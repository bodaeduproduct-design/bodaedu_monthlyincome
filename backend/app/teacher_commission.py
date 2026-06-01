"""선생님·수업 시작일 기준 수수료율 결정 및 수납/정산 반영."""

from __future__ import annotations

from datetime import date
from typing import Any, Optional

from sqlalchemy.orm import Session, aliased

from .enrollment_billing import parse_date_only
from .models import LessonEnrollment, MonthlyPaymentRecord, StudentProfile, TeacherProfile, User
# 고정 수수료율 (개월차 자동 상향 미적용) — 선생님 지급 %
TEACHER_FIXED_COMMISSION_RATES: dict[str, float] = {
    "신태준": 80.0,
    "윤성민": 80.0,
}

# 매출 전액 회사 귀속(선생님 정산 0원). UI·등록상 수수료 100% = 회사 100% 의미.
TEACHER_COMPANY_RETAINED_REVENUE = frozenset({"서재현"})
COMPANY_RETENTION_DISPLAY_RATE = 100.0


def is_company_retained_teacher(teacher_name: str) -> bool:
    return str(teacher_name or "").strip() in TEACHER_COMPANY_RETAINED_REVENUE


def teacher_name_by_profile_id(db: Session, teacher_id: int) -> str:
    name = (
        db.query(User.name)
        .join(TeacherProfile, TeacherProfile.user_id == User.id)
        .filter(TeacherProfile.id == int(teacher_id))
        .scalar()
    )
    return str(name or "").strip()


def expected_commission_rate_by_tenure(start: date, billing_month: str) -> float:
    """개월차: 1~6개월차 60%, 7~12개월차 65%, 13개월차~ 70%."""
    target_month = parse_date_only(f"{billing_month}-01")
    if not target_month:
        return 60.0
    elapsed_months = (target_month.year - start.year) * 12 + (target_month.month - start.month)
    if elapsed_months >= 12:
        return 70.0
    if elapsed_months >= 6:
        return 65.0
    return 60.0


def resolve_commission_rate(
    teacher_name: str,
    enrollment: LessonEnrollment,
    billing_month: str,
) -> float:
    """표시·등록용 수수료율(회사 귀속 선생님은 100%)."""
    name = str(teacher_name or "").strip()
    if name in TEACHER_COMPANY_RETAINED_REVENUE:
        return COMPANY_RETENTION_DISPLAY_RATE

    if name in TEACHER_FIXED_COMMISSION_RATES:
        return float(TEACHER_FIXED_COMMISSION_RATES[name])

    start = parse_date_only(enrollment.start_date)
    if start:
        return expected_commission_rate_by_tenure(start, billing_month)
    try:
        return float(enrollment.current_commission_rate or enrollment.base_commission_rate or 60.0)
    except (TypeError, ValueError):
        return 60.0


def teacher_payout_commission_rate(
    teacher_name: str,
    enrollment: LessonEnrollment,
    billing_month: str,
) -> float:
    """실제 선생님 지급 계산용 수수료율(회사 귀속 선생님은 0%)."""
    if is_company_retained_teacher(teacher_name):
        return 0.0
    return resolve_commission_rate(teacher_name, enrollment, billing_month)


def teacher_settlement_gross_basis(teacher_name: str, gross_basis: int) -> int:
    """선생님 정산 집계 기준 금액 — 회사 귀속 선생님은 0."""
    if is_company_retained_teacher(teacher_name):
        return 0
    return max(0, int(gross_basis or 0))


def _payment_rows_query(
    db: Session,
    *,
    billing_month: Optional[str] = None,
    student_name: Optional[str] = None,
):
    teacher_user = aliased(User)
    student_user = aliased(User)
    q = (
        db.query(MonthlyPaymentRecord, LessonEnrollment, teacher_user.name, student_user.name)
        .join(LessonEnrollment, LessonEnrollment.id == MonthlyPaymentRecord.enrollment_id)
        .join(TeacherProfile, TeacherProfile.id == LessonEnrollment.teacher_id)
        .join(teacher_user, teacher_user.id == TeacherProfile.user_id)
        .join(StudentProfile, StudentProfile.id == LessonEnrollment.student_id)
        .join(student_user, student_user.id == StudentProfile.user_id)
    )
    if billing_month:
        q = q.filter(MonthlyPaymentRecord.billing_month == billing_month)
    if student_name:
        needle = student_name.replace(" ", "")
        q = q.filter(student_user.name.like(f"%{needle}%"))
    return q


def apply_commission_rates_sync(
    db: Session,
    *,
    billing_month: Optional[str] = None,
    student_name: Optional[str] = None,
) -> dict[str, Any]:
    """수납 레코드·수업 enrollment 수수료율을 규칙에 맞게 일괄 갱신 후 정산 재계산."""
    rows = _payment_rows_query(db, billing_month=billing_month, student_name=student_name).all()

    touched_teacher_months: set[tuple[int, str]] = set()
    changed_payments = 0
    enrollment_latest_rate: dict[int, tuple[str, float]] = {}

    for payment, enrollment, teacher_name, _student_name in rows:
        month = str(payment.billing_month)
        display_rate = resolve_commission_rate(teacher_name, enrollment, month)
        payout_rate = teacher_payout_commission_rate(teacher_name, enrollment, month)
        name = str(teacher_name or "").strip()
        current = float(payment.commission_rate or 60.0)
        if abs(current - payout_rate) >= 1e-6:
            payment.commission_rate = payout_rate
            changed_payments += 1
        if name in TEACHER_COMPANY_RETAINED_REVENUE or abs(current - payout_rate) >= 1e-6:
            touched_teacher_months.add((int(payment.teacher_id), month))

        if name in TEACHER_COMPANY_RETAINED_REVENUE:
            enrollment.base_commission_rate = COMPANY_RETENTION_DISPLAY_RATE
            enrollment.current_commission_rate = COMPANY_RETENTION_DISPLAY_RATE
        elif name in TEACHER_FIXED_COMMISSION_RATES:
            fixed = TEACHER_FIXED_COMMISSION_RATES[name]
            enrollment.base_commission_rate = fixed
            enrollment.current_commission_rate = fixed
        else:
            prev = enrollment_latest_rate.get(int(enrollment.id))
            if prev is None or month >= prev[0]:
                enrollment_latest_rate[int(enrollment.id)] = (month, display_rate)

    for enrollment_id, (_month, rate) in enrollment_latest_rate.items():
        enrollment = db.get(LessonEnrollment, enrollment_id)
        if enrollment and float(enrollment.current_commission_rate or 0) != rate:
            enrollment.current_commission_rate = rate

    from .settlement_sync import sync_settlements_from_payments

    for teacher_id, month in sorted(touched_teacher_months):
        sync_settlements_from_payments(db, billing_month=month, teacher_id=teacher_id)

    if touched_teacher_months:
        db.flush()

    return {
        "billing_month": billing_month,
        "student_name": student_name,
        "changed_payments": changed_payments,
        "teacher_months_synced": len(touched_teacher_months),
    }
