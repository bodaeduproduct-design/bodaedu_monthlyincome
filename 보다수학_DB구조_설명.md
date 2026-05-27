# 보다수학 DB 구조 설명서

> **DB 파일:** `boda.db` (SQLite)  
> **대상:** Cursor 개발 시 참고용  
> **마지막 업데이트:** 2026-05

---

## 전체 테이블 목록

| 테이블명 | 설명 |
|----------|------|
| `users` | 선생님 + 학생 공통 계정 |
| `teacher_profiles` | 선생님 상세 정보 |
| `student_profiles` | 학생 상세 정보 |
| `products` | 수업 상품 (고등 주2회 90분 등) |
| `lesson_enrollments` | 수업 (학생↔선생님, 상품·결제 조건) |
| `monthly_payment_records` | 월별 학생 수납 내역 |
| `commission_rate_history` | 수수료율 변경 이력 |
| `settlements` | 선생님 정산 내역 |
| `refund_requests` | 환불 신청 내역 |

---

## 테이블 상세

### 1. users
선생님과 학생 모두 이 테이블에서 관리됩니다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INTEGER PK | 자동증가 |
| `email` | TEXT UNIQUE | 로그인 이메일 (현재는 NULL 허용) |
| `name` | TEXT NOT NULL | 이름 |
| `role` | TEXT | `'teacher'` 또는 `'student'` |
| `created_at` | TEXT | 생성일시 |

---

### 2. teacher_profiles
`users.id`와 1:1 연결. 선생님 고유 정보.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INTEGER PK | 자동증가 |
| `user_id` | INTEGER FK | → users.id |
| `phone` | TEXT | 연락처 |
| `birth_date` | TEXT | 생년월일 |
| `gender` | TEXT | `'male'` / `'female'` |
| `education` | TEXT | 최종학력 |
| `major` | TEXT | 전공 |
| `status` | TEXT | `'active'` / `'inactive'` |

> **주의:** 수수료율은 teacher_profiles에 없음. 수업(lesson_enrollment)마다 다르게 적용됨.

---

### 3. student_profiles
`users.id`와 1:1 연결. 학생 고유 정보.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INTEGER PK | 자동증가 |
| `user_id` | INTEGER FK | → users.id |
| `phone` | TEXT | 학생 연락처 |
| `region` | TEXT | 거주 지역 (서울, 세종, 청주 등) |
| `grade_level` | TEXT | `'elementary'` / `'middle'` / `'high'` |
| `parent_name` | TEXT | 학부모 이름 |
| `parent_phone` | TEXT | 학부모 연락처 |

---

### 4. products
수업 상품 목록. 상품(수정금지) 시트 기준.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INTEGER PK | 자동증가 |
| `name` | TEXT | 상품명 (예: `'고등 주2회 90분'`) |
| `level` | TEXT | `'elementary'` / `'middle'` / `'high'` |
| `sessions_per_week` | INTEGER | 주 수업 횟수 (1, 2, 3) |
| `duration_min` | INTEGER | 수업 시간(분) (60, 90, 120) |
| `price_standard` | INTEGER | 정가 |
| `price_17` | INTEGER | 17% 할인가 (현재 메인 사용) |
| `price_35` | INTEGER | 35% 할인가 |
| `price_per_session` | INTEGER | 회당 단가 |
| `billing_unit` | TEXT | `'monthly'` (월별 고정) / `'per_session'` (회당 변동) |
| `is_active` | INTEGER | 1=활성, 0=비활성 |

> **월별 수업료 계산 방식:**
> - `billing_unit = 'monthly'` → 매달 `price_17` 또는 `price_35` 고정 청구
> - `billing_unit = 'per_session'` → 해당 월 실제 수업 횟수 × `price_per_session`

---

### 5. lesson_enrollments (수업) ⭐ 핵심 테이블
학생-선생님-상품 간의 수업 계약. 한 학생이 같은 선생님과 여러 계약을 가질 수 있음.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INTEGER PK | 자동증가 |
| `student_id` | INTEGER FK | → student_profiles.id |
| `teacher_id` | INTEGER FK | → teacher_profiles.id |
| `product_id` | INTEGER FK | → products.id |
| `price_type` | TEXT | `'price_17'` / `'price_35'` / `'per_session'` |
| `payment_method` | TEXT | `'card'` / `'transfer'` / `'payer'` / `'cms'` |
| `day_1` | INTEGER | 수업 요일1 (0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토) |
| `day_2` | INTEGER | 수업 요일2 |
| `day_3` | INTEGER | 수업 요일3 (주3회인 경우) |
| `base_commission_rate` | REAL | 계약 시작 수수료율 (%) |
| `current_commission_rate` | REAL | 현재 적용 수수료율 (6개월↑ 시 단계적 인상) |
| `trial_date` | TEXT | 시범수업 날짜 |
| `trial_month` | TEXT | 시범수업 해당 월 (예: `'2026-03'`) |
| `trial_fee` | INTEGER | 시범수업 금액 (선생님에게 지급) |
| `start_date` | TEXT | 본수업 시작일 (**NULL이면 trial 상태**) |
| `end_date` | TEXT | 수업 종료일 |
| `next_billing` | TEXT | 다음 청구일 (`YYYY-MM-DD`). **종료일·해지일이 없으면** 매월 1일로 자동 계산 |
| `first_month_sessions` | INTEGER | 첫달 수업 횟수 |
| `first_month_ratio` | REAL | 첫달 금액 비율 (%) |
| `first_month_amount` | INTEGER | 첫달 실제 청구 금액 |
| `cancelled_at` | TEXT | **해지일** (`YYYY-MM-DD`, 시각 없음). NULL이면 해지 전 |
| `termination_total_sessions` | INTEGER | 해지월 총 수업 횟수 |
| `termination_remaining` | INTEGER | 해지월 잔여 수업 횟수 |
| `termination_ratio` | REAL | 잔여 비율 (환불 계산에 사용) |

#### 수업 상태 판별 (컬럼 없이 계산)
```sql
CASE
  WHEN cancelled_at  IS NOT NULL THEN 'cancelled'  -- 해지
  WHEN start_date    IS NOT NULL THEN 'active'      -- 수업 중
  ELSE                                'trial'       -- 시범수업 단계
END AS status
```

#### 자주 쓰는 조회 쿼리
```sql
-- 현재 수업 중인 학생 목록
SELECT u_s.name AS 학생, u_t.name AS 선생님, p.name AS 상품
FROM lesson_enrollments s
JOIN student_profiles sp ON s.student_id = sp.id
JOIN users u_s ON sp.user_id = u_s.id
JOIN teacher_profiles tp ON s.teacher_id = tp.id
JOIN users u_t ON tp.user_id = u_t.id
LEFT JOIN products p ON s.product_id = p.id
WHERE s.start_date IS NOT NULL
  AND s.cancelled_at IS NULL;

-- 특정 학생의 전체 계약 이력
SELECT u_t.name AS 선생님, p.name AS 상품,
       s.start_date, s.end_date, s.cancelled_at
FROM lesson_enrollments s
JOIN teacher_profiles tp ON s.teacher_id = tp.id
JOIN users u_t ON tp.user_id = u_t.id
LEFT JOIN products p ON s.product_id = p.id
WHERE s.student_id = ?
ORDER BY s.created_at;
```

---

### 6. monthly_payment_records (월별 수납)
매월 생성되는 수업/결제 스냅샷. 선생님-학생 조합이 한 달에 여러 계약으로 겹칠 때 월 단위로 관리.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INTEGER PK | 자동증가 |
| `billing_month` | TEXT | 정산 월 (예: `'2026-04'`) |
| `enrollment_id` | INTEGER FK | → lesson_enrollments.id |
| `student_id` | INTEGER FK | → student_profiles.id |
| `teacher_id` | INTEGER FK | → teacher_profiles.id |
| `total_sessions` | INTEGER | 해당월 총 수업 횟수 |
| `completed_sessions` | INTEGER | 완료된 수업 횟수 |
| `billing_unit` | TEXT | `'monthly'` / `'per_session'` |
| `base_amount` | INTEGER | 기준 금액 |
| `special_amount` | INTEGER | 특별결제 금액 (임의 조정 시) |
| `refund_amount` | INTEGER | 환불 금액 |
| `final_amount` | INTEGER | 최종 청구 금액 (base + special - refund) |
| `commission_rate` | REAL | 이 달 적용된 수수료율 스냅샷 |
| `trial_fee` | INTEGER | 시범수업 금액 |
| `payment_tag` | TEXT | `'first_month'` / `'regular'` / `'special'` / `'long_term'` / `'termination'` |
| `memo` | TEXT | 관리자 메모 |

> **payment_tag 설명:**
> - `first_month`: 수업 시작 첫달 (일할 계산 적용)
> - `regular`: 정기 결제
> - `special`: 특별결제 (임의 금액 변경)
> - `long_term`: 6개월↑ 지속으로 수수료율 변경된 달
> - `termination`: 해지월 (환불 계산 적용)

---

### 7. commission_rate_history
수수료율이 변경될 때마다 기록. 6개월 이상 수업 지속 시 단계적 인상 (60% → 65% → 70%).

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INTEGER PK | 자동증가 |
| `enrollment_id` | INTEGER FK | → lesson_enrollments.id |
| `previous_rate` | REAL | 변경 전 수수료율 |
| `new_rate` | REAL | 변경 후 수수료율 |
| `changed_month` | TEXT | 변경 적용 월 (예: `'2026-07'`) |
| `reason` | TEXT | 변경 사유 |
| `created_at` | TEXT | 기록 생성일시 |

---

### 8. settlements ⭐ 핵심 테이블
선생님에게 지급하는 월별 정산 내역. 매월 10일 지급.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INTEGER PK | 자동증가 |
| `billing_month` | TEXT | 정산 월 (예: `'2026-04'`) |
| `teacher_id` | INTEGER FK | → teacher_profiles.id |
| `settlement_type` | TEXT | `'monthly'` / `'per_session'` |
| `gross_amount` | INTEGER | 총 수업료 (D) |
| `trial_fee` | INTEGER | 시범수업 금액 (F) |
| `commission_rate` | REAL | 적용된 수수료율 스냅샷 |
| `pre_tax_amount` | INTEGER | 세전 정산금액 (G = D × rate% + F) |
| `withholding_rate` | REAL | 원천징수율 (기본 3.3%) |
| `withholding_amount` | INTEGER | 원천징수 금액 |
| `net_amount` | INTEGER | **세후 정산금액** (G × 96.7%) |
| `status` | TEXT | `'pending'` / `'paid'` |
| `settled_at` | TEXT | 실제 지급일 |

#### 정산 계산 공식
```
세전 정산금액 = 총수업료 × 수수료율% + 시범수업금액
원천징수액   = 세전 × 3.3%
세후 정산금액 = 세전 × 96.7%
```

#### 월별 정산 요약 쿼리
```sql
SELECT
  u.name AS 선생님,
  s.billing_month,
  s.settlement_type,
  s.gross_amount AS 총수업료,
  s.pre_tax_amount AS 세전정산,
  s.net_amount AS 세후정산,
  s.status,
  s.settled_at AS 지급일
FROM settlements s
JOIN teacher_profiles tp ON s.teacher_id = tp.id
JOIN users u ON tp.user_id = u.id
WHERE s.billing_month = '2026-04'
ORDER BY s.net_amount DESC;
```

---

### 9. refund_requests
환불 신청 및 처리 내역.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INTEGER PK | 자동증가 |
| `enrollment_id` | INTEGER FK | → lesson_enrollments.id |
| `student_id` | INTEGER FK | → student_profiles.id |
| `billing_month` | TEXT | 환불 대상 월 |
| `reason_type` | TEXT | `'before_start'` / `'student_fault'` / `'company_fault'` |
| `reason_detail` | TEXT | 상세 사유 |
| `total_sessions` | INTEGER | 해당월 총 수업 횟수 |
| `completed_sessions` | INTEGER | 완료된 수업 횟수 |
| `progress_rate` | REAL | 진도율 (completed / total) |
| `paid_amount` | INTEGER | 원래 납부 금액 |
| `refund_rate` | REAL | 적용된 환불율 (100 / 66.67 / 50 / 0) |
| `refund_amount` | INTEGER | 실제 환불 금액 |
| `status` | TEXT | `'pending'` → `'reviewing'` → `'approved'` → `'completed'` |
| `requested_at` | TEXT | 신청일시 |
| `approved_at` | TEXT | 승인일시 |
| `completed_at` | TEXT | 처리 완료일시 (평균 5영업일) |

#### 환불율 계산 기준 (제7조)
| 조건 | 환불율 |
|------|--------|
| 수업 시작 전 | 100% |
| 회사 귀책 | 100% |
| 진도율 < 33.3% | 66.67% |
| 33.3% ≤ 진도율 < 50% | 50% |
| 진도율 ≥ 50% | 0% (환불 불가) |

---

## 테이블 관계도

```
users (role: teacher/student)
  │
  ├── teacher_profiles (1:1)
  │       │
  │       └── lesson_enrollments (N) ──── products
  │                │
  │                ├── monthly_payment_records
  │                ├── commission_rate_history
  │                └── refund_requests
  │
  └── student_profiles (1:1)
          │
          └── lesson_enrollments (N)
```

---

## 자주 쓰는 쿼리 모음

### 대시보드용

```sql
-- 현재 수업 중인 학생 수
SELECT COUNT(*) FROM lesson_enrollments
WHERE start_date IS NOT NULL AND cancelled_at IS NULL;

-- 등록된 선생님 수 (활성)
SELECT COUNT(*) FROM teacher_profiles WHERE status = 'active';

-- 이번달 총 매출 (학생 납부 기준)
SELECT SUM(final_amount) FROM monthly_payment_records
WHERE billing_month = '2026-04';

-- 직전달 대비 매출 증감
SELECT
  curr.billing_month,
  curr.total AS 이번달,
  prev.total AS 지난달,
  curr.total - prev.total AS 증감
FROM
  (SELECT billing_month, SUM(final_amount) AS total
   FROM monthly_payment_records WHERE billing_month = '2026-04') curr,
  (SELECT billing_month, SUM(final_amount) AS total
   FROM monthly_payment_records WHERE billing_month = '2026-03') prev;

-- 선생님별 이번달 미정산 건수
SELECT u.name, COUNT(*) AS 미정산
FROM settlements s
JOIN teacher_profiles tp ON s.teacher_id = tp.id
JOIN users u ON tp.user_id = u.id
WHERE s.billing_month = '2026-04' AND s.status = 'pending'
GROUP BY s.teacher_id;
```

### 정산 계산용

```sql
-- 특정 월 선생님 정산 전체 (월별 + 회당 합산)
SELECT
  u.name AS 선생님,
  SUM(s.gross_amount) AS 총수업료,
  SUM(s.trial_fee) AS 시범수업,
  SUM(s.pre_tax_amount) AS 세전정산,
  SUM(s.net_amount) AS 세후정산
FROM settlements s
JOIN teacher_profiles tp ON s.teacher_id = tp.id
JOIN users u ON tp.user_id = u.id
WHERE s.billing_month = '2026-04'
GROUP BY s.teacher_id
ORDER BY SUM(s.net_amount) DESC;
```

---

## 주요 비즈니스 규칙 요약

| 규칙 | 내용 |
|------|------|
| 수업 상태 판별 | `start_date IS NULL` → trial, NOT NULL → active, `cancelled_at` NOT NULL → cancelled |
| 수수료율 | 수업(계약)마다 다름. 6개월↑ 지속 시 60% → 65% → 70% 단계적 인상 |
| 원천징수 | 정산금액의 3.3% 차감 (세후 = 세전 × 96.7%) |
| 시범수업 | 학생 무료, 선생님에게만 수수료 적용. 앞으로는 회당 결제만 |
| 첫달 결제 | 시작일 기준 일할 계산 (`first_month_ratio` 적용) |
| 환불 기준 | 진도율 기반 (제7조). 50% 이상 경과 시 환불 불가 |
| 정산일 | 매월 10일 |
