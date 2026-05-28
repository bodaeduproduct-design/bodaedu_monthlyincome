import { useCallback, useEffect, useState } from 'react'

const TRIAL_FEE = 10000

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  })
  if (!response.ok) {
    let detail = '요청 처리 중 오류가 발생했습니다.'
    try {
      const data = await response.json()
      detail = data.detail ?? detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  return response.json()
}

const EMPTY_USER = {
  role: 'student',
  name: '',
  email: '',
  phone: '',
  region: '',
  grade_level: 'middle',
  parent_name: '',
  parent_phone: '',
  birth_date: '',
  gender: '',
  education: '',
  major: '',
  status: 'active',
}

const EMPTY_SUB = {
  student_id: '',
  teacher_id: '',
  product_id: '',
  trial_date: '',
  trial_month: '',
  payment_method: 'card',
  price_type: '',
  day_1: '',
  day_2: '',
  day_3: '',
  base_commission_rate: '60',
  current_commission_rate: '60',
  start_date: '',
}

function FormSection({ title, description, children }) {
  return (
    <section className="register-section">
      <header className="register-section__header">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="register-section__body">{children}</div>
    </section>
  )
}

function Field({ label, hint, children, required }) {
  return (
    <label className="register-field">
      <span>
        {label}
        {required ? <em className="register-required">*</em> : null}
      </span>
      {hint ? <small>{hint}</small> : null}
      {children}
    </label>
  )
}

export default function DataRegisterView({ onRegistered, selectedMonth }) {
  const [options, setOptions] = useState(null)
  const [activeTab, setActiveTab] = useState('user')
  const [userForm, setUserForm] = useState(EMPTY_USER)
  const [subForm, setSubForm] = useState(EMPTY_SUB)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastResult, setLastResult] = useState(null)
  const [teacherStatusUpdatingId, setTeacherStatusUpdatingId] = useState(null)
  const [teacherEmailUpdatingId, setTeacherEmailUpdatingId] = useState(null)
  const [teacherEmailDrafts, setTeacherEmailDrafts] = useState({})

  const loadOptions = useCallback(async () => {
    const data = await apiRequest('/api/register/options')
    setOptions(data)
  }, [])

  useEffect(() => {
    loadOptions().catch((e) => setError(e.message))
  }, [loadOptions])

  useEffect(() => {
    const drafts = {}
    for (const teacher of options?.teachers ?? []) {
      drafts[teacher.id] = teacher.email ?? ''
    }
    setTeacherEmailDrafts(drafts)
  }, [options])

  const selectedProduct = options?.products?.find((p) => String(p.id) === String(subForm.product_id))

  const handleUserSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const result = await apiRequest('/api/register/user', {
        method: 'POST',
        body: JSON.stringify(userForm),
      })
      setLastResult(result)
      const profileHint =
        result.role === 'student'
          ? `학생 프로필 ID ${result.student_profile_id}`
          : `선생님 프로필 ID ${result.teacher_profile_id}`
      setNotice(`「${result.name}」 사용자를 등록했습니다. (${profileHint})`)
      setUserForm(EMPTY_USER)
      await loadOptions()
      onRegistered?.()
      if (result.role === 'student' && result.student_profile_id) {
        setSubForm((current) => ({ ...current, student_id: String(result.student_profile_id) }))
        setActiveTab('enrollment')
      }
      if (result.role === 'teacher' && result.teacher_profile_id) {
        setSubForm((current) => ({ ...current, teacher_id: String(result.teacher_profile_id) }))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSubSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const payload = {
        ...subForm,
        student_id: Number(subForm.student_id),
        teacher_id: Number(subForm.teacher_id),
        product_id: Number(subForm.product_id),
        day_1: subForm.day_1 === '' ? null : Number(subForm.day_1),
        day_2: subForm.day_2 === '' ? null : Number(subForm.day_2),
        day_3: subForm.day_3 === '' ? null : Number(subForm.day_3),
        base_commission_rate: Number(subForm.base_commission_rate || 60),
        current_commission_rate: Number(subForm.current_commission_rate || subForm.base_commission_rate || 60),
        start_date: subForm.start_date || null,
        trial_date: subForm.trial_date || null,
        trial_month: subForm.trial_month || null,
      }
      const result = await apiRequest('/api/register/enrollment', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setLastResult(result)
      setNotice(
        `수업 #${result.enrollment_id} 등록 완료 · ${result.student_name} ↔ ${result.teacher_name} · 수업월 ${result.trial_month ?? '-'} · 시범비 ${result.trial_fee?.toLocaleString('ko-KR')}원 · 선생님 정산 자동 반영`,
      )
      setSubForm(EMPTY_SUB)
      await loadOptions()
      onRegistered?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleTeacherStatusChange = async (teacherId, status) => {
    setLoading(true)
    setTeacherStatusUpdatingId(teacherId)
    setError('')
    setNotice('')
    try {
      await apiRequest(`/api/teachers/${teacherId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          changed_month: selectedMonth || null,
        }),
      })
      setNotice('선생님 상태를 변경했습니다.')
      await loadOptions()
      onRegistered?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setTeacherStatusUpdatingId(null)
      setLoading(false)
    }
  }

  const handleTeacherEmailSave = async (teacherId) => {
    setLoading(true)
    setTeacherEmailUpdatingId(teacherId)
    setError('')
    setNotice('')
    try {
      await apiRequest(`/api/teachers/${teacherId}/email`, {
        method: 'PATCH',
        body: JSON.stringify({
          email: teacherEmailDrafts[teacherId] ?? '',
        }),
      })
      setNotice('선생님 이메일을 저장했습니다.')
      await loadOptions()
      onRegistered?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setTeacherEmailUpdatingId(null)
      setLoading(false)
    }
  }

  return (
    <div className="data-register">
      <div className="register-tabs">
        <button
          type="button"
          className={activeTab === 'user' ? 'register-tab active' : 'register-tab'}
          onClick={() => setActiveTab('user')}
        >
          사용자 등록
        </button>
        <button
          type="button"
          className={activeTab === 'enrollment' ? 'register-tab active' : 'register-tab'}
          onClick={() => setActiveTab('enrollment')}
        >
          수업 · 시범
        </button>
        <button
          type="button"
          className={activeTab === 'teacher-status' ? 'register-tab active' : 'register-tab'}
          onClick={() => setActiveTab('teacher-status')}
        >
          선생님 상태 변경
        </button>
      </div>

      {notice ? <div className="banner success">{notice}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}

      {activeTab === 'user' ? (
        <form className="register-form" onSubmit={handleUserSubmit}>
          <FormSection title="계정" description="users 테이블 + 역할별 프로필이 동시에 생성됩니다.">
            <div className="register-grid">
              <Field label="역할" required>
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                >
                  <option value="student">학생</option>
                  <option value="teacher">선생님</option>
                </select>
              </Field>
              <Field label="이름" required>
                <input
                  value={userForm.name}
                  onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                  placeholder="홍길동"
                  required
                />
              </Field>
              <Field label="이메일">
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  placeholder="선택"
                />
              </Field>
              <Field label="연락처">
                <input value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} />
              </Field>
            </div>
          </FormSection>

          {userForm.role === 'student' ? (
            <FormSection title="학생 프로필" description="student_profiles">
              <div className="register-grid">
                <Field label="학년">
                  <select
                    value={userForm.grade_level}
                    onChange={(e) => setUserForm({ ...userForm, grade_level: e.target.value })}
                  >
                    <option value="elementary">초등</option>
                    <option value="middle">중등</option>
                    <option value="high">고등</option>
                  </select>
                </Field>
                <Field label="지역">
                  <input value={userForm.region} onChange={(e) => setUserForm({ ...userForm, region: e.target.value })} />
                </Field>
                <Field label="학부모 이름">
                  <input
                    value={userForm.parent_name}
                    onChange={(e) => setUserForm({ ...userForm, parent_name: e.target.value })}
                  />
                </Field>
                <Field label="학부모 연락처">
                  <input
                    value={userForm.parent_phone}
                    onChange={(e) => setUserForm({ ...userForm, parent_phone: e.target.value })}
                  />
                </Field>
              </div>
            </FormSection>
          ) : (
            <FormSection title="선생님 프로필" description="teacher_profiles">
              <div className="register-grid">
                <Field label="상태">
                  <select value={userForm.status} onChange={(e) => setUserForm({ ...userForm, status: e.target.value })}>
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </Field>
                <Field label="생년월일">
                  <input
                    type="date"
                    value={userForm.birth_date}
                    onChange={(e) => setUserForm({ ...userForm, birth_date: e.target.value })}
                  />
                </Field>
                <Field label="성별">
                  <select value={userForm.gender} onChange={(e) => setUserForm({ ...userForm, gender: e.target.value })}>
                    <option value="">-</option>
                    <option value="male">male</option>
                    <option value="female">female</option>
                  </select>
                </Field>
                <Field label="학력">
                  <input
                    value={userForm.education}
                    onChange={(e) => setUserForm({ ...userForm, education: e.target.value })}
                  />
                </Field>
                <Field label="전공">
                  <input value={userForm.major} onChange={(e) => setUserForm({ ...userForm, major: e.target.value })} />
                </Field>
              </div>
            </FormSection>
          )}

          <div className="register-actions">
            <button type="submit" className="primary-button" disabled={loading}>
              {loading ? '저장 중...' : '사용자 등록'}
            </button>
          </div>
        </form>
      ) : activeTab === 'enrollment' ? (
        <form className="register-form" onSubmit={handleSubSubmit}>
          <FormSection title="수업 연결" description="lesson_enrollments · 학생과 선생님을 상품으로 연결합니다.">
            <div className="register-grid">
              <Field label="학생" required>
                <select
                  value={subForm.student_id}
                  onChange={(e) => setSubForm({ ...subForm, student_id: e.target.value })}
                  required
                >
                  <option value="">선택</option>
                  {(options?.students ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (학생#{s.id})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="선생님" required>
                <select
                  value={subForm.teacher_id}
                  onChange={(e) => setSubForm({ ...subForm, teacher_id: e.target.value })}
                  required
                >
                  <option value="">선택</option>
                  {(options?.teachers ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (선생님#{t.id})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="상품" required>
                <select
                  value={subForm.product_id}
                  onChange={(e) => setSubForm({ ...subForm, product_id: e.target.value })}
                  required
                >
                  <option value="">선택</option>
                  {(options?.products ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.billing_unit === 'per_session' ? '회당' : '월별'})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="결제 수단">
                <select
                  value={subForm.payment_method}
                  onChange={(e) => setSubForm({ ...subForm, payment_method: e.target.value })}
                >
                  <option value="card">card</option>
                  <option value="transfer">transfer</option>
                  <option value="payer">payer</option>
                  <option value="cms">cms</option>
                </select>
              </Field>
              <Field label="가격 유형" hint={selectedProduct ? `상품 기본: ${selectedProduct.billing_unit}` : ''}>
                <select
                  value={subForm.price_type}
                  onChange={(e) => setSubForm({ ...subForm, price_type: e.target.value })}
                >
                  <option value="">자동</option>
                  <option value="price_17">price_17 (월별)</option>
                  <option value="price_35">price_35 (월별)</option>
                  <option value="per_session">per_session (회당)</option>
                </select>
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="시범수업"
            description="수업월 기준으로 선생님 정산(settlements)이 자동 반영됩니다 (시범비는 월별 수납에 넣지 않음)"
          >
            <div className="register-grid">
              <Field label="시범수업일" required hint="입력하면 시범 단계 수업으로 등록됩니다 (start_date 비움)">
                <input
                  type="date"
                  value={subForm.trial_date}
                  onChange={(e) => {
                    const trialDate = e.target.value
                    const trialMonth = trialDate && trialDate.length >= 7 ? trialDate.slice(0, 7) : ''
                    setSubForm({ ...subForm, trial_date: trialDate, trial_month: trialMonth })
                  }}
                />
              </Field>
              <Field label="수업월" required hint="YYYY-MM · 시범일에서 자동 채워지며 수정 가능">
                <input
                  type="month"
                  value={subForm.trial_month}
                  onChange={(e) => setSubForm({ ...subForm, trial_month: e.target.value })}
                  required
                />
              </Field>
              <Field label="시범수업비">
                <input type="text" value={`${TRIAL_FEE.toLocaleString('ko-KR')}원 (자동)`} disabled readOnly />
              </Field>
              <Field label="본수업 시작일" hint="시범만 등록 시 비워두세요">
                <input
                  type="date"
                  value={subForm.start_date}
                  onChange={(e) => setSubForm({ ...subForm, start_date: e.target.value })}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="수업 요일 · 수수료" description="선택 입력">
            <div className="register-grid">
              <Field label="요일1 (0=일)">
                <input
                  type="number"
                  min="0"
                  max="6"
                  value={subForm.day_1}
                  onChange={(e) => setSubForm({ ...subForm, day_1: e.target.value })}
                />
              </Field>
              <Field label="요일2">
                <input
                  type="number"
                  min="0"
                  max="6"
                  value={subForm.day_2}
                  onChange={(e) => setSubForm({ ...subForm, day_2: e.target.value })}
                />
              </Field>
              <Field label="요일3">
                <input
                  type="number"
                  min="0"
                  max="6"
                  value={subForm.day_3}
                  onChange={(e) => setSubForm({ ...subForm, day_3: e.target.value })}
                />
              </Field>
              <Field label="기본 수수료율(%)">
                <input
                  type="number"
                  step="0.1"
                  value={subForm.base_commission_rate}
                  onChange={(e) => setSubForm({ ...subForm, base_commission_rate: e.target.value })}
                />
              </Field>
              <Field label="현재 수수료율(%)">
                <input
                  type="number"
                  step="0.1"
                  value={subForm.current_commission_rate}
                  onChange={(e) => setSubForm({ ...subForm, current_commission_rate: e.target.value })}
                />
              </Field>
            </div>
          </FormSection>

          <div className="register-actions">
            <button type="submit" className="primary-button" disabled={loading}>
              {loading ? '저장 중...' : '수업 등록'}
            </button>
          </div>
        </form>
      ) : (
        <section className="register-form">
          <FormSection
            title="선생님 상태 변경"
            description="정산 탭이 아니라 데이터 등록에서 선생님 active/종료 상태를 관리합니다."
          >
            <div className="table-wrap settlement-overview-wrap">
              <table className="settlement-overview-table">
                <thead>
                  <tr>
                    <th>선생님</th>
                    <th>이메일</th>
                    <th>현재 상태</th>
                    <th>변경</th>
                  </tr>
                </thead>
                <tbody>
                  {(options?.teachers ?? []).map((teacher) => (
                    <tr key={teacher.id}>
                      <td>
                        <strong>{teacher.name}</strong>
                      </td>
                      <td>{teacher.status ?? 'active'}</td>
                      <td>
                        <div className="teacher-email-edit">
                          <input
                            type="email"
                            value={teacherEmailDrafts[teacher.id] ?? ''}
                            onChange={(e) =>
                              setTeacherEmailDrafts((prev) => ({
                                ...prev,
                                [teacher.id]: e.target.value,
                              }))
                            }
                            placeholder="teacher@example.com"
                            disabled={loading && teacherEmailUpdatingId === teacher.id}
                          />
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => handleTeacherEmailSave(teacher.id)}
                            disabled={loading && teacherEmailUpdatingId === teacher.id}
                          >
                            저장
                          </button>
                        </div>
                      </td>
                      <td>
                        <select
                          value={teacher.status ?? 'active'}
                          onChange={(e) => handleTeacherStatusChange(teacher.id, e.target.value)}
                          disabled={loading && teacherStatusUpdatingId === teacher.id}
                        >
                          <option value="active">active</option>
                          <option value="ended">종료</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                  {(options?.teachers ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="students-table-empty">
                        등록된 선생님이 없습니다.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </FormSection>
        </section>
      )}

      {lastResult?.enrollment_id || lastResult?.user_id ? (
        <aside className="register-result">
          <h4>최근 등록</h4>
          {lastResult.enrollment_id ? (
            <p>
              수업 #{lastResult.enrollment_id} · {lastResult.student_name} ↔ {lastResult.teacher_name} ·{' '}
              {lastResult.product_name}
            </p>
          ) : (
            <p>
              사용자 #{lastResult.user_id} · {lastResult.name} ({lastResult.role === 'teacher' ? '선생님' : '학생'})
            </p>
          )}
        </aside>
      ) : null}
    </div>
  )
}
