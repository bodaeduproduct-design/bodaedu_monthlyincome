"""신태준 선생님 학생·수업 데이터를 등록 시트 기준으로 맞춥니다."""
from __future__ import annotations

import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app.database import SessionLocal
from app.models import LessonEnrollment, MonthlyPaymentRecord, Product, StudentProfile, User
from app.payment_record_sync import sync_payment_records_for_enrollment
from app.settlement_sync import sync_settlements_from_payments

TEACHER_ID = 3

PRODUCT_BY_NAME = {
    "고등 주2회 60분": 4,
    "고등 주2회 90분": 5,
    "고등 주3회 90분": 8,
    "중등 주2회 90분": 14,
}

# (enrollment_id, student_profile_id, user_id, display_name, ...)
FIXES = [
    {
        "enrollment_id": 8,
        "student_profile_id": 27,
        "user_id": 54,
        "name": "원준우",
        "phone": "01065762734",
        "parent_name": "김해원",
        "parent_phone": "01094072734",
        "product": "고등 주2회 60분",
        "day_1": 2,
        "day_2": 6,
        "day_3": None,
        "start_date": "2025-04-09",
        "end_date": None,
        "payment_method": "카드",
    },
    {
        "enrollment_id": 9,
        "student_profile_id": 5,
        "user_id": 32,
        "name": "원찬우",
        "phone": "01029052734",
        "parent_name": "김해원",
        "parent_phone": "01094072734",
        "product": "고등 주2회 60분",
        "day_1": 1,
        "day_2": 4,
        "day_3": None,
        "start_date": "2026-02-23",
        "end_date": None,
        "payment_method": "카드",
    },
    {
        "enrollment_id": 34,
        "name": "최다은",
        "phone": "01037681642",
        "parent_name": "김화숙",
        "parent_phone": "01037081642",
        "product": "고등 주2회 60분",
        "day_1": 3,
        "day_2": 5,
        "start_date": "2025-05-14",
        "end_date": None,
    },
    {
        "enrollment_id": 35,
        "name": "조연우",
        "phone": "01097500699",
        "parent_name": "조재훈",
        "parent_phone": "01041152450",
        "product": "중등 주2회 90분",
        "day_1": 1,
        "day_2": 5,
        "start_date": "2025-05-26",
        "end_date": None,
    },
    {
        "enrollment_id": 36,
        "name": "이예인",
        "phone": "01027635279",
        "parent_name": "주정복",
        "parent_phone": "01028725279",
        "product": "고등 주2회 90분",
        "day_1": 3,
        "day_2": 7,
        "start_date": "2025-06-01",
        "end_date": None,
        "payment_method": "계좌이체",
    },
    {
        "enrollment_id": 21,
        "name": "민지우",
        "phone": "01028105905",
        "parent_name": None,
        "parent_phone": "01055903333",
        "product": "고등 주3회 90분",
        "day_1": 7,
        "day_2": 3,
        "day_3": 1,
        "start_date": "2025-12-15",
        "end_date": None,
    },
    {
        "enrollment_id": 48,
        "name": "장채원",
        "product": "고등 주2회 90분",
        "day_1": 4,
        "day_2": 7,
        "start_date": "2025-08-01",
        "end_date": None,
    },
    {
        "enrollment_id": 75,
        "name": "최하은",
        "product": "고등 주2회 90분",
        "day_1": 4,
        "day_2": 7,
        "start_date": "2025-09-07",
        "end_date": None,
    },
    {
        "enrollment_id": 50,
        "name": "정우림",
        "product": "중등 주2회 90분",
        "day_1": 6,
        "day_2": 1,
        "start_date": "2026-01-19",
        "end_date": None,
    },
]

# 민지우 이전 수업 종료
CLOSE_ENROLLMENTS = [
    (19, "2025-11-10"),
    (20, "2025-12-14"),
]


def _format_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) == 11:
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    return raw


def main() -> None:
    db = SessionLocal()
    try:
        for enr_id, end in CLOSE_ENROLLMENTS:
            row = db.get(LessonEnrollment, enr_id)
            if row and row.teacher_id == TEACHER_ID:
                row.end_date = end

        touched_months: set[str] = set()
        for spec in FIXES:
            enr = db.get(LessonEnrollment, spec["enrollment_id"])
            if not enr or enr.teacher_id != TEACHER_ID:
                print(f"skip missing/wrong teacher: {spec['enrollment_id']}")
                continue

            if "student_profile_id" in spec:
                enr.student_id = spec["student_profile_id"]
            sp = db.get(StudentProfile, enr.student_id)
            if sp:
                if spec.get("phone"):
                    sp.phone = _format_phone(spec["phone"])
                if "parent_name" in spec:
                    sp.parent_name = spec.get("parent_name")
                if spec.get("parent_phone"):
                    sp.parent_phone = _format_phone(spec["parent_phone"])
                user = db.get(User, sp.user_id)
                if user and "name" in spec:
                    user.name = spec["name"]
            if "user_id" in spec:
                user = db.get(User, spec["user_id"])
                if user and "name" in spec:
                    user.name = spec["name"]

            enr.product_id = PRODUCT_BY_NAME[spec["product"]]
            enr.day_1 = spec.get("day_1")
            enr.day_2 = spec.get("day_2")
            enr.day_3 = spec.get("day_3")
            enr.start_date = spec["start_date"]
            enr.end_date = spec.get("end_date")
            if spec.get("payment_method"):
                enr.payment_method = spec["payment_method"]
            enr.base_commission_rate = 60.0
            enr.current_commission_rate = 60.0

            db.query(MonthlyPaymentRecord).filter(MonthlyPaymentRecord.enrollment_id == enr.id).update(
                {
                    MonthlyPaymentRecord.student_id: enr.student_id,
                    MonthlyPaymentRecord.teacher_id: enr.teacher_id,
                },
                synchronize_session=False,
            )

            product = db.get(Product, enr.product_id)
            sync_payment_records_for_enrollment(db, enr, product=product)
            for p in db.query(MonthlyPaymentRecord).filter(MonthlyPaymentRecord.enrollment_id == enr.id):
                touched_months.add(p.billing_month)

        for month in sorted(touched_months):
            if month == "2025-04":
                continue  # 4월 정산 데이터는 재계산하지 않음
            sync_settlements_from_payments(db, billing_month=month, teacher_id=TEACHER_ID)

        db.commit()
        print("OK — 신태준 학생 9건 반영, 정산 재계산:", len(touched_months), "개월")
    finally:
        db.close()


if __name__ == "__main__":
    main()
