from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Iterable

from sqlalchemy.orm import Session

from .models import (
    Enrollment,
    EnrollmentSchedule,
    SessionCollection,
    StudentRecord,
    Teacher,
    TeacherProfile,
    TrialLesson,
    TuitionRecord,
)

BILLING_PLAN_LABELS = {
    "monthly_35": "월별 (35% 할인)",
    "monthly_17": "월별 (17% 할인)",
    "monthly": "월별",
    "session": "회차",
}


def infer_billing_plan(product_name: str | None) -> str:
    text = (product_name or "").strip()
    if "35" in text:
        return "monthly_35"
    if "17" in text:
        return "monthly_17"
    if "회당" in text:
        return "session"
    return "monthly"


def _parse_month_start(month_key: str | None) -> date | None:
    if not month_key:
        return None
    try:
        year_text, month_text = month_key.split("-")
        return date(int(year_text), int(month_text), 1)
    except ValueError:
        return None


def _schedule_key(row: SessionCollection) -> tuple:
    return (
        (row.course or "").strip(),
        (row.weekly_frequency or "").strip(),
        (row.weekdays or "").strip(),
        (row.time_text or "").strip(),
    )


def _row_effective_start(row: SessionCollection) -> date | None:
    if row.lesson_start_date:
        return row.lesson_start_date
    return _parse_month_start(row.month)


def _build_schedule_periods(rows: Iterable[SessionCollection]) -> list[dict]:
    ordered = sorted(
        rows,
        key=lambda row: (
            _row_effective_start(row) or date.min,
            row.month or "",
            row.id or 0,
        ),
    )
    periods: list[dict] = []
    current: dict | None = None

    for row in ordered:
        key = _schedule_key(row)
        start = _row_effective_start(row)
        if start is None:
            continue

        if current is None:
            current = {
                "key": key,
                "effective_from": start,
                "course": row.course,
                "weekly_frequency": row.weekly_frequency,
                "weekdays": row.weekdays,
                "time_text": row.time_text,
            }
            continue

        if key != current["key"]:
            previous_start = current["effective_from"]
            current["effective_to"] = start - timedelta(days=1) if start > previous_start else start
            periods.append(current)
            current = {
                "key": key,
                "effective_from": start,
                "course": row.course,
                "weekly_frequency": row.weekly_frequency,
                "weekdays": row.weekdays,
                "time_text": row.time_text,
            }
        elif start > current["effective_from"]:
            current["effective_from"] = start

    if current is not None:
        periods.append(current)

    return periods


def sync_teachers_and_enrollments(
    db: Session,
    *,
    teacher_profiles: list[TeacherProfile],
    tuition_records: list[TuitionRecord],
    session_collections: list[SessionCollection],
) -> None:
    db.query(EnrollmentSchedule).delete()
    db.query(Enrollment).delete()
    db.query(Teacher).delete()

    profile_by_name = {row.teacher_name: row for row in teacher_profiles}
    tuition_by_name = {row.teacher_name: row for row in tuition_records}
    teacher_ids: dict[str, int] = {}

    teacher_names = sorted(
        {
            row.teacher_name
            for row in teacher_profiles + tuition_records + session_collections
            if row.teacher_name
        }
    )
    for teacher_name in teacher_names:
        profile = profile_by_name.get(teacher_name)
        tuition = tuition_by_name.get(teacher_name)
        teacher = Teacher(
            teacher_name=teacher_name,
            phone=(profile.phone if profile else None) or (tuition.phone if tuition else None),
            email=(profile.email if profile else None) or (tuition.email if tuition else None),
            birth_date_text=(profile.birth_date_text if profile else None)
            or (tuition.birth_date_text if tuition else None),
            gender=(profile.gender if profile else None) or (tuition.gender if tuition else None),
            education=(profile.education if profile else None) or (tuition.education if tuition else None),
            major=(profile.major if profile else None) or (tuition.major if tuition else None),
            teaching_experience=(profile.teaching_experience if profile else None)
            or (tuition.teaching_experience if tuition else None),
            subject=(profile.subject if profile else None) or (tuition.subject if tuition else None),
            available_grades=(profile.available_grades if profile else None)
            or (tuition.available_grades if tuition else None),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(teacher)
        db.flush()
        teacher_ids[teacher_name] = teacher.id

    students = {row.student_name: row for row in db.query(StudentRecord).all()}
    trials_by_pair: dict[tuple[str, str], list[TrialLesson]] = {}
    for trial in db.query(TrialLesson).all():
        trials_by_pair.setdefault((trial.teacher_name, trial.student_name), []).append(trial)

    rows_by_pair: dict[tuple[str, str], list[SessionCollection]] = {}
    for row in session_collections:
        if not row.student_name or not row.teacher_name:
            continue
        rows_by_pair.setdefault((row.student_name, row.teacher_name), []).append(row)

    for (student_name, teacher_name), pair_rows in rows_by_pair.items():
        student = students.get(student_name)
        teacher_id = teacher_ids.get(teacher_name)
        if not student or not teacher_id:
            continue

        latest_row = max(
            pair_rows,
            key=lambda row: (
                row.lesson_start_date or date.min,
                row.month or "",
                row.id or 0,
            ),
        )
        trial_dates = [row.trial_lesson_date for row in pair_rows if row.trial_lesson_date]
        trial_dates.extend(
            trial.trial_lesson_date
            for trial in trials_by_pair.get((teacher_name, student_name), [])
            if trial.trial_lesson_date
        )
        start_dates = [row.lesson_start_date for row in pair_rows if row.lesson_start_date]
        end_dates = [row.lesson_end_date for row in pair_rows if row.lesson_end_date]
        lesson_end = max(end_dates) if end_dates else None
        status = "ended" if lesson_end else "active"

        enrollment = Enrollment(
            student_id=student.id,
            teacher_id=teacher_id,
            billing_plan=infer_billing_plan(latest_row.product_name),
            payment_method=latest_row.payment_method,
            product_name=latest_row.product_name,
            trial_lesson_date=min(trial_dates) if trial_dates else latest_row.trial_lesson_date,
            lesson_start_date=min(start_dates) if start_dates else latest_row.lesson_start_date,
            lesson_end_date=lesson_end,
            status=status,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(enrollment)
        db.flush()

        for period in _build_schedule_periods(pair_rows):
            db.add(
                EnrollmentSchedule(
                    enrollment_id=enrollment.id,
                    effective_from=period["effective_from"],
                    effective_to=period.get("effective_to"),
                    course=period.get("course"),
                    weekly_frequency=period.get("weekly_frequency"),
                    weekdays=period.get("weekdays"),
                    time_text=period.get("time_text"),
                )
            )
