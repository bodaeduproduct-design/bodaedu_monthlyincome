"""전월 회차 이월 → 익월 선생님 보강 정산."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from .models import MonthlyPaymentRecord, SessionCarryover, Settlement, StudentProfile, User
from .settlement_sync import DEFAULT_WITHHOLDING_RATE, _recalculate_settlement, _safe_int


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def carryover_gross_amount(carryover: SessionCarryover) -> int:
    return _safe_int(carryover.unit_price) * max(1, _safe_int(carryover.session_count))


def carryover_teacher_share(carryover: SessionCarryover) -> int:
    gross = carryover_gross_amount(carryover)
    rate = float(carryover.commission_rate or 60.0)
    return int(round(gross * rate / 100.0))


def carryover_net_amount(carryover: SessionCarryover) -> int:
    from .settlement_detail import net_after_settlement_fee

    return net_after_settlement_fee(carryover_teacher_share(carryover))


def list_carryovers_for_teacher_month(
    db: Session,
    *,
    teacher_id: int,
    settlement_billing_month: Optional[str] = None,
    source_billing_month: Optional[str] = None,
) -> list[dict[str, Any]]:
    q = db.query(SessionCarryover).filter(SessionCarryover.teacher_id == teacher_id)
    if settlement_billing_month:
        q = q.filter(SessionCarryover.settlement_billing_month == settlement_billing_month)
    if source_billing_month:
        q = q.filter(SessionCarryover.source_billing_month == source_billing_month)
    rows = q.order_by(SessionCarryover.source_billing_month.asc(), SessionCarryover.id.asc()).all()
    items: list[dict[str, Any]] = []
    for row in rows:
        student_name = (
            db.query(User.name)
            .join(StudentProfile, StudentProfile.user_id == User.id)
            .filter(StudentProfile.id == row.student_id)
            .scalar()
        )
        pre_tax = carryover_teacher_share(row)
        items.append(
            {
                "id": row.id,
                "enrollment_id": row.enrollment_id,
                "student_id": row.student_id,
                "student_name": student_name,
                "source_billing_month": row.source_billing_month,
                "settlement_billing_month": row.settlement_billing_month,
                "session_count": _safe_int(row.session_count),
                "unit_price": _safe_int(row.unit_price),
                "commission_rate": float(row.commission_rate or 60.0),
                "gross_amount": carryover_gross_amount(row),
                "teacher_share": pre_tax,
                "net_amount": carryover_net_amount(row),
                "status": row.status,
                "memo": row.memo,
            }
        )
    return items


def teacher_carryover_net_total(db: Session, teacher_id: int, settlement_billing_month: str) -> int:
    rows = (
        db.query(SessionCarryover)
        .filter(
            SessionCarryover.teacher_id == teacher_id,
            SessionCarryover.settlement_billing_month == settlement_billing_month,
            SessionCarryover.status.in_(("scheduled", "settled")),
        )
        .all()
    )
    return sum(carryover_net_amount(row) for row in rows)


def sync_carryover_settlement(db: Session, carryover: SessionCarryover) -> Settlement:
    """이월 1건당 settlement_type=carryover 행 1개."""
    settlement_type = "carryover"
    gross = carryover_gross_amount(carryover)
    row = Settlement(
        billing_month=carryover.settlement_billing_month,
        teacher_id=carryover.teacher_id,
        settlement_type=settlement_type,
        gross_amount=gross,
        trial_fee=0,
        commission_rate=float(carryover.commission_rate or 60.0),
        withholding_rate=DEFAULT_WITHHOLDING_RATE,
        status="pending",
    )
    db.add(row)
    _recalculate_settlement(row)
    carryover.status = "settled"
    db.flush()
    return row


def sync_carryover_settlements(db: Session, *, settlement_billing_month: Optional[str] = None) -> int:
    q = db.query(SessionCarryover).filter(SessionCarryover.status.in_(("scheduled", "settled")))
    if settlement_billing_month:
        q = q.filter(SessionCarryover.settlement_billing_month == settlement_billing_month)
        db.query(Settlement).filter(
            Settlement.billing_month == settlement_billing_month,
            Settlement.settlement_type == "carryover",
        ).delete(synchronize_session=False)
    count = 0
    for carryover in q.all():
        sync_carryover_settlement(db, carryover)
        count += 1
    return count


def _next_billing_month(billing_month: str) -> str:
    year_s, month_s = str(billing_month).split("-", 1)
    year = int(year_s)
    month = int(month_s)
    month += 1
    if month > 12:
        year += 1
        month = 1
    return f"{year:04d}-{month:02d}"


def sync_carryovers_from_per_session_gaps(db: Session) -> list[str]:
    """회차별 미진행(예정>진행) → 익월 선생님 이월 정산 자동 생성."""
    from .payment_pricing import per_session_unit_price_from_row

    log: list[str] = []
    rows = (
        db.query(MonthlyPaymentRecord)
        .filter(MonthlyPaymentRecord.billing_unit == "per_session")
        .all()
    )
    for payment in rows:
        total = _safe_int(payment.total_sessions)
        completed = _safe_int(payment.completed_sessions)
        if total <= 0 or completed >= total:
            continue
        gap = total - completed
        unit_price = per_session_unit_price_from_row(payment)
        if unit_price <= 0:
            continue
        target_month = _next_billing_month(payment.billing_month)
        existing = (
            db.query(SessionCarryover)
            .filter(
                SessionCarryover.enrollment_id == payment.enrollment_id,
                SessionCarryover.source_billing_month == payment.billing_month,
                SessionCarryover.settlement_billing_month == target_month,
            )
            .first()
        )
        memo = (
            f"{payment.billing_month} 미진행 {gap}회 → {target_month} 보강. "
            "학생 수납은 예정 전액, 선생님 익월 이월 정산."
        )
        if existing:
            existing.session_count = gap
            existing.unit_price = unit_price
            existing.commission_rate = float(payment.commission_rate or 60.0)
            existing.source_payment_record_id = payment.id
            existing.memo = memo
            existing.status = "scheduled"
        else:
            db.add(
                SessionCarryover(
                    enrollment_id=payment.enrollment_id,
                    student_id=payment.student_id,
                    teacher_id=payment.teacher_id,
                    source_payment_record_id=payment.id,
                    source_billing_month=payment.billing_month,
                    settlement_billing_month=target_month,
                    session_count=gap,
                    unit_price=unit_price,
                    commission_rate=float(payment.commission_rate or 60.0),
                    status="scheduled",
                    memo=memo,
                    created_at=_now_iso(),
                )
            )
        payment.memo = memo
        log.append(f"carryover gap {payment.billing_month}→{target_month} enrollment={payment.enrollment_id} x{gap}")
    db.flush()
    return log


def ensure_may_june_2026_carryovers(db: Session) -> list[str]:
    """김태희·민은후 5월→6월 이월 보강 (idempotent)."""
    log: list[str] = []
    specs = [
        {
            "source_payment_record_id": 1,
            "enrollment_id": 83,
            "student_id": None,
            "teacher_id": 9,
            "teacher_name": "김태희",
            "student_name": "이우진",
            "source_billing_month": "2026-05",
            "settlement_billing_month": "2026-06",
            "session_count": 1,
            "unit_price": 55000,
            "commission_rate": 60.0,
            "memo": "5월 미진행 1회(10→9) → 6월 보강. 학생 수납은 10회 전액, 선생님 6월에 1회 추가 정산.",
        },
        {
            "source_payment_record_id": 3,
            "enrollment_id": 87,
            "student_id": None,
            "teacher_id": 21,
            "teacher_name": "민은후",
            "student_name": "신소은",
            "source_billing_month": "2026-05",
            "settlement_billing_month": "2026-06",
            "session_count": 1,
            "unit_price": 75000,
            "commission_rate": 60.0,
            "memo": "5월 미진행 1회(4→3) → 6월 보강. 학생 수납은 4회 전액, 선생님 6월에 1회 추가 정산.",
        },
    ]

    for spec in specs:
        payment = db.query(MonthlyPaymentRecord).filter(MonthlyPaymentRecord.id == spec["source_payment_record_id"]).first()
        if not payment:
            log.append(f"skip: payment #{spec['source_payment_record_id']} 없음")
            continue
        spec["student_id"] = int(payment.student_id)
        spec["teacher_id"] = int(payment.teacher_id)

        existing = (
            db.query(SessionCarryover)
            .filter(
                SessionCarryover.enrollment_id == spec["enrollment_id"],
                SessionCarryover.source_billing_month == spec["source_billing_month"],
                SessionCarryover.settlement_billing_month == spec["settlement_billing_month"],
            )
            .first()
        )
        if existing:
            existing.session_count = spec["session_count"]
            existing.unit_price = spec["unit_price"]
            existing.commission_rate = spec["commission_rate"]
            existing.memo = spec["memo"]
            existing.source_payment_record_id = spec["source_payment_record_id"]
            existing.status = "scheduled"
            log.append(f"update carryover: {spec['teacher_name']} / {spec['student_name']}")
        else:
            db.add(
                SessionCarryover(
                    enrollment_id=spec["enrollment_id"],
                    student_id=spec["student_id"],
                    teacher_id=spec["teacher_id"],
                    source_payment_record_id=spec["source_payment_record_id"],
                    source_billing_month=spec["source_billing_month"],
                    settlement_billing_month=spec["settlement_billing_month"],
                    session_count=spec["session_count"],
                    unit_price=spec["unit_price"],
                    commission_rate=spec["commission_rate"],
                    status="scheduled",
                    memo=spec["memo"],
                    created_at=_now_iso(),
                )
            )
            log.append(f"create carryover: {spec['teacher_name']} / {spec['student_name']}")

        payment.memo = (
            f"{spec['source_billing_month']} 미진행 {spec['session_count']}회 "
            f"→ {spec['settlement_billing_month']} 보강 예정(선생님 이월 정산)"
        )

    db.flush()
    sync_carryover_settlements(db, settlement_billing_month="2026-06")
    log.append("synced June 2026 carryover settlements")
    return log
