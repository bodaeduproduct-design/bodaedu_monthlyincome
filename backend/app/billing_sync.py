"""수업(lesson_enrollments) 시범 정보 → 선생님 정산(settlements). 시범비는 월별 수납(monthly_payment_records)에 넣지 않음."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import LessonEnrollment, MonthlyPaymentRecord, Product, Settlement
from .teacher_commission import is_company_retained_teacher, teacher_name_by_profile_id, teacher_payout_commission_rate

DEFAULT_WITHHOLDING_RATE = 3.3
TRIAL_FEE_AMOUNT = 10_000
TRIAL_SETTLEMENT_TYPE = "trial"


def trial_month_from_date(trial_date: str) -> Optional[str]:
    if not trial_date:
        return None
    text = str(trial_date).strip()
    if len(text) >= 7 and text[4] == "-":
        return text[:7]
    return None


def normalize_enrollment_trial(enrollment: LessonEnrollment) -> None:
    if enrollment.trial_date and not enrollment.trial_month:
        enrollment.trial_month = trial_month_from_date(str(enrollment.trial_date))


def enrollment_has_trial_window(enrollment: LessonEnrollment) -> bool:
    if not enrollment.trial_date or not str(enrollment.trial_date).strip():
        return False
    if not enrollment.trial_month:
        enrollment.trial_month = trial_month_from_date(str(enrollment.trial_date))
    return bool(enrollment.trial_month)


def resolve_enrollment_trial_fee(enrollment: LessonEnrollment, *, persist: bool = True) -> int:
    """
    시범비 = 회사→선생님 지급. lesson_enrollments.trial_fee에만 둡니다.
    시범일·시범월 있는데 0원이면 10,000원.
    """
    normalize_enrollment_trial(enrollment)
    if not enrollment_has_trial_window(enrollment):
        return 0
    fee = int(enrollment.trial_fee or 0)
    if fee <= 0:
        fee = TRIAL_FEE_AMOUNT
    if persist and int(enrollment.trial_fee or 0) != fee:
        enrollment.trial_fee = fee
    return fee


def clear_trial_from_payment_records(db: Session, enrollment_id: Optional[int] = None) -> int:
    """
    monthly_payment_records는 학생 수납 전용.
    시범만 위해 만들어진 수납 행(payment_tag=trial, 수납 0)은 제거.
    """
    from sqlalchemy import delete, update

    rem = delete(MonthlyPaymentRecord).where(
        MonthlyPaymentRecord.payment_tag == "trial",
        MonthlyPaymentRecord.final_amount == 0,
    )
    if enrollment_id is not None:
        rem = rem.where(MonthlyPaymentRecord.enrollment_id == enrollment_id)
    deleted = db.execute(rem).rowcount or 0

    fix_tag = (
        update(MonthlyPaymentRecord)
        .where(
            MonthlyPaymentRecord.payment_tag == "trial",
            MonthlyPaymentRecord.final_amount > 0,
        )
        .values(payment_tag="regular")
    )
    if enrollment_id is not None:
        fix_tag = fix_tag.where(MonthlyPaymentRecord.enrollment_id == enrollment_id)
    tagged = db.execute(fix_tag).rowcount or 0

    db.expire_all()
    return int(deleted) + int(tagged)


def _settlement_type_for_product(product: Optional[Product]) -> str:
    if product and product.billing_unit in ("monthly", "per_session"):
        return product.billing_unit
    return "monthly"


def _recalculate_settlement(row: Settlement, db: Optional[Session] = None) -> None:
    if db is not None and is_company_retained_teacher(teacher_name_by_profile_id(db, int(row.teacher_id or 0))):
        row.pre_tax_amount = 0
        row.withholding_amount = 0
        row.net_amount = 0
        return

    rate = float(row.commission_rate or 60.0)
    gross = int(row.gross_amount or 0)
    trial = int(row.trial_fee or 0)
    withholding_rate = float(row.withholding_rate if row.withholding_rate is not None else DEFAULT_WITHHOLDING_RATE)

    if row.settlement_type == TRIAL_SETTLEMENT_TYPE:
        pre_tax = trial
    else:
        pre_tax = int(round(gross * rate / 100.0)) + trial
    withholding = int(round(pre_tax * withholding_rate / 100.0))
    net = pre_tax - withholding

    row.pre_tax_amount = pre_tax
    row.withholding_amount = withholding
    row.net_amount = net


def _sum_teacher_trial_fee(db: Session, teacher_id: int, billing_month: str) -> int:
    """선생님·시범월 시범비 = lesson_enrollments.trial_fee 합."""
    total = (
        db.query(func.coalesce(func.sum(LessonEnrollment.trial_fee), 0))
        .filter(
            LessonEnrollment.teacher_id == teacher_id,
            LessonEnrollment.trial_month == billing_month,
            LessonEnrollment.trial_fee > 0,
        )
        .scalar()
    )
    return int(total or 0)


def _clear_trial_from_lesson_settlement_rows(db: Session, teacher_id: int, billing_month: str) -> None:
    for stype in ("monthly", "per_session"):
        row = (
            db.query(Settlement)
            .filter(
                Settlement.teacher_id == teacher_id,
                Settlement.billing_month == billing_month,
                Settlement.settlement_type == stype,
            )
            .first()
        )
        if not row:
            continue
        if int(row.gross_amount or 0) == 0 and int(row.trial_fee or 0) > 0:
            row.trial_fee = 0
            _recalculate_settlement(row, db)


def _find_lesson_settlement_with_gross(
    db: Session, teacher_id: int, billing_month: str, preferred_type: str
) -> Optional[Settlement]:
    preferred = (
        db.query(Settlement)
        .filter(
            Settlement.teacher_id == teacher_id,
            Settlement.billing_month == billing_month,
            Settlement.settlement_type == preferred_type,
            Settlement.gross_amount > 0,
        )
        .first()
    )
    if preferred:
        return preferred
    return (
        db.query(Settlement)
        .filter(
            Settlement.teacher_id == teacher_id,
            Settlement.billing_month == billing_month,
            Settlement.settlement_type.in_(("monthly", "per_session")),
            Settlement.gross_amount > 0,
        )
        .first()
    )


def _upsert_teacher_settlement_trial(
    db: Session,
    *,
    teacher_id: int,
    billing_month: str,
    lesson_settlement_type: str,
    commission_rate: float,
) -> Optional[Settlement]:
    trial_total = _sum_teacher_trial_fee(db, teacher_id, billing_month)
    _clear_trial_from_lesson_settlement_rows(db, teacher_id, billing_month)

    trial_row = (
        db.query(Settlement)
        .filter(
            Settlement.teacher_id == teacher_id,
            Settlement.billing_month == billing_month,
            Settlement.settlement_type == TRIAL_SETTLEMENT_TYPE,
        )
        .first()
    )

    if trial_total <= 0:
        if trial_row:
            db.delete(trial_row)
        return None

    lesson_row = _find_lesson_settlement_with_gross(db, teacher_id, billing_month, lesson_settlement_type)
    if lesson_row:
        lesson_row.trial_fee = trial_total
        _recalculate_settlement(lesson_row, db)
        if trial_row:
            db.delete(trial_row)
        return lesson_row

    if trial_row:
        trial_row.trial_fee = trial_total
        trial_row.gross_amount = 0
        if trial_row.commission_rate is None:
            trial_row.commission_rate = commission_rate
        _recalculate_settlement(trial_row, db)
        return trial_row

    trial_row = Settlement(
        billing_month=billing_month,
        teacher_id=teacher_id,
        settlement_type=TRIAL_SETTLEMENT_TYPE,
        gross_amount=0,
        trial_fee=trial_total,
        commission_rate=commission_rate,
        withholding_rate=DEFAULT_WITHHOLDING_RATE,
        status="pending",
    )
    _recalculate_settlement(trial_row, db)
    db.add(trial_row)
    return trial_row


def sync_enrollment_trial_settlement(
    db: Session,
    enrollment: LessonEnrollment | int,
    *,
    previous_trial_month: Optional[str] = None,
) -> dict[str, Optional[int]]:
    """수업 시범비 → 선생님 settlements만 반영 (수납 레코드는 건드리지 않음)."""
    row = enrollment if isinstance(enrollment, LessonEnrollment) else db.get(LessonEnrollment, enrollment)
    if not row:
        raise ValueError("수업(학생↔선생님)을 찾을 수 없습니다.")

    normalize_enrollment_trial(row)
    clear_trial_from_payment_records(db, row.id)

    if enrollment_has_trial_window(row):
        resolve_enrollment_trial_fee(row, persist=True)
    else:
        row.trial_fee = row.trial_fee or 0

    product = db.get(Product, row.product_id) if row.product_id else None
    lesson_settlement_type = _settlement_type_for_product(product)
    teacher_name = teacher_name_by_profile_id(db, int(row.teacher_id))
    commission_rate = teacher_payout_commission_rate(teacher_name, row, str(row.trial_month or ""))

    months_to_recalc: set[str] = set()
    if row.trial_month:
        months_to_recalc.add(row.trial_month)
    if previous_trial_month:
        months_to_recalc.add(previous_trial_month)

    settlement_id = None
    for billing_month in months_to_recalc:
        settlement = _upsert_teacher_settlement_trial(
            db,
            teacher_id=row.teacher_id,
            billing_month=billing_month,
            lesson_settlement_type=lesson_settlement_type,
            commission_rate=commission_rate,
        )
        if billing_month == row.trial_month and settlement:
            settlement_id = settlement.id

    db.flush()
    return {
        "enrollment_id": row.id,
        "trial_month": row.trial_month,
        "enrollment_trial_fee": int(row.trial_fee or 0),
        "settlement_id": settlement_id,
    }


# 하위 호환 별칭
sync_subscription_billing = sync_enrollment_trial_settlement
sync_subscription_trial_settlement = sync_enrollment_trial_settlement
normalize_subscription_trial = normalize_enrollment_trial
subscription_has_trial_window = enrollment_has_trial_window
resolve_subscription_trial_fee = resolve_enrollment_trial_fee
clear_trial_from_lesson_records = clear_trial_from_payment_records


def _delete_empty_settlement_rows(db: Session) -> None:
    rows = db.query(Settlement).all()
    for row in rows:
        if (
            int(row.gross_amount or 0) == 0
            and int(row.trial_fee or 0) == 0
            and int(row.pre_tax_amount or 0) == 0
            and int(row.net_amount or 0) == 0
        ):
            db.delete(row)


def migrate_trial_only_monthly_settlements(db: Session) -> int:
    moved = 0
    rows = (
        db.query(Settlement)
        .filter(Settlement.settlement_type.in_(("monthly", "per_session")))
        .filter(Settlement.gross_amount == 0)
        .filter(Settlement.trial_fee > 0)
        .all()
    )
    for row in rows:
        existing_trial = (
            db.query(Settlement)
            .filter(
                Settlement.teacher_id == row.teacher_id,
                Settlement.billing_month == row.billing_month,
                Settlement.settlement_type == TRIAL_SETTLEMENT_TYPE,
            )
            .first()
        )
        if existing_trial:
            existing_trial.trial_fee = int(existing_trial.trial_fee or 0) + int(row.trial_fee or 0)
            _recalculate_settlement(existing_trial, db)
            db.delete(row)
        else:
            row.settlement_type = TRIAL_SETTLEMENT_TYPE
            _recalculate_settlement(row, db)
        moved += 1
    return moved


def repair_all_enrollment_trial_sync(db: Session) -> int:
    changed = clear_trial_from_payment_records(db)
    for enrollment in db.query(LessonEnrollment).order_by(LessonEnrollment.id.asc()).all():
        normalize_enrollment_trial(enrollment)
        if enrollment_has_trial_window(enrollment):
            resolve_enrollment_trial_fee(enrollment, persist=True)
    return changed


def sync_all_trial_enrollments(db: Session) -> int:
    migrate_trial_only_monthly_settlements(db)
    changed = clear_trial_from_payment_records(db)

    teacher_months: set[tuple[int, str, str, float]] = set()
    for enrollment in db.query(LessonEnrollment).filter(LessonEnrollment.trial_date.isnot(None)).all():
        normalize_enrollment_trial(enrollment)
        clear_trial_from_payment_records(db, enrollment.id)
        if not enrollment_has_trial_window(enrollment):
            continue
        resolve_enrollment_trial_fee(enrollment, persist=True)
        product = db.get(Product, enrollment.product_id) if enrollment.product_id else None
        stype = _settlement_type_for_product(product)
        rate = float(enrollment.current_commission_rate or enrollment.base_commission_rate or 60.0)
        teacher_months.add((enrollment.teacher_id, enrollment.trial_month, stype, rate))

    for teacher_id, billing_month, stype, rate in teacher_months:
        _upsert_teacher_settlement_trial(
            db,
            teacher_id=teacher_id,
            billing_month=billing_month,
            lesson_settlement_type=stype,
            commission_rate=rate,
        )

    _delete_empty_settlement_rows(db)
    return changed


sync_all_trial_subscriptions = sync_all_trial_enrollments
repair_all_subscription_lesson_trial_sync = repair_all_enrollment_trial_sync
