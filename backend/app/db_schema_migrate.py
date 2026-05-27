"""boda.db 테이블·컬럼 명칭 정리 (1회 마이그레이션)."""

from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def _table_row_count(conn, table: str) -> int:
    row = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
    return int(row or 0)


def apply_table_renames(engine: Engine) -> list[str]:
    """
    subscriptions → lesson_enrollments (학생↔선생님 수업)
    monthly_lesson_records → monthly_payment_records (월별 수납)
    subscription_id → enrollment_id
    """
    log: list[str] = []

    with engine.begin() as conn:
        tables = set(inspect(engine).get_table_names())

        # create_all로 빈 신규 테이블이 먼저 생긴 경우 제거 후 rename
        if "subscriptions" in tables and "lesson_enrollments" in tables:
            if _table_row_count(conn, "lesson_enrollments") == 0:
                conn.execute(text('DROP TABLE "lesson_enrollments"'))
                tables.discard("lesson_enrollments")
                log.append("빈 lesson_enrollments 제거 (rename 준비)")

        if "monthly_lesson_records" in tables and "monthly_payment_records" in tables:
            if _table_row_count(conn, "monthly_payment_records") == 0:
                conn.execute(text('DROP TABLE "monthly_payment_records"'))
                tables.discard("monthly_payment_records")
                log.append("빈 monthly_payment_records 제거 (rename 준비)")

        tables = set(inspect(engine).get_table_names())

        if "subscriptions" in tables and "lesson_enrollments" not in tables:
            conn.execute(text("ALTER TABLE subscriptions RENAME TO lesson_enrollments"))
            log.append("subscriptions → lesson_enrollments")

        if "monthly_lesson_records" in tables and "monthly_payment_records" not in tables:
            conn.execute(text("ALTER TABLE monthly_lesson_records RENAME TO monthly_payment_records"))
            log.append("monthly_lesson_records → monthly_payment_records")

        tables = set(inspect(engine).get_table_names())

        def _rename_col(table: str, old: str, new: str) -> None:
            cols = {c["name"] for c in inspect(engine).get_columns(table)}
            if old in cols and new not in cols:
                conn.execute(text(f'ALTER TABLE "{table}" RENAME COLUMN "{old}" TO "{new}"'))
                log.append(f"{table}.{old} → {new}")

        if "monthly_payment_records" in tables:
            _rename_col("monthly_payment_records", "subscription_id", "enrollment_id")
        if "refund_requests" in tables:
            _rename_col("refund_requests", "subscription_id", "enrollment_id")
        if "commission_rate_history" in tables:
            _rename_col("commission_rate_history", "subscription_id", "enrollment_id")

    return log
