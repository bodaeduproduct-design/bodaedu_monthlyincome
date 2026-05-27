# bodaedu_monthlyincome

정산 관리 로컬 웹앱입니다.

구글 스프레드시트 `정산 관리` 구조를 기준으로 만든 FastAPI + SQLite + React/Vite 로컬 웹앱입니다.  
시트 탭을 그대로 페이지화하고, 공개 워크북을 SQLite로 적재해 보기 좋게 탐색할 수 있도록 구성했습니다.

## 반영된 시트 기준

- `선생님 정산`
- `월별 정산`
- `수업료 관리`
- `회당 정산`
- `회당 수금표`
- `상품(수정금지)`
- `단가표`

## 주요 기능

- 스프레드시트 기반 데이터 자동 적재
- 대시보드 요약 카드와 월별 정산 추이
- 선생님 정산 / 월별 정산 / 회당 정산 표 조회
- 수업료 관리 선생님 프로필 카드 + 원본 테이블 조회
- 회당 수금표 검색
- 상품표 / 단가표 시각화
- 워크북(`.xlsx`) 재업로드 후 전체 데이터 재동기화

## 폴더 구조

```text
정산앱/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── database.py
│   │   ├── excel.py
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   └── workbook_import.py
│   ├── requirements.txt
│   └── settlement.db
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.css
│       ├── App.jsx
│       ├── index.css
│       └── main.jsx
├── sheet.xlsx
└── README.md
```

`sheet.xlsx` 파일이 있으면 백엔드 시작 시 최초 1회 자동으로 SQLite에 적재합니다.

## 실행 방법

### 1. 백엔드

```bash
cd "/Users/bodaedu/Documents/claude/Settlement /정산앱/backend"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

포트 충돌을 피하려면 아래처럼 `8001`로 실행하는 것을 권장합니다.

```bash
uvicorn app.main:app --reload --port 8001
```

기본 권장 주소: `http://127.0.0.1:8001`

### 2. 프론트

```bash
cd "/Users/bodaedu/Documents/claude/Settlement /정산앱/frontend"
npm install
npm run dev
```

기본 주소: `http://127.0.0.1:5173`

프론트의 `/api` 요청은 자동으로 백엔드 `8001` 포트로 프록시됩니다.

## 워크북 재동기화

화면 오른쪽 상단의 `워크북 다시 업로드` 버튼으로 공개 시트에서 내려받은 `.xlsx` 파일을 다시 넣으면,
기존 SQLite 데이터를 전부 교체하고 최신 워크북 기준으로 재적재합니다.

## API 요약

- `GET /api/health` - 서버/동기화 상태 확인
- `GET /api/app-data` - 대시보드와 모든 페이지 데이터 조회
- `POST /api/import/workbook` - `.xlsx` 워크북 전체 재동기화
