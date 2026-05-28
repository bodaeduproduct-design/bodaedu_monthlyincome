from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

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
from .settlement_sync import sync_settlements_from_payments
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


def _active_counts(db: Session, billing_month: str) -> dict[str, int]:
    return {
        "active_student_count": _safe_int(
            db.query(func.count(func.distinct(MonthlyPaymentRecord.student_id)))
            .filter(MonthlyPaymentRecord.billing_month == billing_month)
            .scalar()
        ),
        "active_teacher_count": _safe_int(
            db.query(func.count(func.distinct(MonthlyPaymentRecord.teacher_id)))
            .filter(MonthlyPaymentRecord.billing_month == billing_month)
            .scalar()
        ),
    }


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

    teacher_settlement = _sum_settlement_pre_tax(db, billing_month)
    trial_fee = _sum_trial_fee_for_month(db, billing_month)
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
        "prev_month": prev_month,
        "prev_gross_revenue": prev_gross,
        "revenue_delta": revenue_delta,
        "revenue_delta_rate": revenue_delta_rate,
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
    for month in trend_months:
        lesson = _lesson_revenue_split(db, month)
        gross = lesson["total"] if lesson["has_lesson_data"] else _settlement_gross_split(db, month)["total"]
        active = _active_counts(db, month)
        revenue_trend.append({"month": month, "gross_revenue": gross})
        student_trend.append({"month": month, "student_count": active["active_student_count"]})
    return {"revenue_trend_6m": revenue_trend, "student_trend_6m": student_trend}


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


def _ensure_schema() -> None:
    # boda.db는 이미 테이블이 존재하지만, 로컬 개발 환경에서 누락 시 생성되도록 유지합니다.
    apply_table_renames(engine)
    Base.metadata.create_all(bind=engine)
    # 수업에만 있고 정산에 없는 시범 데이터 보정
    from .database import SessionLocal

    db = SessionLocal()
    try:
        # 수업 → 월별 수납 레코드 자동 생성(미납=0)
        sync_monthly_payment_records_from_enrollments(db)
        # 월별 수납 → 선생님 정산 자동 갱신 (월별/회당)
        sync_settlements_from_payments(db)
        sync_all_trial_enrollments(db)
        sync_all_next_billing(db)
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
            aggregated_map[key] = {
                "billing_month": billing_month,
                "teacher_id": teacher_id,
                "teacher_name": name,
                "gross_amount": 0,
                "trial_fee": 0,
                "net_amount": 0,
                "monthly_net_amount": 0,
                "per_session_net_amount": 0,
                "trial_net_amount": 0,
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

    aggregated = sorted(aggregated_map.values(), key=lambda row: row["net_amount"], reverse=True)
    return {"items": items, "aggregated": aggregated}


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
    """
    선생님 상세 정산 페이지용.\n
    - settlements(월별결제/회당결제) 합계\n
    - monthly_payment_records 상세(있을 경우)\n
    - refund_requests(있을 경우)\n
    """
    teacher_name = _teacher_name_by_profile_id(db, teacher_id)

    settlement_lines = (
        db.query(
            Settlement.settlement_type,
            func.coalesce(func.sum(Settlement.gross_amount), 0),
            func.coalesce(func.sum(Settlement.trial_fee), 0),
            func.coalesce(func.sum(Settlement.net_amount), 0),
        )
        .filter(Settlement.teacher_id == teacher_id, Settlement.billing_month == billing_month)
        .group_by(Settlement.settlement_type)
        .all()
    )
    settlement_summary = [
        {
            "settlement_type": settlement_type,
            "gross_amount": _safe_int(gross_sum),
            "trial_fee": _safe_int(trial_sum),
            "net_amount": _safe_int(net_sum),
        }
        for settlement_type, gross_sum, trial_sum, net_sum in settlement_lines
    ]

    # 수업 레코드 상세 (현재 샘플 DB는 0건일 수 있음)
    lesson_rows = (
        db.query(MonthlyPaymentRecord)
        .filter(MonthlyPaymentRecord.teacher_id == teacher_id, MonthlyPaymentRecord.billing_month == billing_month)
        .order_by(MonthlyPaymentRecord.id.asc())
        .all()
    )
    lesson_items = []
    for row in lesson_rows:
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
        lesson_items.append(
            {
                "id": row.id,
                "student_id": row.student_id,
                "student_name": student_name,
                "enrollment_id": row.enrollment_id,
                "billing_unit": row.billing_unit,
                "product_name": product_name,
                "total_sessions": row.total_sessions,
                "completed_sessions": row.completed_sessions,
                "final_amount": row.final_amount,
                "trial_fee": row.trial_fee,
                "refund_amount": row.refund_amount,
                "payment_tag": row.payment_tag,
                "memo": row.memo,
            }
        )

    refund_rows = (
        db.query(RefundRequest)
        .filter(RefundRequest.billing_month == billing_month)
        .order_by(RefundRequest.id.asc())
        .all()
    )
    refund_items = [
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

    return {
        "teacher_id": teacher_id,
        "teacher_name": teacher_name,
        "billing_month": billing_month,
        "settlement_summary": settlement_summary,
        "lesson_records": lesson_items,
        "refund_requests": refund_items,
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

