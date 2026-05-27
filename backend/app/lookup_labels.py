"""데이터 관리 화면용 FK → 사람이 읽을 수 있는 라벨."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import LessonEnrollment, Product, StudentProfile, TeacherProfile, User


def build_admin_lookups(db: Session) -> dict[str, dict[int, str]]:
    students: dict[int, str] = {}
    for profile_id, name in (
        db.query(StudentProfile.id, User.name)
        .join(User, User.id == StudentProfile.user_id)
        .all()
    ):
        students[profile_id] = name or f"학생#{profile_id}"

    teachers: dict[int, str] = {}
    for profile_id, name in (
        db.query(TeacherProfile.id, User.name)
        .join(User, User.id == TeacherProfile.user_id)
        .all()
    ):
        teachers[profile_id] = name or f"선생님#{profile_id}"

    products: dict[int, str] = {
        row[0]: row[1] or f"상품#{row[0]}"
        for row in db.query(Product.id, Product.name).all()
    }

    users: dict[int, str] = {
        row[0]: row[1] or f"user#{row[0]}" for row in db.query(User.id, User.name).all()
    }

    lesson_enrollments: dict[int, str] = {}
    for enrollment in db.query(LessonEnrollment).all():
        student = students.get(enrollment.student_id, f"학생#{enrollment.student_id}")
        teacher = teachers.get(enrollment.teacher_id, f"선생님#{enrollment.teacher_id}")
        product = products.get(enrollment.product_id, "") if enrollment.product_id else ""
        lesson_enrollments[enrollment.id] = f"{student} · {teacher}" + (f" · {product}" if product else "")

    return {
        "users": users,
        "student_profiles": students,
        "teacher_profiles": teachers,
        "products": products,
        "lesson_enrollments": lesson_enrollments,
        # 예전 fk_table 키 호환
        "subscriptions": lesson_enrollments,
    }


def labels_for_row(row: dict[str, Any], schema: dict[str, Any], lookups: dict[str, dict[int, str]]) -> dict[str, str]:
    labels: dict[str, str] = {}
    for col in schema.get("columns", []):
        if col.get("type") != "fk":
            continue
        fk_table = col.get("fk_table")
        col_name = col.get("name")
        if not fk_table or not col_name:
            continue
        raw = row.get(col_name)
        if raw is None or raw == "":
            continue
        try:
            key = int(raw)
        except (TypeError, ValueError):
            continue
        label = lookups.get(fk_table, {}).get(key)
        if label:
            labels[col_name] = label
    return labels


def enrich_row(row: dict[str, Any], schema: dict[str, Any], lookups: dict[str, dict[int, str]]) -> dict[str, Any]:
    enriched = dict(row)
    enriched["_labels"] = labels_for_row(row, schema, lookups)
    return enriched
