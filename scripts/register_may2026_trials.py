"""2026-05 시범수업 3건: 학생·수업 등록."""

from __future__ import annotations

import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app.database import SessionLocal
from app.registration import register_enrollment, register_user

TEACHERS = {"이지혜": 17, "남혜원": 20}

ROWS = [
    {
        "name": "채윤서",
        "parent_phone": "01046551625",
        "grade_level": "고1",
        "teacher": "이지혜",
        "product_id": 1,
        "trial_date": "2026-05-30",
    },
    {
        "name": "김지현",
        "parent_phone": "01035095027",
        "grade_level": "중2",
        "teacher": "이지혜",
        "product_id": 10,
        "trial_date": "2026-05-22",
    },
    {
        "name": "김다인",
        "parent_phone": "01051877701",
        "grade_level": "중3",
        "teacher": "남혜원",
        "product_id": 10,
        "trial_date": "2026-05-01",
    },
]


def _format_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11:
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    return raw


def main() -> None:
    db = SessionLocal()
    try:
        for row in ROWS:
            user_payload = {
                "role": "student",
                "name": row["name"],
                "grade_level": row["grade_level"],
                "region": "랜딩",
                "parent_name": "학부모",
                "parent_phone": _format_phone(row["parent_phone"]),
            }
            u = register_user(db, user_payload)
            enr = register_enrollment(
                db,
                {
                    "student_id": u["student_profile_id"],
                    "teacher_id": TEACHERS[row["teacher"]],
                    "product_id": row["product_id"],
                    "trial_date": row["trial_date"],
                    "trial_month": row["trial_date"][:7],
                    "payment_method": "card",
                },
            )
            print(
                f"OK {row['name']} → {row['teacher']} "
                f"enrollment#{enr['enrollment_id']} trial={enr['trial_date']}"
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
