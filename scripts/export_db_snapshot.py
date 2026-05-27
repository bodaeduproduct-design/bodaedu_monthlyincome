#!/usr/bin/env python3
"""
정산앱 백엔드(Admin API)에서 테이블별 데이터를 한 번에 덤프합니다.

- /api/admin/schemas 로 테이블 목록/메타 획득
- /api/admin/tables/{table}/rows 를 limit/offset 페이지네이션으로 끝까지 수집
- out_dir 아래에 schemas.json + tables/{table}.json 저장
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


def http_get_json(url: str, *, timeout: float = 30.0) -> Any:
    req = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
        raise RuntimeError(f"HTTP {exc.code} {exc.reason} for {url}\n{body}") from exc
    except URLError as exc:
        raise RuntimeError(f"요청 실패: {url}\n{exc}") from exc
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        text = raw.decode("utf-8", errors="replace")
        raise RuntimeError(f"JSON 파싱 실패: {url}\n{text[:2000]}") from exc


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def dump_table(
    *,
    base_url: str,
    table_name: str,
    out_path: str,
    page_limit: int,
    sleep_ms: int,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    offset = 0
    total: int | None = None

    while True:
        params = urlencode({"offset": offset, "limit": page_limit})
        url = urljoin(base_url, f"/api/admin/tables/{table_name}/rows?{params}")
        payload = http_get_json(url)

        page_rows = payload.get("rows") or []
        if total is None:
            total = int(payload.get("total") or 0)

        rows.extend(page_rows)
        offset += len(page_rows)

        if len(page_rows) == 0 or offset >= total:
            break

        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000.0)

    out = {"table": table_name, "total": total or 0, "rows": rows}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return {"table": table_name, "total": out["total"], "saved_rows": len(rows)}


def main() -> int:
    parser = argparse.ArgumentParser(description="정산앱 DB 스냅샷 덤프")
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8001",
        help="백엔드 주소 (기본: http://127.0.0.1:8001)",
    )
    parser.add_argument(
        "--out-dir",
        default="db-snapshots/latest",
        help="저장 폴더 (기본: db-snapshots/latest)",
    )
    parser.add_argument(
        "--page-limit",
        type=int,
        default=200,
        help="테이블 조회 페이지 크기 (기본: 200, 최대 200)",
    )
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=0,
        help="페이지 요청 사이 쉬는 시간(ms) (기본: 0)",
    )
    args = parser.parse_args()

    base_url = str(args.base_url).rstrip("/")
    out_dir = os.path.abspath(args.out_dir)
    page_limit = int(args.page_limit)
    sleep_ms = int(args.sleep_ms)

    if page_limit < 1:
        page_limit = 1
    if page_limit > 200:
        page_limit = 200

    ensure_dir(out_dir)
    ensure_dir(os.path.join(out_dir, "tables"))

    schemas_url = urljoin(base_url, "/api/admin/schemas")
    schemas_payload = http_get_json(schemas_url)
    tables = schemas_payload.get("tables") or []

    with open(os.path.join(out_dir, "schemas.json"), "w", encoding="utf-8") as f:
        json.dump(schemas_payload, f, ensure_ascii=False, indent=2)

    if not tables:
        print("테이블 목록이 비어있습니다. 백엔드가 정상인지 확인하세요.", file=sys.stderr)
        return 2

    print(f"base_url={base_url}")
    print(f"out_dir={out_dir}")
    print(f"tables={len(tables)} page_limit={page_limit}")

    results: list[dict[str, Any]] = []
    for schema in tables:
        table_name = schema.get("table")
        if not table_name:
            continue
        out_path = os.path.join(out_dir, "tables", f"{table_name}.json")
        try:
            info = dump_table(
                base_url=base_url,
                table_name=table_name,
                out_path=out_path,
                page_limit=page_limit,
                sleep_ms=sleep_ms,
            )
            results.append(info)
            print(f"- {table_name}: {info['saved_rows']}/{info['total']} rows -> {out_path}")
        except Exception as exc:
            print(f"- {table_name}: 실패 ({exc})", file=sys.stderr)
            raise

    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as f:
        json.dump({"base_url": base_url, "results": results}, f, ensure_ascii=False, indent=2)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

