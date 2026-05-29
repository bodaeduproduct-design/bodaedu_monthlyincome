"""수업(lesson_enrollments) → 월별 수납(monthly_payment_records) 자동 생성/갱신.

목표:
- 진행 중 수업: 시작월 ~ 익월(다음 달)까지 매월 레코드 유지 (미리 매출 파악)
- 종료/해지 수업: 시작월 ~ 종료(해지)월까지만 유지, 그 이후 월 레코드는 삭제
- 금액: products + 수업(price_type, 요일) 기준 자동 산출 (payment_pricing)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from .enrollment_billing import enrollment_covers_billing_month, parse_date_only
from .models import LessonEnrollment, MonthlyPaymentRecord, Product, TeacherProfile, User
from .payment_pricing import apply_pricing_to_payment_row
from .teacher_commission import resolve_commission_rate


@dataclass(frozen=True)
class MonthKey:
    year: int
    month: int

    @property
    def text(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"


def _month_key(d: date) -> MonthKey:
    return MonthKey(d.year, d.month)


def _compare_month_keys(a: MonthKey, b: MonthKey) -> int:
    if (a.year, a.month) < (b.year, b.month):
        return -1
    if (a.year, a.month) > (b.year, b.month):
        return 1
    return 0


def _min_month_key(a: MonthKey, b: MonthKey) -> MonthKey:
    return a if _compare_month_keys(a, b) <= 0 else b


def _add_months(mk: MonthKey, months: int) -> MonthKey:
    y, m = mk.year, mk.month + months
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    return MonthKey(y, m)


def _month_iter(start: MonthKey, end: MonthKey) -> Iterable[MonthKey]:
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield MonthKey(y, m)
        m += 1
        if m > 12:
            m = 1
            y += 1


def _billing_unit_for_enrollment(db: Session, enrollment: LessonEnrollment) -> str:
    price_type = str(enrollment.price_type or "").strip().lower()
    if price_type in ("session", "per_session"):
        return "per_session"
    if enrollment.product_id:
        unit = db.query(Product.billing_unit).filter(Product.id == enrollment.product_id).scalar()
        unit = str(unit or "").strip()
        if unit in ("monthly", "per_session"):
            return unit
    return "monthly"


def _commission_rate_for_enrollment(
    db: Session,
    enrollment: LessonEnrollment,
    billing_month: str,
) -> float:
    teacher_name = (
        db.query(User.name)
        .join(TeacherProfile, TeacherProfile.user_id == User.id)
        .filter(TeacherProfile.id == enrollment.teacher_id)
        .scalar()
    )
    return resolve_commission_rate(str(teacher_name or ""), enrollment, billing_month)


def _last_billing_month_key(enrollment: LessonEnrollment, *, as_of: date) -> Optional[MonthKey]:
    """수납 레코드를 만들 마지막 청구월. 진행 중이면 as_of 월 + 익월."""
    start = parse_date_only(enrollment.start_date)
    if not start:
        return None

    cap = _month_key(as_of)
    end = parse_date_only(enrollment.end_date)
    cancelled = parse_date_only(enrollment.cancelled_at)

    if end:
        cap = _min_month_key(cap, _month_key(end))
    if cancelled:
        cap = _min_month_key(cap, _month_key(cancelled))

    if not end and not cancelled:
        cap = _add_months(_month_key(as_of), 1)

    return cap


def _get_or_create_monthly_row(
    db: Session,
    enrollment: LessonEnrollment,
    mk: MonthKey,
    *,
    unit: str,
    rate: float,
) -> tuple[MonthlyPaymentRecord, bool]:
    """행 조회/생성. (row, created)"""
    existing = (
        db.query(MonthlyPaymentRecord)
        .filter(
            MonthlyPaymentRecord.enrollment_id == enrollment.id,
            MonthlyPaymentRecord.billing_month == mk.text,
        )
        .first()
    )
    if existing:
        before = (existing.student_id, existing.teacher_id, existing.billing_unit, existing.commission_rate)
        existing.student_id = enrollment.student_id
        existing.teacher_id = enrollment.teacher_id
        if not existing.billing_unit:
            existing.billing_unit = unit
        if existing.commission_rate is None:
            existing.commission_rate = rate
        after = (existing.student_id, existing.teacher_id, existing.billing_unit, existing.commission_rate)
        return existing, before != after

    row = MonthlyPaymentRecord(
        billing_month=mk.text,
        enrollment_id=enrollment.id,
        student_id=enrollment.student_id,
        teacher_id=enrollment.teacher_id,
        billing_unit=unit,
        total_sessions=0,
        completed_sessions=0,
        base_amount=0,
        special_amount=0,
        refund_amount=0,
        final_amount=0,
        commission_rate=rate,
        payment_tag="unpaid",
        memo=None,
    )
    db.add(row)
    db.flush()
    return row, True


def prune_payment_records_outside_enrollment(db: Session, enrollment: LessonEnrollment) -> int:
    """종료일·해지일 이후(또는 수업 기간 밖) 월별 수납 행 삭제."""
    rows = (
        db.query(MonthlyPaymentRecord)
        .filter(MonthlyPaymentRecord.enrollment_id == enrollment.id)
        .all()
    )
    removed = 0
    for row in rows:
        if not enrollment_covers_billing_month(enrollment, row.billing_month):
            db.delete(row)
            removed += 1
    if removed:
        db.flush()
    return removed


def sync_payment_records_for_enrollment(
    db: Session,
    enrollment: LessonEnrollment,
    *,
    as_of: Optional[date] = None,
    product: Optional[Product] = None,
) -> int:
    """단일 수업의 유효 청구월 범위에 맞춰 월별 수납 레코드·금액을 맞춥니다."""
    as_of = as_of or date.today()
    start = parse_date_only(enrollment.start_date)
    if not start:
        return prune_payment_records_outside_enrollment(db, enrollment)

    if product is None and enrollment.product_id:
        product = db.get(Product, enrollment.product_id)

    last_key = _last_billing_month_key(enrollment, as_of=as_of)
    if not last_key:
        return prune_payment_records_outside_enrollment(db, enrollment)

    start_key = _month_key(start)
    if _compare_month_keys(start_key, last_key) > 0:
        return prune_payment_records_outside_enrollment(db, enrollment)

    unit = _billing_unit_for_enrollment(db, enrollment)
    changed = 0

    for mk in _month_iter(start_key, last_key):
        if not enrollment_covers_billing_month(enrollment, mk.text):
            continue
        rate = _commission_rate_for_enrollment(db, enrollment, mk.text)
        row, row_changed = _get_or_create_monthly_row(db, enrollment, mk, unit=unit, rate=rate)
        if row_changed:
            changed += 1
        if apply_pricing_to_payment_row(db, row, enrollment, product):
            changed += 1

    changed += prune_payment_records_outside_enrollment(db, enrollment)
    db.flush()
    return changed


def sync_monthly_payment_records_from_enrollments(
    db: Session,
    *,
    as_of: Optional[date] = None,
) -> int:
    """
    모든 수업에 대해 월별 수납 레코드를 보장합니다.
    - 진행 중: 시작월 ~ 익월
    - 종료/해지: 시작월 ~ 종료(해지)월, 이후 월은 삭제
    - 금액: 상품·가격유형·요일 기준 자동 계산
    """
    as_of = as_of or date.today()
    changed = 0
    rows = (
        db.query(LessonEnrollment)
        .filter(and_(LessonEnrollment.start_date.isnot(None), LessonEnrollment.start_date != ""))
        .all()
    )

    product_cache: dict[int, Product] = {}
    for enrollment in rows:
        product = None
        if enrollment.product_id:
            pid = int(enrollment.product_id)
            product = product_cache.get(pid)
            if product is None:
                product = db.get(Product, pid)
                if product:
                    product_cache[pid] = product
        changed += sync_payment_records_for_enrollment(
            db, enrollment, as_of=as_of, product=product
        )

    return changed
