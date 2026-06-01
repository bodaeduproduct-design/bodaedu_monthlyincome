"""민은후-신소은, 김태희-이우진 2026-05→06 회차 이월 정산 반영."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app.database import SessionLocal
from app.models import LessonEnrollment, MonthlyPaymentRecord, SessionCarryover
from app.session_carryover import ensure_may_june_2026_carryovers, sync_carryover_settlements
from app.settlement_sync import sync_settlements_from_payments

SPECS = [
    {
        "enrollment_id": 83,
        "may_payment_id": 360,
        "teacher_id": 9,
        "may_completed": 9,
        "may_total": 10,
        "unit_price": 55000,
    },
    {
        "enrollment_id": 87,
        "may_payment_id": 368,
        "teacher_id": 21,
        "may_completed": 3,
        "may_total": 4,
        "unit_price": 75000,
    },
]


def main() -> None:
    db = SessionLocal()
    try:
        for spec in SPECS:
            pay = db.get(MonthlyPaymentRecord, spec["may_payment_id"])
            enr = db.get(LessonEnrollment, spec["enrollment_id"])
            if not pay or not enr:
                raise RuntimeError(f"missing payment/enrollment: {spec}")
            pay.completed_sessions = spec["may_completed"]
            pay.total_sessions = spec["may_total"]
            pay.billing_unit = "per_session"
            pay.base_amount = spec["unit_price"] * spec["may_total"]
            pay.final_amount = pay.base_amount
            pay.memo = (
                f"2026-05 미진행 1회({spec['may_total']}→{spec['may_completed']}) "
                "→ 2026-06 보강. 학생 수납은 예정 전액, 선생님 6월 이월 +1 정산."
            )

        for line in ensure_may_june_2026_carryovers(db):
            print(line)

        for spec in SPECS:
            co = (
                db.query(SessionCarryover)
                .filter(
                    SessionCarryover.enrollment_id == spec["enrollment_id"],
                    SessionCarryover.source_billing_month == "2026-05",
                    SessionCarryover.settlement_billing_month == "2026-06",
                )
                .first()
            )
            if co:
                co.teacher_id = spec["teacher_id"]
                co.student_id = db.get(LessonEnrollment, spec["enrollment_id"]).student_id
                co.source_payment_record_id = spec["may_payment_id"]
                co.unit_price = spec["unit_price"]
                co.session_count = 1
                co.status = "scheduled"

        sync_carryover_settlements(db, settlement_billing_month="2026-06")
        for month in ("2026-05", "2026-06"):
            for tid in (9, 21):
                sync_settlements_from_payments(db, billing_month=month, teacher_id=tid)

        db.commit()
        print("OK — 5월 -1 / 6월 +1 이월 정산 반영")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
