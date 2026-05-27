"""수업(lesson_enrollments) 날짜·다음 청구일 계산."""

from __future__ import annotations

import calendar
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from .models import LessonEnrollment


def parse_date_only(value: Optional[str]) -> Optional[date]:
    if value is None or value == "":
        return None
    text = str(value).strip()[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def normalize_date_only(value: Optional[str]) -> Optional[str]:
    """YYYY-MM-DD. 시각(00:00:00) 등은 잘라냅니다."""
    parsed = parse_date_only(value)
    return parsed.isoformat() if parsed else None


def _add_one_month(year: int, month: int, billing_day: int) -> date:
    month += 1
    if month > 12:
        month = 1
        year += 1
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(billing_day, last))


def compute_next_billing_date(start: date, *, as_of: Optional[date] = None) -> str:
    """
    다음 청구일은 매월 1일 고정.
    as_of 이후 가장 가까운 1일을 반환합니다.
    """
    as_of = as_of or date.today()
    billing_day = 1
    year, month = as_of.year, as_of.month
    last = calendar.monthrange(year, month)[1]
    candidate = date(year, month, min(billing_day, last))
    if candidate < as_of:
        candidate = _add_one_month(year, month, billing_day)
    return candidate.isoformat()


def enrollment_is_cancelled(enrollment: LessonEnrollment) -> bool:
    return bool(normalize_date_only(enrollment.cancelled_at))


def should_auto_update_next_billing(enrollment: LessonEnrollment) -> bool:
    """종료일 없고 해지되지 않은 진행 수업만 DB에 다음 청구일을 자동 반영."""
    if enrollment_is_cancelled(enrollment):
        return False
    if enrollment.end_date and str(enrollment.end_date).strip():
        return False
    if not parse_date_only(enrollment.start_date):
        return False
    return True


def resolve_next_billing(
    enrollment: LessonEnrollment,
    *,
    as_of: Optional[date] = None,
) -> Optional[str]:
    as_of = as_of or date.today()

    if enrollment_is_cancelled(enrollment):
        return None

    end = parse_date_only(enrollment.end_date)
    if end and end < as_of:
        return None

    start = parse_date_only(enrollment.start_date)
    if not start:
        return None

    nxt = parse_date_only(compute_next_billing_date(start, as_of=as_of))
    if not nxt:
        return None
    if end and nxt > end:
        return None
    return nxt.isoformat()


def sync_enrollment_next_billing(
    enrollment: LessonEnrollment,
    *,
    persist: bool = True,
    as_of: Optional[date] = None,
) -> Optional[str]:
    if should_auto_update_next_billing(enrollment):
        computed = resolve_next_billing(enrollment, as_of=as_of)
        if persist and enrollment.next_billing != computed:
            enrollment.next_billing = computed
        return computed
    return normalize_date_only(enrollment.next_billing) or resolve_next_billing(enrollment, as_of=as_of)


def sync_all_next_billing(db: Session) -> int:
    changed = 0
    for row in db.query(LessonEnrollment).order_by(LessonEnrollment.id.asc()).all():
        row.cancelled_at = normalize_date_only(row.cancelled_at)
        row.start_date = normalize_date_only(row.start_date) or row.start_date
        row.end_date = normalize_date_only(row.end_date) or row.end_date
        row.trial_date = normalize_date_only(row.trial_date) or row.trial_date
        before = row.next_billing
        sync_enrollment_next_billing(row, persist=True)
        if row.next_billing != before:
            changed += 1
    return changed


def normalize_enrollment_dates(enrollment: LessonEnrollment) -> None:
    enrollment.cancelled_at = normalize_date_only(enrollment.cancelled_at)
    if enrollment.start_date:
        enrollment.start_date = normalize_date_only(enrollment.start_date) or enrollment.start_date
    if enrollment.end_date:
        enrollment.end_date = normalize_date_only(enrollment.end_date) or enrollment.end_date
    if enrollment.trial_date:
        enrollment.trial_date = normalize_date_only(enrollment.trial_date) or enrollment.trial_date
    if enrollment.next_billing:
        enrollment.next_billing = normalize_date_only(enrollment.next_billing) or enrollment.next_billing
