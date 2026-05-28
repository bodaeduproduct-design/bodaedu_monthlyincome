"""통합 데이터 등록 (사용자 + 수업)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .billing_sync import TRIAL_FEE_AMOUNT, sync_enrollment_trial_settlement
from .enrollment_billing import normalize_date_only, sync_enrollment_next_billing
from .models import LessonEnrollment, Product, StudentProfile, TeacherProfile, User


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def trial_month_from_date(trial_date: str) -> Optional[str]:
    """'2026-05-15' -> '2026-05'"""
    if not trial_date:
        return None
    text = str(trial_date).strip()
    if len(text) >= 7 and text[4] == "-":
        return text[:7]
    return None


def list_register_options(db: Session) -> dict[str, Any]:
    students = [
        {
            "id": sp.id,
            "name": name,
            "user_id": sp.user_id,
        }
        for sp, name in (
            db.query(StudentProfile, User.name)
            .join(User, User.id == StudentProfile.user_id)
            .order_by(User.name.asc())
            .all()
        )
    ]
    teachers = [
        {
            "id": tp.id,
            "name": name,
            "user_id": tp.user_id,
            "email": email,
            "status": tp.status or "active",
            "status_changed_at": tp.status_changed_at,
        }
        for tp, name, email in (
            db.query(TeacherProfile, User.name, User.email)
            .join(User, User.id == TeacherProfile.user_id)
            .order_by(User.name.asc())
            .all()
        )
    ]
    products = [
        {
            "id": p.id,
            "name": p.name,
            "billing_unit": p.billing_unit,
            "level": p.level,
            "sessions_per_week": p.sessions_per_week,
        }
        for p in db.query(Product).order_by(Product.name.asc()).all()
        if getattr(p, "is_active", 1) in (1, None, True)
    ]
    return {
        "trial_fee_amount": TRIAL_FEE_AMOUNT,
        "students": students,
        "teachers": teachers,
        "products": products,
    }


def register_user(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    role = str(payload.get("role") or "").strip().lower()
    name = str(payload.get("name") or "").strip()
    if role not in ("teacher", "student"):
        raise ValueError("역할(role)은 teacher 또는 student여야 합니다.")
    if not name:
        raise ValueError("이름은 필수입니다.")

    email = str(payload.get("email") or "").strip() or None
    created_at = _now_iso()

    user = User(email=email, name=name, role=role, created_at=created_at)
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("이메일이 이미 사용 중이거나 저장에 실패했습니다.") from exc

    if role == "student":
        profile = StudentProfile(
            user_id=user.id,
            phone=payload.get("phone"),
            region=payload.get("region"),
            grade_level=payload.get("grade_level"),
            parent_name=payload.get("parent_name"),
            parent_phone=payload.get("parent_phone"),
            created_at=created_at,
        )
        db.add(profile)
        db.flush()
        return {
            "user_id": user.id,
            "role": role,
            "name": name,
            "student_profile_id": profile.id,
            "teacher_profile_id": None,
        }

    profile = TeacherProfile(
        user_id=user.id,
        phone=payload.get("phone"),
        birth_date=payload.get("birth_date"),
        gender=payload.get("gender"),
        education=payload.get("education"),
        major=payload.get("major"),
        status=payload.get("status") or "active",
        created_at=created_at,
    )
    db.add(profile)
    db.flush()
    return {
        "user_id": user.id,
        "role": role,
        "name": name,
        "student_profile_id": None,
        "teacher_profile_id": profile.id,
    }


def register_enrollment(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    student_id = payload.get("student_id")
    teacher_id = payload.get("teacher_id")
    product_id = payload.get("product_id")
    if not student_id or not teacher_id or not product_id:
        raise ValueError("학생, 선생님, 상품은 필수입니다.")

    student = db.get(StudentProfile, int(student_id))
    teacher = db.get(TeacherProfile, int(teacher_id))
    product = db.get(Product, int(product_id))
    if not student:
        raise ValueError("학생 프로필을 찾을 수 없습니다.")
    if not teacher:
        raise ValueError("선생님 프로필을 찾을 수 없습니다.")
    if not product:
        raise ValueError("상품을 찾을 수 없습니다.")

    trial_date = str(payload.get("trial_date") or "").strip() or None
    trial_month = str(payload.get("trial_month") or "").strip() or None
    if not trial_month and trial_date:
        trial_month = trial_month_from_date(trial_date)
    if trial_date and trial_month:
        trial_fee = TRIAL_FEE_AMOUNT
    else:
        trial_fee = _safe_int_optional(payload.get("trial_fee")) or 0

    price_type = payload.get("price_type")
    if not price_type:
        price_type = "per_session" if product.billing_unit == "per_session" else "price_17"

    base_rate = float(payload.get("base_commission_rate") or 60.0)
    current_rate = float(payload.get("current_commission_rate") or base_rate)

    sub = LessonEnrollment(
        student_id=int(student_id),
        teacher_id=int(teacher_id),
        product_id=int(product_id),
        price_type=price_type,
        payment_method=payload.get("payment_method") or "card",
        day_1=_safe_int_optional(payload.get("day_1")),
        day_2=_safe_int_optional(payload.get("day_2")),
        day_3=_safe_int_optional(payload.get("day_3")),
        base_commission_rate=base_rate,
        current_commission_rate=current_rate,
        trial_date=trial_date,
        trial_month=trial_month,
        trial_fee=trial_fee,
        start_date=normalize_date_only(payload.get("start_date")),
        end_date=normalize_date_only(payload.get("end_date")),
        next_billing=normalize_date_only(payload.get("next_billing")),
        created_at=_now_iso(),
    )
    db.add(sub)
    db.flush()
    sync_enrollment_next_billing(sub)

    billing_sync = sync_enrollment_trial_settlement(db, sub)

    student_name = db.query(User.name).filter(User.id == student.user_id).scalar()
    teacher_name = db.query(User.name).filter(User.id == teacher.user_id).scalar()

    return {
        "enrollment_id": sub.id,
        "student_id": sub.student_id,
        "student_name": student_name,
        "teacher_id": sub.teacher_id,
        "teacher_name": teacher_name,
        "product_name": product.name,
        "trial_date": sub.trial_date,
        "trial_month": sub.trial_month,
        "trial_fee": sub.trial_fee,
        "status": "trial" if not sub.start_date else ("cancelled" if sub.cancelled_at else "active"),
        "next_billing": sub.next_billing,
        "settlement_id": billing_sync.get("settlement_id"),
    }


# 하위 호환
register_subscription = register_enrollment


def _safe_int_optional(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
