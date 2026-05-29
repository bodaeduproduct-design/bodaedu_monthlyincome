"""특이금액(수동 청구) 시드·보정."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import MonthlyPaymentRecord, StudentProfile, TeacherProfile, User
from .payment_pricing import has_special_amount, recompute_payment_final_amount
from .settlement_sync import sync_settlements_from_payments

# 서재현 선생님 · 2026-05 특이금액
SEOJAEHYUN_MAY_2026_SPECIALS: list[dict[str, Any]] = [
    {"student_name": "이도윤", "special_amount": 140_000},
    {"student_name": "김바울", "special_amount": 80_000},
    {"student_name": "한형욱", "special_amount": 150_000},
]

BILLING_MONTH = "2026-05"
TEACHER_NAME = "서재현"


def _teacher_id_by_name(db: Session, name: str) -> int | None:
    row = (
        db.query(TeacherProfile.id)
        .join(User, User.id == TeacherProfile.user_id)
        .filter(User.name == name)
        .first()
    )
    return int(row[0]) if row else None


def _student_id_by_name(db: Session, name: str) -> int | None:
    row = (
        db.query(StudentProfile.id)
        .join(User, User.id == StudentProfile.user_id)
        .filter(User.name == name)
        .first()
    )
    return int(row[0]) if row else None


def apply_special_payment(
    db: Session,
    *,
    teacher_id: int,
    student_id: int,
    billing_month: str,
    special_amount: int,
) -> str | None:
    row = (
        db.query(MonthlyPaymentRecord)
        .filter(
            MonthlyPaymentRecord.teacher_id == teacher_id,
            MonthlyPaymentRecord.student_id == student_id,
            MonthlyPaymentRecord.billing_month == billing_month,
        )
        .order_by(MonthlyPaymentRecord.id.asc())
        .first()
    )
    if not row:
        return f"missing payment row: teacher={teacher_id} student={student_id} {billing_month}"

    row.special_amount = int(special_amount)
    recompute_payment_final_amount(row)
    if row.final_amount > 0:
        row.payment_status = "paid"
    return None


def ensure_seojaehyun_may_2026_special_payments(db: Session) -> list[str]:
    log: list[str] = []
    teacher_id = _teacher_id_by_name(db, TEACHER_NAME)
    if not teacher_id:
        log.append(f"teacher not found: {TEACHER_NAME}")
        return log

    for spec in SEOJAEHYUN_MAY_2026_SPECIALS:
        student_id = _student_id_by_name(db, spec["student_name"])
        if not student_id:
            log.append(f"student not found: {spec['student_name']}")
            continue
        err = apply_special_payment(
            db,
            teacher_id=teacher_id,
            student_id=student_id,
            billing_month=BILLING_MONTH,
            special_amount=int(spec["special_amount"]),
        )
        if err:
            log.append(err)
            continue
        log.append(
            f"special {TEACHER_NAME}/{spec['student_name']} {BILLING_MONTH} "
            f"₩{spec['special_amount']:,}"
        )

    sync_settlements_from_payments(db, billing_month=BILLING_MONTH, teacher_id=teacher_id)
    log.append(f"synced settlements {TEACHER_NAME} {BILLING_MONTH}")
    return log


def refresh_special_payment_final_amounts(db: Session) -> int:
    """DB에 special_amount만 있고 final이 어긋난 행 일괄 보정."""
    rows = db.query(MonthlyPaymentRecord).all()
    changed = 0
    for row in rows:
        if not has_special_amount(row):
            continue
        before = int(row.final_amount or 0)
        recompute_payment_final_amount(row)
        if int(row.final_amount or 0) != before:
            changed += 1
    return changed
