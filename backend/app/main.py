from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
import base64
import os
import re
import smtplib
from email.message import EmailMessage
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session, aliased

from .database import Base, engine, get_db
from .models import (
    MonthlyPaymentRecord,
    Product,
    RefundRequest,
    Settlement,
    StudentProfile,
    LessonEnrollment,
    TeacherProfile,
    User,
)
from .db_schema_migrate import apply_table_renames
from .billing_sync import sync_all_trial_enrollments
from .enrollment_billing import resolve_next_billing, sync_all_next_billing
from .settlement_detail import build_teacher_settlement_detail
from .payment_pricing import refresh_all_per_session_payment_amounts
from .session_carryover import (
    ensure_may_june_2026_carryovers,
    sync_carryovers_from_per_session_gaps,
    teacher_carryover_net_total,
)
from .special_payments import ensure_seojaehyun_may_2026_special_payments, refresh_special_payment_final_amounts
from .settlement_sync import (
    SETTLEMENT_FEE_MULTIPLIER,
    prune_settlements_without_payments,
    sync_settlements_from_payments,
)
from .payment_record_sync import sync_monthly_payment_records_from_enrollments
from .schema_registry import get_all_schemas, list_table_names
from .registration import TRIAL_FEE_AMOUNT, list_register_options, register_enrollment, register_user
from .table_admin import build_tables_overview, create_row, delete_row, get_row, list_rows, update_row


class AdminRowPayload(BaseModel):
    values: dict[str, Any]


class RegisterUserPayload(BaseModel):
    role: str
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    region: Optional[str] = None
    grade_level: Optional[str] = None
    parent_name: Optional[str] = None
    parent_phone: Optional[str] = None
    birth_date: Optional[str] = None
    gender: Optional[str] = None
    education: Optional[str] = None
    major: Optional[str] = None
    status: Optional[str] = None


class RegisterEnrollmentPayload(BaseModel):
    student_id: int
    teacher_id: int
    product_id: int
    trial_date: Optional[str] = None
    trial_month: Optional[str] = None
    payment_method: Optional[str] = "card"
    price_type: Optional[str] = None
    day_1: Optional[int] = None
    day_2: Optional[int] = None
    day_3: Optional[int] = None
    base_commission_rate: Optional[float] = 60.0
    current_commission_rate: Optional[float] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    next_billing: Optional[str] = None


class TeacherStatusPayload(BaseModel):
    status: str
    changed_month: Optional[str] = None


class PaymentStatusPayload(BaseModel):
    billing_month: str
    student_id: int
    teacher_id: Optional[int] = None
    payment_status: str


class TeacherEmailPayload(BaseModel):
    email: Optional[str] = None


class TeacherEmailAttachment(BaseModel):
    teacher_id: int
    png_base64: str


class SettlementEmailSendPayload(BaseModel):
    billing_month: str
    teacher_ids: Optional[list[int]] = None
    attachments: Optional[list[TeacherEmailAttachment]] = None


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _display_field(value: Any) -> str:
    if value is None or value == "":
        return "-"
    return str(value)


def _month_add(billing_month: str, delta: int) -> Optional[str]:
    try:
        year_s, month_s = billing_month.split("-")
        year, month = int(year_s), int(month_s)
    except (TypeError, ValueError):
        return None
    month += delta
    while month > 12:
        month -= 12
        year += 1
    while month < 1:
        month += 12
        year -= 1
    return f"{year:04d}-{month:02d}"


def _normalize_month(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    text_value = str(value).strip()
    if len(text_value) >= 7 and text_value[4] == "-":
        return text_value[:7]
    parsed = _parse_date_only(text_value)
    if parsed:
        return f"{parsed.year:04d}-{parsed.month:02d}"
    return None


def _sum_lesson_revenue(db: Session, billing_month: str) -> int:
    return _safe_int(
        db.query(func.coalesce(func.sum(MonthlyPaymentRecord.final_amount), 0))
        .filter(MonthlyPaymentRecord.billing_month == billing_month)
        .scalar()
    )


def _sum_settlement_net(db: Session, billing_month: str) -> int:
    return _safe_int(
        db.query(func.coalesce(func.sum(Settlement.net_amount), 0))
        .filter(Settlement.billing_month == billing_month)
        .scalar()
    )


def _sum_settlement_pre_tax(db: Session, billing_month: str) -> int:
    return _safe_int(
        db.query(func.coalesce(func.sum(Settlement.pre_tax_amount), 0))
        .filter(Settlement.billing_month == billing_month)
        .scalar()
    )


def _sum_teacher_share_pre_tax_from_payments(db: Session, billing_month: str) -> int:
    value = (
        db.query(
            func.coalesce(
                func.sum(
                    MonthlyPaymentRecord.final_amount
                    * func.coalesce(MonthlyPaymentRecord.commission_rate, 60.0)
                    / 100.0
                ),
                0.0,
            )
        )
        .filter(MonthlyPaymentRecord.billing_month == billing_month)
        .scalar()
    )
    return int(round(float(value or 0.0)))


def _sum_settlement_trial_fee(db: Session, billing_month: str) -> int:
    return _safe_int(
        db.query(func.coalesce(func.sum(Settlement.trial_fee), 0))
        .filter(Settlement.billing_month == billing_month)
        .scalar()
    )


def _sum_enrollment_trial_fee(db: Session, billing_month: str) -> int:
    """구독 trial_month 기준 시범비(데이터 등록 직후 정산 행 미반영분 포함)."""
    return _safe_int(
        db.query(func.coalesce(func.sum(LessonEnrollment.trial_fee), 0))
        .filter(LessonEnrollment.trial_month == billing_month)
        .filter(LessonEnrollment.trial_fee > 0)
        .scalar()
    )


def _sum_trial_fee_for_month(db: Session, billing_month: str) -> int:
    """해당 월 시범수업비 — 구독(선생님 지급 기준) 우선, 없으면 settlements."""
    from_sub = _sum_enrollment_trial_fee(db, billing_month)
    if from_sub > 0:
        return from_sub
    return _sum_settlement_trial_fee(db, billing_month)


def _sum_teacher_enrollment_trial_fee(db: Session, teacher_id: int, billing_month: str) -> int:
    return _safe_int(
        db.query(func.coalesce(func.sum(LessonEnrollment.trial_fee), 0))
        .filter(
            LessonEnrollment.teacher_id == teacher_id,
            LessonEnrollment.trial_month == billing_month,
            LessonEnrollment.trial_fee > 0,
        )
        .scalar()
    )


def _trial_net_portion(row: Settlement) -> int:
    """정산 행에서 시범비 몫의 순지급 — monthly/per_session에 trial_fee가 합쳐진 경우 비율 분리."""
    settlement_type = str(row.settlement_type or "")
    trial_fee = _safe_int(row.trial_fee)
    pre_tax = _safe_int(row.pre_tax_amount)
    net = _safe_int(row.net_amount)
    if settlement_type == "trial":
        return net
    if trial_fee <= 0:
        return 0
    if pre_tax > 0:
        return int(round(net * trial_fee / pre_tax))
    return net if trial_fee > 0 else 0


def _teacher_trial_totals_for_month(db: Session, teacher_id: int, billing_month: str) -> tuple[int, int]:
    """(시범비 합계, 시범 순지급) — settlements 병합 행 + 수업 등록 fallback."""
    settlement_rows = (
        db.query(Settlement)
        .filter(Settlement.teacher_id == teacher_id, Settlement.billing_month == billing_month)
        .all()
    )
    trial_fee = sum(_safe_int(r.trial_fee) for r in settlement_rows)
    trial_net = sum(_trial_net_portion(r) for r in settlement_rows)

    if trial_fee <= 0:
        enroll_fee = _sum_teacher_enrollment_trial_fee(db, teacher_id, billing_month)
        if enroll_fee > 0:
            trial_fee = enroll_fee
            trial_net = int(round(enroll_fee * SETTLEMENT_FEE_MULTIPLIER))
    return trial_fee, trial_net


def _lesson_revenue_split(db: Session, billing_month: str) -> dict[str, int]:
    rows = (
        db.query(
            MonthlyPaymentRecord.billing_unit,
            func.coalesce(func.sum(MonthlyPaymentRecord.final_amount), 0),
        )
        .filter(MonthlyPaymentRecord.billing_month == billing_month)
        .group_by(MonthlyPaymentRecord.billing_unit)
        .all()
    )
    monthly = 0
    per_session = 0
    for unit, amount in rows:
        if unit == "monthly":
            monthly = _safe_int(amount)
        elif unit == "per_session":
            per_session = _safe_int(amount)
    total = monthly + per_session
    return {"total": total, "monthly": monthly, "per_session": per_session, "has_lesson_data": total > 0}


def _student_ids_from_payments(db: Session, billing_month: str, *, teacher_id: Optional[int] = None) -> set[int]:
    q = db.query(MonthlyPaymentRecord.student_id).filter(MonthlyPaymentRecord.billing_month == billing_month)
    if teacher_id is not None:
        q = q.filter(MonthlyPaymentRecord.teacher_id == teacher_id)
    return {int(row[0]) for row in q.distinct().all() if row[0] is not None}


def _student_ids_from_trials(db: Session, billing_month: str, *, teacher_id: Optional[int] = None) -> set[int]:
    q = db.query(LessonEnrollment.student_id).filter(
        LessonEnrollment.trial_month == billing_month,
        LessonEnrollment.trial_fee > 0,
    )
    if teacher_id is not None:
        q = q.filter(LessonEnrollment.teacher_id == teacher_id)
    return {int(row[0]) for row in q.distinct().all() if row[0] is not None}


def _teacher_month_billing_counts(db: Session, teacher_id: int, billing_month: str) -> dict[str, int]:
    """선생님·월 기준 청구(수납) 학생 수 + 시범 학생 수."""
    billing_students = _student_ids_from_payments(db, billing_month, teacher_id=teacher_id)
    trial_students = _student_ids_from_trials(db, billing_month, teacher_id=teacher_id)
    payment_rows = (
        db.query(func.count(MonthlyPaymentRecord.id))
        .filter(
            MonthlyPaymentRecord.teacher_id == teacher_id,
            MonthlyPaymentRecord.billing_month == billing_month,
        )
        .scalar()
    )
    return {
        "payment_record_count": _safe_int(payment_rows),
        "billing_student_count": len(billing_students),
        "trial_student_count": len(trial_students),
        "trial_only_student_count": len(trial_students - billing_students),
        "total_student_count": len(billing_students | trial_students),
    }


def _teacher_settlement_breakdown(db: Session, teacher_id: int, billing_month: str) -> dict[str, int]:
    """선생님·월 정산: 유형별 세전·세후 + 합계 (목록 화면용)."""
    rows = (
        db.query(Settlement)
        .filter(Settlement.teacher_id == teacher_id, Settlement.billing_month == billing_month)
        .all()
    )
    monthly_pre_tax = 0
    monthly_net = 0
    per_session_pre_tax = 0
    per_session_net = 0
    carryover_pre_tax = 0
    carryover_net = 0
    for row in rows:
        settlement_type = str(row.settlement_type or "")
        pre_tax = _safe_int(row.pre_tax_amount)
        net = _safe_int(row.net_amount)
        if settlement_type == "monthly":
            monthly_pre_tax += pre_tax
            monthly_net += net
        elif settlement_type == "per_session":
            per_session_pre_tax += pre_tax
            per_session_net += net
        elif settlement_type == "carryover":
            carryover_pre_tax += pre_tax
            carryover_net += net

    trial_pre_tax, trial_net = _teacher_trial_totals_for_month(db, teacher_id, billing_month)
    total_pre_tax = monthly_pre_tax + per_session_pre_tax + trial_pre_tax + carryover_pre_tax
    total_net = monthly_net + per_session_net + trial_net + carryover_net
    return {
        "monthly_pre_tax_amount": monthly_pre_tax,
        "monthly_net_amount": monthly_net,
        "per_session_pre_tax_amount": per_session_pre_tax,
        "per_session_net_amount": per_session_net,
        "trial_pre_tax_amount": trial_pre_tax,
        "trial_net_amount": trial_net,
        "carryover_pre_tax_amount": carryover_pre_tax,
        "carryover_net_amount": carryover_net,
        "pre_tax_amount": total_pre_tax,
        "net_amount": total_net,
    }


def _teacher_net_by_unit_from_payments(db: Session, teacher_id: int, billing_month: str) -> dict[str, int]:
    rows = (
        db.query(
            MonthlyPaymentRecord.billing_unit,
            func.coalesce(func.sum(MonthlyPaymentRecord.final_amount), 0),
            func.coalesce(
                func.sum(
                    MonthlyPaymentRecord.final_amount
                    * func.coalesce(MonthlyPaymentRecord.commission_rate, 60.0)
                    / 100.0
                ),
                0.0,
            ),
        )
        .filter(
            MonthlyPaymentRecord.teacher_id == teacher_id,
            MonthlyPaymentRecord.billing_month == billing_month,
        )
        .group_by(MonthlyPaymentRecord.billing_unit)
        .all()
    )
    monthly_gross = 0
    per_session_gross = 0
    monthly_net = 0
    per_session_net = 0
    for unit, gross_sum, pre_tax_sum in rows:
        gross = _safe_int(gross_sum)
        pre_tax = int(round(float(pre_tax_sum or 0.0)))
        net = int(round(pre_tax * SETTLEMENT_FEE_MULTIPLIER))
        if unit == "per_session":
            per_session_gross += gross
            per_session_net += net
        else:
            monthly_gross += gross
            monthly_net += net
    return {
        "monthly_gross_amount": monthly_gross,
        "per_session_gross_amount": per_session_gross,
        "monthly_net_amount": monthly_net,
        "per_session_net_amount": per_session_net,
    }


def _active_counts(db: Session, billing_month: str) -> dict[str, int]:
    billing_students = _student_ids_from_payments(db, billing_month)
    trial_students = _student_ids_from_trials(db, billing_month)
    teacher_ids = {
        int(row[0])
        for row in db.query(MonthlyPaymentRecord.teacher_id)
        .filter(MonthlyPaymentRecord.billing_month == billing_month)
        .distinct()
        .all()
        if row[0] is not None
    }
    teacher_ids.update(
        int(row[0])
        for row in db.query(LessonEnrollment.teacher_id)
        .filter(LessonEnrollment.trial_month == billing_month, LessonEnrollment.trial_fee > 0)
        .distinct()
        .all()
        if row[0] is not None
    )
    return {
        "active_student_count": len(billing_students | trial_students),
        "billing_student_count": len(billing_students),
        "trial_student_count": len(trial_students),
        "active_teacher_count": len(teacher_ids),
    }


def _student_user_created_count(db: Session, billing_month: str) -> int:
    rows = (
        db.query(User.created_at)
        .join(StudentProfile, StudentProfile.user_id == User.id)
        .all()
    )
    return sum(1 for (created_at,) in rows if _normalize_month(created_at) == billing_month)


def _trial_count_for_month(db: Session, billing_month: str) -> int:
    rows = db.query(LessonEnrollment.trial_date).all()
    return sum(1 for (trial_date,) in rows if _normalize_month(trial_date) == billing_month)


def _new_first_payment_student_count(db: Session, billing_month: str) -> int:
    student_first_month: dict[int, str] = {}
    rows = db.query(MonthlyPaymentRecord.student_id, MonthlyPaymentRecord.billing_month).all()
    for student_id, month in rows:
        if student_id is None or not month:
            continue
        sid = int(student_id)
        current = student_first_month.get(sid)
        if current is None or str(month) < current:
            student_first_month[sid] = str(month)
    return sum(1 for month in student_first_month.values() if month == billing_month)


def _student_exit_count(db: Session, billing_month: str) -> int:
    rows = db.query(LessonEnrollment.student_id, LessonEnrollment.end_date).all()
    exited_students: set[int] = set()
    for student_id, end_date in rows:
        if student_id is None:
            continue
        if _normalize_month(end_date) == billing_month:
            exited_students.add(int(student_id))
    return len(exited_students)


def _dashboard_student_lists(db: Session, billing_month: str) -> dict[str, Any]:
    student_user = aliased(User)
    teacher_user = aliased(User)
    payment_rows = db.query(MonthlyPaymentRecord.student_id, MonthlyPaymentRecord.billing_month).all()
    first_month_by_student: dict[int, str] = {}
    for student_id, month in payment_rows:
        if student_id is None or not month:
            continue
        sid = int(student_id)
        current = first_month_by_student.get(sid)
        if current is None or str(month) < current:
            first_month_by_student[sid] = str(month)
    new_ids = [sid for sid, first_month in first_month_by_student.items() if first_month == billing_month]
    new_items: list[dict[str, Any]] = []
    if new_ids:
        new_detail_rows = (
            db.query(
                StudentProfile.id,
                student_user.name,
                TeacherProfile.id,
                teacher_user.name,
                Product.name,
            )
            .join(student_user, student_user.id == StudentProfile.user_id)
            .join(LessonEnrollment, LessonEnrollment.student_id == StudentProfile.id)
            .outerjoin(TeacherProfile, TeacherProfile.id == LessonEnrollment.teacher_id)
            .outerjoin(teacher_user, teacher_user.id == TeacherProfile.user_id)
            .outerjoin(Product, Product.id == LessonEnrollment.product_id)
            .filter(StudentProfile.id.in_(new_ids))
            .order_by(student_user.name.asc(), StudentProfile.id.asc(), LessonEnrollment.id.asc())
            .all()
        )
        new_map: dict[int, dict[str, Any]] = {}
        for student_id, student_name, _teacher_id, teacher_name, product_name in new_detail_rows:
            sid = int(student_id)
            row = new_map.get(sid)
            if not row:
                row = {
                    "student_id": sid,
                    "student_name": student_name,
                    "teachers": [],
                    "products": [],
                }
                new_map[sid] = row
            if teacher_name and teacher_name not in row["teachers"]:
                row["teachers"].append(teacher_name)
            if product_name and product_name not in row["products"]:
                row["products"].append(product_name)
        new_items = sorted(new_map.values(), key=lambda x: (x["student_name"], x["student_id"]))

    ended_rows = db.query(LessonEnrollment.student_id, LessonEnrollment.end_date).all()
    ended_ids: set[int] = set()
    for student_id, end_date in ended_rows:
        if student_id is None:
            continue
        if _normalize_month(end_date) == billing_month:
            ended_ids.add(int(student_id))
    ended_items: list[dict[str, Any]] = []
    if ended_ids:
        ended_detail_rows = (
            db.query(
                StudentProfile.id,
                student_user.name,
                TeacherProfile.id,
                teacher_user.name,
                Product.name,
            )
            .join(student_user, student_user.id == StudentProfile.user_id)
            .join(LessonEnrollment, LessonEnrollment.student_id == StudentProfile.id)
            .outerjoin(TeacherProfile, TeacherProfile.id == LessonEnrollment.teacher_id)
            .outerjoin(teacher_user, teacher_user.id == TeacherProfile.user_id)
            .outerjoin(Product, Product.id == LessonEnrollment.product_id)
            .filter(StudentProfile.id.in_(list(ended_ids)))
            .filter(func.substr(func.coalesce(LessonEnrollment.end_date, ""), 1, 7) == billing_month)
            .order_by(student_user.name.asc(), StudentProfile.id.asc(), LessonEnrollment.id.asc())
            .all()
        )
        ended_map: dict[int, dict[str, Any]] = {}
        for student_id, student_name, _teacher_id, teacher_name, product_name in ended_detail_rows:
            sid = int(student_id)
            row = ended_map.get(sid)
            if not row:
                row = {
                    "student_id": sid,
                    "student_name": student_name,
                    "teachers": [],
                    "products": [],
                }
                ended_map[sid] = row
            if teacher_name and teacher_name not in row["teachers"]:
                row["teachers"].append(teacher_name)
            if product_name and product_name not in row["products"]:
                row["products"].append(product_name)
        ended_items = sorted(ended_map.values(), key=lambda x: (x["student_name"], x["student_id"]))

    return {
        "billing_month": billing_month,
        "new_students": new_items,
        "ended_students": ended_items,
    }


def _active_teacher_profile_count(db: Session) -> int:
    return _safe_int(
        db.query(func.count(TeacherProfile.id))
        .filter(func.lower(func.coalesce(TeacherProfile.status, "active")) == "active")
        .scalar()
    )


def _teacher_ended_count_for_month(db: Session, billing_month: str) -> int:
    rows = db.query(TeacherProfile.status, TeacherProfile.status_changed_at).all()
    ended = 0
    for status, changed_at in rows:
        if str(status or "").lower() != "ended":
            continue
        if _normalize_month(changed_at) == billing_month:
            ended += 1
    return ended


def _payment_status_counts(db: Session, billing_month: str) -> dict[str, int]:
    rows = (
        db.query(MonthlyPaymentRecord.payment_status, func.count(MonthlyPaymentRecord.id))
        .filter(MonthlyPaymentRecord.billing_month == billing_month)
        .group_by(MonthlyPaymentRecord.payment_status)
        .all()
    )
    paid = 0
    unpaid = 0
    for status, count in rows:
        normalized = str(status or "paid").lower()
        if normalized == "paid":
            paid += _safe_int(count)
        else:
            unpaid += _safe_int(count)
    return {"paid_count": paid, "unpaid_count": unpaid, "total_count": paid + unpaid}


def _settlement_gross_split(db: Session, billing_month: str) -> dict[str, int]:
    rows = (
        db.query(
            Settlement.settlement_type,
            func.coalesce(func.sum(Settlement.gross_amount), 0),
        )
        .filter(Settlement.billing_month == billing_month)
        .group_by(Settlement.settlement_type)
        .all()
    )
    monthly = 0
    per_session = 0
    for settlement_type, amount in rows:
        if settlement_type == "monthly":
            monthly = _safe_int(amount)
        elif settlement_type == "per_session":
            per_session = _safe_int(amount)
    return {"monthly": monthly, "per_session": per_session, "total": monthly + per_session}


def _build_dashboard_for_month(db: Session, billing_month: str) -> dict[str, Any]:
    lesson = _lesson_revenue_split(db, billing_month)
    settlement_split = _settlement_gross_split(db, billing_month)

    gross_revenue = lesson["total"]
    revenue_source = "monthly_payment_records"
    if not lesson["has_lesson_data"]:
        gross_revenue = settlement_split["total"]
        revenue_source = "settlements"
        monthly_revenue = settlement_split["monthly"]
        per_session_revenue = settlement_split["per_session"]
    else:
        monthly_revenue = lesson["monthly"]
        per_session_revenue = lesson["per_session"]

    teacher_settlement = _sum_teacher_share_pre_tax_from_payments(db, billing_month)
    trial_fee = _sum_trial_fee_for_month(db, billing_month)
    teacher_settlement += trial_fee
    # 순매출 = 학생 수납(총매출) - 선생님 정산(세전, 시범수업비 포함) 
    net_revenue = gross_revenue - teacher_settlement

    prev_month = _month_add(billing_month, -1)
    prev_gross = 0
    if prev_month:
        prev_lesson = _lesson_revenue_split(db, prev_month)
        prev_gross = prev_lesson["total"] if prev_lesson["has_lesson_data"] else _settlement_gross_split(db, prev_month)["total"]

    revenue_delta = gross_revenue - prev_gross
    revenue_delta_rate = round((revenue_delta / prev_gross) * 100, 1) if prev_gross else None

    active = _active_counts(db, billing_month)
    prev_active = _active_counts(db, prev_month) if prev_month else {"active_student_count": 0, "active_teacher_count": 0}
    student_created = _student_user_created_count(db, billing_month)
    trial_count = _trial_count_for_month(db, billing_month)
    first_payment_new = _new_first_payment_student_count(db, billing_month)
    prev_student_created = _student_user_created_count(db, prev_month) if prev_month else 0
    inquiry_delta = student_created - prev_student_created
    student_exit = _student_exit_count(db, billing_month)
    student_delta = active["active_student_count"] - _safe_int(prev_active.get("active_student_count"))
    active_teacher_total = _active_teacher_profile_count(db)
    teacher_ended = _teacher_ended_count_for_month(db, billing_month)
    teacher_delta = active["active_teacher_count"] - _safe_int(prev_active.get("active_teacher_count"))
    payment_counts = _payment_status_counts(db, billing_month)

    return {
        "billing_month": billing_month,
        "revenue_source": revenue_source,
        "gross_revenue": gross_revenue,
        "monthly_revenue": monthly_revenue,
        "per_session_revenue": per_session_revenue,
        "teacher_settlement": teacher_settlement,
        "trial_fee": trial_fee,
        "net_revenue": net_revenue,
        "active_student_count": active["active_student_count"],
        "active_teacher_count": active["active_teacher_count"],
        "active_teacher_total": active_teacher_total,
        "teacher_ended_count": teacher_ended,
        "prev_month": prev_month,
        "prev_gross_revenue": prev_gross,
        "revenue_delta": revenue_delta,
        "revenue_delta_rate": revenue_delta_rate,
        "new_inquiry_count": student_created,
        "new_first_payment_count": first_payment_new,
        "trial_lesson_count": trial_count,
        "inquiry_delta": inquiry_delta,
        "student_new_count": first_payment_new,
        "student_exit_count": student_exit,
        "student_delta": student_delta,
        "teacher_delta": teacher_delta,
        "paid_count": payment_counts["paid_count"],
        "unpaid_count": payment_counts["unpaid_count"],
        "collection_count": payment_counts["total_count"],
    }


def _last_n_months(anchor_month: str, n: int = 6) -> list[str]:
    months = []
    cursor = anchor_month
    for _ in range(n):
        if not cursor:
            break
        months.append(cursor)
        cursor = _month_add(cursor, -1)
    return list(reversed(months))


def _build_six_month_trends(db: Session, anchor_month: str) -> dict[str, list[dict[str, Any]]]:
    trend_months = _last_n_months(anchor_month, 6)
    revenue_trend = []
    student_trend = []
    inquiry_trend = []
    for month in trend_months:
        lesson = _lesson_revenue_split(db, month)
        gross = lesson["total"] if lesson["has_lesson_data"] else _settlement_gross_split(db, month)["total"]
        active = _active_counts(db, month)
        inquiry_count = _student_user_created_count(db, month)
        revenue_trend.append({"month": month, "gross_revenue": gross})
        student_trend.append({"month": month, "student_count": active["active_student_count"]})
        inquiry_trend.append({"month": month, "inquiry_count": inquiry_count})
    return {
        "revenue_trend_6m": revenue_trend,
        "student_trend_6m": student_trend,
        "inquiry_trend_6m": inquiry_trend,
    }


def _payment_methods_for_month(db: Session, billing_month: str) -> list[dict[str, Any]]:
    rows = (
        db.query(
            LessonEnrollment.payment_method,
            func.coalesce(func.sum(MonthlyPaymentRecord.final_amount), 0),
        )
        .join(LessonEnrollment, LessonEnrollment.id == MonthlyPaymentRecord.enrollment_id)
        .filter(MonthlyPaymentRecord.billing_month == billing_month)
        .group_by(LessonEnrollment.payment_method)
        .all()
    )
    if rows:
        return [
            {"payment_method": method or "미입력", "amount": _safe_int(amount)}
            for method, amount in sorted(rows, key=lambda item: item[1], reverse=True)
        ]
    counts = (
        db.query(LessonEnrollment.payment_method, func.count(LessonEnrollment.id))
        .group_by(LessonEnrollment.payment_method)
        .all()
    )
    return [{"payment_method": method or "미입력", "amount": _safe_int(count)} for method, count in counts]


def _teacher_name_by_profile_id(db: Session, teacher_profile_id: int) -> str:
    """
    문서 기준: settlements.teacher_id는 teacher_profiles.id를 참조하고,
    teacher_profiles.user_id를 통해 users.name을 찾는다.

    현재 로컬 boda.db에 teacher_profiles가 비어있는 경우도 있어, 그땐 users.id 직접 매칭으로 fallback.
    """
    name = (
        db.query(User.name)
        .join(TeacherProfile, TeacherProfile.user_id == User.id)
        .filter(TeacherProfile.id == teacher_profile_id)
        .scalar()
    )
    if name:
        return name
    fallback = db.query(User.name).filter(User.id == teacher_profile_id).scalar()
    return fallback or f"teacher#{teacher_profile_id}"


def _student_name_by_profile_id(db: Session, student_profile_id: int) -> str:
    name = (
        db.query(User.name)
        .join(StudentProfile, StudentProfile.user_id == User.id)
        .filter(StudentProfile.id == student_profile_id)
        .scalar()
    )
    if name:
        return name
    fallback = db.query(User.name).filter(User.id == student_profile_id).scalar()
    return fallback or f"student#{student_profile_id}"


def _ensure_schema() -> None:
    # boda.db는 이미 테이블이 존재하지만, 로컬 개발 환경에서 누락 시 생성되도록 유지합니다.
    apply_table_renames(engine)
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        payment_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(monthly_payment_records)")).fetchall()}
        if "payment_status" not in payment_cols:
            conn.execute(
                text(
                    "ALTER TABLE monthly_payment_records "
                    "ADD COLUMN payment_status TEXT DEFAULT 'paid'"
                )
            )
        conn.execute(
            text(
                "UPDATE monthly_payment_records "
                "SET payment_status = CASE "
                "WHEN billing_month <= '2026-05' THEN 'paid' "
                "ELSE 'unpaid' "
                "END "
                "WHERE payment_status IS NULL OR payment_status = ''"
            )
        )
        conn.execute(
            text(
                "UPDATE monthly_payment_records "
                "SET payment_status = 'paid' "
                "WHERE billing_month <= '2026-05'"
            )
        )
        conn.execute(
            text(
                "UPDATE monthly_payment_records "
                "SET payment_status = 'unpaid' "
                "WHERE billing_month > '2026-05'"
            )
        )

        teacher_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(teacher_profiles)")).fetchall()}
        if "status_changed_at" not in teacher_cols:
            conn.execute(text("ALTER TABLE teacher_profiles ADD COLUMN status_changed_at TEXT"))

    # 수업에만 있고 정산에 없는 시범 데이터 보정
    from .database import SessionLocal

    db = SessionLocal()
    try:
        # 수업 → 월별 수납 레코드 자동 생성(미납=0)
        sync_monthly_payment_records_from_enrollments(db)
        refresh_all_per_session_payment_amounts(db)
        for line in sync_carryovers_from_per_session_gaps(db):
            pass
        # 월별 수납 → 선생님 정산 자동 갱신 (월별/회당)
        sync_settlements_from_payments(db)
        prune_settlements_without_payments(db)
        sync_all_trial_enrollments(db)
        sync_all_next_billing(db)
        for line in ensure_may_june_2026_carryovers(db):
            pass
        refresh_special_payment_final_amounts(db)
        for line in ensure_seojaehyun_may_2026_special_payments(db):
            pass
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _ensure_schema()
    yield


app = FastAPI(title="보다수학 정산 (boda.db)", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "db": "boda.db"}


@app.get("/api/dashboard")
def dashboard(month: Optional[str] = None, db: Session = Depends(get_db)):
    """조회 월 기준 대시보드 지표 (카드/차트용)."""
    months_from_lessons = [
        row[0]
        for row in db.query(MonthlyPaymentRecord.billing_month)
        .distinct()
        .order_by(MonthlyPaymentRecord.billing_month.desc())
        .all()
        if row[0]
    ]
    months_from_settlements = [
        row[0]
        for row in db.query(Settlement.billing_month)
        .distinct()
        .order_by(Settlement.billing_month.desc())
        .all()
        if row[0]
    ]
    months = sorted(set(months_from_lessons) | set(months_from_settlements), reverse=True)

    if not month:
        if "2026-05" in months:
            month = "2026-05"
        else:
            month = months[0] if months else None

    if not month:
        raise HTTPException(status_code=404, detail="조회 가능한 월이 없습니다.")

    summary = _build_dashboard_for_month(db, month)
    trends = _build_six_month_trends(db, month)
    return {
        "available_months": months,
        "summary": summary,
        **trends,
    }


@app.get("/api/dashboard/student-lists")
def dashboard_student_lists(month: Optional[str] = None, db: Session = Depends(get_db)):
    months = [
        row[0]
        for row in db.query(MonthlyPaymentRecord.billing_month)
        .distinct()
        .order_by(MonthlyPaymentRecord.billing_month.desc())
        .all()
        if row[0]
    ]
    if not month:
        month = months[0] if months else None
    if not month:
        return {"billing_month": None, "active_students": [], "new_students": [], "ended_students": []}
    return _dashboard_student_lists(db, month)


@app.get("/api/students/payment-summary")
def students_payment_summary(month: Optional[str] = None, db: Session = Depends(get_db)):
    """학생 수납 페이지 — 결제수단별 수금(도넛 차트용)."""
    if not month:
        month = (
            db.query(MonthlyPaymentRecord.billing_month)
            .distinct()
            .order_by(MonthlyPaymentRecord.billing_month.desc())
            .limit(1)
            .scalar()
        )
    if not month:
        return {"billing_month": None, "items": []}
    return {"billing_month": month, "items": _payment_methods_for_month(db, month)}


@app.get("/api/app-data")
def app_data(db: Session = Depends(get_db)):
    """
    프론트 초기 로딩용 통합 데이터.
    (추후 화면별 엔드포인트로 분리해도, 하위호환을 위해 유지)
    """

    months_from_settlements = [
        row[0]
        for row in db.query(Settlement.billing_month)
        .distinct()
        .order_by(Settlement.billing_month.desc())
        .all()
        if row[0]
    ]
    months_from_lessons = [
        row[0]
        for row in db.query(MonthlyPaymentRecord.billing_month)
        .distinct()
        .order_by(MonthlyPaymentRecord.billing_month.desc())
        .all()
        if row[0]
    ]
    months = sorted(set(months_from_lessons) | set(months_from_settlements), reverse=True)
    latest_month = months[0] if months else None

    teacher_count = db.query(func.count(TeacherProfile.id)).scalar() or 0
    student_count = db.query(func.count(StudentProfile.id)).scalar() or 0
    enrollment_count = db.query(func.count(LessonEnrollment.id)).scalar() or 0

    # 문서 기준:
    # - 총매출/월별결제/회당결제: monthly_payment_records.final_amount (billing_unit으로 분기)
    # - 순수익(지급액): settlements.net_amount
    # 단, sample DB에서 monthly_payment_records가 비어있을 수 있으므로 settlements로 일부 fallback합니다.

    lesson_exists = (db.query(func.count(MonthlyPaymentRecord.id)).scalar() or 0) if latest_month else 0

    lesson_by_month: dict[str, dict[str, int]] = {}
    lesson_type_by_month: dict[tuple[str, str], dict[str, int]] = {}
    payment_method_amounts: dict[str, int] = {}

    if lesson_exists > 0:
        lesson_by_month = {
            row[0]: {"gross_amount": _safe_int(row[1]), "trial_fee": 0}
            for row in db.query(
                MonthlyPaymentRecord.billing_month,
                func.coalesce(func.sum(MonthlyPaymentRecord.final_amount), 0),
            )
            .group_by(MonthlyPaymentRecord.billing_month)
            .all()
            if row[0]
        }

        lesson_type_by_month = {
            (row[0], row[1]): {"gross_amount": _safe_int(row[2])}
            for row in db.query(
                MonthlyPaymentRecord.billing_month,
                MonthlyPaymentRecord.billing_unit,
                func.coalesce(func.sum(MonthlyPaymentRecord.final_amount), 0),
            )
            .group_by(MonthlyPaymentRecord.billing_month, MonthlyPaymentRecord.billing_unit)
            .all()
            if row[0] and row[1]
        }

        # 결제수단별 수금(금액): monthly_payment_records의 enrollment_id → subscriptions.payment_method로 join
        payment_rows = (
            db.query(
                LessonEnrollment.payment_method,
                func.coalesce(func.sum(MonthlyPaymentRecord.final_amount), 0),
            )
            .join(LessonEnrollment, LessonEnrollment.id == MonthlyPaymentRecord.enrollment_id)
            .group_by(LessonEnrollment.payment_method)
            .all()
        )
        for method, amount in payment_rows:
            payment_method_amounts[method or "미입력"] = _safe_int(amount)

    # settlements 기반(순수익/총수업료/시범수업비) 집계
    # 문서의 "총매출"은 monthly_payment_records 기준이지만,
    # sample DB처럼 monthly_payment_records가 비어있을 수 있어 gross 관련 지표는 fallback을 제공합니다.
    settlement_by_month = {
        row[0]: {
            "gross_amount": _safe_int(row[1]),
            "net_profit": _safe_int(row[2]),
            "trial_fee": _safe_int(row[3]),
        }
        for row in db.query(
            Settlement.billing_month,
            func.coalesce(func.sum(Settlement.gross_amount), 0),
            func.coalesce(func.sum(Settlement.net_amount), 0),
            func.coalesce(func.sum(Settlement.trial_fee), 0),
        )
        .group_by(Settlement.billing_month)
        .all()
        if row[0]
    }

    settlement_type_by_month = {
        (row[0], row[1]): {"gross_amount": _safe_int(row[2])}
        for row in db.query(
            Settlement.billing_month,
            Settlement.settlement_type,
            func.coalesce(func.sum(Settlement.gross_amount), 0),
        )
        .group_by(Settlement.billing_month, Settlement.settlement_type)
        .all()
        if row[0] and row[1]
    }

    latest_net_profit = settlement_by_month.get(latest_month, {}).get("net_profit") if latest_month else None
    latest_trial_fee = _sum_trial_fee_for_month(db, latest_month) if latest_month else None

    latest_gross_amount = (
        lesson_by_month.get(latest_month, {}).get("gross_amount")
        if latest_month and lesson_exists > 0
        else settlement_by_month.get(latest_month, {}).get("gross_amount") if latest_month else None
    )
    latest_monthly_gross = (
        lesson_type_by_month.get((latest_month, "monthly"), {}).get("gross_amount")
        if latest_month and lesson_exists > 0
        else settlement_type_by_month.get((latest_month, "monthly"), {}).get("gross_amount") if latest_month else None
    )
    latest_per_session_gross = (
        lesson_type_by_month.get((latest_month, "per_session"), {}).get("gross_amount")
        if latest_month and lesson_exists > 0
        else settlement_type_by_month.get((latest_month, "per_session"), {}).get("gross_amount") if latest_month else None
    )

    # 결제수단별 수금/분포
    if payment_method_amounts:
        payment_method_summary = [
            {"payment_method": method, "amount": amount}
            for method, amount in sorted(payment_method_amounts.items(), key=lambda item: item[1], reverse=True)
        ]
    else:
        payment_method_counts = {
            (row[0] or "미입력"): _safe_int(row[1])
            for row in db.query(LessonEnrollment.payment_method, func.count(LessonEnrollment.id)).group_by(LessonEnrollment.payment_method).all()
        }
        payment_method_summary = [
            {"payment_method": method, "amount": amount}
            for method, amount in sorted(payment_method_counts.items(), key=lambda item: item[1], reverse=True)
        ]

    revenue_trend = []
    for month in months:
        has_lesson_revenue = month in lesson_by_month and lesson_by_month[month].get("gross_amount", 0) > 0
        revenue_trend.append(
            {
                "month": month,
                "gross_amount": lesson_by_month.get(month, {}).get("gross_amount", 0)
                if has_lesson_revenue
                else settlement_by_month.get(month, {}).get("gross_amount", 0),
                "gross_amount_source": "monthly_payment_records" if has_lesson_revenue else "settlements",
                "net_profit": settlement_by_month.get(month, {}).get("net_profit", 0),
                "trial_fee": _sum_trial_fee_for_month(db, month),
                "monthly_gross_amount": lesson_type_by_month.get((month, "monthly"), {}).get("gross_amount", 0)
                if has_lesson_revenue
                else settlement_type_by_month.get((month, "monthly"), {}).get("gross_amount", 0),
                "per_session_gross_amount": lesson_type_by_month.get((month, "per_session"), {}).get("gross_amount", 0)
                if has_lesson_revenue
                else settlement_type_by_month.get((month, "per_session"), {}).get("gross_amount", 0),
            }
        )

    default_month = "2026-05" if "2026-05" in months else latest_month

    # 이번달 수업 학생/선생님 수: monthly_payment_records가 없으면 0으로 반환
    month_active_student_count = 0
    month_active_teacher_count = 0
    if latest_month and months_from_lessons:
        month_active_student_count = (
            db.query(func.count(func.distinct(MonthlyPaymentRecord.student_id)))
            .filter(MonthlyPaymentRecord.billing_month == latest_month)
            .scalar()
            or 0
        )
        month_active_teacher_count = (
            db.query(func.count(func.distinct(MonthlyPaymentRecord.teacher_id)))
            .filter(MonthlyPaymentRecord.billing_month == latest_month)
            .scalar()
            or 0
        )

    # 선생님 목록: teacher_profiles가 비어있을 수 있어 users(role='teacher')를 기준으로 생성
    teachers = []
    # 문서 기준: teacher_profiles(1:1 users). 다만 샘플 DB가 비어있을 수 있어 users(role='teacher')로 fallback.
    teacher_profiles = db.query(TeacherProfile).order_by(TeacherProfile.id.asc()).all()
    if teacher_profiles:
        for tp in teacher_profiles:
            user = db.query(User).filter(User.id == tp.user_id).first()
            teachers.append(
                {
                    "teacher_id": tp.id,
                    "name": _teacher_name_by_profile_id(db, tp.id),
                    "status": _display_field(tp.status),
                    "email": _display_field(user.email if user else None),
                    "phone": _display_field(tp.phone),
                    "birth_date": _display_field(tp.birth_date),
                    "gender": _display_field(tp.gender),
                    "education": _display_field(tp.education),
                    "major": _display_field(tp.major),
                }
            )
    else:
        for u in db.query(User).filter(User.role == "teacher").order_by(User.id.asc()).all():
            teachers.append(
                {
                    "teacher_id": u.id,
                    "name": u.name,
                    "status": "active",
                    "email": _display_field(u.email),
                    "phone": "-",
                    "birth_date": "-",
                    "gender": "-",
                    "education": "-",
                    "major": "-",
                }
            )

    # 최신월 선생님별 지급 요약(한눈에 보기)
    teacher_settlement_summary = []
    if latest_month:
        rows = (
            db.query(
                Settlement.teacher_id,
                func.coalesce(func.sum(Settlement.gross_amount), 0),
                func.coalesce(func.sum(Settlement.trial_fee), 0),
                func.coalesce(func.sum(Settlement.net_amount), 0),
            )
            .filter(Settlement.billing_month == latest_month)
            .group_by(Settlement.teacher_id)
            .all()
        )
        for teacher_id, gross_sum, trial_sum, net_sum in rows:
            name = _teacher_name_by_profile_id(db, teacher_id)
            teacher_settlement_summary.append(
                {
                    "billing_month": latest_month,
                    "teacher_id": teacher_id,
                    "teacher_name": name,
                    "gross_amount": _safe_int(gross_sum),
                    "trial_fee": _safe_int(trial_sum),
                    "net_amount": _safe_int(net_sum),
                }
            )
        teacher_settlement_summary.sort(key=lambda item: item["net_amount"], reverse=True)

    return {
        "meta": {
            "available_months": months,
            "latest_month": latest_month,
            "default_month": default_month,
            "source_notes": "대시보드 상세 지표는 /api/dashboard?month= 조회 월 기준입니다.",
        },
        "dashboard": {
            "teacher_count": teacher_count,
            "student_count": student_count,
            "enrollment_count": enrollment_count,
            "latest_net_profit": _safe_int(latest_net_profit) if latest_net_profit is not None else None,
            "latest_gross_amount": _safe_int(latest_gross_amount) if latest_gross_amount is not None else None,
            "latest_monthly_gross_amount": _safe_int(latest_monthly_gross) if latest_monthly_gross is not None else None,
            "latest_per_session_gross_amount": _safe_int(latest_per_session_gross) if latest_per_session_gross is not None else None,
            "latest_trial_fee": _safe_int(latest_trial_fee) if latest_trial_fee is not None else None,
            "latest_active_student_count": _safe_int(month_active_student_count),
            "latest_active_teacher_count": _safe_int(month_active_teacher_count),
            "payment_method_summary": payment_method_summary,
            "revenue_trend": revenue_trend,
        },
        "products": [
            {
                "id": p.id,
                "name": p.name,
                "billing_unit": p.billing_unit,
                "price_standard": p.price_standard,
                "price_17": p.price_17,
                "price_35": p.price_35,
                "price_per_session": p.price_per_session,
                "is_active": bool(p.is_active),
            }
            for p in db.query(Product).order_by(Product.id.asc()).all()
        ],
        "teachers": teachers,
        "teacher_settlements": teacher_settlement_summary,
    }


@app.get("/api/teachers/settlements")
def list_teacher_settlements(month: Optional[str] = None, db: Session = Depends(get_db)):
    """
    선생님별 정산 목록(한눈에): 지정 월 또는 전체 월.
    - month 미지정: 월별(teacher_id, billing_month) 단위로 모두 반환
    - items: settlement_type별 행
    - aggregated: 선생님별 월별+회당 합산
    """
    rate_adjustments = {"billing_month": month, "changed_count": 0, "changed_teachers": []}
    if month:
        rate_adjustments = _auto_adjust_commission_rates_for_month(db, month)
        db.commit()

    q = db.query(
        Settlement.billing_month,
        Settlement.teacher_id,
        Settlement.settlement_type,
        func.coalesce(func.sum(Settlement.gross_amount), 0),
        func.coalesce(func.sum(Settlement.trial_fee), 0),
        func.coalesce(func.sum(Settlement.net_amount), 0),
    )
    if month:
        q = q.filter(Settlement.billing_month == month)
    q = q.group_by(Settlement.billing_month, Settlement.teacher_id, Settlement.settlement_type)
    rows = q.order_by(Settlement.billing_month.desc(), Settlement.teacher_id.asc()).all()

    items = []
    aggregated_map: dict[tuple[str, int], dict[str, Any]] = {}
    for billing_month, teacher_id, settlement_type, gross_sum, trial_sum, net_sum in rows:
        name = _teacher_name_by_profile_id(db, teacher_id)
        gross_i = _safe_int(gross_sum)
        trial_i = _safe_int(trial_sum)
        net_i = _safe_int(net_sum)
        items.append(
            {
                "billing_month": billing_month,
                "teacher_id": teacher_id,
                "teacher_name": name,
                "settlement_type": settlement_type,
                "gross_amount": gross_i,
                "trial_fee": trial_i,
                "net_amount": net_i,
            }
        )
        key = (billing_month, teacher_id)
        if key not in aggregated_map:
            teacher_status = (
                db.query(TeacherProfile.status).filter(TeacherProfile.id == teacher_id).scalar() or "active"
            )
            teacher_email = (
                db.query(User.email)
                .join(TeacherProfile, TeacherProfile.user_id == User.id)
                .filter(TeacherProfile.id == teacher_id)
                .scalar()
            )
            aggregated_map[key] = {
                "billing_month": billing_month,
                "teacher_id": teacher_id,
                "teacher_name": name,
                "teacher_email": teacher_email,
                "teacher_status": str(teacher_status).lower(),
                "gross_amount": 0,
                "trial_fee": 0,
                "pre_tax_amount": 0,
                "net_amount": 0,
                "monthly_pre_tax_amount": 0,
                "monthly_net_amount": 0,
                "per_session_pre_tax_amount": 0,
                "per_session_net_amount": 0,
                "trial_pre_tax_amount": 0,
                "trial_net_amount": 0,
                "carryover_pre_tax_amount": 0,
                "carryover_net_amount": 0,
            }
        agg = aggregated_map[key]
        agg["gross_amount"] += gross_i
        agg["trial_fee"] += trial_i
        agg["net_amount"] += net_i
        if settlement_type == "monthly":
            agg["monthly_net_amount"] += net_i
        elif settlement_type == "per_session":
            agg["per_session_net_amount"] += net_i
        elif settlement_type == "trial":
            agg["trial_net_amount"] += net_i
        elif settlement_type == "carryover":
            agg["carryover_net_amount"] += net_i

    # 시범만 있는 선생님(정산 행 없음)도 목록에 포함
    if month:
        trial_teacher_ids = [
            int(r[0])
            for r in db.query(LessonEnrollment.teacher_id)
            .filter(LessonEnrollment.trial_month == month, LessonEnrollment.trial_fee > 0)
            .distinct()
            .all()
            if r[0] is not None
        ]
        for teacher_id in trial_teacher_ids:
            key = (month, teacher_id)
            if key not in aggregated_map:
                teacher_status = (
                    db.query(TeacherProfile.status).filter(TeacherProfile.id == teacher_id).scalar() or "active"
                )
                teacher_email = (
                    db.query(User.email)
                    .join(TeacherProfile, TeacherProfile.user_id == User.id)
                    .filter(TeacherProfile.id == teacher_id)
                    .scalar()
                )
                aggregated_map[key] = {
                    "billing_month": month,
                    "teacher_id": teacher_id,
                    "teacher_name": _teacher_name_by_profile_id(db, teacher_id),
                    "teacher_email": teacher_email,
                    "teacher_status": str(teacher_status).lower(),
                    "gross_amount": 0,
                    "trial_fee": 0,
                    "pre_tax_amount": 0,
                    "net_amount": 0,
                    "monthly_pre_tax_amount": 0,
                    "monthly_net_amount": 0,
                    "per_session_pre_tax_amount": 0,
                    "per_session_net_amount": 0,
                    "trial_pre_tax_amount": 0,
                    "trial_net_amount": 0,
                    "carryover_pre_tax_amount": 0,
                    "carryover_net_amount": 0,
                }

    for key, agg in aggregated_map.items():
        billing_month, teacher_id = key
        breakdown = _teacher_settlement_breakdown(db, int(teacher_id), str(billing_month))
        agg.update(breakdown)
        agg["trial_fee"] = breakdown["trial_pre_tax_amount"]
        recalculated = _teacher_net_by_unit_from_payments(db, int(teacher_id), str(billing_month))
        agg["gross_amount"] = recalculated["monthly_gross_amount"] + recalculated["per_session_gross_amount"]
        agg.update(_teacher_month_billing_counts(db, int(teacher_id), str(billing_month)))

    aggregated = sorted(aggregated_map.values(), key=lambda row: row["net_amount"], reverse=True)
    return {"items": items, "aggregated": aggregated, "rate_adjustments": rate_adjustments}


@app.get("/api/teachers/{teacher_id}/settlements")
def teacher_settlement_months(teacher_id: int, db: Session = Depends(get_db)):
    months = [
        row[0]
        for row in db.query(Settlement.billing_month)
        .filter(Settlement.teacher_id == teacher_id)
        .distinct()
        .order_by(Settlement.billing_month.desc())
        .all()
        if row[0]
    ]
    name = _teacher_name_by_profile_id(db, teacher_id)
    return {"teacher_id": teacher_id, "teacher_name": name, "months": months}


@app.get("/api/teachers/{teacher_id}/settlements/{billing_month}")
def teacher_settlement_detail(teacher_id: int, billing_month: str, db: Session = Depends(get_db)):
    """선생님 상세 정산 — 정규/시범 분리, 수수료·세전·원천세·최종 지급 경로."""
    teacher_name = _teacher_name_by_profile_id(db, teacher_id)
    if not teacher_name or teacher_name.startswith("teacher#"):
        return {"detail": "선생님을 찾을 수 없습니다."}

    detail = build_teacher_settlement_detail(
        db,
        teacher_id=teacher_id,
        billing_month=billing_month,
        teacher_name=teacher_name,
    )

    refund_rows = (
        db.query(RefundRequest)
        .filter(RefundRequest.billing_month == billing_month)
        .order_by(RefundRequest.id.asc())
        .all()
    )
    detail["refund_requests"] = [
        {
            "id": r.id,
            "enrollment_id": r.enrollment_id,
            "student_id": r.student_id,
            "paid_amount": r.paid_amount,
            "refund_amount": r.refund_amount,
            "status": r.status,
        }
        for r in refund_rows
    ]
    return detail


@app.patch("/api/teachers/{teacher_id}/status")
def update_teacher_status(teacher_id: int, payload: TeacherStatusPayload, db: Session = Depends(get_db)):
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="선생님을 찾을 수 없습니다.")
    normalized_status = str(payload.status or "").strip().lower()
    if normalized_status not in {"active", "ended"}:
        raise HTTPException(status_code=400, detail="status는 active 또는 ended 이어야 합니다.")
    teacher.status = normalized_status
    if normalized_status == "ended":
        teacher.status_changed_at = f"{payload.changed_month or date.today().strftime('%Y-%m')}-01"
    else:
        teacher.status_changed_at = None
    db.commit()
    return {"ok": True, "teacher_id": teacher_id, "status": teacher.status, "status_changed_at": teacher.status_changed_at}


@app.patch("/api/teachers/{teacher_id}/email")
def update_teacher_email(teacher_id: int, payload: TeacherEmailPayload, db: Session = Depends(get_db)):
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="선생님을 찾을 수 없습니다.")
    user = db.query(User).filter(User.id == teacher.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="선생님 사용자 정보를 찾을 수 없습니다.")
    normalized_email = (payload.email or "").strip() or None
    user.email = normalized_email
    db.commit()
    return {"ok": True, "teacher_id": teacher_id, "email": user.email}


def _decode_png_base64(value: str) -> bytes:
    raw = (value or "").strip()
    if "," in raw:
        raw = raw.split(",", 1)[1]
    return base64.b64decode(raw)


def _safe_attachment_filename(teacher_name: str, billing_month: str) -> str:
    safe_name = re.sub(r'[\\/:*?"<>|]', "_", str(teacher_name or "teacher").strip()) or "teacher"
    safe_month = re.sub(r'[\\/:*?"<>|]', "_", str(billing_month or "month").strip()) or "month"
    return f"정산서_{safe_name}_{safe_month}.png"


def _send_settlement_email(
    to_email: str,
    *,
    teacher_name: str,
    billing_month: str,
    net_amount: int,
    png_bytes: Optional[bytes] = None,
) -> None:
    host = (os.getenv("SMTP_HOST") or "").strip()
    port = int(os.getenv("SMTP_PORT") or "587")
    username = (os.getenv("SMTP_USER") or "").strip()
    password = os.getenv("SMTP_PASS") or ""
    from_email = (os.getenv("SMTP_FROM") or username).strip()
    use_tls = (os.getenv("SMTP_USE_TLS") or "true").strip().lower() in {"1", "true", "yes", "y"}

    if not host or not from_email:
        raise HTTPException(
            status_code=400,
            detail="SMTP 설정이 필요합니다. SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM 환경변수를 설정하세요.",
        )

    subject = f"[보다수학] {billing_month} 정산 내역 안내 ({teacher_name})"
    detail_line = (
        "상세 내역은 첨부된 정산서 이미지를 확인해 주세요.\n"
        if png_bytes
        else "상세 내역은 정산 화면에서 확인해 주세요.\n"
    )
    body = (
        f"{teacher_name} 선생님\n\n"
        f"{billing_month} 정산 내역을 안내드립니다.\n"
        f"- 최종 정산금액: {format_currency(net_amount)}\n\n"
        f"{detail_line}"
        "감사합니다."
    )
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = from_email
    message["To"] = to_email
    message.set_content(body)
    if png_bytes:
        message.add_attachment(
            png_bytes,
            maintype="image",
            subtype="png",
            filename=_safe_attachment_filename(teacher_name, billing_month),
        )

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        if use_tls:
            smtp.starttls()
        if username:
            smtp.login(username, password)
        smtp.send_message(message)


def format_currency(value: int) -> str:
    try:
        return f"₩{int(value):,}"
    except Exception:
        return f"₩{value}"


@app.post("/api/teachers/settlements/send-email")
def send_teacher_settlement_emails(payload: SettlementEmailSendPayload, db: Session = Depends(get_db)):
    billing_month = str(payload.billing_month or "").strip()
    if not billing_month:
        raise HTTPException(status_code=400, detail="billing_month는 필수입니다.")
    selected_teacher_ids = {int(tid) for tid in (payload.teacher_ids or []) if tid is not None}
    attachment_by_teacher: dict[int, bytes] = {}
    for item in payload.attachments or []:
        try:
            attachment_by_teacher[int(item.teacher_id)] = _decode_png_base64(item.png_base64)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"첨부 이미지 디코딩 실패 (teacher_id={item.teacher_id}): {exc}") from exc

    rows = (
        db.query(
            Settlement.teacher_id,
            func.coalesce(func.sum(Settlement.net_amount), 0).label("net_amount"),
        )
        .filter(Settlement.billing_month == billing_month)
        .group_by(Settlement.teacher_id)
        .all()
    )
    sent = []
    skipped = []
    failed = []
    for teacher_id, net_amount in rows:
        if selected_teacher_ids and int(teacher_id) not in selected_teacher_ids:
            continue
        teacher = db.query(TeacherProfile).filter(TeacherProfile.id == teacher_id).first()
        teacher_name = _teacher_name_by_profile_id(db, int(teacher_id))
        email = None
        if teacher:
            email = db.query(User.email).filter(User.id == teacher.user_id).scalar()
        email = (email or "").strip()
        if not email:
            skipped.append({"teacher_id": int(teacher_id), "teacher_name": teacher_name, "reason": "email 없음"})
            continue
        try:
            _send_settlement_email(
                email,
                teacher_name=teacher_name,
                billing_month=billing_month,
                net_amount=_safe_int(net_amount),
                png_bytes=attachment_by_teacher.get(int(teacher_id)),
            )
            sent.append(
                {
                    "teacher_id": int(teacher_id),
                    "teacher_name": teacher_name,
                    "email": email,
                    "has_attachment": int(teacher_id) in attachment_by_teacher,
                }
            )
        except Exception as exc:
            failed.append(
                {
                    "teacher_id": int(teacher_id),
                    "teacher_name": teacher_name,
                    "email": email,
                    "reason": str(exc),
                }
            )

    return {
        "ok": len(failed) == 0,
        "billing_month": billing_month,
        "selected_count": len(selected_teacher_ids) if selected_teacher_ids else len(rows),
        "sent_count": len(sent),
        "skipped_count": len(skipped),
        "failed_count": len(failed),
        "sent": sent,
        "skipped": skipped,
        "failed": failed,
    }


@app.patch("/api/students/payment-status")
def update_student_payment_status(payload: PaymentStatusPayload, db: Session = Depends(get_db)):
    normalized = str(payload.payment_status or "").strip().lower()
    if normalized not in {"paid", "unpaid"}:
        raise HTTPException(status_code=400, detail="payment_status는 paid 또는 unpaid 이어야 합니다.")
    q = db.query(MonthlyPaymentRecord).filter(
        MonthlyPaymentRecord.billing_month == payload.billing_month,
        MonthlyPaymentRecord.student_id == payload.student_id,
    )
    if payload.teacher_id is not None:
        q = q.filter(MonthlyPaymentRecord.teacher_id == payload.teacher_id)
    rows = q.all()
    if not rows:
        raise HTTPException(status_code=404, detail="수납 레코드를 찾을 수 없습니다.")
    for row in rows:
        row.payment_status = normalized
    db.commit()
    return {
        "ok": True,
        "updated_count": len(rows),
        "billing_month": payload.billing_month,
        "student_id": payload.student_id,
        "teacher_id": payload.teacher_id,
        "payment_status": normalized,
    }


@app.get("/api/students")
def list_students(month: Optional[str] = None, db: Session = Depends(get_db)):
    """
    학생 수납/관리용 학생 목록.
    - 학생(이름/연락) + 연결된 구독(상품/결제수단/담당선생님) 요약을 제공합니다.
    """
    # 조회월 기준: 해당 월에 월별 수납 레코드가 있는 학생 (금액 0 포함)
    # month 미지정이면 기존처럼 전체 학생 반환(레거시)
    return list_students_by_month(db, month=month)


def _month_range(month: str) -> tuple[date, date]:
    """'YYYY-MM' -> (월초, 월말)"""
    year_s, month_s = str(month).split("-")
    y, m = int(year_s), int(month_s)
    start = date(y, m, 1)
    if m == 12:
        end = date(y + 1, 1, 1)
    else:
        end = date(y, m + 1, 1)
    # end is exclusive
    return start, date.fromordinal(end.toordinal() - 1)


def _parse_date_only(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    text = str(value).strip()[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


COMMISSION_EXCLUDED_TEACHERS = {"신태준", "서재현", "윤성민"}


def _expected_commission_rate_by_tenure(start: date, billing_month: str) -> float:
    target_month = _parse_date_only(f"{billing_month}-01")
    if not target_month:
        return 60.0
    elapsed_months = (target_month.year - start.year) * 12 + (target_month.month - start.month)
    # 개월차 기준: 7개월차부터 65%, 13개월차부터 70%
    # (elapsed_months는 0부터 시작하므로 7개월차=6, 13개월차=12)
    if elapsed_months >= 12:
        return 70.0
    if elapsed_months >= 6:
        return 65.0
    return 60.0


def _auto_adjust_commission_rates_for_month(db: Session, billing_month: str) -> dict[str, Any]:
    rows = (
        db.query(
            MonthlyPaymentRecord,
            LessonEnrollment,
            User.name,
            User.id,
        )
        .join(LessonEnrollment, LessonEnrollment.id == MonthlyPaymentRecord.enrollment_id)
        .join(TeacherProfile, TeacherProfile.id == LessonEnrollment.teacher_id)
        .join(User, User.id == TeacherProfile.user_id)
        .filter(MonthlyPaymentRecord.billing_month == billing_month)
        .all()
    )
    changed_by_teacher: dict[int, dict[str, Any]] = {}
    notice_by_teacher: dict[int, dict[str, Any]] = {}
    changed_record_ids: set[int] = set()
    changed_enrollment_ids: set[int] = set()
    touched_teacher_ids: set[int] = set()

    for payment, enrollment, teacher_name, teacher_user_id in rows:
        teacher_name = str(teacher_name or "").strip()
        if teacher_name in COMMISSION_EXCLUDED_TEACHERS:
            continue
        start = _parse_date_only(enrollment.start_date)
        if not start:
            continue
        expected = _expected_commission_rate_by_tenure(start, billing_month)
        current_rate = float(payment.commission_rate or 60.0)
        elapsed_months = (_parse_date_only(f"{billing_month}-01").year - start.year) * 12 + (
            _parse_date_only(f"{billing_month}-01").month - start.month
        )
        is_notice_month = elapsed_months in (6, 12)
        if is_notice_month:
            notice_entry = notice_by_teacher.setdefault(
                int(payment.teacher_id),
                {
                    "teacher_id": int(payment.teacher_id),
                    "teacher_name": teacher_name,
                    "students": [],
                },
            )
            notice_entry["students"].append(
                {
                    "student_id": int(payment.student_id),
                    "student_name": _student_name_by_profile_id(db, int(payment.student_id)),
                    "enrollment_id": int(enrollment.id),
                    "current_rate": current_rate,
                    "target_rate": expected,
                    "start_date": enrollment.start_date,
                }
            )
        if abs(current_rate - expected) < 1e-6:
            continue

        payment.commission_rate = expected
        touched_teacher_ids.add(int(payment.teacher_id))
        changed_record_ids.add(int(payment.id))
        changed_enrollment_ids.add(int(enrollment.id))

        entry = changed_by_teacher.setdefault(
            int(payment.teacher_id),
            {
                "teacher_id": int(payment.teacher_id),
                "teacher_name": teacher_name,
                "students": [],
            },
        )
        entry["students"].append(
            {
                "student_id": int(payment.student_id),
                "student_name": _student_name_by_profile_id(db, int(payment.student_id)),
                "enrollment_id": int(enrollment.id),
                "old_rate": current_rate,
                "new_rate": expected,
                "start_date": enrollment.start_date,
            }
        )

    # enrollment 현재 수수료율도 최신값으로 맞춘다.
    if changed_enrollment_ids:
        enrollment_rows = (
            db.query(LessonEnrollment)
            .filter(LessonEnrollment.id.in_(list(changed_enrollment_ids)))
            .all()
        )
        for enrollment in enrollment_rows:
            start = _parse_date_only(enrollment.start_date)
            if not start:
                continue
            expected = _expected_commission_rate_by_tenure(start, billing_month)
            enrollment.current_commission_rate = expected

    # 변경된 선생님-월 정산을 재동기화
    for teacher_id in touched_teacher_ids:
        sync_settlements_from_payments(db, billing_month=billing_month, teacher_id=teacher_id)

    if touched_teacher_ids:
        db.flush()

    changed_teachers = sorted(changed_by_teacher.values(), key=lambda x: x["teacher_name"])
    changed_count = sum(len(t["students"]) for t in changed_teachers)
    notice_teachers = sorted(notice_by_teacher.values(), key=lambda x: x["teacher_name"])
    notice_count = sum(len(t["students"]) for t in notice_teachers)
    return {
        "billing_month": billing_month,
        "changed_count": changed_count,
        "changed_teachers": changed_teachers,
        "notice_count": notice_count,
        "notice_teachers": notice_teachers,
    }


def _enrollment_valid_for_month(enrollment: LessonEnrollment, month: str) -> bool:
    start_m, end_m = _month_range(month)

    start = _parse_date_only(enrollment.start_date)
    if not start:
        return False

    end = _parse_date_only(enrollment.end_date)
    cancelled = _parse_date_only(enrollment.cancelled_at)

    if cancelled and cancelled < start_m:
        return False
    if end and end < start_m:
        return False
    if start > end_m:
        return False
    return True


def list_students_by_month(db: Session, month: Optional[str] = None) -> dict[str, Any]:
    if not month:
        # 레거시: 전체 학생
        items = []
        students = (
            db.query(
                StudentProfile.id,
                StudentProfile.phone,
                StudentProfile.grade_level,
                StudentProfile.parent_name,
                StudentProfile.parent_phone,
                User.name,
            )
            .join(User, User.id == StudentProfile.user_id)
            .order_by(User.name.asc())
            .all()
        )
        for student_profile_id, phone, grade_level, parent_name, parent_phone, student_name in students:
            items.append(
                {
                    "student_id": student_profile_id,
                    "student_name": student_name,
                    "phone": phone,
                    "grade_level": grade_level,
                    "parent_name": parent_name,
                    "parent_phone": parent_phone,
                }
            )
        return {"billing_month": None, "items": items}

    # 학생별 월 수납 합계 + 해당 월 상품/선생님 요약
    payment_rows = (
        db.query(
            StudentProfile.id.label("student_id"),
            User.name.label("student_name"),
            MonthlyPaymentRecord.enrollment_id.label("enrollment_id"),
            MonthlyPaymentRecord.final_amount.label("final_amount"),
            MonthlyPaymentRecord.billing_unit.label("billing_unit"),
            MonthlyPaymentRecord.payment_status.label("payment_status"),
            LessonEnrollment.teacher_id.label("teacher_id"),
            LessonEnrollment.payment_method.label("payment_method"),
            Product.name.label("product_name"),
        )
        .join(User, User.id == StudentProfile.user_id)
        .join(MonthlyPaymentRecord, MonthlyPaymentRecord.student_id == StudentProfile.id)
        .outerjoin(LessonEnrollment, LessonEnrollment.id == MonthlyPaymentRecord.enrollment_id)
        .outerjoin(Product, Product.id == LessonEnrollment.product_id)
        .filter(MonthlyPaymentRecord.billing_month == month)
        .order_by(User.name.asc(), MonthlyPaymentRecord.id.asc())
        .all()
    )

    teacher_names_by_id = {
        tid: name
        for tid, name in (
            db.query(TeacherProfile.id, User.name)
            .join(User, User.id == TeacherProfile.user_id)
            .all()
        )
        if tid and name
    }

    agg: dict[tuple[int, Optional[int]], dict[str, Any]] = {}
    for row in payment_rows:
        sid = int(row.student_id)
        tid = int(row.teacher_id) if row.teacher_id is not None else None
        key = (sid, tid)
        entry = agg.get(key)
        if not entry:
            entry = {
                "student_row_key": f"{sid}:{tid if tid is not None else 'na'}",
                "student_id": sid,
                "student_name": row.student_name,
                "student_display_name": row.student_name,
                "teacher_id": tid,
                "month_paid_amount": 0,
                "month_paid_amount_monthly": 0,
                "month_paid_amount_per_session": 0,
                "products": [],
                "teachers": [],
                "billing_units": [],
                "payment_methods": [],
                "payment_statuses": [],
            }
            agg[key] = entry

        amount = _safe_int(row.final_amount)
        entry["month_paid_amount"] += amount
        if row.billing_unit == "monthly":
            entry["month_paid_amount_monthly"] += amount
        elif row.billing_unit == "per_session":
            entry["month_paid_amount_per_session"] += amount

        if row.product_name and row.product_name not in entry["products"]:
            entry["products"].append(row.product_name)
        tname = teacher_names_by_id.get(int(row.teacher_id)) if row.teacher_id is not None else None
        if tname and tname not in entry["teachers"]:
            entry["teachers"].append(tname)
        if row.billing_unit and row.billing_unit not in entry["billing_units"]:
            entry["billing_units"].append(row.billing_unit)
        if row.payment_method and row.payment_method not in entry["payment_methods"]:
            entry["payment_methods"].append(row.payment_method)
        payment_status = str(row.payment_status or "paid").lower()
        if payment_status not in entry["payment_statuses"]:
            entry["payment_statuses"].append(payment_status)

    items = sorted(
        agg.values(),
        key=lambda x: (
            x.get("student_name") or "",
            x.get("teachers", [""])[0] if x.get("teachers") else "",
            x.get("student_id") or 0,
            x.get("teacher_id") if x.get("teacher_id") is not None else -1,
        ),
    )

    # 동명이인(또는 동일 학생명 다중 행) 표시 보조: 이름 (1), 이름 (2)
    name_counts: dict[str, int] = {}
    for item in items:
        base_name = str(item.get("student_name") or "").strip()
        if not base_name:
            continue
        name_counts[base_name] = name_counts.get(base_name, 0) + 1

    name_indices: dict[str, int] = {}
    for item in items:
        base_name = str(item.get("student_name") or "").strip()
        if not base_name:
            continue
        if name_counts.get(base_name, 0) <= 1:
            item["student_display_name"] = base_name
            continue
        idx = name_indices.get(base_name, 0) + 1
        name_indices[base_name] = idx
        item["student_display_name"] = f"{base_name} ({idx})"
        item["payment_status"] = "unpaid" if "unpaid" in item.get("payment_statuses", []) else "paid"

    for item in items:
        if "payment_status" not in item:
            item["payment_status"] = "unpaid" if "unpaid" in item.get("payment_statuses", []) else "paid"

    return {"billing_month": month, "items": items}


@app.get("/api/students/{student_id}")
def student_detail(student_id: int, month: Optional[str] = None, db: Session = Depends(get_db)):
    """
    학생 상세: 수업(학생↔선생님) + 월별 수납 + 환불.
    """
    student_row = (
        db.query(StudentProfile, User.name)
        .join(User, User.id == StudentProfile.user_id)
        .filter(StudentProfile.id == student_id)
        .first()
    )
    if not student_row:
        return {"detail": "학생을 찾을 수 없습니다."}
    student, student_name = student_row
    weekday_labels = {1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토", 7: "일"}

    subs = (
        db.query(LessonEnrollment, Product.name, User.name)
        .outerjoin(Product, Product.id == LessonEnrollment.product_id)
        .outerjoin(TeacherProfile, TeacherProfile.id == LessonEnrollment.teacher_id)
        .outerjoin(User, User.id == TeacherProfile.user_id)
        .filter(LessonEnrollment.student_id == student_id)
        .order_by(LessonEnrollment.id.desc())
        .all()
    )
    enrollment_items = []
    for sub, product_name, teacher_name in subs:
        item = {
            "enrollment_id": sub.id,
            "teacher_id": sub.teacher_id,
            "teacher_name": teacher_name or f"teacher#{sub.teacher_id}",
            "product_id": sub.product_id,
            "product_name": product_name,
            "payment_method": sub.payment_method,
            "commission_rate": sub.current_commission_rate,
            "trial_date": sub.trial_date,
            "trial_month": sub.trial_month,
            "trial_fee": _safe_int(sub.trial_fee),
            "start_date": sub.start_date,
            "end_date": sub.end_date,
            "next_billing": resolve_next_billing(sub) or sub.next_billing,
            "first_month_sessions": sub.first_month_sessions,
            "first_month_ratio": sub.first_month_ratio,
            "first_month_amount": sub.first_month_amount,
            "day_1": sub.day_1,
            "day_2": sub.day_2,
            "day_3": sub.day_3,
            "weekdays": [
                weekday_labels[d]
                for d in [sub.day_1, sub.day_2, sub.day_3]
                if d in weekday_labels
            ],
        }
        if month:
            item["is_valid_for_month"] = _enrollment_valid_for_month(sub, month)
        enrollment_items.append(item)

    payment_q = db.query(MonthlyPaymentRecord).filter(MonthlyPaymentRecord.student_id == student_id)
    if month:
        payment_q = payment_q.filter(MonthlyPaymentRecord.billing_month == month)
    payment_rows = payment_q.order_by(MonthlyPaymentRecord.billing_month.desc(), MonthlyPaymentRecord.id.desc()).all()

    history_rows = (
        db.query(MonthlyPaymentRecord)
        .filter(MonthlyPaymentRecord.student_id == student_id)
        .filter(MonthlyPaymentRecord.billing_month != month if month else True)
        .order_by(MonthlyPaymentRecord.billing_month.desc(), MonthlyPaymentRecord.id.desc())
        .all()
    )

    enrollment_ids = {
        row.enrollment_id for row in (*payment_rows, *history_rows) if row.enrollment_id
    }
    payment_method_by_enrollment = (
        {
            eid: pm
            for eid, pm in db.query(LessonEnrollment.id, LessonEnrollment.payment_method)
            .filter(LessonEnrollment.id.in_(enrollment_ids))
            .all()
        }
        if enrollment_ids
        else {}
    )
    product_name_by_enrollment = (
        {
            eid: pname
            for eid, pname in db.query(LessonEnrollment.id, Product.name)
            .outerjoin(Product, Product.id == LessonEnrollment.product_id)
            .filter(LessonEnrollment.id.in_(enrollment_ids))
            .all()
        }
        if enrollment_ids
        else {}
    )

    month_payment_items = [
        {
            "id": row.id,
            "billing_month": row.billing_month,
            "teacher_id": row.teacher_id,
            "enrollment_id": row.enrollment_id,
            "billing_unit": row.billing_unit,
            "teacher_name": _teacher_name_by_profile_id(db, row.teacher_id),
            "product_name": product_name_by_enrollment.get(row.enrollment_id),
            "payment_method": payment_method_by_enrollment.get(row.enrollment_id),
            "total_sessions": row.total_sessions,
            "completed_sessions": row.completed_sessions,
            "base_amount": row.base_amount,
            "special_amount": row.special_amount,
            "refund_amount": row.refund_amount,
            "final_amount": row.final_amount,
            "payment_tag": row.payment_tag,
            "memo": row.memo,
        }
        for row in payment_rows
    ]

    history_items = [
        {
            "id": row.id,
            "billing_month": row.billing_month,
            "teacher_id": row.teacher_id,
            "teacher_name": _teacher_name_by_profile_id(db, row.teacher_id),
            "enrollment_id": row.enrollment_id,
            "billing_unit": row.billing_unit,
            "product_name": product_name_by_enrollment.get(row.enrollment_id),
            "payment_method": payment_method_by_enrollment.get(row.enrollment_id),
            "final_amount": row.final_amount,
            "payment_tag": row.payment_tag,
            "memo": row.memo,
        }
        for row in history_rows
    ]

    refund_rows = (
        db.query(RefundRequest)
        .filter(RefundRequest.student_id == student_id)
        .order_by(RefundRequest.billing_month.desc(), RefundRequest.id.desc())
        .all()
    )
    refund_items = [
        {
            "id": r.id,
            "billing_month": r.billing_month,
            "enrollment_id": r.enrollment_id,
            "paid_amount": r.paid_amount,
            "refund_amount": r.refund_amount,
            "status": r.status,
        }
        for r in refund_rows
    ]

    return {
        "student_id": student_id,
        "student_name": student_name,
        "billing_month": month,
        "phone": student.phone,
        "grade_level": student.grade_level,
        "parent_name": student.parent_name,
        "parent_phone": student.parent_phone,
        "enrollments": [e for e in enrollment_items if (not month or e.get("is_valid_for_month"))],
        "month_payments": month_payment_items,
        "payment_history": history_items,
        "refund_requests": refund_items,
    }


@app.get("/api/register/options")
def register_options(db: Session = Depends(get_db)):
    """데이터 등록 화면용 선택 목록."""
    return list_register_options(db)


@app.post("/api/register/user")
def register_user_endpoint(payload: RegisterUserPayload, db: Session = Depends(get_db)):
    """
    사용자 + 역할별 프로필(학생/선생님) 한 번에 생성.
    """
    try:
        result = register_user(db, payload.model_dump())
        db.commit()
        return {"ok": True, **result}
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/register/enrollment")
@app.post("/api/register/subscription")
def register_enrollment_endpoint(payload: RegisterEnrollmentPayload, db: Session = Depends(get_db)):
    """
    수업(학생↔선생님) 생성. 시범일 입력 시 trial_fee는 10,000원으로 자동 설정.
    """
    try:
        result = register_enrollment(db, payload.model_dump())
        db.commit()
        return {"ok": True, "trial_fee_amount": TRIAL_FEE_AMOUNT, **result}
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/admin/schemas")
def admin_list_schemas():
    return {"tables": get_all_schemas()}


@app.get("/api/admin/overview")
def admin_tables_overview(max_rows: int = 2000, db: Session = Depends(get_db)):
    max_rows = min(max(max_rows, 1), 5000)
    return build_tables_overview(db, max_rows_per_table=max_rows)


@app.get("/api/admin/tables/{table_name}/rows")
def admin_list_table_rows(
    table_name: str,
    offset: int = 0,
    limit: int = 50,
    q: Optional[str] = None,
    exclude_ended: bool = False,
    db: Session = Depends(get_db),
):
    if table_name not in list_table_names():
        raise HTTPException(status_code=404, detail="알 수 없는 테이블입니다.")
    limit = min(max(limit, 1), 200)
    offset = max(offset, 0)
    try:
        return list_rows(
            db,
            table_name,
            offset=offset,
            limit=limit,
            query=q,
            exclude_ended=exclude_ended,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="알 수 없는 테이블입니다.") from None


@app.get("/api/admin/tables/{table_name}/rows/{row_id}")
def admin_get_table_row(table_name: str, row_id: int, db: Session = Depends(get_db)):
    if table_name not in list_table_names():
        raise HTTPException(status_code=404, detail="알 수 없는 테이블입니다.")
    try:
        return get_row(db, table_name, row_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/admin/tables/{table_name}/rows")
def admin_create_table_row(table_name: str, payload: AdminRowPayload, db: Session = Depends(get_db)):
    if table_name not in list_table_names():
        raise HTTPException(status_code=404, detail="알 수 없는 테이블입니다.")
    try:
        return create_row(db, table_name, payload.values)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/api/admin/tables/{table_name}/rows/{row_id}")
def admin_update_table_row(
    table_name: str,
    row_id: int,
    payload: AdminRowPayload,
    db: Session = Depends(get_db),
):
    if table_name not in list_table_names():
        raise HTTPException(status_code=404, detail="알 수 없는 테이블입니다.")
    try:
        return update_row(db, table_name, row_id, payload.values)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/admin/tables/{table_name}/rows/{row_id}")
def admin_delete_table_row(table_name: str, row_id: int, db: Session = Depends(get_db)):
    if table_name not in list_table_names():
        raise HTTPException(status_code=404, detail="알 수 없는 테이블입니다.")
    try:
        return delete_row(db, table_name, row_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

