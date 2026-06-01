"""선생님 정산 상세 — 운영자용 지급 경로·정규/시범 분리."""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from .models import LessonEnrollment, MonthlyPaymentRecord, Product, Settlement, StudentProfile, User
from .payment_pricing import payment_row_collection_amount, per_session_teacher_settlement_gross
from .teacher_commission import (
    COMPANY_RETENTION_DISPLAY_RATE,
    is_company_retained_teacher,
    resolve_commission_rate,
    teacher_payout_commission_rate,
    teacher_settlement_gross_basis,
)
from .session_carryover import list_carryovers_for_teacher_month, teacher_carryover_net_total
from .settlement_sync import (
    DEFAULT_WITHHOLDING_RATE,
    SETTLEMENT_FEE_MULTIPLIER,
    SETTLEMENT_FEE_RATE,
)

REGULAR_SETTLEMENT_TYPES = frozenset({"monthly", "per_session"})


def _month_short_label(billing_month: Optional[str]) -> str:
    if not billing_month or len(str(billing_month)) < 7:
        return "-"
    try:
        return f"{int(str(billing_month).split('-')[1])}월"
    except ValueError:
        return str(billing_month)


def _build_carryover_label(
    *,
    carryover_in: Optional[dict[str, Any]],
    carryover_out: Optional[dict[str, Any]],
) -> str:
    if carryover_in and _safe_int(carryover_in.get("session_count")) > 0:
        count = _safe_int(carryover_in["session_count"])
        source = _month_short_label(carryover_in.get("source_billing_month"))
        return f"{count}회 ({source} 이월)"
    if carryover_out and _safe_int(carryover_out.get("session_count")) > 0:
        count = _safe_int(carryover_out["session_count"])
        target = _month_short_label(carryover_out.get("settlement_billing_month"))
        return f"{count}회 → {target}"
    return "-"


def _carryover_delta_display(
    *,
    carryover_in: Optional[dict[str, Any]],
    carryover_out: Optional[dict[str, Any]],
) -> tuple[int, str]:
    """이월 회차: 익월로 빠지면 -, 전월에서 들어오면 +."""
    if carryover_out and _safe_int(carryover_out.get("session_count")) > 0:
        count = _safe_int(carryover_out["session_count"])
        return -count, f"-{count}"
    if carryover_in and _safe_int(carryover_in.get("session_count")) > 0:
        count = _safe_int(carryover_in["session_count"])
        return count, f"+{count}"
    return 0, "-"


def _safe_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _safe_float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def teacher_share_from_payment(final_amount: int, commission_rate: float) -> int:
    """정규 수업: 수납액 × 수수료율(%) → 선생님 몫(세전, 해당 건)."""
    return int(round(_safe_int(final_amount) * _safe_float(commission_rate) / 100.0))


def settlement_fee_from_teacher_share(teacher_share: int, fee_rate: float = SETTLEMENT_FEE_RATE) -> int:
    """정산 수수료(3.3%) = 선생님 몫 × 3.3%."""
    return int(round(_safe_int(teacher_share) * _safe_float(fee_rate) / 100.0))


def net_after_settlement_fee(teacher_share: int, fee_rate: float = SETTLEMENT_FEE_RATE) -> int:
    """최종 지급 = 선생님 몫 × 0.967 (엑셀: =J68*0.967)."""
    return int(round(_safe_int(teacher_share) * (1.0 - _safe_float(fee_rate) / 100.0)))


# 하위 호환 별칭
withholding_from_pre_tax = settlement_fee_from_teacher_share
net_from_pre_tax = net_after_settlement_fee


def _split_withholding(pre_tax_total: int, withholding_total: int, part_pre_tax: int) -> int:
    if pre_tax_total <= 0 or part_pre_tax <= 0:
        return 0
    return int(round(withholding_total * part_pre_tax / pre_tax_total))


def build_teacher_settlement_detail(
    db: Session,
    *,
    teacher_id: int,
    billing_month: str,
    teacher_name: str,
) -> dict[str, Any]:
    settlement_rows = (
        db.query(Settlement)
        .filter(Settlement.teacher_id == teacher_id, Settlement.billing_month == billing_month)
        .order_by(Settlement.settlement_type.asc(), Settlement.id.asc())
        .all()
    )

    withholding_rate = DEFAULT_WITHHOLDING_RATE
    for row in settlement_rows:
        if row.withholding_rate is not None:
            withholding_rate = float(row.withholding_rate)
            break

    # 정규 수납 상세
    payment_rows = (
        db.query(MonthlyPaymentRecord)
        .filter(
            MonthlyPaymentRecord.teacher_id == teacher_id,
            MonthlyPaymentRecord.billing_month == billing_month,
        )
        .order_by(MonthlyPaymentRecord.id.asc())
        .all()
    )

    regular_payments: list[dict[str, Any]] = []
    regular_monthly_payments: list[dict[str, Any]] = []
    regular_per_session_payments: list[dict[str, Any]] = []
    per_session_total_sessions = 0
    per_session_completed_sessions = 0
    per_session_scheduled_amount = 0
    per_session_paid_amount = 0
    carryover_out_by_enrollment: dict[int, dict[str, Any]] = {
        int(item["enrollment_id"]): item
        for item in list_carryovers_for_teacher_month(db, teacher_id=teacher_id, source_billing_month=billing_month)
    }
    carryover_in_by_enrollment: dict[int, dict[str, Any]] = {
        int(item["enrollment_id"]): item
        for item in list_carryovers_for_teacher_month(db, teacher_id=teacher_id, settlement_billing_month=billing_month)
    }
    carryover_lessons = list_carryovers_for_teacher_month(
        db, teacher_id=teacher_id, settlement_billing_month=billing_month
    )
    tuition_gross = 0
    tuition_teacher_share = 0
    weighted_rate_sum = 0.0

    for row in payment_rows:
        student_name = (
            db.query(User.name)
            .join(StudentProfile, StudentProfile.user_id == User.id)
            .filter(StudentProfile.id == row.student_id)
            .scalar()
        )
        product_name = (
            db.query(Product.name)
            .join(LessonEnrollment, LessonEnrollment.product_id == Product.id)
            .filter(LessonEnrollment.id == row.enrollment_id)
            .scalar()
        )
        enrollment = db.get(LessonEnrollment, int(row.enrollment_id)) if row.enrollment_id else None
        display_rate = (
            resolve_commission_rate(teacher_name, enrollment, billing_month)
            if enrollment
            else _safe_float(row.commission_rate if row.commission_rate is not None else 60.0)
        )
        payout_rate = (
            teacher_payout_commission_rate(teacher_name, enrollment, billing_month)
            if enrollment
            else (0.0 if is_company_retained_teacher(teacher_name) else display_rate)
        )
        collection_amount = payment_row_collection_amount(row)
        amount = collection_amount
        total_sessions = _safe_int(row.total_sessions)
        completed_sessions = _safe_int(row.completed_sessions)
        per_session_unit_price = int(round(_safe_int(row.base_amount) / total_sessions)) if total_sessions > 0 else 0
        carryover_out = carryover_out_by_enrollment.get(int(row.enrollment_id or 0))
        carryover_in = carryover_in_by_enrollment.get(int(row.enrollment_id or 0))
        carryover_out_sessions = _safe_int(carryover_out["session_count"]) if carryover_out else 0
        teacher_gross_basis = (
            per_session_teacher_settlement_gross(row, carryover_out_sessions=carryover_out_sessions)
            if row.billing_unit == "per_session"
            else collection_amount
        )
        teacher_gross = teacher_settlement_gross_basis(teacher_name, teacher_gross_basis)
        carryover_in_sessions = _safe_int(carryover_in["session_count"]) if carryover_in else 0
        carryover_share_pre_tax = _safe_int(carryover_in["teacher_share"]) if carryover_in else 0
        carryover_delta, carryover_display = _carryover_delta_display(
            carryover_in=carryover_in,
            carryover_out=carryover_out,
        )
        # 진행 = 예정(total_sessions) + 이월(±N) 회차 기준
        progress_sessions = max(0, total_sessions + carryover_delta)
        if row.billing_unit == "per_session" and per_session_unit_price > 0:
            # 정산 수납액: 학생 수납 전액이 아니라 실진행(진행) 회차 × 회차당 단가
            settlement_session_count = progress_sessions
            settlement_gross_amount = progress_sessions * per_session_unit_price
            teacher_gross = settlement_gross_amount
            tuition_gross_amount = collection_amount
        else:
            progress_gross_amount = (
                progress_sessions * per_session_unit_price if per_session_unit_price > 0 else collection_amount
            )
            settlement_session_count = progress_sessions
            settlement_gross_amount = progress_gross_amount
            tuition_gross_amount = collection_amount
        share = teacher_share_from_payment(teacher_gross, payout_rate)
        tuition_gross += collection_amount
        tuition_teacher_share += share
        weighted_rate_sum += teacher_gross * payout_rate
        teacher_share_total = share + carryover_share_pre_tax
        regular_payments.append(
            {
                "id": row.id,
                "student_id": row.student_id,
                "student_name": student_name,
                "enrollment_id": row.enrollment_id,
                "product_name": product_name,
                "billing_unit": row.billing_unit,
                "total_sessions": total_sessions,
                "completed_sessions": completed_sessions,
                "carryover_sessions": _safe_int(carryover_out["session_count"]) if carryover_out else carryover_in_sessions,
                "carryover_target_month": carryover_out["settlement_billing_month"] if carryover_out else None,
                "carryover_label": _build_carryover_label(carryover_in=carryover_in, carryover_out=carryover_out),
                "carryover_delta": carryover_delta,
                "carryover_display": carryover_display,
                "progress_sessions": progress_sessions,
                "tuition_gross_amount": tuition_gross_amount,
                "student_collection_amount": collection_amount,
                "settlement_session_count": settlement_session_count,
                "settlement_gross_amount": settlement_gross_amount,
                "settlement_basis_amount": settlement_gross_amount,
                "per_session_unit_price": per_session_unit_price,
                "final_amount": amount,
                "commission_rate": display_rate,
                "payout_commission_rate": payout_rate,
                "teacher_share": teacher_share_total,
                "teacher_share_pre_tax": teacher_share_total,
                "teacher_settlement_gross": teacher_gross,
                "collection_amount": collection_amount,
                "company_share": max(0, collection_amount - share),
                "payment_tag": row.payment_tag,
                "memo": row.memo,
            }
        )
        pay_row = regular_payments[-1]
        if row.billing_unit == "per_session":
            regular_per_session_payments.append(pay_row)
            total_s = _safe_int(row.total_sessions)
            completed_s = _safe_int(row.completed_sessions) if row.completed_sessions is not None else total_s
            completed_s = max(0, min(completed_s, total_s)) if total_s > 0 else 0
            per_session_total_sessions += total_s
            per_session_completed_sessions += completed_s
            per_session_paid_amount += collection_amount
            per_session_scheduled_amount += collection_amount
        else:
            regular_monthly_payments.append(pay_row)

    commission_rate = (
        COMPANY_RETENTION_DISPLAY_RATE
        if is_company_retained_teacher(teacher_name)
        else (float(weighted_rate_sum / tuition_gross) if tuition_gross > 0 else 60.0)
    )

    # 정산 행 → 정규/시범 세전·원천세·순지급 분리
    regular_tuition_pre_tax = 0
    regular_withholding = 0
    regular_net = 0
    trial_pre_tax = 0
    trial_withholding = 0
    trial_net = 0

    for row in settlement_rows:
        stype = str(row.settlement_type or "")
        pre_tax = _safe_int(row.pre_tax_amount)
        withholding = _safe_int(row.withholding_amount)
        net = _safe_int(row.net_amount)

        if stype == "trial":
            trial_pre_tax += pre_tax
            trial_withholding += withholding
            trial_net += net
            continue

        if stype not in REGULAR_SETTLEMENT_TYPES:
            continue

        trial_part = _safe_int(row.trial_fee)
        tuition_part = max(0, pre_tax - trial_part)
        regular_tuition_pre_tax += tuition_part
        trial_pre_tax += trial_part

        if pre_tax > 0:
            tuition_w = _split_withholding(pre_tax, withholding, tuition_part)
            trial_w = _split_withholding(pre_tax, withholding, trial_part)
            regular_withholding += tuition_w
            trial_withholding += trial_w
            tuition_net = int(round(net * tuition_part / pre_tax))
            regular_net += tuition_net
            trial_net += net - tuition_net
        elif tuition_part > 0:
            regular_net += net

    # 시범은 정규 행에 합쳐지지 않은 경우: 수업 등록 기준 목록
    trial_lessons: list[dict[str, Any]] = []
    trial_enrollments = (
        db.query(LessonEnrollment, User.name)
        .join(StudentProfile, StudentProfile.id == LessonEnrollment.student_id)
        .join(User, User.id == StudentProfile.user_id)
        .filter(
            LessonEnrollment.teacher_id == teacher_id,
            LessonEnrollment.trial_month == billing_month,
            LessonEnrollment.trial_fee > 0,
        )
        .order_by(LessonEnrollment.trial_date.asc(), LessonEnrollment.id.asc())
        .all()
    )

    company_retained = is_company_retained_teacher(teacher_name)
    for enrollment, student_name in trial_enrollments:
        fee = _safe_int(enrollment.trial_fee)
        pre_tax = 0 if company_retained else fee
        w = settlement_fee_from_teacher_share(pre_tax)
        trial_lessons.append(
            {
                "enrollment_id": enrollment.id,
                "student_name": student_name,
                "trial_date": enrollment.trial_date,
                "trial_fee": fee,
                "pre_tax_amount": pre_tax,
                "withholding_amount": w,
                "settlement_fee_amount": w,
                "net_amount": net_after_settlement_fee(pre_tax),
            }
        )

    if trial_pre_tax == 0 and trial_lessons:
        trial_pre_tax = sum(x["pre_tax_amount"] for x in trial_lessons)
        trial_withholding = sum(x["withholding_amount"] for x in trial_lessons)
        trial_net = sum(x["net_amount"] for x in trial_lessons)

    if payment_rows:
        # 수납 상세가 있으면 settlements 잔존값보다 실수납 계산값을 우선한다.
        regular_tuition_pre_tax = tuition_teacher_share
        regular_withholding = settlement_fee_from_teacher_share(regular_tuition_pre_tax)
        regular_net = net_after_settlement_fee(regular_tuition_pre_tax)
    elif regular_tuition_pre_tax == 0 and tuition_teacher_share > 0:
        regular_tuition_pre_tax = tuition_teacher_share
        regular_withholding = settlement_fee_from_teacher_share(regular_tuition_pre_tax)
        regular_net = net_after_settlement_fee(regular_tuition_pre_tax)

    if trial_net == 0 and trial_pre_tax > 0 and trial_withholding == 0:
        trial_withholding = settlement_fee_from_teacher_share(trial_pre_tax)
        trial_net = net_after_settlement_fee(trial_pre_tax)

    carryover_pre_tax = sum(_safe_int(item["teacher_share"]) for item in carryover_lessons)
    carryover_withholding = sum(
        settlement_fee_from_teacher_share(_safe_int(item["teacher_share"])) for item in carryover_lessons
    )
    carryover_net = teacher_carryover_net_total(db, teacher_id, billing_month)

    regular_tuition_pre_tax += carryover_pre_tax
    regular_withholding += carryover_withholding
    regular_net += carryover_net
    tuition_gross += sum(_safe_int(item["gross_amount"]) for item in carryover_lessons)

    total_pre_tax = regular_tuition_pre_tax + trial_pre_tax
    total_withholding = regular_withholding + trial_withholding
    total_net = regular_net + trial_net

    return {
        "teacher_id": teacher_id,
        "teacher_name": teacher_name,
        "billing_month": billing_month,
        "withholding_rate": withholding_rate,
        "settlement_fee_rate": SETTLEMENT_FEE_RATE,
        "settlement_fee_multiplier": SETTLEMENT_FEE_MULTIPLIER,
        "commission_definition": {
            "regular": (
                "정규 수업: ① 수납액 × 수수료율(%) = 선생님 몫(세전) ② 선생님 몫 × "
                f"{SETTLEMENT_FEE_MULTIPLIER} (=1−{SETTLEMENT_FEE_RATE}% 정산 수수료) = 최종 지급. "
                "수수료율은 해당 월 수납 가중평균, 회사 몫 = 수납액 − 선생님 몫."
            ),
            "trial": (
                "시범 수업: 시범비 = 선생님 몫(세전), 이후 "
                f"× {SETTLEMENT_FEE_MULTIPLIER} (정산 수수료 {SETTLEMENT_FEE_RATE}%) 적용."
            ),
        },
        "payout_flow": {
            "regular": {
                "label": "정규 수업",
                "tuition_gross": tuition_gross,
                "commission_rate": round(commission_rate, 2),
                "teacher_share_pre_tax": regular_tuition_pre_tax,
                "company_share": max(
                    0,
                    tuition_gross
                    + sum(_safe_int(item["gross_amount"]) for item in carryover_lessons)
                    - tuition_teacher_share
                    - carryover_pre_tax,
                ),
                "settlement_fee_rate": SETTLEMENT_FEE_RATE,
                "settlement_fee_multiplier": SETTLEMENT_FEE_MULTIPLIER,
                "settlement_fee_amount": regular_withholding,
                "withholding_amount": regular_withholding,
                "net_amount": regular_net if regular_net else net_after_settlement_fee(regular_tuition_pre_tax),
                "formula": f"선생님 몫 × {SETTLEMENT_FEE_MULTIPLIER} (이월 보강 포함)",
            },
            "trial": {
                "label": "시범 수업",
                "trial_count": len(trial_lessons) if trial_lessons else (1 if trial_pre_tax > 0 else 0),
                "trial_fee_gross": trial_pre_tax,
                "teacher_share_pre_tax": trial_pre_tax,
                "settlement_fee_rate": SETTLEMENT_FEE_RATE,
                "settlement_fee_multiplier": SETTLEMENT_FEE_MULTIPLIER,
                "settlement_fee_amount": trial_withholding,
                "withholding_amount": trial_withholding,
                "net_amount": trial_net if trial_net else net_after_settlement_fee(trial_pre_tax or 0),
                "formula": f"시범비 × {SETTLEMENT_FEE_MULTIPLIER}",
            },
            "total": {
                "pre_tax_amount": total_pre_tax,
                "settlement_fee_amount": total_withholding,
                "withholding_amount": total_withholding,
                "net_amount": total_net,
            },
        },
        "regular_monthly_payments": regular_monthly_payments,
        "regular_per_session_payments": regular_per_session_payments,
        "carryover_lessons": carryover_lessons,
        "per_session_summary": {
            "total_sessions": per_session_total_sessions,
            "completed_sessions": per_session_completed_sessions,
            "pending_sessions": max(0, per_session_total_sessions - per_session_completed_sessions),
            "scheduled_amount": per_session_scheduled_amount,
            "paid_amount": per_session_paid_amount,
            "deducted_amount": max(0, per_session_scheduled_amount - per_session_paid_amount),
        },
        "regular_payments": regular_payments,
        "trial_lessons": trial_lessons,
        "settlement_rows": [
            {
                "settlement_type": row.settlement_type,
                "gross_amount": _safe_int(row.gross_amount),
                "trial_fee": _safe_int(row.trial_fee),
                "commission_rate": _safe_float(row.commission_rate),
                "pre_tax_amount": _safe_int(row.pre_tax_amount),
                "withholding_amount": _safe_int(row.withholding_amount),
                "net_amount": _safe_int(row.net_amount),
            }
            for row in settlement_rows
        ],
        "settlement_summary": [
            {
                "settlement_type": row.settlement_type,
                "gross_amount": _safe_int(row.gross_amount),
                "trial_fee": _safe_int(row.trial_fee),
                "net_amount": _safe_int(row.net_amount),
            }
            for row in settlement_rows
        ],
        "lesson_records": regular_payments,
    }
