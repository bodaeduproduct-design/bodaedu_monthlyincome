"""boda.db 테이블/컬럼 메타데이터 (데이터 관리/DB 전체보기용)."""

from __future__ import annotations

from typing import Any


# type: text | integer | float | textarea | fk | date | datetime | boolean
TABLE_REGISTRY: dict[str, dict[str, Any]] = {
    "users": {
        "label": "사용자",
        "layer": "core",
        "sheet": "boda.db",
        "search_fields": ["name", "role", "email"],
        "allow_create": True,
        "allow_delete": True,
        "columns": {
            "id": {"label": "ID", "type": "integer", "editable": False},
            "email": {"label": "이메일", "type": "text"},
            "name": {"label": "이름", "type": "text", "required": True},
            "role": {"label": "역할", "type": "text", "required": True},
            "created_at": {"label": "생성시각", "type": "text"},
        },
    },
    "student_profiles": {
        "label": "학생 프로필",
        "layer": "core",
        "sheet": "boda.db",
        "search_fields": ["grade_level", "phone", "parent_name", "parent_phone"],
        "allow_create": True,
        "allow_delete": True,
        "columns": {
            "id": {"label": "학생ID", "type": "integer", "editable": False},
            "user_id": {"label": "사용자ID", "type": "fk", "fk_table": "users", "required": True},
            "phone": {"label": "학생 연락처", "type": "text"},
            "region": {"label": "지역", "type": "text"},
            "grade_level": {"label": "학년", "type": "text"},
            "parent_name": {"label": "보호자명", "type": "text"},
            "parent_phone": {"label": "보호자 연락처", "type": "text"},
            "created_at": {"label": "생성시각", "type": "text"},
        },
    },
    "teacher_profiles": {
        "label": "선생님 프로필",
        "layer": "core",
        "sheet": "boda.db",
        "search_fields": ["status", "phone", "education", "major"],
        "allow_create": True,
        "allow_delete": True,
        "columns": {
            "id": {"label": "선생님ID", "type": "integer", "editable": False},
            "user_id": {"label": "사용자ID", "type": "fk", "fk_table": "users", "required": True},
            "phone": {"label": "연락처", "type": "text"},
            "birth_date": {"label": "생년월일", "type": "text"},
            "gender": {"label": "성별", "type": "text"},
            "education": {"label": "학력", "type": "text"},
            "major": {"label": "전공", "type": "text"},
            "status": {"label": "상태", "type": "text"},
            "created_at": {"label": "생성시각", "type": "text"},
        },
    },
    "products": {
        "label": "상품/단가",
        "layer": "core",
        "sheet": "boda.db",
        "search_fields": ["name", "level", "billing_unit"],
        "allow_create": True,
        "allow_delete": False,
        "columns": {
            "id": {"label": "상품ID", "type": "integer", "editable": False},
            "name": {"label": "상품명", "type": "text", "required": True},
            "level": {"label": "레벨", "type": "text", "required": True},
            "sessions_per_week": {"label": "주횟수", "type": "integer", "required": True},
            "duration_min": {"label": "분", "type": "integer", "required": True},
            "price_standard": {"label": "정가", "type": "integer"},
            "price_17": {"label": "17%", "type": "integer"},
            "price_35": {"label": "35%", "type": "integer"},
            "price_per_session": {"label": "회당", "type": "integer"},
            "billing_unit": {"label": "결제기준", "type": "text", "required": True},
            "is_active": {"label": "활성", "type": "integer"},
            "created_at": {"label": "생성시각", "type": "text"},
        },
    },
    "lesson_enrollments": {
        "label": "수업 (학생↔선생님)",
        "layer": "core",
        "sheet": "boda.db",
        "search_fields": ["payment_method", "start_date", "end_date", "next_billing"],
        "search_hint": "결제수단·날짜·선생님명·학생명",
        "allow_create": True,
        "allow_delete": True,
        "columns": {
            "id": {"label": "수업ID", "type": "integer", "editable": False},
            "student_id": {"label": "학생ID", "type": "fk", "fk_table": "student_profiles", "required": True},
            "teacher_id": {"label": "선생님ID", "type": "fk", "fk_table": "teacher_profiles", "required": True},
            "product_id": {"label": "상품ID", "type": "fk", "fk_table": "products"},
            "price_type": {"label": "가격유형", "type": "text"},
            "payment_method": {"label": "결제수단", "type": "text"},
            "day_1": {"label": "요일1", "type": "integer"},
            "day_2": {"label": "요일2", "type": "integer"},
            "day_3": {"label": "요일3", "type": "integer"},
            "base_commission_rate": {"label": "기본수수료율", "type": "float"},
            "current_commission_rate": {"label": "현재수수료율", "type": "float"},
            "trial_date": {"label": "시범일", "type": "date"},
            "trial_month": {"label": "시범월", "type": "text"},
            "trial_fee": {"label": "시범비", "type": "integer"},
            "start_date": {"label": "시작일", "type": "date"},
            "end_date": {"label": "종료일", "type": "date"},
            "next_billing": {
                "label": "다음 청구일",
                "type": "date",
                "help": "종료일·해지일이 없으면 매월 1일로 자동 계산",
            },
            "first_month_sessions": {"label": "첫달횟수", "type": "integer"},
            "first_month_ratio": {"label": "첫달비율", "type": "float"},
            "first_month_amount": {"label": "첫달금액", "type": "integer"},
            "cancelled_at": {
                "label": "해지일",
                "type": "date",
                "help": "수업 계약 해지일(날짜만). NULL이면 해지 전",
            },
            "termination_total_sessions": {"label": "해지월총횟수", "type": "integer"},
            "termination_remaining": {"label": "해지잔여", "type": "integer"},
            "termination_ratio": {"label": "해지비율", "type": "float"},
            "created_at": {"label": "생성시각", "type": "text"},
        },
    },
    "monthly_payment_records": {
        "label": "월별 수납 내역",
        "layer": "ledger",
        "sheet": "boda.db",
        "search_fields": ["billing_month", "billing_unit", "payment_tag"],
        "allow_create": True,
        "allow_delete": True,
        "columns": {
            "id": {"label": "ID", "type": "integer", "editable": False},
            "billing_month": {"label": "수납월", "type": "text", "required": True},
            "enrollment_id": {"label": "수업ID", "type": "fk", "fk_table": "lesson_enrollments", "required": True},
            "student_id": {"label": "학생ID", "type": "fk", "fk_table": "student_profiles", "required": True},
            "teacher_id": {"label": "선생님ID", "type": "fk", "fk_table": "teacher_profiles", "required": True},
            "total_sessions": {"label": "총횟수", "type": "integer"},
            "completed_sessions": {"label": "완료횟수", "type": "integer"},
            "billing_unit": {"label": "결제기준", "type": "text"},
            "base_amount": {"label": "기본금액", "type": "integer"},
            "special_amount": {"label": "특이금액", "type": "integer"},
            "refund_amount": {"label": "환불", "type": "integer"},
            "final_amount": {"label": "최종금액", "type": "integer"},
            "commission_rate": {"label": "수수료율", "type": "float"},
            "trial_fee": {
                "label": "시범비(미사용)",
                "type": "integer",
                "editable": False,
            },
            "payment_tag": {"label": "결제태그", "type": "text"},
            "memo": {"label": "메모", "type": "textarea"},
        },
    },
    "settlements": {
        "label": "선생님 정산(지급)",
        "layer": "ledger",
        "sheet": "boda.db",
        "search_fields": ["billing_month", "settlement_type", "status"],
        "allow_create": True,
        "allow_delete": True,
        "columns": {
            "id": {"label": "ID", "type": "integer", "editable": False},
            "billing_month": {"label": "정산월", "type": "text", "required": True},
            "teacher_id": {"label": "선생님ID", "type": "fk", "fk_table": "teacher_profiles", "required": True},
            "settlement_type": {"label": "구분", "type": "text", "required": True},
            "gross_amount": {"label": "총매출", "type": "integer"},
            "trial_fee": {"label": "시범비", "type": "integer"},
            "commission_rate": {"label": "수수료율", "type": "float"},
            "pre_tax_amount": {"label": "세전", "type": "integer"},
            "withholding_rate": {"label": "원천세율", "type": "float"},
            "withholding_amount": {"label": "원천세", "type": "integer"},
            "net_amount": {"label": "지급액", "type": "integer"},
            "status": {"label": "상태", "type": "text"},
            "settled_at": {"label": "정산일", "type": "text"},
        },
    },
    "refund_requests": {
        "label": "환불 요청",
        "layer": "ledger",
        "sheet": "boda.db",
        "search_fields": ["billing_month", "status", "reason_type"],
        "allow_create": True,
        "allow_delete": True,
        "columns": {
            "id": {"label": "ID", "type": "integer", "editable": False},
            "enrollment_id": {"label": "수업ID", "type": "fk", "fk_table": "lesson_enrollments", "required": True},
            "student_id": {"label": "학생ID", "type": "fk", "fk_table": "student_profiles", "required": True},
            "billing_month": {"label": "월", "type": "text", "required": True},
            "reason_type": {"label": "사유", "type": "text"},
            "reason_detail": {"label": "상세", "type": "textarea"},
            "paid_amount": {"label": "납부액", "type": "integer"},
            "refund_amount": {"label": "환불액", "type": "integer"},
            "status": {"label": "상태", "type": "text"},
            "requested_at": {"label": "요청", "type": "text"},
            "approved_at": {"label": "승인", "type": "text"},
            "completed_at": {"label": "완료", "type": "text"},
        },
    },
    "commission_rate_history": {
        "label": "수수료율 변경 이력",
        "layer": "ledger",
        "sheet": "boda.db",
        "search_fields": ["changed_month", "reason"],
        "allow_create": True,
        "allow_delete": True,
        "columns": {
            "id": {"label": "ID", "type": "integer", "editable": False},
            "enrollment_id": {"label": "수업ID", "type": "fk", "fk_table": "lesson_enrollments", "required": True},
            "previous_rate": {"label": "이전", "type": "float"},
            "new_rate": {"label": "신규", "type": "float"},
            "changed_month": {"label": "변경월", "type": "text", "required": True},
            "reason": {"label": "사유", "type": "textarea"},
            "created_at": {"label": "생성시각", "type": "text"},
        },
    },
}


# 예전 DB 탭/API 경로 호환
LEGACY_TABLE_ALIASES: dict[str, str] = {
    "subscriptions": "lesson_enrollments",
    "monthly_lesson_records": "monthly_payment_records",
}


def resolve_table_name(table_name: str) -> str:
    return LEGACY_TABLE_ALIASES.get(table_name, table_name)


def list_table_names() -> list[str]:
    return list(TABLE_REGISTRY.keys())


def get_table_schema(table_name: str) -> dict[str, Any]:
    table_name = resolve_table_name(table_name)
    if table_name not in TABLE_REGISTRY:
        raise KeyError(table_name)
    entry = TABLE_REGISTRY[table_name]
    columns = []
    for name, meta in entry["columns"].items():
        columns.append(
            {
                "name": name,
                "label": meta.get("label", name),
                "type": meta.get("type", "text"),
                "editable": meta.get("editable", name not in ("id",)),
                "required": meta.get("required", False),
                "help": meta.get("help", ""),
                "fk_table": meta.get("fk_table"),
            }
        )
    return {
        "table": table_name,
        "label": entry.get("label", table_name),
        "layer": entry.get("layer", ""),
        "sheet": entry.get("sheet", ""),
        "search_fields": entry.get("search_fields", []),
        "search_hint": entry.get("search_hint", ""),
        "allow_create": entry.get("allow_create", True),
        "allow_delete": entry.get("allow_delete", True),
        "columns": columns,
    }


def get_all_schemas() -> list[dict[str, Any]]:
    return [get_table_schema(name) for name in list_table_names()]

