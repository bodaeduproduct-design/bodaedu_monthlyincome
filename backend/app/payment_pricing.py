"""수업(product_id, price_type, 요일) + 상품 단가표 → 월별 수납 금액 산출."""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from .enrollment_billing import billing_month_bounds, parse_date_only
from .models import LessonEnrollment, MonthlyPaymentRecord, Product

# lesson_enrollments.day_* : 0=일 … 6=토 → datetime.weekday() (0=월 … 6=일)
_ENROLL_DAY_TO_PYTHON_WEEKDAY = {0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5}

AUTO_PRICING_TAGS = frozenset({"unpaid", "regular", "first_month", ""})


@dataclass(frozen=True)
class PaymentAmountQuote:
    billing_unit: str
    base_amount: int
    total_sessions: int
    final_amount: int
    payment_tag: str


def enrollment_lesson_weekdays(enrollment: LessonEnrollment) -> list[int]:
    """수업 요일 → Python weekday (월=0 … 일=6)."""
    weekdays: list[int] = []
    for name in ("day_1", "day_2", "day_3"):
        raw = getattr(enrollment, name, None)
        if raw is None or raw == "":
            continue
        try:
            day_code = int(raw)
        except (TypeError, ValueError):
            continue
        if day_code not in _ENROLL_DAY_TO_PYTHON_WEEKDAY:
            continue
        py = _ENROLL_DAY_TO_PYTHON_WEEKDAY[day_code]
        if py not in weekdays:
            weekdays.append(py)
    return sorted(weekdays)


def resolve_price_type(enrollment: LessonEnrollment, product: Optional[Product]) -> str:
    price_type = str(enrollment.price_type or "").strip()
    if price_type in ("price_17", "price_35", "per_session"):
        return price_type
    if product and str(product.billing_unit or "").strip() == "per_session":
        return "per_session"
    return "price_35"


def find_per_session_product_variant(db: Session, product: Product) -> Optional[Product]:
    """월별 상품명 + ' (회당)' 짝 SKU (예: 중등 주2회 90분 → 중등 주2회 90분 (회당))."""
    if str(product.billing_unit or "").strip() == "per_session":
        return product
    variant_name = f"{product.name} (회당)"
    return (
        db.query(Product)
        .filter(Product.name == variant_name, Product.billing_unit == "per_session")
        .first()
    )


def effective_billing_unit(enrollment: LessonEnrollment, product: Optional[Product]) -> str:
    """수업 price_type · 상품 billing_unit 기준 (기존 수납 행 값은 보지 않음)."""
    price_type = resolve_price_type(enrollment, product)
    if price_type == "per_session":
        return "per_session"
    if product:
        unit = str(product.billing_unit or "").strip()
        if unit in ("monthly", "per_session"):
            return unit
    return "monthly"


def resolve_pricing_product(
    db: Session,
    enrollment: LessonEnrollment,
    product: Optional[Product],
    *,
    billing_unit: str,
) -> Optional[Product]:
    if not product:
        return None
    if billing_unit == "per_session" and str(product.billing_unit or "").strip() == "monthly":
        return find_per_session_product_variant(db, product) or product
    return product


def monthly_list_price(product: Product, price_type: str) -> int:
    if price_type == "price_17":
        return int(product.price_17 or product.price_standard or 0)
    if price_type == "price_35":
        return int(product.price_35 or product.price_standard or 0)
    return int(product.price_standard or product.price_35 or product.price_17 or 0)


def per_session_unit_price(product: Product) -> int:
    return int(product.price_per_session or 0)


def _active_period_in_month(
    enrollment: LessonEnrollment,
    billing_month: str,
) -> Optional[tuple[date, date]]:
    month_start, month_end = billing_month_bounds(billing_month)
    lesson_start = parse_date_only(enrollment.start_date)
    if not lesson_start:
        return None

    period_start = max(month_start, lesson_start)
    period_end = month_end

    for boundary in (parse_date_only(enrollment.end_date), parse_date_only(enrollment.cancelled_at)):
        if boundary and boundary < period_end:
            period_end = boundary

    if period_start > period_end:
        return None
    return period_start, period_end


def count_scheduled_sessions_in_month(
    enrollment: LessonEnrollment,
    billing_month: str,
    *,
    product: Optional[Product] = None,
) -> int:
    """해당 월·수업 기간 안에서 배정 요일 수업 횟수."""
    period = _active_period_in_month(enrollment, billing_month)
    if not period:
        return 0

    period_start, period_end = period
    weekdays = enrollment_lesson_weekdays(enrollment)

    if weekdays:
        count = 0
        cursor = period_start
        while cursor <= period_end:
            if cursor.weekday() in weekdays:
                count += 1
            cursor = date.fromordinal(cursor.toordinal() + 1)
        return count

    # 요일 미입력: 상품 주 N회 × (활성 일수/7) 근사
    if product and product.sessions_per_week:
        active_days = (period_end - period_start).days + 1
        return max(0, int(round(float(product.sessions_per_week) * active_days / 7.0)))
    return 0


def _is_start_billing_month(enrollment: LessonEnrollment, billing_month: str) -> bool:
    start = parse_date_only(enrollment.start_date)
    if not start:
        return False
    return f"{start.year:04d}-{start.month:02d}" == billing_month


def quote_payment_for_month(
    db: Session,
    enrollment: LessonEnrollment,
    product: Optional[Product],
    billing_month: str,
) -> Optional[PaymentAmountQuote]:
    if not product:
        return None

    price_type = resolve_price_type(enrollment, product)
    billing_unit = effective_billing_unit(enrollment, product)
    product = resolve_pricing_product(db, enrollment, product, billing_unit=billing_unit)
    if not product:
        return None

    if _is_start_billing_month(enrollment, billing_month):
        if enrollment.first_month_amount is not None and int(enrollment.first_month_amount or 0) > 0:
            amount = int(enrollment.first_month_amount)
            sessions = int(enrollment.first_month_sessions or 0)
            return PaymentAmountQuote(
                billing_unit=billing_unit,
                base_amount=amount,
                total_sessions=sessions,
                final_amount=amount,
                payment_tag="first_month",
            )

    if billing_unit == "monthly":
        base = monthly_list_price(product, price_type)
        if _is_start_billing_month(enrollment, billing_month) and enrollment.first_month_ratio:
            try:
                ratio = float(enrollment.first_month_ratio)
                if 0 < ratio < 100:
                    base = int(round(base * ratio / 100.0))
            except (TypeError, ValueError):
                pass
        if _is_start_billing_month(enrollment, billing_month) and enrollment.first_month_sessions:
            sessions = int(enrollment.first_month_sessions or 0)
        else:
            sessions = count_scheduled_sessions_in_month(enrollment, billing_month, product=product)
            if billing_unit == "monthly" and not enrollment_lesson_weekdays(enrollment):
                sessions = max(sessions, product.sessions_per_week * 4)
        tag = "first_month" if _is_start_billing_month(enrollment, billing_month) else "regular"
        return PaymentAmountQuote(
            billing_unit="monthly",
            base_amount=base,
            total_sessions=sessions,
            final_amount=base,
            payment_tag=tag,
        )

    # 회당(per_session): 해당 월 수업 횟수 × 회당 단가
    unit_price = per_session_unit_price(product)
    sessions = count_scheduled_sessions_in_month(enrollment, billing_month, product=product)
    if _is_start_billing_month(enrollment, billing_month) and enrollment.first_month_sessions:
        sessions = int(enrollment.first_month_sessions)
    base = unit_price * sessions
    tag = "first_month" if _is_start_billing_month(enrollment, billing_month) else "regular"
    return PaymentAmountQuote(
        billing_unit="per_session",
        base_amount=base,
        total_sessions=sessions,
        final_amount=base,
        payment_tag=tag,
    )


def should_auto_apply_pricing(row: MonthlyPaymentRecord) -> bool:
    """특별결제(special) 등 수동 조정 행은 금액 자동 덮어쓰기 안 함."""
    tag = str(row.payment_tag or "").strip().lower()
    return tag != "special"


def apply_pricing_to_payment_row(
    db: Session,
    row: MonthlyPaymentRecord,
    enrollment: LessonEnrollment,
    product: Optional[Product],
) -> bool:
    if not should_auto_apply_pricing(row):
        return False

    quote = quote_payment_for_month(db, enrollment, product, row.billing_month)
    if not quote:
        return False

    before = (
        row.billing_unit,
        row.base_amount,
        row.total_sessions,
        row.final_amount,
        row.payment_tag,
    )

    row.billing_unit = quote.billing_unit
    row.total_sessions = int(quote.total_sessions or 0)
    if quote.billing_unit == "per_session":
        # 회당 수업은 "총 횟수"와 "완료 횟수"를 분리해 관리하고, 지급은 완료 횟수 기준으로 계산합니다.
        unit_price = int(round(quote.base_amount / row.total_sessions)) if row.total_sessions > 0 else 0
        completed = int(row.completed_sessions or 0)
        if completed <= 0 and row.total_sessions > 0:
            completed = row.total_sessions
        completed = max(0, min(completed, row.total_sessions)) if row.total_sessions > 0 else 0
        row.completed_sessions = completed
        row.base_amount = unit_price * row.total_sessions
        priced_amount = unit_price * completed
    else:
        row.base_amount = quote.base_amount
        priced_amount = quote.base_amount
    special = int(row.special_amount or 0)
    refund = int(row.refund_amount or 0)
    row.final_amount = max(0, priced_amount + special - refund)
    if row.final_amount <= 0 and quote.payment_tag != "first_month":
        row.payment_tag = "unpaid"
    else:
        row.payment_tag = quote.payment_tag

    after = (
        row.billing_unit,
        row.base_amount,
        row.total_sessions,
        row.final_amount,
        row.payment_tag,
    )
    return before != after
