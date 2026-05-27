"""학생 결제 수단 — 수납 시트 기준으로 student_records에 반영."""

from __future__ import annotations

from sqlalchemy.orm import Session

from .models import SessionCollection, StudentRecord, TuitionStudentMonth


def latest_payment_methods_by_student(db: Session) -> dict[str, str]:
    """학생 이름 → 가장 최근 결제 수단 (회당 수금 우선, 그다음 월별 수납)."""
    methods: dict[str, str] = {}

    tuition_rows = db.query(TuitionStudentMonth).order_by(
        TuitionStudentMonth.month.asc(), TuitionStudentMonth.id.asc()
    ).all()
    for row in tuition_rows:
        if row.student_name and row.payment_method:
            methods[row.student_name.strip()] = row.payment_method.strip()

    session_rows = db.query(SessionCollection).order_by(
        SessionCollection.month.asc(), SessionCollection.id.asc()
    ).all()
    for row in session_rows:
        if row.student_name and row.payment_method:
            methods[row.student_name.strip()] = row.payment_method.strip()

    return methods


def sync_student_payment_methods(db: Session, *, overwrite: bool = False) -> int:
    """워크북 import 후 student_records.payment_method 갱신."""
    methods = latest_payment_methods_by_student(db)
    updated = 0
    for student in db.query(StudentRecord).all():
        method = methods.get(student.student_name)
        if not method:
            continue
        if overwrite or not student.payment_method:
            if student.payment_method != method:
                student.payment_method = method
                updated += 1
    if updated:
        db.commit()
    return updated
