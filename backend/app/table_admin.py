"""boda.db 테이블별 조회·수정·삭제 (화이트리스트)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from .models import (
    CommissionRateHistory,
    LessonEnrollment,
    MonthlyPaymentRecord,
    Product,
    RefundRequest,
    Settlement,
    StudentProfile,
    TeacherProfile,
    User,
)
from .billing_sync import normalize_enrollment_trial, sync_enrollment_trial_settlement
from .enrollment_billing import normalize_enrollment_dates, sync_enrollment_next_billing
from .lookup_labels import build_admin_lookups, enrich_row
from .schema_registry import get_table_schema, list_table_names, resolve_table_name

TABLE_MODELS = {
    "users": User,
    "student_profiles": StudentProfile,
    "teacher_profiles": TeacherProfile,
    "products": Product,
    "lesson_enrollments": LessonEnrollment,
    "monthly_payment_records": MonthlyPaymentRecord,
    "settlements": Settlement,
    "refund_requests": RefundRequest,
    "commission_rate_history": CommissionRateHistory,
}


def _model_for_table(table_name: str):
    canonical = resolve_table_name(table_name)
    if canonical not in TABLE_MODELS:
        raise KeyError(table_name)
    return TABLE_MODELS[canonical]


def _apply_search_filter(
    db: Session,
    q,
    *,
    table_name: str,
    model: type,
    schema: dict[str, Any],
    query: str,
):
    term = f"%{query.strip()}%"
    field_filters = [
        getattr(model, field).ilike(term)
        for field in schema.get("search_fields", [])
        if hasattr(model, field)
    ]

    canonical = resolve_table_name(table_name)
    if canonical == "lesson_enrollments":
        teacher_user = aliased(User)
        student_user = aliased(User)
        return (
            q.outerjoin(TeacherProfile, TeacherProfile.id == LessonEnrollment.teacher_id)
            .outerjoin(teacher_user, teacher_user.id == TeacherProfile.user_id)
            .outerjoin(StudentProfile, StudentProfile.id == LessonEnrollment.student_id)
            .outerjoin(student_user, student_user.id == StudentProfile.user_id)
            .filter(
                or_(
                    *field_filters,
                    teacher_user.name.ilike(term),
                    student_user.name.ilike(term),
                )
            )
            .distinct()
        )

    if not field_filters:
        return q
    return q.filter(or_(*field_filters))


def _serialize_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _serialize_row(row: Any, column_names: list[str]) -> dict[str, Any]:
    return {name: _serialize_value(getattr(row, name)) for name in column_names}


def _parse_value(meta: dict[str, Any], raw: Any) -> Any:
    col_type = meta.get("type", "text")
    if raw is None or raw == "":
        if meta.get("required"):
            return raw
        return None

    if col_type == "integer":
        return int(raw)
    if col_type == "float":
        return float(raw)
    if col_type == "date":
        from .enrollment_billing import normalize_date_only

        return normalize_date_only(str(raw).strip() if raw is not None else None)
    if col_type in ("text", "textarea", "fk"):
        text = str(raw).strip()
        return text or None
    return raw


def build_tables_overview(db: Session, *, max_rows_per_table: int = 2000) -> dict[str, Any]:
    max_rows_per_table = min(max(max_rows_per_table, 1), 5000)
    tables: list[dict[str, Any]] = []
    grand_total = 0

    for table_name in list_table_names():
        schema = get_table_schema(table_name)
        model = _model_for_table(table_name)
        column_names = [col["name"] for col in schema["columns"]]

        q = db.query(model)
        total = q.count()
        grand_total += total

        order_col = getattr(model, "id", None)
        if order_col is not None:
            rows = q.order_by(model.id.asc()).limit(max_rows_per_table).all()
        else:
            rows = q.limit(max_rows_per_table).all()

        lookups = build_admin_lookups(db)
        serialized = [_serialize_row(row, column_names) for row in rows]
        tables.append(
            {
                "table": table_name,
                "label": schema["label"],
                "sheet": schema.get("sheet", ""),
                "total": total,
                "truncated": total > len(rows),
                "columns": schema["columns"],
                "rows": [enrich_row(r, schema, lookups) for r in serialized],
            }
        )

    return {
        "table_count": len(tables),
        "row_count": grand_total,
        "max_rows_per_table": max_rows_per_table,
        "tables": tables,
    }


def list_rows(
    db: Session,
    table_name: str,
    *,
    offset: int = 0,
    limit: int = 50,
    query: Optional[str] = None,
) -> dict[str, Any]:
    schema = get_table_schema(table_name)
    model = _model_for_table(table_name)
    column_names = [col["name"] for col in schema["columns"]]

    q = db.query(model)
    if query and schema.get("search_fields"):
        q = _apply_search_filter(db, q, table_name=table_name, model=model, schema=schema, query=query)

    total = q.count()
    order_col = getattr(model, "id", None)
    if order_col is not None:
        rows = q.order_by(model.id.desc()).offset(offset).limit(limit).all()
    else:
        rows = q.offset(offset).limit(limit).all()

    lookups = build_admin_lookups(db)
    serialized = [_serialize_row(row, column_names) for row in rows]
    return {
        "table": table_name,
        "total": total,
        "offset": offset,
        "limit": limit,
        "rows": [enrich_row(r, schema, lookups) for r in serialized],
    }


def get_row(db: Session, table_name: str, row_id: int) -> dict[str, Any]:
    schema = get_table_schema(table_name)
    model = _model_for_table(table_name)
    row = db.get(model, row_id)
    if not row:
        raise LookupError("행을 찾을 수 없습니다.")
    column_names = [col["name"] for col in schema["columns"]]
    serialized = _serialize_row(row, column_names)
    lookups = build_admin_lookups(db)
    return enrich_row(serialized, schema, lookups)


def _apply_values(row: Any, table_name: str, values: dict[str, Any]) -> None:
    schema = get_table_schema(table_name)
    col_meta = {c["name"]: c for c in schema["columns"]}
    for name, meta in col_meta.items():
        if not meta.get("editable", True):
            continue
        if name not in values:
            continue
        setattr(row, name, _parse_value(meta, values[name]))


def create_row(db: Session, table_name: str, values: dict[str, Any]) -> dict[str, Any]:
    schema = get_table_schema(table_name)
    if not schema["allow_create"]:
        raise PermissionError("이 테이블은 새 행을 추가할 수 없습니다.")
    model = _model_for_table(table_name)
    row = model()
    _apply_values(row, table_name, values)

    for col in schema["columns"]:
        if col.get("required") and getattr(row, col["name"], None) in (None, ""):
            raise ValueError(f"{col['label']}({col['name']})은(는) 필수입니다.")

    db.add(row)
    try:
        db.flush()
        if resolve_table_name(table_name) == "lesson_enrollments":
            normalize_enrollment_dates(row)
            normalize_enrollment_trial(row)
            sync_enrollment_next_billing(row)
            sync_enrollment_trial_settlement(db, row)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("저장 실패: 중복 값 또는 FK 제약을 확인하세요.") from exc
    db.refresh(row)
    return {"id": row.id}


def update_row(db: Session, table_name: str, row_id: int, values: dict[str, Any]) -> dict[str, Any]:
    model = _model_for_table(table_name)
    row = db.get(model, row_id)
    if not row:
        raise LookupError("행을 찾을 수 없습니다.")
    previous_trial_month = row.trial_month if resolve_table_name(table_name) == "lesson_enrollments" else None
    _apply_values(row, table_name, values)
    try:
        if resolve_table_name(table_name) == "lesson_enrollments":
            normalize_enrollment_dates(row)
            normalize_enrollment_trial(row)
            sync_enrollment_next_billing(row)
            sync_enrollment_trial_settlement(db, row, previous_trial_month=previous_trial_month)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("저장 실패: 중복 값 또는 FK 제약을 확인하세요.") from exc
    return {"id": row_id}


def _delete_user_row(db: Session, user_id: int) -> None:
    """users 삭제 시 연결된 학생/선생님 프로필을 함께 정리합니다."""
    user = db.get(User, user_id)
    if not user:
        raise LookupError("행을 찾을 수 없습니다.")

    student_profile = db.query(StudentProfile).filter(StudentProfile.user_id == user_id).first()
    if student_profile:
        refs = (
            db.query(LessonEnrollment).filter(LessonEnrollment.student_id == student_profile.id).count()
            + db.query(MonthlyPaymentRecord).filter(MonthlyPaymentRecord.student_id == student_profile.id).count()
            + db.query(RefundRequest).filter(RefundRequest.student_id == student_profile.id).count()
        )
        if refs > 0:
            raise ValueError(
                "이 학생은 수업·수납·환불 데이터가 있어 삭제할 수 없습니다. "
                "관련 수업/수납을 먼저 정리하거나 학생 프로필만 별도 삭제하세요."
            )
        db.delete(student_profile)

    teacher_profile = db.query(TeacherProfile).filter(TeacherProfile.user_id == user_id).first()
    if teacher_profile:
        refs = (
            db.query(LessonEnrollment).filter(LessonEnrollment.teacher_id == teacher_profile.id).count()
            + db.query(MonthlyPaymentRecord).filter(MonthlyPaymentRecord.teacher_id == teacher_profile.id).count()
            + db.query(Settlement).filter(Settlement.teacher_id == teacher_profile.id).count()
        )
        if refs > 0:
            raise ValueError(
                "이 선생님은 수업·수납·정산 데이터가 있어 삭제할 수 없습니다. "
                "관련 데이터를 먼저 정리하거나 선생님 프로필만 별도 삭제하세요."
            )
        db.delete(teacher_profile)

    db.delete(user)


def delete_row(db: Session, table_name: str, row_id: int) -> dict[str, Any]:
    schema = get_table_schema(table_name)
    if not schema["allow_delete"]:
        raise PermissionError("이 테이블은 삭제할 수 없습니다.")
    try:
        if table_name == "users":
            _delete_user_row(db, row_id)
        else:
            model = _model_for_table(table_name)
            row = db.get(model, row_id)
            if not row:
                raise LookupError("행을 찾을 수 없습니다.")
            db.delete(row)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("삭제 실패: 다른 테이블에서 참조 중일 수 있습니다.") from exc
    return {"deleted": True, "id": row_id}

