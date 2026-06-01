"""운영 관리 — 수업 중 학생·시범 등 한눈에 보기."""

from __future__ import annotations

from datetime import date
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session, aliased

from .enrollment_billing import billing_month_bounds, parse_date_only
from .models import LessonEnrollment, Product, StudentProfile, TeacherProfile, User


def _normalize_month(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    text_value = str(value).strip()
    if len(text_value) >= 7 and text_value[4] == "-":
        return text_value[:7]
    parsed = parse_date_only(text_value)
    if parsed:
        return f"{parsed.year:04d}-{parsed.month:02d}"
    return None


def _as_of_for_operations_month(billing_month: str) -> date:
    """조회 월이 이번 달이면 오늘, 과거 월이면 해당 월 말일."""
    today = date.today()
    _, end_m = billing_month_bounds(billing_month)
    if today.year == end_m.year and today.month == end_m.month:
        return today
    return end_m


def enrollment_active_as_of(enrollment: LessonEnrollment, as_of: date) -> bool:
    start = parse_date_only(enrollment.start_date)
    if not start or start > as_of:
        return False
    end = parse_date_only(enrollment.end_date)
    cancelled = parse_date_only(enrollment.cancelled_at)
    if cancelled and cancelled <= as_of:
        return False
    if end and end < as_of:
        return False
    return True


def build_operations_overview(db: Session, billing_month: str) -> dict[str, Any]:
    from .main import _billing_type_label, _dashboard_inquiry_lists, _weekday_text_for_enrollment

    as_of = _as_of_for_operations_month(billing_month)
    student_enrollment_counts = {
        int(sid): int(cnt)
        for sid, cnt in db.query(LessonEnrollment.student_id, func.count(LessonEnrollment.id))
        .group_by(LessonEnrollment.student_id)
        .all()
        if sid is not None
    }
    student_user = aliased(User)
    teacher_user = aliased(User)

    rows = (
        db.query(
            LessonEnrollment,
            student_user.name,
            teacher_user.name,
            Product.name,
            Product.billing_unit,
        )
        .join(StudentProfile, StudentProfile.id == LessonEnrollment.student_id)
        .join(student_user, student_user.id == StudentProfile.user_id)
        .outerjoin(TeacherProfile, TeacherProfile.id == LessonEnrollment.teacher_id)
        .outerjoin(teacher_user, teacher_user.id == TeacherProfile.user_id)
        .outerjoin(Product, Product.id == LessonEnrollment.product_id)
        .order_by(student_user.name.asc(), teacher_user.name.asc(), LessonEnrollment.id.asc())
        .all()
    )

    active_enrollments: list[dict[str, Any]] = []
    starting_this_month: list[dict[str, Any]] = []
    ending_this_month: list[dict[str, Any]] = []
    active_student_ids: set[int] = set()
    teacher_names: set[str] = set()

    for enrollment, student_name, teacher_name, product_name, product_billing_unit in rows:
        sid = int(enrollment.student_id or 0)
        if not sid:
            continue
        tname = str(teacher_name or "").strip()
        if tname:
            teacher_names.add(tname)

        base = {
            "enrollment_id": int(enrollment.id),
            "student_id": sid,
            "student_name": str(student_name or ""),
            "student_enrollment_count": student_enrollment_counts.get(sid, 0),
            "teacher_name": tname or "-",
            "product_name": str(product_name or "-"),
            "start_date": str(enrollment.start_date or "") or "-",
            "end_date": str(enrollment.end_date or "") or "-",
            "weekday": _weekday_text_for_enrollment(enrollment),
            "billing_type": _billing_type_label(enrollment, product_billing_unit),
            "payment_method": str(enrollment.payment_method or "") or "-",
        }

        if enrollment_active_as_of(enrollment, as_of):
            active_student_ids.add(sid)
            active_enrollments.append({**base, "status": "수업중"})

        if _normalize_month(enrollment.start_date) == billing_month:
            starting_this_month.append({**base, "status": "신규시작"})

        end_raw = enrollment.end_date or enrollment.cancelled_at
        if _normalize_month(end_raw) == billing_month:
            ending_this_month.append({**base, "status": "종료"})

    inquiry = _dashboard_inquiry_lists(db, billing_month)
    trial_lessons = []
    for item in inquiry.get("trial_lessons") or []:
        sid = int(item.get("student_id") or 0)
        trial_lessons.append(
            {
                **item,
                "student_enrollment_count": student_enrollment_counts.get(sid, 0),
            }
        )

    by_teacher: dict[str, dict[str, int]] = {}
    for row in active_enrollments:
        key = row["teacher_name"]
        bucket = by_teacher.setdefault(
            key,
            {"teacher_name": key, "student_count": 0, "enrollment_count": 0},
        )
        bucket["enrollment_count"] += 1

    for key, bucket in by_teacher.items():
        bucket["student_count"] = len(
            {r["student_id"] for r in active_enrollments if r["teacher_name"] == key}
        )

    teacher_summary = sorted(
        by_teacher.values(),
        key=lambda item: (-int(item["enrollment_count"]), str(item["teacher_name"])),
    )

    return {
        "billing_month": billing_month,
        "as_of": as_of.isoformat(),
        "summary": {
            "active_student_count": len(active_student_ids),
            "active_enrollment_count": len(active_enrollments),
            "trial_lesson_count": len(trial_lessons),
            "starting_count": len({r["student_id"] for r in starting_this_month}),
            "ending_count": len({r["student_id"] for r in ending_this_month}),
            "teacher_count": len(teacher_names),
        },
        "teacher_summary": teacher_summary,
        "active_enrollments": active_enrollments,
        "trial_lessons": trial_lessons,
        "starting_this_month": starting_this_month,
        "ending_this_month": ending_this_month,
    }
