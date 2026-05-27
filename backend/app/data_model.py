"""사용자 유형·DB 테이블 구조 문서 및 실시간 연결 현황."""

from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from .models import (
    Enrollment,
    ProductPrice,
    SessionCollection,
    StudentRecord,
    Teacher,
    TeacherSettlement,
    TrialLesson,
    TuitionStudentMonth,
)

USER_TYPES = [
    {
        "id": "student",
        "label": "학생",
        "money_flow": "payer",
        "money_flow_label": "돈을 내는 사람",
        "description": "수업료·회차 수납을 하는 사용자. 월별 수납·회당 수금·시범수업 이력이 이 유형에 속합니다.",
    },
    {
        "id": "teacher",
        "label": "선생님",
        "money_flow": "payee",
        "money_flow_label": "돈을 받는 사람",
        "description": "학생 수납에 대한 정산을 받는 사용자. 선생님 정산·월별/회당 정산 집계가 이 유형에 속합니다.",
    },
]

# link_type: fk = DB 외래키, name = 이름 문자열 조인, catalog = 상품 카탈로그 참조, meta = 시스템
TABLE_CATALOG = [
    {
        "table": "student_records",
        "label": "학생 마스터",
        "layer": "core",
        "user_types": ["student"],
        "role": "학생(납부자) 마스터 — 이름·연락처·상태",
        "link_type": "fk",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": ["enrollments.student_id", "student_events.student_id"],
    },
    {
        "table": "teachers",
        "label": "선생님 마스터",
        "layer": "core",
        "user_types": ["teacher"],
        "role": "선생님(수취인) 마스터 — import 후 enrollment_sync로 생성",
        "link_type": "fk",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": ["enrollments.teacher_id"],
    },
    {
        "table": "product_prices",
        "label": "상품 단가표",
        "layer": "catalog",
        "user_types": ["student", "teacher"],
        "role": "서비스 상품 정의 (35%/17% 할인, 회당 단가표)",
        "link_type": "catalog",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": ["enrollments.product_name (문자열, FK 없음)", "session_collections.product_name"],
    },
    {
        "table": "rate_table_rows",
        "label": "단가표 원본",
        "layer": "catalog",
        "user_types": [],
        "role": "엑셀 단가표 시트 원본 행 (UI 참고용)",
        "link_type": "none",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": [],
    },
    {
        "table": "enrollments",
        "label": "수강(학생↔선생님)",
        "layer": "core",
        "user_types": ["student", "teacher"],
        "role": "학생 1명 + 선생님 1명 매칭, 상품명·요금제·시범/시작/종료",
        "link_type": "fk",
        "primary_keys": ["id"],
        "foreign_keys": ["student_id → student_records", "teacher_id → teachers"],
        "links_to": ["enrollment_schedules", "tuition/session (이름으로만)"],
    },
    {
        "table": "enrollment_schedules",
        "label": "수업 스케줄",
        "layer": "core",
        "user_types": ["student", "teacher"],
        "role": "과정·요일·시간 — 적용 기간(effective_from/to) 단위",
        "link_type": "fk",
        "primary_keys": ["id"],
        "foreign_keys": ["enrollment_id → enrollments"],
        "links_to": [],
    },
    {
        "table": "tuition_student_months",
        "label": "월별 수납",
        "layer": "import",
        "user_types": ["student"],
        "role": "학생 월별 수업료 납부 스냅샷 (수업료 관리 시트)",
        "link_type": "name",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": ["student_name ↔ student_records", "teacher_name ↔ teachers"],
    },
    {
        "table": "session_collections",
        "label": "회당 수금",
        "layer": "import",
        "user_types": ["student"],
        "role": "회차 수납·상품명·당월 회차/금액 (회당 수금표)",
        "link_type": "name",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": ["student_name", "teacher_name", "product_name → product_prices"],
    },
    {
        "table": "trial_lessons",
        "label": "시범수업",
        "layer": "import",
        "user_types": ["student", "teacher"],
        "role": "시범 일정 (수업료 AM열 + 회당 M열)",
        "link_type": "name",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": ["student_name", "teacher_name"],
    },
    {
        "table": "student_events",
        "label": "학생 수동 이력",
        "layer": "core",
        "user_types": ["student"],
        "role": "앱에서 입력한 학생 이벤트 (정산 import와 분리)",
        "link_type": "fk",
        "primary_keys": ["id"],
        "foreign_keys": ["student_id → student_records"],
        "links_to": ["teacher_name, product_name (문자열)"],
    },
    {
        "table": "teacher_settlements",
        "label": "선생님 최종 정산",
        "layer": "import",
        "user_types": ["teacher"],
        "role": "선생님별 월 최종 정산액 (선생님 정산 시트)",
        "link_type": "name",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": ["teacher_name ↔ teachers"],
    },
    {
        "table": "monthly_settlements",
        "label": "월별 정산",
        "layer": "import",
        "user_types": ["teacher"],
        "role": "선생님 월별 수업료 정산 집계",
        "link_type": "name",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": ["teacher_name"],
    },
    {
        "table": "session_settlements",
        "label": "회당 정산",
        "layer": "import",
        "user_types": ["teacher"],
        "role": "선생님 회차 수업료 정산 집계",
        "link_type": "name",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": ["teacher_name"],
    },
    {
        "table": "tuition_records",
        "label": "수업료 관리(선생님 행)",
        "layer": "import",
        "user_types": ["teacher"],
        "role": "엑셀 수업료 관리 시트 선생님 프로필 행",
        "link_type": "name",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": ["teacher_name"],
    },
    {
        "table": "teacher_profiles",
        "label": "선생님 프로필 스냅샷",
        "layer": "import",
        "user_types": ["teacher"],
        "role": "import 시점 선생님 프로필 (teachers와 별도)",
        "link_type": "name",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": ["teacher_name"],
    },
    {
        "table": "payment_method_revenues",
        "label": "결제수단별 매출",
        "layer": "import",
        "user_types": ["student"],
        "role": "월·결제수단별 수납 합계",
        "link_type": "none",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": [],
    },
    {
        "table": "data_syncs",
        "label": "동기화 이력",
        "layer": "meta",
        "user_types": [],
        "role": "워크북 import 메타",
        "link_type": "meta",
        "primary_keys": ["id"],
        "foreign_keys": [],
        "links_to": [],
    },
]

TARGET_CHAIN = [
    {
        "step": 1,
        "entity": "product_prices",
        "label": "상품 단가표",
        "description": "모든 판매 상품·단가의 기준 (35%/17%/회당)",
    },
    {
        "step": 2,
        "entity": "student_records",
        "label": "학생",
        "description": "납부자 마스터",
    },
    {
        "step": 3,
        "entity": "enrollments",
        "label": "수강 계약",
        "description": "학생 + 선생님 + product_id(FK 목표) — 어떤 상품을 결제하는지",
    },
    {
        "step": 4,
        "entity": "teachers",
        "label": "선생님",
        "description": "해당 수강·상품에 대한 정산 수취인",
    },
    {
        "step": 5,
        "entity": "tuition_student_months / session_collections",
        "label": "수납 실적",
        "description": "enrollment_id FK로 학생 납부 내역 연결 (현재: 이름만)",
    },
    {
        "step": 6,
        "entity": "teacher_settlements",
        "label": "선생님 정산",
        "description": "teacher_id + month + enrollment 기준 정산 (현재: teacher_name만)",
    },
]

LAYER_LABELS = {
    "core": "운영 코어 (FK 연결)",
    "catalog": "상품·단가",
    "import": "엑셀 import 스냅샷 (이름 조인)",
    "meta": "시스템",
}

# ER 다이어그램: from → to, type = fk | name | catalog
SCHEMA_RELATIONSHIPS = [
    {"from": "enrollments", "to": "student_records", "type": "fk", "label": "student_id"},
    {"from": "enrollments", "to": "teachers", "type": "fk", "label": "teacher_id"},
    {"from": "enrollment_schedules", "to": "enrollments", "type": "fk", "label": "enrollment_id"},
    {"from": "student_events", "to": "student_records", "type": "fk", "label": "student_id"},
    {"from": "enrollments", "to": "product_prices", "type": "catalog", "label": "product_name"},
    {"from": "session_collections", "to": "product_prices", "type": "catalog", "label": "product_name"},
    {"from": "tuition_student_months", "to": "student_records", "type": "name", "label": "student_name"},
    {"from": "tuition_student_months", "to": "teachers", "type": "name", "label": "teacher_name"},
    {"from": "session_collections", "to": "student_records", "type": "name", "label": "student_name"},
    {"from": "session_collections", "to": "teachers", "type": "name", "label": "teacher_name"},
    {"from": "trial_lessons", "to": "student_records", "type": "name", "label": "student_name"},
    {"from": "trial_lessons", "to": "teachers", "type": "name", "label": "teacher_name"},
    {"from": "teacher_settlements", "to": "teachers", "type": "name", "label": "teacher_name"},
    {"from": "monthly_settlements", "to": "teachers", "type": "name", "label": "teacher_name"},
    {"from": "session_settlements", "to": "teachers", "type": "name", "label": "teacher_name"},
    {"from": "tuition_records", "to": "teachers", "type": "name", "label": "teacher_name"},
    {"from": "teacher_profiles", "to": "teachers", "type": "name", "label": "teacher_name"},
    {"from": "payment_method_revenues", "to": "tuition_student_months", "type": "name", "label": "집계"},
    {"from": "payment_method_revenues", "to": "session_collections", "type": "name", "label": "집계"},
]

# SVG 노드 배치 (x, y, w, h)
DIAGRAM_LAYOUT: dict[str, dict[str, int]] = {
    "product_prices": {"x": 520, "y": 24, "w": 200, "h": 52},
    "rate_table_rows": {"x": 760, "y": 24, "w": 200, "h": 52},
    "student_records": {"x": 40, "y": 120, "w": 200, "h": 52},
    "student_events": {"x": 40, "y": 220, "w": 200, "h": 52},
    "tuition_student_months": {"x": 40, "y": 340, "w": 200, "h": 52},
    "session_collections": {"x": 40, "y": 460, "w": 200, "h": 52},
    "trial_lessons": {"x": 40, "y": 580, "w": 200, "h": 52},
    "enrollments": {"x": 320, "y": 280, "w": 200, "h": 52},
    "enrollment_schedules": {"x": 320, "y": 400, "w": 200, "h": 52},
    "teachers": {"x": 600, "y": 120, "w": 200, "h": 52},
    "teacher_profiles": {"x": 600, "y": 220, "w": 200, "h": 52},
    "tuition_records": {"x": 600, "y": 340, "w": 200, "h": 52},
    "teacher_settlements": {"x": 880, "y": 120, "w": 200, "h": 52},
    "monthly_settlements": {"x": 880, "y": 220, "w": 200, "h": 52},
    "session_settlements": {"x": 880, "y": 340, "w": 200, "h": 52},
    "payment_method_revenues": {"x": 40, "y": 700, "w": 200, "h": 52},
    "data_syncs": {"x": 320, "y": 700, "w": 200, "h": 52},
}

APP_PAGES = [
    {
        "id": "dashboard",
        "label": "대시보드",
        "nav_id": "dashboard",
        "focus": "운영월 매출·학생/선생님 수·결제수단·시범",
        "tables_read": [
            "teacher_settlements",
            "monthly_settlements",
            "session_collections",
            "tuition_student_months",
            "payment_method_revenues",
            "trial_lessons",
            "teacher_profiles",
        ],
        "tables_write": [],
        "api_keys": ["dashboard", "teacher_settlements", "monthly_settlements", "session_collections", "tuition_student_months", "payment_method_revenues", "trial_lessons"],
    },
    {
        "id": "teacher-settlements",
        "label": "선생님 정산",
        "nav_id": "teacher-settlements",
        "focus": "선생님별 정산 요약 + 학생별 상세 모달",
        "tables_read": [
            "teacher_settlements",
            "monthly_settlements",
            "session_settlements",
            "tuition_student_months",
            "session_collections",
            "trial_lessons",
        ],
        "tables_write": [],
        "api_keys": ["teacher_settlements", "monthly_settlements", "session_settlements", "tuition_student_months", "session_collections", "trial_lessons"],
    },
    {
        "id": "students",
        "label": "학생 수납",
        "nav_id": "students",
        "focus": "학생 마스터·수강·회당 수납·수동 이력",
        "tables_read": ["student_records", "enrollments", "enrollment_schedules", "session_collections", "student_events", "trial_lessons"],
        "tables_write": ["student_records", "student_events"],
        "api_keys": ["students", "enrollments"],
        "api_write": ["POST /api/students", "PUT /api/students/{id}", "POST /api/students/{id}/events", "PUT /api/student-events/{id}", "DELETE /api/student-events/{id}", "POST /api/enrollments/{id}/schedules"],
    },
    {
        "id": "tuition",
        "label": "수업료 관리",
        "nav_id": "tuition",
        "focus": "월별 수납(수업료 관리 시트)",
        "tables_read": ["tuition_student_months", "tuition_records"],
        "tables_write": [],
        "api_keys": ["tuition_student_months", "tuition_records"],
    },
    {
        "id": "catalogs",
        "label": "상품 / 단가표",
        "nav_id": "catalogs",
        "focus": "상품 단가·단가표 원본",
        "tables_read": ["product_prices", "rate_table_rows"],
        "tables_write": [],
        "api_keys": ["product_prices", "rate_table_rows"],
    },
    {
        "id": "data-model",
        "label": "데이터 구조",
        "nav_id": "data-model",
        "focus": "DB 스키마·연결·화면 매핑",
        "tables_read": ["*"],
        "tables_write": [],
        "api_keys": ["data_model"],
        "api_write": ["GET /api/data-model"],
    },
]

MERMAID_ER = """erDiagram
    student_records ||--o{ enrollments : student_id
    teachers ||--o{ enrollments : teacher_id
    enrollments ||--o{ enrollment_schedules : enrollment_id
    student_records ||--o{ student_events : student_id
    product_prices }o..o{ enrollments : product_name
    student_records }o..o{ tuition_student_months : student_name
    teachers }o..o{ tuition_student_months : teacher_name
    student_records }o..o{ session_collections : student_name
    teachers }o..o{ session_collections : teacher_name
    teachers }o..o{ teacher_settlements : teacher_name
    teachers }o..o{ monthly_settlements : teacher_name
    teachers }o..o{ session_settlements : teacher_name
"""


def _tables_used_by_pages() -> dict[str, list[str]]:
    usage: dict[str, list[str]] = {}
    for page in APP_PAGES:
        for table in page["tables_read"]:
            if table == "*":
                continue
            usage.setdefault(table, []).append(page["label"])
    return usage


def _pair_key(student_name: str | None, teacher_name: str | None) -> tuple[str, str] | None:
    if not student_name or not teacher_name:
        return None
    return (student_name.strip(), teacher_name.strip())


def build_data_model_snapshot(db: Session) -> dict:
    from .database import engine

    inspector = inspect(engine)
    row_counts: dict[str, int] = {}
    for entry in TABLE_CATALOG:
        table = entry["table"]
        if inspector.has_table(table):
            row_counts[table] = db.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0
        else:
            row_counts[table] = 0

    catalog_products = {row.product_name.strip() for row in db.query(ProductPrice).all() if row.product_name}
    catalog_by_table = {}
    for row in db.query(ProductPrice).all():
        catalog_by_table.setdefault(row.table_name, set()).add(row.product_name.strip())

    students_by_name = {row.student_name: row for row in db.query(StudentRecord).all()}
    teachers_by_name = {row.teacher_name: row for row in db.query(Teacher).all()}
    enrollment_pairs = set()
    enrollment_product_names: list[str] = []
    enrollments_catalog_matched = 0
    for enrollment in db.query(Enrollment).all():
        student = db.get(StudentRecord, enrollment.student_id)
        teacher = db.get(Teacher, enrollment.teacher_id)
        if student and teacher:
            enrollment_pairs.add((student.student_name, teacher.teacher_name))
        pname = (enrollment.product_name or "").strip()
        if pname:
            enrollment_product_names.append(pname)
            if pname in catalog_products:
                enrollments_catalog_matched += 1

    tuition_rows = db.query(TuitionStudentMonth).all()
    session_rows = db.query(SessionCollection).all()
    tuition_linked = 0
    for row in tuition_rows:
        if _pair_key(row.student_name, row.teacher_name) in enrollment_pairs:
            tuition_linked += 1

    session_linked = 0
    session_product_matched = 0
    for row in session_rows:
        if _pair_key(row.student_name, row.teacher_name) in enrollment_pairs:
            session_linked += 1
        if row.product_name and row.product_name.strip() in catalog_products:
            session_product_matched += 1

    settlement_teachers = {row.teacher_name for row in db.query(TeacherSettlement).all()}
    teachers_in_settlement = sum(1 for name in teachers_by_name if name in settlement_teachers)

    tables = []
    for entry in TABLE_CATALOG:
        table = entry["table"]
        columns = []
        if inspector.has_table(table):
            columns = [col["name"] for col in inspector.get_columns(table)]
        tables.append(
            {
                **entry,
                "layer_label": LAYER_LABELS.get(entry["layer"], entry["layer"]),
                "row_count": row_counts.get(table, 0),
                "columns": columns,
            }
        )

    table_usage = _tables_used_by_pages()
    for row in tables:
        row["used_by_pages"] = table_usage.get(row["table"], [])
    tables_by_name = {row["table"]: row for row in tables}
    diagram_nodes = []
    for table_name, layout in DIAGRAM_LAYOUT.items():
        meta = tables_by_name.get(table_name)
        if not meta:
            continue
        diagram_nodes.append(
            {
                "table": table_name,
                "label": meta["label"],
                "layer": meta["layer"],
                "link_type": meta["link_type"],
                "row_count": meta["row_count"],
                "user_types": meta.get("user_types", []),
                "used_by_pages": table_usage.get(table_name, []),
                **layout,
            }
        )

    enrollment_total = db.query(Enrollment).count()
    sample_chains = []
    for enrollment in db.query(Enrollment).limit(8):
        student = db.get(StudentRecord, enrollment.student_id)
        teacher = db.get(Teacher, enrollment.teacher_id)
        if not student or not teacher:
            continue
        pair = (student.student_name, teacher.teacher_name)
        pname = (enrollment.product_name or "").strip()
        tuition_count = sum(
            1
            for row in tuition_rows
            if row.student_name == student.student_name and row.teacher_name == teacher.teacher_name
        )
        session_count = sum(
            1
            for row in session_rows
            if row.student_name == student.student_name and row.teacher_name == teacher.teacher_name
        )
        sample_chains.append(
            {
                "enrollment_id": enrollment.id,
                "student_name": student.student_name,
                "teacher_name": teacher.teacher_name,
                "product_name": pname or None,
                "billing_plan": enrollment.billing_plan,
                "product_in_catalog": pname in catalog_products if pname else False,
                "tuition_month_rows": tuition_count,
                "session_collection_rows": session_count,
                "has_teacher_settlement": teacher.teacher_name in settlement_teachers,
            }
        )

    unmapped_products = sorted(
        {
            name
            for name in enrollment_product_names + [row.product_name.strip() for row in session_rows if row.product_name]
            if name and name not in catalog_products
        }
    )[:12]

    return {
        "user_types": USER_TYPES,
        "target_chain": TARGET_CHAIN,
        "relationships": SCHEMA_RELATIONSHIPS,
        "diagram_nodes": diagram_nodes,
        "diagram_size": {"width": 1120, "height": 780},
        "app_pages": APP_PAGES,
        "mermaid_er": MERMAID_ER.strip(),
        "tables": tables,
        "tables_by_name": tables_by_name,
        "stats": {
            "student_count": row_counts.get("student_records", 0),
            "teacher_count": row_counts.get("teachers", 0),
            "enrollment_count": enrollment_total,
            "product_catalog_count": row_counts.get("product_prices", 0),
            "enrollments_with_product_in_catalog": enrollments_catalog_matched,
            "enrollments_with_product": sum(1 for e in db.query(Enrollment).all() if (e.product_name or "").strip()),
            "tuition_month_rows": len(tuition_rows),
            "tuition_rows_linked_to_enrollment": tuition_linked,
            "session_collection_rows": len(session_rows),
            "session_rows_linked_to_enrollment": session_linked,
            "session_rows_product_in_catalog": session_product_matched,
            "teachers_with_settlement_rows": teachers_in_settlement,
            "trial_lesson_rows": row_counts.get("trial_lessons", 0),
        },
        "catalog_tables": [
            {"table_name": name, "product_count": len(names)}
            for name, names in sorted(catalog_by_table.items())
        ],
        "sample_chains": sample_chains,
        "gaps": [
            {
                "id": "import_name_join",
                "severity": "high",
                "title": "수납·정산 테이블에 FK 없음",
                "detail": "tuition_student_months, session_collections, teacher_settlements 등은 student_name·teacher_name 문자열만 사용합니다.",
            },
            {
                "id": "product_fk",
                "severity": "high",
                "title": "상품 FK 미연결",
                "detail": "enrollments.product_name은 자유 텍스트입니다. product_prices.id FK가 없어 단가표와 DB 레벨 검증이 되지 않습니다.",
            },
            {
                "id": "dual_teacher",
                "severity": "medium",
                "title": "선생님 이중 테이블",
                "detail": "teacher_profiles(import 스냅샷)와 teachers(수강용)가 분리되어 있습니다.",
            },
            {
                "id": "reimport_reset",
                "severity": "medium",
                "title": "재동기화 시 수강 초기화",
                "detail": "워크북 재import 시 enrollments·enrollment_schedules가 삭제 후 재생성됩니다.",
            },
        ],
        "unmapped_product_names_sample": unmapped_products,
    }
