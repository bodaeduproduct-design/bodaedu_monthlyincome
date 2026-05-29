#!/bin/zsh
cd "$(dirname "$0")"
source .venv/bin/activate

export SMTP_HOST=smtp.worksmobile.com
export SMTP_PORT=587
export SMTP_USE_TLS=true
export SMTP_USER=bodaedu_product@bodaedu.kr
export SMTP_FROM=bodaedu_product@bodaedu.kr

echo "네이버웍스 외부 앱 비밀번호를 입력하세요 (화면에 표시되지 않음):"
read -s SMTP_PASS
export SMTP_PASS
echo ""

exec uvicorn app.main:app --reload --port 8001
