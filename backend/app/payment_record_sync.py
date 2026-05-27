"""수업(lesson_enrollments) → 월별 수납(monthly_payment_records) 자동 생성/갱신.

목표:
- 본수업(start_date)이 있고, 종료/해지가 없는 수업은 시작월부터 매월 레코드를 유지
- 수납이 없는 달은 final_amount=0 (미납/예정)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from .enrollment_billing import parse_date_only
from .models import LessonEnrollment, MonthlyPaymentRecord, Product


@dataclass(frozen=True)
class MonthKey:
    year: int
    month: int

    @property
    def text(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"


def _month_key(d: date) -> MonthKey:
    return MonthKey(d.year, d.month)


def _month_iter(start: MonthKey, end: MonthKey) -> Iterable[MonthKey]:
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield MonthKey(y, m)
        m += 1
        if m > 12:
            m = 1
            y += 1


def _billing_unit_for_enrollment(db: Session, enrollment: LessonEnrollment) -> str:
    if enrollment.product_id:
        unit = db.query(Product.billing_unit).filter(Product.id == enrollment.product_id).scalar()
        unit = str(unit or "").strip()
        if unit in ("monthly", "per_session"):
            return unit
    return "monthly"


def _commission_rate_for_enrollment(enrollment: LessonEnrollment) -> float:
    try:
        return float(enrollment.current_commission_rate or enrollment.base_commission_rate or 60.0)
    except (TypeError, ValueError):
        return 60.0


def sync_monthly_payment_records_from_enrollments(
    db: Session,
    *,
    as_of: Optional[date] = None,
) -> int:
    """
    수업이 '계속 진행 중'인 경우(종료/해지 없음), start_date 월부터 as_of 월까지
    매월 monthly_payment_records를 보장합니다.
    """
    as_of = as_of or date.today()
    end_key = _month_key(as_of)

    changed = 0
    rows = (
        db.query(LessonEnrollment)
        .filter(and_(LessonEnrollment.start_date.isnot(None), LessonEnrollment.start_date != ""))
        .all()
    )

    for enrollment in rows:
        # 해지/종료 수업은 자동 생성 대상에서 제외 (과거 레코드는 남겨둠)
        if enrollment.cancelled_at and str(enrollment.cancelled_at).strip():
            continue
        if enrollment.end_date and str(enrollment.end_date).strip():
            continue

        start = parse_date_only(enrollment.start_date)
        if not start:
            continue

        start_key = _month_key(start)
        unit = _billing_unit_for_enrollment(db, enrollment)
        rate = _commission_rate_for_enrollment(enrollment)

        for mk in _month_iter(start_key, end_key):
            existing = (
                db.query(MonthlyPaymentRecord)
                .filter(
                    MonthlyPaymentRecord.enrollment_id == enrollment.id,
                    MonthlyPaymentRecord.billing_month == mk.text,
                )
                .first()
            )
            if not existing:
                db.add(
                    MonthlyPaymentRecord(
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
                        trial_fee=0,
                        payment_tag="unpaid",
                        memo=None,
                    )
                )
                changed += 1
                continue

            # 기존 레코드는 금액을 건드리지 않고, 관계/메타만 최신화
            before = (existing.student_id, existing.teacher_id, existing.billing_unit, existing.commission_rate)
            existing.student_id = enrollment.student_id
            existing.teacher_id = enrollment.teacher_id
            if not existing.billing_unit:
                existing.billing_unit = unit
            if existing.commission_rate is None:
                existing.commission_rate = rate
            after = (existing.student_id, existing.teacher_id, existing.billing_unit, existing.commission_rate)
            if before != after:
                changed += 1

    db.flush()
    return changed

