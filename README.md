# 보다수학 정산앱 (boda.db)

`boda.db`(SQLite) 기준으로 대시보드/정산/학생수납/상품 단가표를 보는 로컬 웹앱입니다.

- **백엔드**: FastAPI + SQLAlchemy + SQLite
- **프론트**: React + Vite

## DB 기준

이 프로젝트는 아래 두 파일을 **단일 기준**으로 사용합니다.

- `정산앱/boda.db`: 실제 실행 시 조회/수정되는 SQLite DB
- `정산앱/boda_db_sqlite.sql`: DB 스키마/샘플 데이터를 담은 SQL 문서(참조용)

## 주요 기능

- 대시보드: 총매출, 월별결제/회당결제, 순수익(지급액), 시범수업비, 결제수단 분포, 매출 추이
- 선생님 정산: 월별 지급액을 한눈에, 클릭 시 상세(정산 요약/레코드)
- 학생 수납: 학생별 수업(상품/담당/결제수단/다음청구 등) 조회
- 상품/단가표: `products` 테이블 기준 표시
- DB 전체보기: 테이블별 전체 행을 한 페이지에서 확인
- 데이터 관리: 테이블별 CRUD(화이트리스트 기반)
- 데이터 구조: ER/테이블 사전(기존 뷰 유지)

## 폴더 구조

```text
정산앱/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── database.py
│   │   ├── main.py
│   │   ├── models.py
│   ├── requirements.txt
│   └── (venv 등)
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.css
│       ├── BodaApp.jsx
│       ├── index.css
│       └── main.jsx
├── boda.db
├── boda_db_sqlite.sql
└── README.md
```

## 실행 방법

### 1. 백엔드

```bash
cd "/Users/bodaedu/Documents/claude/Settlement /정산앱/backend"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

기본 권장 주소: `http://127.0.0.1:8001` (프론트 프록시가 이 포트를 바라봅니다)

### 2. 프론트

```bash
cd "/Users/bodaedu/Documents/claude/Settlement /정산앱/frontend"
npm install
npm run dev
```

기본 주소: `http://127.0.0.1:5173`

프론트의 `/api` 요청은 자동으로 백엔드 `8001` 포트로 프록시됩니다.
## 데이터 관리/전체보기 API

- 스키마: `GET /api/admin/schemas`
- 전체보기: `GET /api/admin/overview`
- CRUD: `GET/POST/PUT/DELETE /api/admin/tables/{table}/rows`

```
product_prices (상품 단가표)
       │
       ▼ product_name (문자열, FK 목표: product_id)
enrollments ◄── student_records + teachers
       │
       ├── enrollment_schedules (요일·시간 기간)
       ├── tuition_student_months (월별 수납, 이름 조인)
       ├── session_collections (회당 수금 + product_name)
       └── teacher_settlements (선생님 정산, teacher_name 조인)
```

- **상품 정의**: `product_prices` — `35% 할인` · `17% 할인` · `회당 단가표`
- **학생이 결제하는 상품**: `enrollments.product_name` + 회당은 `session_collections.product_name`
- **선생님이 정산받는 대상**: 동일 `(학생, 선생님)` 수강에 대한 import 정산 행

**요금제(`billing_plan`)**: `monthly_35` · `monthly_17` · `monthly` · `session` — 상품명에서 추론.

### DB 레이어

| 레이어 | 테이블 예 | 연결 방식 |
|--------|-----------|-----------|
| 운영 코어 | `student_records`, `teachers`, `enrollments`, `enrollment_schedules` | FK |
| 상품 카탈로그 | `product_prices`, `rate_table_rows` | 참조 (enrollment는 아직 FK 없음) |
| 엑셀 import | `tuition_student_months`, `session_collections`, `teacher_settlements` … | `student_name` / `teacher_name` |

### 향후 FK 정리 (목표)

1. `enrollments.product_id` → `product_prices.id`
2. `tuition_student_months.enrollment_id`, `session_collections.enrollment_id`
3. `teacher_settlements.teacher_id` → `teachers.id`

### 시범수업 일정 (시트 기준)

| 시트 | 열 | 내용 |
|------|-----|------|
| 수업료 관리 | **AM** | 시범수업 날짜 (마스터, 월별 수납 학생) |
| 수업료 관리 | AF / AO | 수업 시작일 / 해지일 |
| 회당 수금표 | **M** | 시범수업 날짜 (회차 수납 학생) |
| 회당 수금표 | N / O | 수업 시작일 / 종료일 |

동기화 시 `trial_lessons` 테이블에 합쳐지며, 대시보드·선생님 정산 시범 패널에서 출처(수업료 AM / 회당 M)로 표시됩니다.

### 익월부터 수업 요일이 바뀔 때 (DB 처리 원칙)

기존 스케줄 행을 **수정하지 않습니다**. 기간 이력을 쌓습니다.

1. 현재 열린 스케줄(`effective_to`가 NULL)에 **종료일** = 변경 전날 (예: 5/31)을 넣습니다.
2. **새 행**을 추가합니다: `effective_from` = 변경 적용일 (예: 6/1), 새 요일·시간.
3. 과거 월 정산·대시보드는 해당 월 말일 기준으로 유효한 스케줄을 조회합니다.

API 예시 (6월 1일부터 화·목 → 월·수):

```http
POST /api/enrollments/{enrollment_id}/schedules
Content-Type: application/json

{
  "effective_from": "2026-06-01",
  "course": "고등",
  "weekly_frequency": "주2회",
  "weekdays": "월, 수",
  "time_text": "19:00"
}
```

워크북 재동기화 시 `enrollments` / `enrollment_schedules`는 시트 기준으로 다시 생성됩니다. 수동으로 넣은 스케줄 변경은 재동기화 전에 백업하거나, 이후 UI에서 다시 등록해야 합니다.

## API 요약

- `GET /api/health` - 서버/동기화 상태 확인
- `GET /api/app-data` - 대시보드와 모든 페이지 데이터 조회 (`teachers`, `enrollments` 포함)
- `POST /api/enrollments/{id}/schedules` - 수업 요일·시간 변경(기간 추가)
- `POST /api/import/workbook` - `.xlsx` 워크북 전체 재동기화
