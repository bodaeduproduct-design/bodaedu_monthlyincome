"""기본 price_17, price_35는 원준우·원찬우·최다은·최하은·김선우만."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app.database import SessionLocal
from app.models import LessonEnrollment, MonthlyPaymentRecord, Product, StudentProfile, User
from app.payment_pricing import (
    is_price_35_student_name,
    monthly_list_price,
    quote_payment_for_month,
    resolve_price_type,
)
from app.payment_record_sync import sync_payment_records_for_enrollment
from app.settlement_sync import sync_settlements_from_payments

def _is_price_35_student(name: str) -> bool:
    return is_price_35_student_name(name)


def main() -> None:
    db = SessionLocal()
    try:
        rows = (
            db.query(LessonEnrollment, User.name, Product)
            .join(StudentProfile, StudentProfile.id == LessonEnrollment.student_id)
            .join(User, User.id == StudentProfile.user_id)
            .outerjoin(Product, Product.id == LessonEnrollment.product_id)
            .all()
        )

        touched_teachers: set[tuple[int, str]] = set()
        for enrollment, student_name, product in rows:
            if _is_price_35_student(student_name):
                enrollment.price_type = "price_35"
            else:
                current = str(enrollment.price_type or "").strip()
                if current == "per_session" or current == "session":
                    enrollment.price_type = "per_session"
                else:
                    enrollment.price_type = "price_17"

            if not enrollment.start_date or not product:
                continue

            sync_payment_records_for_enrollment(db, enrollment, as_of=date(2026, 8, 31), product=product)

            pt = resolve_price_type(enrollment, product)
            for pay in (
                db.query(MonthlyPaymentRecord)
                .filter(MonthlyPaymentRecord.enrollment_id == enrollment.id)
                .all()
            ):
                if pay.billing_month and str(pay.billing_month) < str(enrollment.start_date)[:7]:
                    continue
                if str(pay.payment_tag or "").strip().lower() == "special":
                    continue
                quote = quote_payment_for_month(db, enrollment, product, pay.billing_month)
                if not quote or quote.billing_unit != "monthly":
                    continue
                expected = quote.base_amount
                if pay.billing_month == str(enrollment.start_date)[:7] and enrollment.first_month_amount:
                    expected = int(enrollment.first_month_amount)
                elif pay.payment_tag == "first_month":
                    continue
                if int(pay.final_amount or 0) != expected:
                    pay.base_amount = expected
                    pay.final_amount = expected
                    if pay.memo and "[sheet]" in pay.memo:
                        pay.memo = f"price_type={pt} 반영"

                touched_teachers.add((int(pay.teacher_id), str(pay.billing_month)))

        for teacher_id, month in sorted(touched_teachers):
            if month != "2025-04":
                sync_settlements_from_payments(db, billing_month=month, teacher_id=teacher_id)

        db.commit()

        print("=== price_35 학생 ===")
        for enrollment, student_name, product in rows:
            if not _is_price_35_student(student_name):
                continue
            pt = resolve_price_type(enrollment, product)
            price = monthly_list_price(product, pt) if product else 0
            print(f"  {student_name} enr#{enrollment.id} {pt} {price:,}")

        print("=== 샘플 (민지우) ===")
        for enrollment, student_name, product in rows:
            if student_name != "민지우" or enrollment.id != 21:
                continue
            print(
                f"  {student_name} enr#{enrollment.id} "
                f"price_type={enrollment.price_type} → {resolve_price_type(enrollment, product)} "
                f"{monthly_list_price(product, resolve_price_type(enrollment, product)):,}"
            )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
