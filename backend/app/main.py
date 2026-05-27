from __future__ import annotations

from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db
from .models import (
    DataSync,
    MonthlySettlement,
    ProductPrice,
    RateTableRow,
    SessionCollection,
    SessionSettlement,
    StudentEvent,
    StudentRecord,
    TeacherProfile,
    TeacherSettlement,
    TuitionRecord,
)
from .schemas import (
    ImportResponse,
    StudentEventCreate,
    StudentEventUpdate,
    StudentRecordCreate,
    StudentRecordUpdate,
)
from .workbook_import import PRODUCT_PRICE_TABLES, sync_workbook

SAMPLE_WORKBOOK_PATH = Path(__file__).resolve().parents[2] / "sheet.xlsx"


def _serialize_date(value):
    return value.isoformat() if value else None


def _parse_month(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    try:
        year_text, month_text = value.split("-")
        return int(year_text), int(month_text)
    except ValueError:
        return None


def _format_month(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _add_months(value: str | None, months: int) -> str | None:
    parsed = _parse_month(value)
    if not parsed:
        return None
    year, month = parsed
    total = (year * 12 + (month - 1)) + months
    target_year = total // 12
    target_month = total % 12 + 1
    return _format_month(target_year, target_month)


def _month_from_date(value: date | None) -> str | None:
    if not value:
        return None
    return _format_month(value.year, value.month)


def _teacher_service_month(row: TeacherSettlement) -> str | None:
    return row.month


def _teacher_settlement_month(row: TeacherSettlement) -> str | None:
    return _month_from_date(row.settlement_date) or _add_months(row.month, 1)


def _monthly_service_month(row: MonthlySettlement) -> str | None:
    return row.month


def _monthly_settlement_month(row: MonthlySettlement) -> str | None:
    return _add_months(row.month, 1)


def _session_service_month(row: SessionSettlement) -> str | None:
    return row.month


def _session_settlement_month(row: SessionSettlement) -> str | None:
    return row.month


def _collection_service_month(row: SessionCollection) -> str | None:
    return row.month


def _collection_settlement_month(row: SessionCollection) -> str | None:
    return row.month


def _ensure_schema() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        existing_columns = {
            row[1] for row in connection.exec_driver_sql("PRAGMA table_info(session_collections)").fetchall()
        }
        if "trial_lesson_date" not in existing_columns:
            connection.execute(text("ALTER TABLE session_collections ADD COLUMN trial_lesson_date DATE"))
        if "lesson_start_date" not in existing_columns:
            connection.execute(text("ALTER TABLE session_collections ADD COLUMN lesson_start_date DATE"))
        if "lesson_end_date" not in existing_columns:
            connection.execute(text("ALTER TABLE session_collections ADD COLUMN lesson_end_date DATE"))


def _seed_from_sample_workbook() -> None:
    if not SAMPLE_WORKBOOK_PATH.exists():
        return

    db = SessionLocal()
    try:
        has_data = db.query(DataSync).count() > 0
        needs_resync = db.query(SessionCollection).count() > 0 and db.query(SessionCollection).filter(
            SessionCollection.trial_lesson_date.isnot(None)
        ).count() == 0
        expected_product_prices = {
            (table_name, product_name, float(amount))
            for table_name, rows in PRODUCT_PRICE_TABLES
            for product_name, amount in rows
        }
        current_product_prices = {
            (row.table_name, row.product_name, float(row.amount)) for row in db.query(ProductPrice).all()
        }
        product_prices_changed = current_product_prices != expected_product_prices
        if not has_data or needs_resync or product_prices_changed:
            sync_workbook(db, workbook_path=SAMPLE_WORKBOOK_PATH, source_name=SAMPLE_WORKBOOK_PATH.name)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    _ensure_schema()
    _seed_from_sample_workbook()
    yield


app = FastAPI(title="정산 관리 API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _build_app_data(db: Session) -> dict:
    _ensure_student_records_from_imported_rows(db)
    data_sync = db.query(DataSync).order_by(DataSync.imported_at.desc()).first()
    teacher_settlements = db.query(TeacherSettlement).all()
    monthly_settlements = db.query(MonthlySettlement).all()
    tuition_records = db.query(TuitionRecord).order_by(TuitionRecord.teacher_name.asc(), TuitionRecord.id.asc()).all()
    teacher_profiles = db.query(TeacherProfile).order_by(TeacherProfile.teacher_name.asc()).all()
    session_settlements = db.query(SessionSettlement).all()
    session_collections = db.query(SessionCollection).all()
    student_records = db.query(StudentRecord).order_by(StudentRecord.student_name.asc()).all()
    student_events = db.query(StudentEvent).order_by(StudentEvent.event_date.asc(), StudentEvent.id.asc()).all()
    product_prices = db.query(ProductPrice).order_by(ProductPrice.id.asc()).all()
    rate_table_rows = db.query(RateTableRow).order_by(RateTableRow.row_order.asc()).all()

    teacher_settlement_items = sorted(
        [
            {
                "id": row.id,
                "service_month": _teacher_service_month(row),
                "settlement_month": _teacher_settlement_month(row),
                "teacher_name": row.teacher_name,
                "student_count": row.student_count,
                "monthly_total_tuition": row.monthly_total_tuition,
                "monthly_trial_amount": row.monthly_trial_amount,
                "monthly_pretax_amount": row.monthly_pretax_amount,
                "session_total_tuition": row.session_total_tuition,
                "session_trial_amount": row.session_trial_amount,
                "session_pretax_amount": row.session_pretax_amount,
                "final_pretax_amount": row.final_pretax_amount,
                "final_aftertax_amount": row.final_aftertax_amount,
                "settlement_date": _serialize_date(row.settlement_date),
            }
            for row in teacher_settlements
        ],
        key=lambda item: (
            item["settlement_month"] or "",
            item["final_aftertax_amount"],
            item["teacher_name"],
        ),
        reverse=True,
    )

    monthly_settlement_items = sorted(
        [
            {
                "id": row.id,
                "service_month": _monthly_service_month(row),
                "settlement_month": _monthly_settlement_month(row),
                "teacher_name": row.teacher_name,
                "student_count": row.student_count,
                "fee_rate": row.fee_rate,
                "first_payment": row.first_payment,
                "recurring_payment": row.recurring_payment,
                "special_payment": row.special_payment,
                "refund_amount": row.refund_amount,
                "long_term_payment": row.long_term_payment,
                "long_term_refund": row.long_term_refund,
                "total_tuition": row.total_tuition,
                "trial_lesson_amount": row.trial_lesson_amount,
                "pretax_amount": row.pretax_amount,
            }
            for row in monthly_settlements
        ],
        key=lambda item: (
            item["settlement_month"] or "",
            item["pretax_amount"],
            item["teacher_name"],
        ),
        reverse=True,
    )

    session_settlement_items = sorted(
        [
            {
                "id": row.id,
                "service_month": _session_service_month(row),
                "settlement_month": _session_settlement_month(row),
                "teacher_name": row.teacher_name,
                "student_count": row.student_count,
                "first_payment_count": row.first_payment_count,
                "first_payment_fee": row.first_payment_fee,
                "recurring_payment_count": row.recurring_payment_count,
                "recurring_payment_fee": row.recurring_payment_fee,
                "refund_payment_count": row.refund_payment_count,
                "refund_payment_fee": row.refund_payment_fee,
                "first_payment_commission": row.first_payment_commission,
                "recurring_payment_commission": row.recurring_payment_commission,
                "refund_payment_commission": row.refund_payment_commission,
            }
            for row in session_settlements
        ],
        key=lambda item: (
            item["settlement_month"] or "",
            item["recurring_payment_fee"],
            item["teacher_name"],
        ),
        reverse=True,
    )

    session_collection_items = sorted(
        [
            {
                "id": row.id,
                "service_month": _collection_service_month(row),
                "settlement_month": _collection_settlement_month(row),
                "row_number": row.row_number,
                "payment_method": row.payment_method,
                "teacher_name": row.teacher_name,
                "student_name": row.student_name,
                "commission_rate": row.commission_rate,
                "course": row.course,
                "weekly_frequency": row.weekly_frequency,
                "weekdays": row.weekdays,
                "time_text": row.time_text,
                "product_name": row.product_name,
                "current_month_sessions": row.current_month_sessions,
                "current_month_amount": row.current_month_amount,
                "trial_lesson_date": _serialize_date(row.trial_lesson_date),
                "lesson_start_date": _serialize_date(row.lesson_start_date),
                "lesson_end_date": _serialize_date(row.lesson_end_date),
            }
            for row in session_collections
        ],
        key=lambda item: (
            item["settlement_month"] or "",
            item["current_month_amount"],
            item["teacher_name"],
        ),
        reverse=True,
    )

    available_months = sorted(
        {
            *[row["settlement_month"] for row in teacher_settlement_items if row["settlement_month"]],
            *[row["settlement_month"] for row in monthly_settlement_items if row["settlement_month"]],
            *[row["settlement_month"] for row in session_settlement_items if row["settlement_month"]],
            *[row["settlement_month"] for row in session_collection_items if row["settlement_month"]],
        },
        reverse=True,
    )

    latest_teacher_month = teacher_settlement_items[0]["settlement_month"] if teacher_settlement_items else None
    latest_monthly_month = monthly_settlement_items[0]["settlement_month"] if monthly_settlement_items else None
    latest_session_month = session_settlement_items[0]["settlement_month"] if session_settlement_items else None
    latest_collection_month = session_collection_items[0]["settlement_month"] if session_collection_items else None
    latest_month = (latest_teacher_month or available_months[0]) if available_months else None

    latest_teacher_settlements = [
        row for row in teacher_settlement_items if row["settlement_month"] == latest_teacher_month
    ]
    latest_monthly_settlements = [
        row for row in monthly_settlement_items if row["settlement_month"] == latest_monthly_month
    ]
    latest_session_collections = [
        row for row in session_collection_items if row["settlement_month"] == latest_collection_month
    ]

    payment_method_summary: dict[str, int] = defaultdict(int)
    for record in tuition_records:
        payment_method_summary[record.payment_method or "미입력"] += 1

    top_products: dict[str, dict] = defaultdict(lambda: {"total_amount": 0.0, "teacher_names": set()})
    for row in latest_session_collections:
        product_name = row["product_name"] or "미지정"
        top_products[product_name]["total_amount"] += row["current_month_amount"]
        top_products[product_name]["teacher_names"].add(row["teacher_name"])

    monthly_trend: dict[str, dict] = defaultdict(
        lambda: {"final_pretax_amount": 0.0, "final_aftertax_amount": 0.0, "teacher_count": 0}
    )
    for row in teacher_settlement_items:
        month_key = row["settlement_month"]
        if not month_key:
            continue
        monthly_trend[month_key]["final_pretax_amount"] += row["final_pretax_amount"]
        monthly_trend[month_key]["final_aftertax_amount"] += row["final_aftertax_amount"]
        monthly_trend[month_key]["teacher_count"] += 1

    latest_teacher_map = {row["teacher_name"]: row for row in latest_teacher_settlements}
    latest_collection_by_teacher: dict[str, float] = defaultdict(float)
    for row in latest_session_collections:
        latest_collection_by_teacher[row["teacher_name"]] += row["current_month_amount"]

    manual_events_by_student_id: dict[int, list[StudentEvent]] = defaultdict(list)
    for event in student_events:
        manual_events_by_student_id[event.student_id].append(event)

    imported_rows_by_student: dict[str, list[dict]] = defaultdict(list)
    for row in session_collection_items:
        if row["student_name"]:
            imported_rows_by_student[row["student_name"]].append(row)

    student_summaries = []
    for student in student_records:
        imported_rows = sorted(
            imported_rows_by_student.get(student.student_name, []),
            key=lambda item: (
                item["lesson_start_date"] or "",
                item["trial_lesson_date"] or "",
                item["product_name"] or "",
            ),
        )
        manual_items = manual_events_by_student_id.get(student.id, [])

        trial_dates = [row["trial_lesson_date"] for row in imported_rows if row["trial_lesson_date"]]
        start_dates = [row["lesson_start_date"] for row in imported_rows if row["lesson_start_date"]]
        end_dates = [row["lesson_end_date"] for row in imported_rows if row["lesson_end_date"]]
        teachers = sorted({row["teacher_name"] for row in imported_rows if row["teacher_name"]})
        payment_methods = sorted({row["payment_method"] for row in imported_rows if row["payment_method"]})

        latest_row = imported_rows[-1] if imported_rows else None
        active_rows = [row for row in imported_rows if not row["lesson_end_date"]]
        current_row = active_rows[-1] if active_rows else latest_row

        student_summaries.append(
            {
                "id": student.id,
                "student_name": student.student_name,
                "parent_name": student.parent_name,
                "contact": student.contact,
                "status": student.status or ("수업중" if active_rows else "상태 확인 필요"),
                "notes": student.notes,
                "created_at": _serialize_date(student.created_at),
                "updated_at": _serialize_date(student.updated_at),
                "teacher_names": teachers,
                "payment_methods": payment_methods,
                "first_trial_date": min(trial_dates) if trial_dates else None,
                "first_start_date": min(start_dates) if start_dates else None,
                "latest_end_date": max(end_dates) if end_dates else None,
                "current_teacher_name": current_row["teacher_name"] if current_row else None,
                "current_product_name": current_row["product_name"] if current_row else None,
                "current_payment_method": current_row["payment_method"] if current_row else None,
                "current_schedule": ", ".join(
                    filter(None, [current_row["weekly_frequency"], current_row["weekdays"], current_row["time_text"]])
                )
                if current_row
                else None,
                "imported_row_count": len(imported_rows),
                "manual_event_count": len(manual_items),
                "imported_rows": imported_rows,
                "manual_events": [
                    {
                        "id": event.id,
                        "event_date": _serialize_date(event.event_date),
                        "event_type": event.event_type,
                        "title": event.title,
                        "teacher_name": event.teacher_name,
                        "payment_method": event.payment_method,
                        "weekly_frequency": event.weekly_frequency,
                        "weekdays": event.weekdays,
                        "time_text": event.time_text,
                        "product_name": event.product_name,
                        "amount": event.amount,
                        "memo": event.memo,
                    }
                    for event in manual_items
                ],
            }
        )

    return {
        "meta": {
            "source_name": data_sync.source_name if data_sync else None,
            "last_imported_at": _serialize_date(data_sync.imported_at) if data_sync else None,
            "available_months": available_months,
            "latest_month": latest_month,
            "page_latest_months": {
                "teacher-settlements": latest_teacher_month,
                "monthly-settlements": latest_monthly_month,
                "session-settlements": latest_session_month,
                "session-collections": latest_collection_month,
            },
        },
        "dashboard": {
            "teacher_count": len({profile.teacher_name for profile in teacher_profiles}),
            "tuition_record_count": len(tuition_records),
            "latest_total_pretax_amount": sum(row["final_pretax_amount"] for row in latest_teacher_settlements),
            "latest_total_aftertax_amount": sum(row["final_aftertax_amount"] for row in latest_teacher_settlements),
            "latest_monthly_tuition": sum(row["total_tuition"] for row in latest_monthly_settlements),
            "latest_session_collection_amount": sum(row["current_month_amount"] for row in latest_session_collections),
            "latest_teacher_month": latest_teacher_month,
            "latest_monthly_month": latest_monthly_month,
            "latest_session_month": latest_session_month,
            "latest_collection_month": latest_collection_month,
            "payment_method_summary": [
                {"payment_method": key, "count": count}
                for key, count in sorted(payment_method_summary.items(), key=lambda item: item[1], reverse=True)
            ],
            "monthly_trend": [
                {"month": month, **values}
                for month, values in sorted(monthly_trend.items(), key=lambda item: item[0], reverse=True)
            ],
            "top_teachers": [
                {
                    "teacher_name": row["teacher_name"],
                    "student_count": row["student_count"],
                    "final_aftertax_amount": row["final_aftertax_amount"],
                }
                for row in latest_teacher_settlements[:8]
            ],
            "top_products": [
                {
                    "product_name": product_name,
                    "total_amount": values["total_amount"],
                    "teacher_count": len(values["teacher_names"]),
                }
                for product_name, values in sorted(
                    top_products.items(),
                    key=lambda item: item[1]["total_amount"],
                    reverse=True,
                )[:8]
            ],
        },
        "teacher_settlements": teacher_settlement_items,
        "monthly_settlements": monthly_settlement_items,
        "tuition_records": [
            {
                "id": row.id,
                "sequence_no": row.sequence_no,
                "payment_method": row.payment_method,
                "teacher_name": row.teacher_name,
                "phone": row.phone,
                "email": row.email,
                "birth_date_text": row.birth_date_text,
                "gender": row.gender,
                "education": row.education,
                "major": row.major,
                "teaching_experience": row.teaching_experience,
                "subject": row.subject,
                "available_grades": row.available_grades,
            }
            for row in tuition_records
        ],
        "teacher_profiles": [
            {
                "id": row.id,
                "teacher_name": row.teacher_name,
                "payment_method": row.payment_method,
                "phone": row.phone,
                "email": row.email,
                "birth_date_text": row.birth_date_text,
                "gender": row.gender,
                "education": row.education,
                "major": row.major,
                "teaching_experience": row.teaching_experience,
                "subject": row.subject,
                "available_grades": row.available_grades,
                "latest_student_count": latest_teacher_map.get(row.teacher_name)["student_count"]
                if latest_teacher_map.get(row.teacher_name)
                else 0,
                "latest_aftertax_amount": latest_teacher_map.get(row.teacher_name)["final_aftertax_amount"]
                if latest_teacher_map.get(row.teacher_name)
                else 0.0,
                "latest_session_collection_amount": latest_collection_by_teacher.get(row.teacher_name, 0.0),
            }
            for row in teacher_profiles
        ],
        "students": student_summaries,
        "session_settlements": session_settlement_items,
        "session_collections": session_collection_items,
        "product_prices": [
            {
                "id": row.id,
                "table_name": row.table_name,
                "product_name": row.product_name,
                "amount": row.amount,
            }
            for row in product_prices
        ],
        "rate_table_rows": [
            {
                "id": row.id,
                "section_name": row.section_name,
                "row_type": row.row_type,
                "row_label": row.row_label,
                "values": [row.value_1, row.value_2, row.value_3, row.value_4, row.value_5, row.value_6],
            }
            for row in rate_table_rows
        ],
    }


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _ensure_student_records_from_imported_rows(db: Session) -> None:
    existing_names = {row.student_name for row in db.query(StudentRecord).all()}
    imported_names = {
        row.student_name for row in db.query(SessionCollection).all() if row.student_name and row.student_name.strip()
    }
    missing_names = sorted(imported_names - existing_names)
    if not missing_names:
        return

    now = datetime.utcnow()
    for student_name in missing_names:
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
    db.commit()


@app.get("/api/health")
def health_check(db: Session = Depends(get_db)):
    return {
        "status": "ok",
        "synced": db.query(DataSync).count() > 0,
    }


@app.get("/api/app-data")
def get_app_data(db: Session = Depends(get_db)):
    return _build_app_data(db)


@app.post("/api/students")
def create_student(payload: StudentRecordCreate, db: Session = Depends(get_db)):
    existing = db.query(StudentRecord).filter(StudentRecord.student_name == payload.student_name.strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="이미 존재하는 학생 이름입니다.")

    now = datetime.utcnow()
    student = StudentRecord(
        student_name=payload.student_name.strip(),
        parent_name=_clean_optional_text(payload.parent_name),
        contact=_clean_optional_text(payload.contact),
        status=_clean_optional_text(payload.status),
        notes=_clean_optional_text(payload.notes),
        created_at=now,
        updated_at=now,
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    return {"id": student.id}


@app.put("/api/students/{student_id}")
def update_student(student_id: int, payload: StudentRecordUpdate, db: Session = Depends(get_db)):
    student = db.get(StudentRecord, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="학생 정보를 찾을 수 없습니다.")

    name = payload.student_name.strip()
    duplicate = (
        db.query(StudentRecord)
        .filter(StudentRecord.student_name == name, StudentRecord.id != student_id)
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=400, detail="이미 존재하는 학생 이름입니다.")

    student.student_name = name
    student.parent_name = _clean_optional_text(payload.parent_name)
    student.contact = _clean_optional_text(payload.contact)
    student.status = _clean_optional_text(payload.status)
    student.notes = _clean_optional_text(payload.notes)
    student.updated_at = datetime.utcnow()
    db.commit()
    return {"id": student.id}


@app.post("/api/students/{student_id}/events")
def create_student_event(student_id: int, payload: StudentEventCreate, db: Session = Depends(get_db)):
    student = db.get(StudentRecord, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="학생 정보를 찾을 수 없습니다.")

    now = datetime.utcnow()
    event = StudentEvent(
        student_id=student_id,
        event_date=payload.event_date,
        event_type=payload.event_type.strip(),
        title=payload.title.strip(),
        teacher_name=_clean_optional_text(payload.teacher_name),
        payment_method=_clean_optional_text(payload.payment_method),
        weekly_frequency=_clean_optional_text(payload.weekly_frequency),
        weekdays=_clean_optional_text(payload.weekdays),
        time_text=_clean_optional_text(payload.time_text),
        product_name=_clean_optional_text(payload.product_name),
        amount=payload.amount,
        memo=_clean_optional_text(payload.memo),
        created_at=now,
        updated_at=now,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return {"id": event.id}


@app.put("/api/student-events/{event_id}")
def update_student_event(event_id: int, payload: StudentEventUpdate, db: Session = Depends(get_db)):
    event = db.get(StudentEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="학생 이벤트를 찾을 수 없습니다.")

    event.event_date = payload.event_date
    event.event_type = payload.event_type.strip()
    event.title = payload.title.strip()
    event.teacher_name = _clean_optional_text(payload.teacher_name)
    event.payment_method = _clean_optional_text(payload.payment_method)
    event.weekly_frequency = _clean_optional_text(payload.weekly_frequency)
    event.weekdays = _clean_optional_text(payload.weekdays)
    event.time_text = _clean_optional_text(payload.time_text)
    event.product_name = _clean_optional_text(payload.product_name)
    event.amount = payload.amount
    event.memo = _clean_optional_text(payload.memo)
    event.updated_at = datetime.utcnow()
    db.commit()
    return {"id": event.id}


@app.delete("/api/student-events/{event_id}")
def delete_student_event(event_id: int, db: Session = Depends(get_db)):
    event = db.get(StudentEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="학생 이벤트를 찾을 수 없습니다.")

    db.delete(event)
    db.commit()
    return {"deleted": True}


@app.post("/api/import/workbook", response_model=ImportResponse)
async def import_workbook(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm", ".xltx", ".xltm")):
        raise HTTPException(status_code=400, detail="엑셀 워크북(.xlsx) 파일만 업로드할 수 있습니다.")

    file_bytes = await file.read()
    sync_workbook(db, workbook_bytes=file_bytes, source_name=file.filename)

    app_data = _build_app_data(db)
    imported_count = (
        len(app_data["teacher_settlements"])
        + len(app_data["monthly_settlements"])
        + len(app_data["tuition_records"])
        + len(app_data["session_settlements"])
        + len(app_data["session_collections"])
        + len(app_data["product_prices"])
        + len(app_data["rate_table_rows"])
    )
    return {
        "imported_count": imported_count,
        "source_name": file.filename,
        "available_months": app_data["meta"]["available_months"],
    }
