#!/usr/bin/env bash
set -euo pipefail

# 정산앱 전체 테이블 데이터를 한 번에 덤프합니다.
# 사용: ./scripts/export_db_snapshot.sh [base_url] [out_dir]

BASE_URL="${1:-http://127.0.0.1:8001}"
OUT_DIR="${2:-db-snapshots/latest}"

python3 "./scripts/export_db_snapshot.py" \
  --base-url "$BASE_URL" \
  --out-dir "$OUT_DIR"

echo ""
echo "완료: $OUT_DIR"

