from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
import re
from typing import Any, Iterable

from openpyxl import load_workbook
from sqlalchemy.orm import Session

from .models import (
    DataSync,
    MonthlySettlement,
    ProductPrice,
    RateTableRow,
    SessionCollection,
    SessionSettlement,
    StudentRecord,
    TeacherProfile,
    TeacherSettlement,
    TuitionRecord,
)

MONTH_TITLE_PATTERN = re.compile(r"(\d{4})년\s*(\d{1,2})월")

PRODUCT_PRICE_TABLES: tuple[tuple[str, tuple[tuple[str, int], ...]], ...] = (
    (
        "35% 할인",
        (
            ("고등 주1회 60분", 150000),
            ("고등 주1회 90분", 200000),
            ("고등 주1회 120분", 240000),
            ("고등 주2회 60분", 250000),
            ("고등 주2회 90분", 350000),
            ("고등 주2회 120분", 430000),
            ("고등 주3회 60분", 350000),
            ("고등 주3회 90분", 500000),
            ("고등 주3회 120분", 630000),
            ("중등 주1회 60분", 140000),
            ("중등 주1회 90분", 180000),
            ("중등 주1회 120분", 230000),
            ("중등 주2회 60분", 240000),
            ("중등 주2회 90분", 320000),
            ("중등 주2회 120분", 410000),
            ("중등 주3회 60분", 330000),
            ("중등 주3회 90분", 440000),
            ("중등 주3회 120분", 580000),
            ("초등 주1회 60분", 200000),
            ("초등 주2회 60분", 330000),
            ("초등 주3회 60분", 450000),
            ("고등 주2회 개별진도", 440000),
            ("고등 주3회 개별진도", 580000),
            ("고등 주4회 개별진도", 700000),
            ("중등 주2회 개별진도", 400000),
            ("중등 주3회 개별진도", 550000),
            ("중등 주4회 개별진도", 680000),
        ),
    ),
    (
        "17% 할인",
        (
            ("고등 주1회 60분", 210000),
            ("고등 주1회 90분", 250000),
            ("고등 주1회 120분", 300000),
            ("고등 주2회 60분", 400000),
            ("고등 주2회 90분", 440000),
            ("고등 주2회 120분", 540000),
            ("고등 주3회 60분", 550000),
            ("고등 주3회 90분", 630000),
            ("고등 주3회 120분", 790000),
            ("중등 주1회 60분", 190000),
            ("중등 주1회 90분", 230000),
            ("중등 주1회 120분", 290000),
            ("중등 주2회 60분", 320000),
            ("중등 주2회 90분", 400000),
            ("중등 주2회 120분", 520000),
            ("중등 주3회 60분", 440000),
            ("중등 주3회 90분", 550000),
            ("중등 주3회 120분", 730000),
            ("초등 주1회 60분", 170000),
            ("초등 주2회 60분", 280000),
            ("초등 주3회 60분", 380000),
            ("고등 주2회 개별진도", 440000),
            ("고등 주3회 개별진도", 580000),
            ("고등 주4회 개별진도", 700000),
            ("중등 주2회 개별진도", 400000),
            ("중등 주3회 개별진도", 550000),
            ("중등 주4회 개별진도", 680000),
        ),
    ),
    (
        "회당 단가표",
        (
            ("고등 주1회 60분", 55000),
            ("고등 주1회 90분", 65000),
            ("고등 주1회 120분", 75000),
            ("고등 주2회 60분", 50000),
            ("고등 주2회 90분", 55000),
            ("고등 주2회 120분", 70000),
            ("고등 주3회 60분", 50000),
            ("고등 주3회 90분", 55000),
            ("고등 주3회 120분", 70000),
            ("중등 주1회 60분", 48000),
            ("중등 주1회 90분", 58000),
            ("중등 주1회 120분", 70000),
            ("중등 주2회 60분", 40000),
            ("중등 주2회 90분", 50000),
            ("중등 주2회 120분", 65000),
            ("중등 주3회 60분", 37000),
            ("중등 주3회 90분", 46000),
            ("중등 주3회 120분", 61000),
            ("초등 주1회 60분", 42000),
            ("초등 주2회 60분", 35000),
            ("초등 주3회 60분", 32000),
        ),
    ),
)


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _float(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = str(value).replace(",", "").replace("%", "").strip()
    if not cleaned:
        return 0.0
    return float(cleaned)


def _int(value: Any) -> int:
    return int(round(_float(value)))


def _date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _text(value)
    for fmt in ("%Y.%m.%d", "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d."):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _month_from_value(value: Any) -> str:
    if isinstance(value, (date, datetime)):
        dt = value.date() if isinstance(value, datetime) else value
        return f"{dt.year:04d}-{dt.month:02d}"
    text = _text(value)
    match = MONTH_TITLE_PATTERN.search(text)
    if match:
        return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}"
    return ""


def _clear_existing_data(db: Session) -> None:
    for model in (
        DataSync,
        TeacherSettlement,
        MonthlySettlement,
        TuitionRecord,
        TeacherProfile,
        SessionSettlement,
        SessionCollection,
        ProductPrice,
        RateTableRow,
    ):
        db.query(model).delete()
    db.commit()


def _upsert_student_records(db: Session, student_names: set[str]) -> None:
    existing = {
        row.student_name: row for row in db.query(StudentRecord).filter(StudentRecord.student_name.in_(student_names)).all()
    }
    now = datetime.utcnow()
    for student_name in sorted(student_names):
        if student_name in existing:
            existing[student_name].updated_at = now
            continue
        db.add(
            StudentRecord(
                student_name=student_name,
                parent_name=None,
                contact=None,
                status="수업중",
                notes=None,
                created_at=now,
                updated_at=now,
            )
        )


def _teacher_settlement_rows(worksheet) -> list[TeacherSettlement]:
    records: list[TeacherSettlement] = []
    current_month = ""

    for row in worksheet.iter_rows(values_only=True):
        marker = row[1] if len(row) > 1 else None
        marker_text = _text(marker)

        if "선생님 정산표" in marker_text:
            current_month = _month_from_value(marker_text)
            continue

        if not current_month or not marker_text:
            continue

        if marker_text in {"월별 정산", "회당 정산", "최종 합계", "선생님"}:
            continue

        if not isinstance(marker, str):
            continue

        records.append(
            TeacherSettlement(
                month=current_month,
                teacher_name=marker_text,
                student_count=_int(row[2] if len(row) > 2 else None),
                monthly_total_tuition=_float(row[3] if len(row) > 3 else None),
                monthly_trial_amount=_float(row[4] if len(row) > 4 else None),
                monthly_pretax_amount=_float(row[5] if len(row) > 5 else None),
                session_total_tuition=_float(row[6] if len(row) > 6 else None),
                session_trial_amount=_float(row[7] if len(row) > 7 else None),
                session_pretax_amount=_float(row[8] if len(row) > 8 else None),
                final_pretax_amount=_float(row[9] if len(row) > 9 else None),
                final_aftertax_amount=_float(row[10] if len(row) > 10 else None),
                settlement_date=_date(row[11] if len(row) > 11 else None),
            )
        )

    return records


def _monthly_settlement_rows(worksheet) -> list[MonthlySettlement]:
    records: list[MonthlySettlement] = []
    current_month = ""
    in_section = False

    for row in worksheet.iter_rows(values_only=True):
        marker = row[1] if len(row) > 1 else None
        marker_text = _text(marker)

        if isinstance(marker, (date, datetime)):
            current_month = _month_from_value(marker)
            in_section = False
            continue

        if marker_text == "선생님":
            in_section = True
            continue

        if not in_section or not current_month or not marker_text:
            continue

        if not isinstance(marker, str):
            continue

        records.append(
            MonthlySettlement(
                month=current_month,
                teacher_name=marker_text,
                student_count=_int(row[2] if len(row) > 2 else None),
                fee_rate=_float(row[3] if len(row) > 3 else None),
                first_payment=_float(row[4] if len(row) > 4 else None),
                recurring_payment=_float(row[5] if len(row) > 5 else None),
                special_payment=_float(row[6] if len(row) > 6 else None),
                refund_amount=_float(row[7] if len(row) > 7 else None),
                long_term_payment=_float(row[8] if len(row) > 8 else None),
                long_term_refund=_float(row[9] if len(row) > 9 else None),
                total_tuition=_float(row[10] if len(row) > 10 else None),
                trial_lesson_amount=_float(row[11] if len(row) > 11 else None),
                pretax_amount=_float(row[12] if len(row) > 12 else None),
            )
        )

    return records


def _tuition_records(worksheet) -> list[TuitionRecord]:
    records: list[TuitionRecord] = []

    for row in worksheet.iter_rows(min_row=5, values_only=True):
        teacher_name = _text(row[2] if len(row) > 2 else None)
        if not teacher_name or teacher_name == "홍길동":
            continue

        sequence_value = row[0] if len(row) > 0 else None
        if sequence_value == "ex)":
            continue

        records.append(
            TuitionRecord(
                sequence_no=_int(sequence_value) if sequence_value not in (None, "") else None,
                payment_method=_text(row[1] if len(row) > 1 else None) or None,
                teacher_name=teacher_name,
                phone=_text(row[3] if len(row) > 3 else None) or None,
                email=_text(row[4] if len(row) > 4 else None) or None,
                birth_date_text=_text(row[5] if len(row) > 5 else None) or None,
                gender=_text(row[6] if len(row) > 6 else None) or None,
                education=_text(row[7] if len(row) > 7 else None) or None,
                major=_text(row[8] if len(row) > 8 else None) or None,
                teaching_experience=_text(row[9] if len(row) > 9 else None) or None,
                subject=_text(row[10] if len(row) > 10 else None) or None,
                available_grades=_text(row[11] if len(row) > 11 else None) or None,
            )
        )

    return records


def _teacher_profiles(records: Iterable[TuitionRecord], known_teacher_names: set[str]) -> list[TeacherProfile]:
    by_teacher: dict[str, dict[str, str | None]] = defaultdict(dict)

    for record in records:
        entry = by_teacher[record.teacher_name]
        for field in (
            "payment_method",
            "phone",
            "email",
            "birth_date_text",
            "gender",
            "education",
            "major",
            "teaching_experience",
            "subject",
            "available_grades",
        ):
            current_value = getattr(record, field)
            if current_value and not entry.get(field):
                entry[field] = current_value

    profiles = []
    for teacher_name in sorted(known_teacher_names):
        entry = by_teacher.get(teacher_name, {})
        profiles.append(
            TeacherProfile(
                teacher_name=teacher_name,
                payment_method=entry.get("payment_method"),
                phone=entry.get("phone"),
                email=entry.get("email"),
                birth_date_text=entry.get("birth_date_text"),
                gender=entry.get("gender"),
                education=entry.get("education"),
                major=entry.get("major"),
                teaching_experience=entry.get("teaching_experience"),
                subject=entry.get("subject"),
                available_grades=entry.get("available_grades"),
            )
        )
    return profiles


def _session_settlements(worksheet) -> list[SessionSettlement]:
    records: list[SessionSettlement] = []
    current_month = ""
    in_section = False

    for row in worksheet.iter_rows(values_only=True):
        marker = row[1] if len(row) > 1 else None
        marker_text = _text(marker)

        if isinstance(marker, (date, datetime)):
            current_month = _month_from_value(marker)
            in_section = False
            continue

        if marker_text == "선생님":
            in_section = True
            continue

        if not in_section or not current_month or not marker_text:
            continue

        if not isinstance(marker, str):
            continue

        records.append(
            SessionSettlement(
                month=current_month,
                teacher_name=marker_text,
                student_count=_int(row[2] if len(row) > 2 else None),
                first_payment_count=_int(row[3] if len(row) > 3 else None),
                first_payment_fee=_float(row[4] if len(row) > 4 else None),
                recurring_payment_count=_int(row[5] if len(row) > 5 else None),
                recurring_payment_fee=_float(row[6] if len(row) > 6 else None),
                refund_payment_count=_int(row[7] if len(row) > 7 else None),
                refund_payment_fee=_float(row[8] if len(row) > 8 else None),
                first_payment_commission=_float(row[9] if len(row) > 9 else None),
                recurring_payment_commission=_float(row[10] if len(row) > 10 else None),
                refund_payment_commission=_float(row[11] if len(row) > 11 else None),
            )
        )

    return records


def _session_collections(worksheet) -> list[SessionCollection]:
    records: list[SessionCollection] = []
    current_month = _month_from_value(worksheet["K2"].value)

    for row in worksheet.iter_rows(min_row=4, values_only=True):
        teacher_name = _text(row[2] if len(row) > 2 else None)
        if not teacher_name:
            continue

        records.append(
            SessionCollection(
                month=current_month,
                row_number=_int(row[0] if len(row) > 0 else None) if row[0] not in (None, "") else None,
                payment_method=_text(row[1] if len(row) > 1 else None) or None,
                teacher_name=teacher_name,
                student_name=_text(row[3] if len(row) > 3 else None) or None,
                commission_rate=_float(row[4] if len(row) > 4 else None),
                course=_text(row[5] if len(row) > 5 else None) or None,
                weekly_frequency=_text(row[6] if len(row) > 6 else None) or None,
                weekdays=_text(row[7] if len(row) > 7 else None) or None,
                time_text=_text(row[8] if len(row) > 8 else None) or None,
                product_name=_text(row[9] if len(row) > 9 else None) or None,
                current_month_sessions=_int(row[10] if len(row) > 10 else None),
                current_month_amount=_float(row[11] if len(row) > 11 else None),
                trial_lesson_date=_date(row[12] if len(row) > 12 else None),
                lesson_start_date=_date(row[13] if len(row) > 13 else None),
                lesson_end_date=_date(row[14] if len(row) > 14 else None),
            )
        )

    return records


def _product_prices() -> list[ProductPrice]:
    records: list[ProductPrice] = []
    for table_name, rows in PRODUCT_PRICE_TABLES:
        for product_name, amount in rows:
            records.append(
                ProductPrice(
                    table_name=table_name,
                    product_name=product_name,
                    amount=float(amount),
                )
            )
    return records


def _rate_table_rows(worksheet) -> list[RateTableRow]:
    records: list[RateTableRow] = []
    current_section = ""
    row_order = 0

    for row in worksheet.iter_rows(values_only=True):
        values = list(row[:7])
        if not any(value not in (None, "") for value in values):
            continue

        if values[0] is None and isinstance(values[1], str) and not any(values[2:]):
            current_section = _text(values[1])
            continue

        row_type = "header" if values[0] is None else "data"
        records.append(
            RateTableRow(
                section_name=current_section,
                row_type=row_type,
                row_label=_text(values[0]),
                value_1=_text(values[1]) or None,
                value_2=_text(values[2]) or None,
                value_3=_text(values[3]) or None,
                value_4=_text(values[4]) or None,
                value_5=_text(values[5]) or None,
                value_6=_text(values[6]) or None,
                row_order=row_order,
            )
        )
        row_order += 1

    return records


def sync_workbook(
    db: Session,
    *,
    workbook_bytes: bytes | None = None,
    workbook_path: str | Path | None = None,
    source_name: str,
) -> None:
    if workbook_bytes is None and workbook_path is None:
        raise ValueError("workbook_bytes 또는 workbook_path 중 하나는 필요합니다.")

    if workbook_bytes is not None:
        workbook = load_workbook(filename=BytesIO(workbook_bytes), data_only=True)
    else:
        workbook = load_workbook(filename=str(workbook_path), data_only=True)

    teacher_settlements = _teacher_settlement_rows(workbook["선생님 정산"])
    monthly_settlements = _monthly_settlement_rows(workbook["월별 정산"])
    tuition_records = _tuition_records(workbook["수업료 관리"])
    session_settlements = _session_settlements(workbook["회당 정산"])
    session_collections = _session_collections(workbook["회당 수금표"])
    product_prices = _product_prices()
    rate_table_rows = _rate_table_rows(workbook["단가표"])

    teacher_names = {
        record.teacher_name
        for record in teacher_settlements + monthly_settlements + session_settlements + session_collections
    }
    teacher_names.update(record.teacher_name for record in tuition_records)
    student_names = {record.student_name for record in session_collections if record.student_name}
    teacher_profiles = _teacher_profiles(tuition_records, teacher_names)

    months = sorted({record.month for record in teacher_settlements if record.month})

    _clear_existing_data(db)
    db.add_all(teacher_settlements)
    db.add_all(monthly_settlements)
    db.add_all(tuition_records)
    db.add_all(teacher_profiles)
    db.add_all(session_settlements)
    db.add_all(session_collections)
    db.add_all(product_prices)
    db.add_all(rate_table_rows)
    _upsert_student_records(db, student_names)
    db.add(
        DataSync(
            source_name=source_name,
            imported_at=datetime.utcnow(),
            notes=", ".join(months),
        )
    )
    db.commit()
