"""월별 수납(monthly_payment_records) → 선생님 정산(settlements) 자동 동기화."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import MonthlyPaymentRecord, Settlement


DEFAULT_WITHHOLDING_RATE = 3.3


@dataclass(frozen=True)
class SettlementAgg:
    gross_amount: int
    weighted_rate_sum: float

    @property
    def commission_rate(self) -> float:
        if self.gross_amount <= 0:
            return 60.0
        return float(self.weighted_rate_sum / float(self.gross_amount))


def _safe_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _recalculate_settlement(row: Settlement) -> None:
    rate = float(row.commission_rate or 60.0)
    gross = _safe_int(row.gross_amount)
    trial = _safe_int(row.trial_fee)
    withholding_rate = float(row.withholding_rate if row.withholding_rate is not None else DEFAULT_WITHHOLDING_RATE)

    pre_tax = int(round(gross * rate / 100.0)) + trial
    withholding = int(round(pre_tax * withholding_rate / 100.0))
    net = pre_tax - withholding

    row.pre_tax_amount = pre_tax
    row.withholding_amount = withholding
    row.net_amount = net


def sync_settlements_from_payments(
    db: Session,
    *,
    billing_month: Optional[str] = None,
    teacher_id: Optional[int] = None,
) -> int:
    """
    monthly_payment_records(학생 수납) 기반으로 settlements(선생님 지급)을 upsert.

    - settlement_type: monthly_payment_records.billing_unit (monthly|per_session)
    - gross_amount: SUM(final_amount)
    - commission_rate: 가중평균( final_amount * commission_rate / SUM(final_amount) )
    """
    q = db.query(
        MonthlyPaymentRecord.teacher_id,
        MonthlyPaymentRecord.billing_month,
        MonthlyPaymentRecord.billing_unit,
        func.count(MonthlyPaymentRecord.id).label("row_count"),
        func.coalesce(func.sum(MonthlyPaymentRecord.final_amount), 0).label("gross_amount"),
        func.coalesce(
            func.sum(MonthlyPaymentRecord.final_amount * func.coalesce(MonthlyPaymentRecord.commission_rate, 60.0)),
            0.0,
        ).label("weighted_rate_sum"),
    )

    if billing_month:
        q = q.filter(MonthlyPaymentRecord.billing_month == billing_month)
    if teacher_id:
        q = q.filter(MonthlyPaymentRecord.teacher_id == teacher_id)

    q = q.group_by(
        MonthlyPaymentRecord.teacher_id,
        MonthlyPaymentRecord.billing_month,
        MonthlyPaymentRecord.billing_unit,
    )

    changed = 0
    for t_id, month, unit, row_count, gross_sum, weighted_rate_sum in q.all():
        unit = str(unit or "").strip() or "monthly"
        if unit not in ("monthly", "per_session"):
            continue

        if _safe_int(row_count) <= 0:
            continue

        agg = SettlementAgg(gross_amount=_safe_int(gross_sum), weighted_rate_sum=float(weighted_rate_sum or 0.0))

        row = (
            db.query(Settlement)
            .filter(
                Settlement.teacher_id == int(t_id),
                Settlement.billing_month == str(month),
                Settlement.settlement_type == unit,
            )
            .first()
        )

        if not row:
            row = Settlement(
                billing_month=str(month),
                teacher_id=int(t_id),
                settlement_type=unit,
                gross_amount=agg.gross_amount,
                trial_fee=0,
                commission_rate=agg.commission_rate,
                withholding_rate=DEFAULT_WITHHOLDING_RATE,
                status="pending",
            )
            _recalculate_settlement(row)
            db.add(row)
            changed += 1
            continue

        before = (row.gross_amount, row.commission_rate, row.pre_tax_amount, row.net_amount)
        row.gross_amount = agg.gross_amount
        row.commission_rate = agg.commission_rate
        _recalculate_settlement(row)
        after = (row.gross_amount, row.commission_rate, row.pre_tax_amount, row.net_amount)
        if before != after:
            changed += 1

    db.flush()
    return changed


def prune_settlements_without_payments(
    db: Session,
    *,
    billing_months: Optional[list[str]] = None,
    teacher_ids: Optional[list[int]] = None,
) -> int:
    """월별 수납이 없어진 (teacher, month, unit) 조합의 정산 행 제거."""
    q = db.query(Settlement)
    if billing_months:
        q = q.filter(Settlement.billing_month.in_(billing_months))
    if teacher_ids:
        q = q.filter(Settlement.teacher_id.in_(teacher_ids))

    removed = 0
    for settlement in q.all():
        payment_count = (
            db.query(MonthlyPaymentRecord)
            .filter(
                MonthlyPaymentRecord.teacher_id == settlement.teacher_id,
                MonthlyPaymentRecord.billing_month == settlement.billing_month,
                MonthlyPaymentRecord.billing_unit == settlement.settlement_type,
            )
            .count()
        )
        if payment_count == 0:
            db.delete(settlement)
            removed += 1
    if removed:
        db.flush()
    return removed

