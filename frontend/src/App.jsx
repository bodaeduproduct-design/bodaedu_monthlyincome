import { useEffect, useMemo, useState } from 'react'
import DataAdminView from './DataAdminView.jsx'
import DataOverviewView from './DataOverviewView.jsx'
import DbSchemaView from './DbSchemaView.jsx'
import './App.css'

const NAV_ITEMS = [
  { id: 'dashboard', label: '대시보드' },
  { id: 'teacher-settlements', label: '선생님 정산' },
  { id: 'students', label: '학생 수납' },
  { id: 'catalogs', label: '상품 / 단가표' },
  { id: 'data-model', label: '데이터 구조' },
  { id: 'data-overview', label: 'DB 전체보기' },
  { id: 'data-admin', label: '데이터 관리' },
]

const currencyFormatter = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
})

function formatCurrency(value) {
  return currencyFormatter.format(value ?? 0)
}

function formatMonth(value) {
  if (!value) return '-'
  const [y, m] = String(value).split('-')
  return `${y}년 ${m}월`
}

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
  if (response.status === 204) return null
  return response.json()
}

function SectionCard({ title, description, actions, children }) {
  return (
    <section className="section-card">
      <header className="section-card__header">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="section-card__actions">{actions}</div> : null}
      </header>
      <div className="section-card__body">{children}</div>
    </section>
  )
}

function DetailModal({ title, onClose, children }) {
  if (!children) return null
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-sheet">
        <header className="modal-sheet__header">
          <h3>{title}</h3>
          <button type="button" className="secondary-button" onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="modal-sheet__body">{children}</div>
      </div>
    </div>
  )
}

export default function App() {
  const [selectedPage, setSelectedPage] = useState('dashboard')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [dataAdminTable, setDataAdminTable] = useState(null)

  const [appData, setAppData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const months = appData?.meta?.available_months ?? []

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await apiRequest('/api/app-data')
        if (!cancelled) {
          setAppData(res)
          setSelectedMonth((current) => current || res?.meta?.latest_month || '')
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const pageTitle = NAV_ITEMS.find((item) => item.id === selectedPage)?.label ?? '정산 관리'
  const pageDescription =
    selectedPage === 'dashboard'
      ? '월별 총매출, 월별결제/회당결제, 순수익(지급액), 결제수단 분포, 매출 추이를 확인합니다.'
      : selectedPage === 'teacher-settlements'
        ? '선생님별로 해당 월에 지급해야 할 금액을 한눈에 보고, 클릭하면 상세를 확인합니다.'
        : selectedPage === 'students'
          ? '학생별 구독(상품/담당/결제수단)과 수납 관리 정보를 확인합니다.'
          : selectedPage === 'catalogs'
            ? '상품(단가/월별)을 확인합니다.'
            : selectedPage === 'data-model'
              ? 'boda DB 구조(ER/테이블 사전)를 확인합니다.'
              : selectedPage === 'data-overview'
                ? '테이블별 전체 행을 한 페이지에서 확인합니다.'
                : selectedPage === 'data-admin'
                  ? '테이블별 데이터를 직접 수정합니다.'
                  : ''

  const renderDashboard = () => {
    const dash = appData?.dashboard
    if (!dash) return <div className="empty-state">대시보드 데이터를 불러오지 못했습니다.</div>

    const trend = dash.revenue_trend ?? []

    return (
      <>
        <div className="dashboard-grid">
          <SectionCard title="요약" description="선택 월 기준 핵심 지표입니다.">
            <div className="metric-list">
              <div className="metric-item">
                <span>총매출</span>
                <strong>{formatCurrency(dash.latest_gross_amount)}</strong>
              </div>
              <div className="metric-item">
                <span>월별결제 매출</span>
                <strong>{formatCurrency(dash.latest_monthly_gross_amount)}</strong>
              </div>
              <div className="metric-item">
                <span>회당결제 매출</span>
                <strong>{formatCurrency(dash.latest_per_session_gross_amount)}</strong>
              </div>
              <div className="metric-item">
                <span>순수익(지급액)</span>
                <strong>{formatCurrency(dash.latest_net_profit)}</strong>
              </div>
              <div className="metric-item">
                <span>시범수업비 정산</span>
                <strong>{formatCurrency(dash.latest_trial_fee)}</strong>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="결제 수단 분포" description="subscriptions.payment_method 기준(임시).">
            <div className="metric-list">
              {(dash.payment_method_summary ?? []).map((row) => (
                <div className="metric-item" key={row.payment_method}>
                  <span>{row.payment_method}</span>
                  <strong>{row.count}건</strong>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="매출 추이" description="월별 총매출/월별결제/회당결제/순수익 추이입니다.">
          {trend.length === 0 ? (
            <div className="empty-state compact">추이 데이터가 없습니다.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>월</th>
                    <th>총매출</th>
                    <th>월별결제</th>
                    <th>회당결제</th>
                    <th>순수익(지급액)</th>
                    <th>시범수업비</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((row) => (
                    <tr key={row.month}>
                      <td>{formatMonth(row.month)}</td>
                      <td>{formatCurrency(row.gross_amount)}</td>
                      <td>{formatCurrency(row.monthly_gross_amount)}</td>
                      <td>{formatCurrency(row.per_session_gross_amount)}</td>
                      <td>{formatCurrency(row.net_profit)}</td>
                      <td>{formatCurrency(row.trial_fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </>
    )
  }

  const [teacherRows, setTeacherRows] = useState([])
  const [teacherLoading, setTeacherLoading] = useState(false)
  const [teacherError, setTeacherError] = useState('')
  const [teacherDetail, setTeacherDetail] = useState(null)

  useEffect(() => {
    if (selectedPage !== 'teacher-settlements' || !selectedMonth) return
    let cancelled = false
    const load = async () => {
      setTeacherLoading(true)
      setTeacherError('')
      try {
        const res = await apiRequest(`/api/teachers/settlements?month=${encodeURIComponent(selectedMonth)}`)
        if (!cancelled) setTeacherRows(res.items ?? [])
      } catch (e) {
        if (!cancelled) setTeacherError(e.message)
      } finally {
        if (!cancelled) setTeacherLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedMonth])

  const teacherTotals = useMemo(() => {
    return (teacherRows ?? []).reduce(
      (acc, row) => ({
        gross_amount: acc.gross_amount + (row.gross_amount ?? 0),
        trial_fee: acc.trial_fee + (row.trial_fee ?? 0),
        net_amount: acc.net_amount + (row.net_amount ?? 0),
      }),
      { gross_amount: 0, trial_fee: 0, net_amount: 0 },
    )
  }, [teacherRows])

  const renderTeacherSettlements = () => (
    <>
      <SectionCard
        title="선생님별 정산"
        description="선택 월에 선생님에게 지급해야 할 금액(순수익)을 한눈에 봅니다."
        actions={<span className="summary-chip">지급 합계 {formatCurrency(teacherTotals.net_amount)}</span>}
      >
        {teacherError ? <div className="banner error">{teacherError}</div> : null}
        {teacherLoading ? (
          <div className="empty-state compact">불러오는 중...</div>
        ) : teacherRows.length === 0 ? (
          <div className="empty-state compact">정산 데이터가 없습니다.</div>
        ) : (
          <div className="table-wrap settlement-overview-wrap">
            <table className="settlement-overview-table">
              <thead>
                <tr>
                  <th>선생님</th>
                  <th>정산 구분</th>
                  <th>총매출</th>
                  <th>시범수업비</th>
                  <th>지급액(순수익)</th>
                </tr>
              </thead>
              <tbody>
                {teacherRows.map((row, idx) => (
                  <tr key={`${row.teacher_id}-${row.settlement_type}-${idx}`}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={async () => {
                          const detail = await apiRequest(
                            `/api/teachers/${row.teacher_id}/settlements/${encodeURIComponent(row.billing_month)}`,
                          )
                          setTeacherDetail(detail)
                        }}
                      >
                        {row.teacher_name}
                      </button>
                      <small className="table-sub">정산월 {row.billing_month}</small>
                    </td>
                    <td>{row.settlement_type === 'per_session' ? '회당' : '월별'}</td>
                    <td>{formatCurrency(row.gross_amount)}</td>
                    <td>{formatCurrency(row.trial_fee)}</td>
                    <td>{formatCurrency(row.net_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <DetailModal
        title={teacherDetail ? `${teacherDetail.teacher_name} · ${teacherDetail.billing_month}` : ''}
        onClose={() => setTeacherDetail(null)}
      >
        {teacherDetail ? (
          <SectionCard title="정산 요약">
            <div className="metric-list">
              {(teacherDetail.settlement_summary ?? []).map((row) => (
                <div className="metric-item" key={row.settlement_type}>
                  <span>{row.settlement_type === 'per_session' ? '회당' : '월별'}</span>
                  <strong>{formatCurrency(row.net_amount)}</strong>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : null}
      </DetailModal>
    </>
  )

  const [students, setStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [studentsError, setStudentsError] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [studentDetail, setStudentDetail] = useState(null)
  const [studentDetailLoading, setStudentDetailLoading] = useState(false)

  useEffect(() => {
    if (selectedPage !== 'students') return
    let cancelled = false
    const load = async () => {
      setStudentsLoading(true)
      setStudentsError('')
      try {
        const res = await apiRequest('/api/students')
        if (!cancelled) {
          setStudents(res.items ?? [])
          setSelectedStudentId((current) => current ?? (res.items?.[0]?.student_id ?? null))
        }
      } catch (e) {
        if (!cancelled) setStudentsError(e.message)
      } finally {
        if (!cancelled) setStudentsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage])

  useEffect(() => {
    if (selectedPage !== 'students' || selectedStudentId === null) return
    let cancelled = false
    const load = async () => {
      setStudentDetailLoading(true)
      try {
        const res = await apiRequest(`/api/students/${selectedStudentId}`)
        if (!cancelled) setStudentDetail(res)
      } finally {
        if (!cancelled) setStudentDetailLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedStudentId])

  const renderStudents = () => (
    <div className="students-layout">
      <SectionCard title="학생 목록" description="학생별 구독(상품/담당/결제수단)을 확인합니다.">
        {studentsError ? <div className="banner error">{studentsError}</div> : null}
        {studentsLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
        <div className="student-list">
          {students.map((student) => (
            <button
              key={student.student_id}
              type="button"
              className={student.student_id === selectedStudentId ? 'student-list-item active' : 'student-list-item'}
              onClick={() => setSelectedStudentId(student.student_id)}
            >
              <div>
                <strong>{student.student_name}</strong>
              </div>
              <div className="student-list-item__meta">
                <span>{student.grade_level || '-'}</span>
                <span>구독 {student.subscription_count ?? 0}건</span>
              </div>
            </button>
          ))}
        </div>
      </SectionCard>

      <div className="student-detail">
        <SectionCard title={studentDetail ? studentDetail.student_name : '학생 상세'} description="구독 정보를 표시합니다.">
          {studentDetailLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
          {studentDetail ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>담당 선생님</th>
                    <th>상품</th>
                    <th>결제수단</th>
                    <th>수수료율</th>
                    <th>시작</th>
                    <th>종료</th>
                    <th>다음 청구</th>
                  </tr>
                </thead>
                <tbody>
                  {(studentDetail.subscriptions ?? []).map((sub) => (
                    <tr key={sub.subscription_id}>
                      <td>{sub.teacher_name || '-'}</td>
                      <td>{sub.product_name || '-'}</td>
                      <td>{sub.payment_method || '-'}</td>
                      <td>{sub.commission_rate ? `${sub.commission_rate}%` : '-'}</td>
                      <td>{sub.start_date || '-'}</td>
                      <td>{sub.end_date || '-'}</td>
                      <td>{sub.next_billing || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state compact">학생을 선택하세요.</div>
          )}
        </SectionCard>
      </div>
    </div>
  )

  const renderCatalogs = () => (
    <SectionCard title="상품 / 단가표" description="products 테이블 기준입니다.">
      {(appData?.products ?? []).length === 0 ? (
        <div className="empty-state compact">상품 데이터가 없습니다.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>상품명</th>
                <th>결제 기준</th>
                <th>정가</th>
                <th>17%</th>
                <th>35%</th>
                <th>회당</th>
              </tr>
            </thead>
            <tbody>
              {appData.products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.billing_unit === 'per_session' ? '회당' : '월별'}</td>
                  <td>{formatCurrency(p.price_standard)}</td>
                  <td>{formatCurrency(p.price_17)}</td>
                  <td>{formatCurrency(p.price_35)}</td>
                  <td>{formatCurrency(p.price_per_session)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )

  const [dataModel, setDataModel] = useState(null)
  const [dataModelLoading, setDataModelLoading] = useState(false)
  const [dataModelError, setDataModelError] = useState('')

  useEffect(() => {
    if (selectedPage !== 'data-model' || dataModelLoading || dataModel) return
    let cancelled = false
    const load = async () => {
      setDataModelLoading(true)
      setDataModelError('')
      try {
        const model = await apiRequest('/api/data-model')
        if (!cancelled) setDataModel(model)
      } catch (e) {
        if (!cancelled) setDataModelError(e.message)
      } finally {
        if (!cancelled) setDataModelLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, dataModelLoading, dataModel])

  const renderDataModel = () => {
    if (dataModelError) return <div className="banner error">{dataModelError}</div>
    if (dataModelLoading) return <div className="empty-state">불러오는 중...</div>
    if (!dataModel) return <div className="empty-state">데이터 구조 정보를 불러오지 못했습니다.</div>
    return (
      <div className="data-model-page">
        <DbSchemaView model={dataModel} />
      </div>
    )
  }

  const renderCurrentPage = () => {
    switch (selectedPage) {
      case 'dashboard':
        return renderDashboard()
      case 'teacher-settlements':
        return renderTeacherSettlements()
      case 'students':
        return renderStudents()
      case 'catalogs':
        return renderCatalogs()
      case 'data-model':
        return renderDataModel()
      case 'data-overview':
        return (
          <DataOverviewView
            onOpenAdmin={(table) => {
              setDataAdminTable(table ?? null)
              setSelectedPage('data-admin')
            }}
          />
        )
      case 'data-admin':
        return <DataAdminView initialTable={dataAdminTable} />
      default:
        return renderDashboard()
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true">
              <img src="/logo.svg" alt="" className="brand-logo" />
            </div>
            <div className="brand-text">
              <strong>보다수학</strong>
              <span>운영 · 정산 관리</span>
            </div>
          </div>

          <nav className="gnb">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === selectedPage ? 'gnb-item active' : 'gnb-item'}
                onClick={() => setSelectedPage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="page-shell">
        <section className="page-panel">
          <header className="page-panel__header">
            <div className="page-heading">
              <p className="eyebrow">{pageTitle}</p>
              <h2 className="topbar__title">{pageTitle}</h2>
              <p className="topbar__description">{pageDescription}</p>
            </div>
            {selectedPage !== 'data-model' &&
            selectedPage !== 'data-overview' &&
            selectedPage !== 'data-admin' ? (
              <div className="toolbar">
                <label className="toolbar-field">
                  <span>조회 월</span>
                  <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {formatMonth(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </header>

          {error ? <div className="banner error">{error}</div> : null}
          {loading && !appData ? <div className="empty-state">불러오는 중...</div> : renderCurrentPage()}
        </section>
      </main>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import DataAdminView from './DataAdminView.jsx'
import DataOverviewView from './DataOverviewView.jsx'
import DbSchemaView from './DbSchemaView.jsx'
import './App.css'

const NAV_ITEMS = [
  { id: 'dashboard', label: '대시보드' },
  { id: 'teacher-settlements', label: '선생님 정산' },
  { id: 'students', label: '학생 수납' },
  { id: 'catalogs', label: '상품 / 단가표' },
  { id: 'data-model', label: '데이터 구조' },
  { id: 'data-overview', label: 'DB 전체보기' },
  { id: 'data-admin', label: '데이터 관리' },
]

const currencyFormatter = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
})

function formatCurrency(value) {
  return currencyFormatter.format(value ?? 0)
}

function formatMonth(value) {
  if (!value) return '-'
  const [y, m] = String(value).split('-')
  return `${y}년 ${m}월`
}

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
  if (response.status === 204) return null
  return response.json()
}

function SectionCard({ title, description, actions, children }) {
  return (
    <section className="section-card">
      <header className="section-card__header">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="section-card__actions">{actions}</div> : null}
      </header>
      <div className="section-card__body">{children}</div>
    </section>
  )
}

function DetailModal({ title, onClose, children }) {
  if (!children) return null
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-sheet">
        <header className="modal-sheet__header">
          <h3>{title}</h3>
          <button type="button" className="secondary-button" onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="modal-sheet__body">{children}</div>
      </div>
    </div>
  )
}

export default function App() {
  const [selectedPage, setSelectedPage] = useState('dashboard')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [dataAdminTable, setDataAdminTable] = useState(null)

  const [appData, setAppData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const months = appData?.meta?.available_months ?? []

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await apiRequest('/api/app-data')
        if (!cancelled) {
          setAppData(res)
          setSelectedMonth((current) => current || res?.meta?.latest_month || '')
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const pageTitle = NAV_ITEMS.find((item) => item.id === selectedPage)?.label ?? '정산 관리'
  const pageDescription =
    selectedPage === 'dashboard'
      ? '월별 총매출, 월별결제/회당결제, 순수익(지급액), 결제수단 분포, 매출 추이를 확인합니다.'
      : selectedPage === 'teacher-settlements'
        ? '선생님별로 해당 월에 지급해야 할 금액을 한눈에 보고, 클릭하면 상세를 확인합니다.'
        : selectedPage === 'students'
          ? '학생별 구독(상품/담당/결제수단)과 수납 관리 정보를 확인합니다.'
          : selectedPage === 'catalogs'
            ? '상품(단가/월별)을 확인합니다.'
            : selectedPage === 'data-model'
              ? 'boda DB 구조(ER/테이블 사전)를 확인합니다.'
              : selectedPage === 'data-overview'
                ? '테이블별 전체 행을 한 페이지에서 확인합니다.'
                : selectedPage === 'data-admin'
                  ? '테이블별 데이터를 직접 수정합니다.'
                  : ''

  const renderDashboard = () => {
    const dash = appData?.dashboard
    if (!dash) return <div className="empty-state">대시보드 데이터를 불러오지 못했습니다.</div>

    const trend = dash.revenue_trend ?? []

    return (
      <>
        <div className="dashboard-grid">
          <SectionCard title="요약" description="선택 월 기준 핵심 지표입니다.">
            <div className="metric-list">
              <div className="metric-item">
                <span>총매출</span>
                <strong>{formatCurrency(dash.latest_gross_amount)}</strong>
              </div>
              <div className="metric-item">
                <span>월별결제 매출</span>
                <strong>{formatCurrency(dash.latest_monthly_gross_amount)}</strong>
              </div>
              <div className="metric-item">
                <span>회당결제 매출</span>
                <strong>{formatCurrency(dash.latest_per_session_gross_amount)}</strong>
              </div>
              <div className="metric-item">
                <span>순수익(지급액)</span>
                <strong>{formatCurrency(dash.latest_net_profit)}</strong>
              </div>
              <div className="metric-item">
                <span>시범수업비 정산</span>
                <strong>{formatCurrency(dash.latest_trial_fee)}</strong>
              </div>
              <div className="metric-item metric-item--muted">
                <span>이번달 수업 학생 수</span>
                <strong>{dash.latest_active_student_count ?? 0}명</strong>
              </div>
              <div className="metric-item metric-item--muted">
                <span>이번달 수업 선생님 수</span>
                <strong>{dash.latest_active_teacher_count ?? 0}명</strong>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="결제 수단 분포" description="subscriptions.payment_method 기준(임시).">
            <div className="metric-list">
              {(dash.payment_method_summary ?? []).map((row) => (
                <div className="metric-item" key={row.payment_method}>
                  <span>{row.payment_method}</span>
                  <strong>{row.count}건</strong>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="매출 추이" description="월별 총매출/월별결제/회당결제/순수익 추이입니다.">
          {trend.length === 0 ? (
            <div className="empty-state compact">추이 데이터가 없습니다.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>월</th>
                    <th>총매출</th>
                    <th>월별결제</th>
                    <th>회당결제</th>
                    <th>순수익(지급액)</th>
                    <th>시범수업비</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((row) => (
                    <tr key={row.month}>
                      <td>{formatMonth(row.month)}</td>
                      <td>{formatCurrency(row.gross_amount)}</td>
                      <td>{formatCurrency(row.monthly_gross_amount)}</td>
                      <td>{formatCurrency(row.per_session_gross_amount)}</td>
                      <td>{formatCurrency(row.net_profit)}</td>
                      <td>{formatCurrency(row.trial_fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </>
    )
  }

  const [teacherRows, setTeacherRows] = useState([])
  const [teacherLoading, setTeacherLoading] = useState(false)
  const [teacherError, setTeacherError] = useState('')
  const [teacherDetail, setTeacherDetail] = useState(null)

  useEffect(() => {
    if (selectedPage !== 'teacher-settlements' || !selectedMonth) return
    let cancelled = false
    const load = async () => {
      setTeacherLoading(true)
      setTeacherError('')
      try {
        const res = await apiRequest(`/api/teachers/settlements?month=${encodeURIComponent(selectedMonth)}`)
        if (!cancelled) setTeacherRows(res.items ?? [])
      } catch (e) {
        if (!cancelled) setTeacherError(e.message)
      } finally {
        if (!cancelled) setTeacherLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedMonth])

  const teacherTotals = useMemo(() => {
    return (teacherRows ?? []).reduce(
      (acc, row) => ({
        gross_amount: acc.gross_amount + (row.gross_amount ?? 0),
        trial_fee: acc.trial_fee + (row.trial_fee ?? 0),
        net_amount: acc.net_amount + (row.net_amount ?? 0),
      }),
      { gross_amount: 0, trial_fee: 0, net_amount: 0 },
    )
  }, [teacherRows])

  const renderTeacherSettlements = () => (
    <>
      <SectionCard
        title="선생님별 정산"
        description="선택 월에 선생님에게 지급해야 할 금액(순수익)을 한눈에 봅니다."
        actions={<span className="summary-chip">지급 합계 {formatCurrency(teacherTotals.net_amount)}</span>}
      >
        {teacherError ? <div className="banner error">{teacherError}</div> : null}
        {teacherLoading ? (
          <div className="empty-state compact">불러오는 중...</div>
        ) : teacherRows.length === 0 ? (
          <div className="empty-state compact">정산 데이터가 없습니다.</div>
        ) : (
          <div className="table-wrap settlement-overview-wrap">
            <table className="settlement-overview-table">
              <thead>
                <tr>
                  <th>선생님</th>
                  <th>정산 구분</th>
                  <th>총매출</th>
                  <th>시범수업비</th>
                  <th>지급액(순수익)</th>
                </tr>
              </thead>
              <tbody>
                {teacherRows.map((row, idx) => (
                  <tr key={`${row.teacher_id}-${row.settlement_type}-${idx}`}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={async () => {
                          const detail = await apiRequest(
                            `/api/teachers/${row.teacher_id}/settlements/${encodeURIComponent(row.billing_month)}`,
                          )
                          setTeacherDetail(detail)
                        }}
                      >
                        {row.teacher_name}
                      </button>
                      <small className="table-sub">정산월 {row.billing_month}</small>
                    </td>
                    <td>{row.settlement_type === 'per_session' ? '회당' : '월별'}</td>
                    <td>{formatCurrency(row.gross_amount)}</td>
                    <td>{formatCurrency(row.trial_fee)}</td>
                    <td>{formatCurrency(row.net_amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>합계</td>
                  <td>-</td>
                  <td>{formatCurrency(teacherTotals.gross_amount)}</td>
                  <td>{formatCurrency(teacherTotals.trial_fee)}</td>
                  <td>{formatCurrency(teacherTotals.net_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>

      <DetailModal
        title={teacherDetail ? `${teacherDetail.teacher_name} · ${teacherDetail.billing_month}` : ''}
        onClose={() => setTeacherDetail(null)}
      >
        {teacherDetail ? (
          <>
            <SectionCard title="정산 요약">
              <div className="metric-list">
                {(teacherDetail.settlement_summary ?? []).map((row) => (
                  <div className="metric-item" key={row.settlement_type}>
                    <span>{row.settlement_type === 'per_session' ? '회당' : '월별'}</span>
                    <strong>{formatCurrency(row.net_amount)}</strong>
                  </div>
                ))}
              </div>
            </SectionCard>
            <SectionCard title="수업/수납 상세" description="monthly_lesson_records 기반(데이터가 없으면 비어있을 수 있음)">
              {(teacherDetail.lesson_records ?? []).length === 0 ? (
                <div className="empty-state compact">상세 레코드가 없습니다.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>학생</th>
                        <th>상품</th>
                        <th>구분</th>
                        <th>횟수</th>
                        <th>금액</th>
                        <th>시범</th>
                        <th>환불</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teacherDetail.lesson_records.map((r) => (
                        <tr key={r.id}>
                          <td>{r.student_name || '-'}</td>
                          <td>{r.product_name || '-'}</td>
                          <td>{r.billing_unit === 'per_session' ? '회당' : '월별'}</td>
                          <td>
                            {r.completed_sessions ?? 0}/{r.total_sessions ?? 0}
                          </td>
                          <td>{formatCurrency(r.final_amount)}</td>
                          <td>{formatCurrency(r.trial_fee)}</td>
                          <td>{formatCurrency(r.refund_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </>
        ) : null}
      </DetailModal>
    </>
  )

  const [students, setStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [studentsError, setStudentsError] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [studentDetail, setStudentDetail] = useState(null)
  const [studentDetailLoading, setStudentDetailLoading] = useState(false)

  useEffect(() => {
    if (selectedPage !== 'students') return
    let cancelled = false
    const load = async () => {
      setStudentsLoading(true)
      setStudentsError('')
      try {
        const res = await apiRequest('/api/students')
        if (!cancelled) {
          setStudents(res.items ?? [])
          setSelectedStudentId((current) => current ?? (res.items?.[0]?.student_id ?? null))
        }
      } catch (e) {
        if (!cancelled) setStudentsError(e.message)
      } finally {
        if (!cancelled) setStudentsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage])

  useEffect(() => {
    if (selectedPage !== 'students' || selectedStudentId === null) return
    let cancelled = false
    const load = async () => {
      setStudentDetailLoading(true)
      try {
        const res = await apiRequest(`/api/students/${selectedStudentId}`)
        if (!cancelled) setStudentDetail(res)
      } finally {
        if (!cancelled) setStudentDetailLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedStudentId])

  const renderStudents = () => (
    <div className="students-layout">
      <SectionCard title="학생 목록" description="학생별 구독(상품/담당/결제수단)을 확인합니다.">
        {studentsError ? <div className="banner error">{studentsError}</div> : null}
        {studentsLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
        <div className="student-list">
          {students.map((student) => (
            <button
              key={student.student_id}
              type="button"
              className={student.student_id === selectedStudentId ? 'student-list-item active' : 'student-list-item'}
              onClick={() => setSelectedStudentId(student.student_id)}
            >
              <div>
                <strong>{student.student_name}</strong>
                <span>{student.teacher_names?.length ? student.teacher_names.join(', ') : '담당 선생님 미지정'}</span>
              </div>
              <div className="student-list-item__meta">
                <span>{student.grade_level || '-'}</span>
                <span>구독 {student.subscription_count ?? 0}건</span>
              </div>
            </button>
          ))}
        </div>
      </SectionCard>

      <div className="student-detail">
        <SectionCard
          title={studentDetail ? `${studentDetail.student_name} 수납/구독` : '학생 상세'}
          description="상품명, 결제수단, 담당 선생님, 청구/종료/다음청구 등 핵심 정보를 표시합니다."
        >
          {studentDetailLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
          {studentDetail ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>담당 선생님</th>
                    <th>상품</th>
                    <th>결제수단</th>
                    <th>수수료율</th>
                    <th>시작</th>
                    <th>종료</th>
                    <th>다음 청구</th>
                  </tr>
                </thead>
                <tbody>
                  {(studentDetail.subscriptions ?? []).map((sub) => (
                    <tr key={sub.subscription_id}>
                      <td>{sub.teacher_name || '-'}</td>
                      <td>{sub.product_name || '-'}</td>
                      <td>{sub.payment_method || '-'}</td>
                      <td>{sub.commission_rate ? `${sub.commission_rate}%` : '-'}</td>
                      <td>{sub.start_date || '-'}</td>
                      <td>{sub.end_date || '-'}</td>
                      <td>{sub.next_billing || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state compact">학생을 선택하세요.</div>
          )}
        </SectionCard>
      </div>
    </div>
  )

  const renderCatalogs = () => (
    <SectionCard title="상품 / 단가표" description="products 테이블 기준입니다.">
      {(appData?.products ?? []).length === 0 ? (
        <div className="empty-state compact">상품 데이터가 없습니다.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>상품명</th>
                <th>결제 기준</th>
                <th>정가</th>
                <th>17%</th>
                <th>35%</th>
                <th>회당</th>
              </tr>
            </thead>
            <tbody>
              {appData.products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.billing_unit === 'per_session' ? '회당' : '월별'}</td>
                  <td>{formatCurrency(p.price_standard)}</td>
                  <td>{formatCurrency(p.price_17)}</td>
                  <td>{formatCurrency(p.price_35)}</td>
                  <td>{formatCurrency(p.price_per_session)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )

  const [dataModel, setDataModel] = useState(null)
  const [dataModelLoading, setDataModelLoading] = useState(false)
  const [dataModelError, setDataModelError] = useState('')

  useEffect(() => {
    if (selectedPage !== 'data-model' || dataModelLoading || dataModel) return
    let cancelled = false
    const load = async () => {
      setDataModelLoading(true)
      setDataModelError('')
      try {
        const model = await apiRequest('/api/data-model')
        if (!cancelled) setDataModel(model)
      } catch (e) {
        if (!cancelled) setDataModelError(e.message)
      } finally {
        if (!cancelled) setDataModelLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, dataModelLoading, dataModel])

  const renderDataModel = () => {
    if (dataModelError) return <div className="banner error">{dataModelError}</div>
    if (dataModelLoading) return <div className="empty-state">불러오는 중...</div>
    if (!dataModel) return <div className="empty-state">데이터 구조 정보를 불러오지 못했습니다.</div>
    return (
      <div className="data-model-page">
        <DbSchemaView model={dataModel} />
      </div>
    )
  }

  const renderCurrentPage = () => {
    switch (selectedPage) {
      case 'dashboard':
        return renderDashboard()
      case 'teacher-settlements':
        return renderTeacherSettlements()
      case 'students':
        return renderStudents()
      case 'catalogs':
        return renderCatalogs()
      case 'data-model':
        return renderDataModel()
      case 'data-overview':
        return (
          <DataOverviewView
            onOpenAdmin={(table) => {
              setDataAdminTable(table ?? null)
              setSelectedPage('data-admin')
            }}
          />
        )
      case 'data-admin':
        return <DataAdminView initialTable={dataAdminTable} />
      default:
        return renderDashboard()
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true">
              B
            </div>
            <div className="brand-text">
              <strong>보다수학</strong>
              <span>운영 · 정산 관리</span>
            </div>
          </div>

          <nav className="gnb">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === selectedPage ? 'gnb-item active' : 'gnb-item'}
                onClick={() => setSelectedPage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="page-shell">
        <section className="page-panel">
          <header className="page-panel__header">
            <div className="page-heading">
              <p className="eyebrow">{pageTitle}</p>
              <h2 className="topbar__title">{pageTitle}</h2>
              <p className="topbar__description">{pageDescription}</p>
            </div>
            {selectedPage !== 'data-model' &&
            selectedPage !== 'data-overview' &&
            selectedPage !== 'data-admin' ? (
              <div className="toolbar">
                <label className="toolbar-field">
                  <span>조회 월</span>
                  <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {formatMonth(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </header>

          {error ? <div className="banner error">{error}</div> : null}
          {loading && !appData ? <div className="empty-state">불러오는 중...</div> : renderCurrentPage()}
        </section>
      </main>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import DataAdminView from './DataAdminView.jsx'
import DataOverviewView from './DataOverviewView.jsx'
import DbSchemaView from './DbSchemaView.jsx'
import './App.css'

const NAV_ITEMS = [
  { id: 'dashboard', label: '대시보드' },
  { id: 'teacher-settlements', label: '선생님 정산' },
  { id: 'students', label: '학생 수납' },
  { id: 'catalogs', label: '상품 / 단가표' },
  { id: 'data-model', label: '데이터 구조' },
  { id: 'data-overview', label: 'DB 전체보기' },
  { id: 'data-admin', label: '데이터 관리' },
]

const currencyFormatter = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
})

function formatCurrency(value) {
  return currencyFormatter.format(value ?? 0)
}

function formatMonth(value) {
  if (!value) return '-'
  const [y, m] = String(value).split('-')
  return `${y}년 ${m}월`
}

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
  if (response.status === 204) return null
  return response.json()
}

function SectionCard({ title, description, actions, children }) {
  return (
    <section className="section-card">
      <header className="section-card__header">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="section-card__actions">{actions}</div> : null}
      </header>
      <div className="section-card__body">{children}</div>
    </section>
  )
}

function DetailModal({ title, onClose, children }) {
  if (!children) return null
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-sheet">
        <header className="modal-sheet__header">
          <h3>{title}</h3>
          <button type="button" className="secondary-button" onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="modal-sheet__body">{children}</div>
      </div>
    </div>
  )
}

export default function App() {
  const [selectedPage, setSelectedPage] = useState('dashboard')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [dataAdminTable, setDataAdminTable] = useState(null)

  const [appData, setAppData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const months = appData?.meta?.available_months ?? []

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await apiRequest('/api/app-data')
        if (!cancelled) {
          setAppData(res)
          setSelectedMonth((current) => current || res?.meta?.latest_month || '')
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const pageTitle = NAV_ITEMS.find((item) => item.id === selectedPage)?.label ?? '정산 관리'
  const pageDescription =
    selectedPage === 'dashboard'
      ? '월별 총매출, 월별결제/회당결제, 순수익(지급액), 결제수단 분포, 매출 추이를 확인합니다.'
      : selectedPage === 'teacher-settlements'
        ? '선생님별로 해당 월에 지급해야 할 금액을 한눈에 보고, 클릭하면 상세를 확인합니다.'
        : selectedPage === 'students'
          ? '학생별 구독(상품/담당/결제수단)과 수납 관리 정보를 확인합니다.'
          : selectedPage === 'catalogs'
            ? '상품(단가/월별)을 확인합니다.'
            : selectedPage === 'data-model'
              ? 'boda DB 구조(ER/테이블 사전)를 확인합니다.'
              : selectedPage === 'data-overview'
                ? '테이블별 전체 행을 한 페이지에서 확인합니다.'
                : selectedPage === 'data-admin'
                  ? '테이블별 데이터를 직접 수정합니다.'
                  : ''

  const renderDashboard = () => {
    const dash = appData?.dashboard
    if (!dash) return <div className="empty-state">대시보드 데이터를 불러오지 못했습니다.</div>

    const trend = dash.revenue_trend ?? []

    return (
      <>
        <div className="dashboard-grid">
          <SectionCard title="요약" description="선택 월 기준 핵심 지표입니다.">
            <div className="metric-list">
              <div className="metric-item">
                <span>총매출</span>
                <strong>{formatCurrency(dash.latest_gross_amount)}</strong>
              </div>
              <div className="metric-item">
                <span>월별결제 매출</span>
                <strong>{formatCurrency(dash.latest_monthly_gross_amount)}</strong>
              </div>
              <div className="metric-item">
                <span>회당결제 매출</span>
                <strong>{formatCurrency(dash.latest_per_session_gross_amount)}</strong>
              </div>
              <div className="metric-item">
                <span>순수익(지급액)</span>
                <strong>{formatCurrency(dash.latest_net_profit)}</strong>
              </div>
              <div className="metric-item">
                <span>시범수업비 정산</span>
                <strong>{formatCurrency(dash.latest_trial_fee)}</strong>
              </div>
              <div className="metric-item metric-item--muted">
                <span>이번달 수업 학생 수</span>
                <strong>{dash.latest_active_student_count ?? 0}명</strong>
              </div>
              <div className="metric-item metric-item--muted">
                <span>이번달 수업 선생님 수</span>
                <strong>{dash.latest_active_teacher_count ?? 0}명</strong>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="결제 수단 분포" description="subscriptions.payment_method 기준(임시).">
            <div className="metric-list">
              {(dash.payment_method_summary ?? []).map((row) => (
                <div className="metric-item" key={row.payment_method}>
                  <span>{row.payment_method}</span>
                  <strong>{row.count}건</strong>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="매출 추이" description="월별 총매출/월별결제/회당결제/순수익 추이입니다.">
          {trend.length === 0 ? (
            <div className="empty-state compact">추이 데이터가 없습니다.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>월</th>
                    <th>총매출</th>
                    <th>월별결제</th>
                    <th>회당결제</th>
                    <th>순수익(지급액)</th>
                    <th>시범수업비</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((row) => (
                    <tr key={row.month}>
                      <td>{formatMonth(row.month)}</td>
                      <td>{formatCurrency(row.gross_amount)}</td>
                      <td>{formatCurrency(row.monthly_gross_amount)}</td>
                      <td>{formatCurrency(row.per_session_gross_amount)}</td>
                      <td>{formatCurrency(row.net_profit)}</td>
                      <td>{formatCurrency(row.trial_fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </>
    )
  }

  const [teacherRows, setTeacherRows] = useState([])
  const [teacherLoading, setTeacherLoading] = useState(false)
  const [teacherError, setTeacherError] = useState('')
  const [teacherDetail, setTeacherDetail] = useState(null)

  useEffect(() => {
    if (selectedPage !== 'teacher-settlements' || !selectedMonth) return
    let cancelled = false
    const load = async () => {
      setTeacherLoading(true)
      setTeacherError('')
      try {
        const res = await apiRequest(`/api/teachers/settlements?month=${encodeURIComponent(selectedMonth)}`)
        if (!cancelled) setTeacherRows(res.items ?? [])
      } catch (e) {
        if (!cancelled) setTeacherError(e.message)
      } finally {
        if (!cancelled) setTeacherLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedMonth])

  const teacherTotals = useMemo(() => {
    return (teacherRows ?? []).reduce(
      (acc, row) => ({
        gross_amount: acc.gross_amount + (row.gross_amount ?? 0),
        trial_fee: acc.trial_fee + (row.trial_fee ?? 0),
        net_amount: acc.net_amount + (row.net_amount ?? 0),
      }),
      { gross_amount: 0, trial_fee: 0, net_amount: 0 },
    )
  }, [teacherRows])

  const renderTeacherSettlements = () => (
    <>
      <SectionCard
        title="선생님별 정산"
        description="선택 월에 선생님에게 지급해야 할 금액(순수익)을 한눈에 봅니다."
        actions={<span className="summary-chip">지급 합계 {formatCurrency(teacherTotals.net_amount)}</span>}
      >
        {teacherError ? <div className="banner error">{teacherError}</div> : null}
        {teacherLoading ? (
          <div className="empty-state compact">불러오는 중...</div>
        ) : teacherRows.length === 0 ? (
          <div className="empty-state compact">정산 데이터가 없습니다.</div>
        ) : (
          <div className="table-wrap settlement-overview-wrap">
            <table className="settlement-overview-table">
              <thead>
                <tr>
                  <th>선생님</th>
                  <th>정산 구분</th>
                  <th>총매출</th>
                  <th>시범수업비</th>
                  <th>지급액(순수익)</th>
                </tr>
              </thead>
              <tbody>
                {teacherRows.map((row, idx) => (
                  <tr key={`${row.teacher_id}-${row.settlement_type}-${idx}`}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={async () => {
                          const detail = await apiRequest(
                            `/api/teachers/${row.teacher_id}/settlements/${encodeURIComponent(row.billing_month)}`,
                          )
                          setTeacherDetail(detail)
                        }}
                      >
                        {row.teacher_name}
                      </button>
                      <small className="table-sub">정산월 {row.billing_month}</small>
                    </td>
                    <td>{row.settlement_type === 'per_session' ? '회당' : '월별'}</td>
                    <td>{formatCurrency(row.gross_amount)}</td>
                    <td>{formatCurrency(row.trial_fee)}</td>
                    <td>{formatCurrency(row.net_amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>합계</td>
                  <td>-</td>
                  <td>{formatCurrency(teacherTotals.gross_amount)}</td>
                  <td>{formatCurrency(teacherTotals.trial_fee)}</td>
                  <td>{formatCurrency(teacherTotals.net_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>

      <DetailModal title={teacherDetail ? `${teacherDetail.teacher_name} · ${teacherDetail.billing_month}` : ''} onClose={() => setTeacherDetail(null)}>
        {teacherDetail ? (
          <>
            <SectionCard title="정산 요약">
              <div className="metric-list">
                {(teacherDetail.settlement_summary ?? []).map((row) => (
                  <div className="metric-item" key={row.settlement_type}>
                    <span>{row.settlement_type === 'per_session' ? '회당' : '월별'}</span>
                    <strong>{formatCurrency(row.net_amount)}</strong>
                  </div>
                ))}
              </div>
            </SectionCard>
            <SectionCard title="수업/수납 상세" description="monthly_lesson_records 기반(데이터가 없으면 비어있을 수 있음)">
              {(teacherDetail.lesson_records ?? []).length === 0 ? (
                <div className="empty-state compact">상세 레코드가 없습니다.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>학생</th>
                        <th>상품</th>
                        <th>구분</th>
                        <th>횟수</th>
                        <th>금액</th>
                        <th>시범</th>
                        <th>환불</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teacherDetail.lesson_records.map((r) => (
                        <tr key={r.id}>
                          <td>{r.student_name || '-'}</td>
                          <td>{r.product_name || '-'}</td>
                          <td>{r.billing_unit === 'per_session' ? '회당' : '월별'}</td>
                          <td>{r.completed_sessions ?? 0}/{r.total_sessions ?? 0}</td>
                          <td>{formatCurrency(r.final_amount)}</td>
                          <td>{formatCurrency(r.trial_fee)}</td>
                          <td>{formatCurrency(r.refund_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </>
        ) : null}
      </DetailModal>
    </>
  )

  const [students, setStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [studentsError, setStudentsError] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [studentDetail, setStudentDetail] = useState(null)
  const [studentDetailLoading, setStudentDetailLoading] = useState(false)

  useEffect(() => {
    if (selectedPage !== 'students') return
    let cancelled = false
    const load = async () => {
      setStudentsLoading(true)
      setStudentsError('')
      try {
        const res = await apiRequest('/api/students')
        if (!cancelled) {
          setStudents(res.items ?? [])
          setSelectedStudentId((current) => current ?? (res.items?.[0]?.student_id ?? null))
        }
      } catch (e) {
        if (!cancelled) setStudentsError(e.message)
      } finally {
        if (!cancelled) setStudentsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage])

  useEffect(() => {
    if (selectedPage !== 'students' || selectedStudentId === null) return
    let cancelled = false
    const load = async () => {
      setStudentDetailLoading(true)
      try {
        const res = await apiRequest(`/api/students/${selectedStudentId}`)
        if (!cancelled) setStudentDetail(res)
      } finally {
        if (!cancelled) setStudentDetailLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedStudentId])

  const renderStudents = () => (
    <div className="students-layout">
      <SectionCard title="학생 목록" description="학생별 구독(상품/담당/결제수단)을 확인합니다.">
        {studentsError ? <div className="banner error">{studentsError}</div> : null}
        {studentsLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
        <div className="student-list">
          {students.map((student) => (
            <button
              key={student.student_id}
              type="button"
              className={student.student_id === selectedStudentId ? 'student-list-item active' : 'student-list-item'}
              onClick={() => setSelectedStudentId(student.student_id)}
            >
              <div>
                <strong>{student.student_name}</strong>
                <span>{student.teacher_names?.length ? student.teacher_names.join(', ') : '담당 선생님 미지정'}</span>
              </div>
              <div className="student-list-item__meta">
                <span>{student.grade_level || '-'}</span>
                <span>구독 {student.subscription_count ?? 0}건</span>
              </div>
            </button>
          ))}
        </div>
      </SectionCard>

      <div className="student-detail">
        <SectionCard
          title={studentDetail ? `${studentDetail.student_name} 수납/구독` : '학생 상세'}
          description="상품명, 결제수단, 담당 선생님, 청구/종료/다음청구 등 핵심 정보를 표시합니다."
        >
          {studentDetailLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
          {studentDetail ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>담당 선생님</th>
                    <th>상품</th>
                    <th>결제수단</th>
                    <th>수수료율</th>
                    <th>시작</th>
                    <th>종료</th>
                    <th>다음 청구</th>
                  </tr>
                </thead>
                <tbody>
                  {(studentDetail.subscriptions ?? []).map((sub) => (
                    <tr key={sub.subscription_id}>
                      <td>{sub.teacher_name || '-'}</td>
                      <td>{sub.product_name || '-'}</td>
                      <td>{sub.payment_method || '-'}</td>
                      <td>{sub.commission_rate ? `${sub.commission_rate}%` : '-'}</td>
                      <td>{sub.start_date || '-'}</td>
                      <td>{sub.end_date || '-'}</td>
                      <td>{sub.next_billing || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state compact">학생을 선택하세요.</div>
          )}
        </SectionCard>
      </div>
    </div>
  )

  const renderCatalogs = () => (
    <SectionCard title="상품 / 단가표" description="products 테이블 기준입니다.">
      {(appData?.products ?? []).length === 0 ? (
        <div className="empty-state compact">상품 데이터가 없습니다.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>상품명</th>
                <th>결제 기준</th>
                <th>정가</th>
                <th>17%</th>
                <th>35%</th>
                <th>회당</th>
              </tr>
            </thead>
            <tbody>
              {appData.products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.billing_unit === 'per_session' ? '회당' : '월별'}</td>
                  <td>{formatCurrency(p.price_standard)}</td>
                  <td>{formatCurrency(p.price_17)}</td>
                  <td>{formatCurrency(p.price_35)}</td>
                  <td>{formatCurrency(p.price_per_session)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )

  const [dataModel, setDataModel] = useState(null)
  const [dataModelLoading, setDataModelLoading] = useState(false)
  const [dataModelError, setDataModelError] = useState('')

  useEffect(() => {
    if (selectedPage !== 'data-model' || dataModelLoading || dataModel) return
    let cancelled = false
    const load = async () => {
      setDataModelLoading(true)
      setDataModelError('')
      try {
        const model = await apiRequest('/api/data-model')
        if (!cancelled) setDataModel(model)
      } catch (e) {
        if (!cancelled) setDataModelError(e.message)
      } finally {
        if (!cancelled) setDataModelLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, dataModelLoading, dataModel])

  const renderDataModel = () => {
    if (dataModelError) return <div className="banner error">{dataModelError}</div>
    if (dataModelLoading) return <div className="empty-state">불러오는 중...</div>
    if (!dataModel) return <div className="empty-state">데이터 구조 정보를 불러오지 못했습니다.</div>
    return (
      <div className="data-model-page">
        <DbSchemaView model={dataModel} />
      </div>
    )
  }

  const renderCurrentPage = () => {
    switch (selectedPage) {
      case 'dashboard':
        return renderDashboard()
      case 'teacher-settlements':
        return renderTeacherSettlements()
      case 'students':
        return renderStudents()
      case 'catalogs':
        return renderCatalogs()
      case 'data-model':
        return renderDataModel()
      case 'data-overview':
        return (
          <DataOverviewView
            onOpenAdmin={(table) => {
              setDataAdminTable(table ?? null)
              setSelectedPage('data-admin')
            }}
          />
        )
      case 'data-admin':
        return <DataAdminView initialTable={dataAdminTable} />
      default:
        return renderDashboard()
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true">
              B
            </div>
            <div className="brand-text">
              <strong>보다수학</strong>
              <span>운영 · 정산 관리</span>
            </div>
          </div>

          <nav className="gnb">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === selectedPage ? 'gnb-item active' : 'gnb-item'}
                onClick={() => setSelectedPage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="page-shell">
        <section className="page-panel">
          <header className="page-panel__header">
            <div className="page-heading">
              <p className="eyebrow">{pageTitle}</p>
              <h2 className="topbar__title">{pageTitle}</h2>
              <p className="topbar__description">{pageDescription}</p>
            </div>
            {selectedPage !== 'data-model' &&
            selectedPage !== 'data-overview' &&
            selectedPage !== 'data-admin' ? (
              <div className="toolbar">
                <label className="toolbar-field">
                  <span>조회 월</span>
                  <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {formatMonth(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </header>

          {error ? <div className="banner error">{error}</div> : null}
          {loading && !appData ? <div className="empty-state">불러오는 중...</div> : renderCurrentPage()}
        </section>
      </main>
    </div>
  )
}

function formatNumber(value) {
  return numberFormatter.format(value ?? 0)
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') {
    return '-'
  }
  return `${Math.round((value ?? 0) * 100)}%`
}

function formatMonth(value) {
  if (!value) {
    return '-'
  }
  const [year, month] = value.split('-')
  return `${year}년 ${month}월`
}

function formatMonthShort(value) {
  if (!value) {
    return ''
  }
  const [year, month] = value.split('-')
  return `${year.slice(2)}.${month}`
}

function formatMonthLabel(value) {
  return value ? formatMonth(value) : '-'
}

function uniqueCount(rows, key) {
  return new Set(rows.map((row) => row[key]).filter(Boolean)).size
}

function sumBy(rows, selector) {
  return rows.reduce((total, row) => total + (selector(row) ?? 0), 0)
}

function buildTeacherSettlementDetail(data, teacherRow) {
  if (!data || !teacherRow) {
    return null
  }

  const { teacher_name: teacherName, service_month: serviceMonth } = teacherRow
  const monthlyLines = (data.tuition_student_months ?? [])
    .filter((row) => row.teacher_name === teacherName && row.month === serviceMonth)
    .sort((left, right) => (left.student_name || '').localeCompare(right.student_name || ''))

  const sessionLines = (data.session_collections ?? [])
    .filter((row) => row.teacher_name === teacherName && row.service_month === serviceMonth)
    .sort((left, right) => (left.student_name || '').localeCompare(right.student_name || ''))

  const monthlySettlement = (data.monthly_settlements ?? []).find(
    (row) => row.teacher_name === teacherName && row.service_month === serviceMonth,
  )

  const sessionSettlement = (data.session_settlements ?? []).find(
    (row) => row.teacher_name === teacherName && row.service_month === serviceMonth,
  )

  const trialLessons = buildTrialLessonItems(data, serviceMonth, { teacherName }).map((item) => ({
    id: item.id,
    trial_lesson_date: item.date,
    student_name: item.student_name,
    teacher_name: item.teacher_name,
    product_name: null,
    current_month_amount: 0,
  }))

  return {
    teacherRow,
    monthlyLines,
    sessionLines,
    monthlySettlement,
    sessionSettlement,
    trialLessons,
    monthlyStudentCount: uniqueCount(monthlyLines, 'student_name'),
    sessionStudentCount: uniqueCount(
      sessionLines.filter((row) => (row.current_month_amount ?? 0) > 0),
      'student_name',
    ),
  }
}

function formatDateTime(value) {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('ko-KR')
}

function formatDate(value) {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString('ko-KR')
}

function parseProductName(productName) {
  const match = productName?.match(/^(초등|중등|고등)\s+(주\d회)\s+(.+)$/)
  if (!match) {
    return null
  }
  return {
    school: match[1],
    frequency: match[2],
    detail: match[3],
  }
}

function sortByOrder(values, order) {
  return [...values].sort((a, b) => {
    const aIndex = order.indexOf(a)
    const bIndex = order.indexOf(b)
    if (aIndex === -1 && bIndex === -1) {
      return a.localeCompare(b, 'ko')
    }
    if (aIndex === -1) {
      return 1
    }
    if (bIndex === -1) {
      return -1
    }
    return aIndex - bIndex
  })
}

function buildSchoolPriceTables(rows) {
  const grouped = new Map()

  rows.forEach((row) => {
    const parsed = parseProductName(row.product_name)
    if (!parsed || parsed.detail === '개별진도') {
      return
    }

    if (!grouped.has(parsed.school)) {
      grouped.set(parsed.school, new Map())
    }

    const schoolMap = grouped.get(parsed.school)
    if (!schoolMap.has(parsed.frequency)) {
      schoolMap.set(parsed.frequency, new Map())
    }

    schoolMap.get(parsed.frequency).set(parsed.detail, row.amount)
  })

  return SCHOOL_ORDER.map((school) => {
    const schoolMap = grouped.get(school)
    if (!schoolMap) {
      return null
    }

    const frequencies = sortByOrder([...schoolMap.keys()], FREQUENCY_ORDER)
    const details = sortByOrder(
      [...new Set(frequencies.flatMap((frequency) => [...(schoolMap.get(frequency)?.keys() ?? [])]))],
      DETAIL_ORDER,
    )

    return {
      school,
      details,
      rows: frequencies.map((frequency) => ({
        frequency,
          amountByDetail: Object.fromEntries(
            details.map((detail) => [detail, schoolMap.get(frequency)?.get(detail) ?? null]),
          ),
      })),
    }
  }).filter(Boolean)
}

function buildCatalogTableRows(schoolTables) {
  return schoolTables.flatMap((schoolTable) =>
    schoolTable.rows.map((row) => ({
      school: schoolTable.school,
      frequency: row.frequency,
      amount60: row.amountByDetail['60분'],
      amount90: row.amountByDetail['90분'],
      amount120: row.amountByDetail['120분'],
    })),
  )
}

function buildFrequencyCaption(frequency, tableType) {
  const match = frequency?.match(/주(\d+)회/)
  if (!match) {
    return ''
  }

  if (tableType !== '회당 단가표') {
    return ''
  }

  const count = Number(match[1]) * 4
  return `월 ${count}회 기준`
}

function buildMonthlySessionCount(frequency) {
  const match = frequency?.match(/주(\d+)회/)
  if (!match) {
    return 0
  }
  return Number(match[1]) * 4
}

function buildMonthlyEquivalent(amount, frequency, tableType) {
  if (tableType !== '회당 단가표' || !amount) {
    return ''
  }

  const monthlyCount = buildMonthlySessionCount(frequency)
  if (!monthlyCount) {
    return ''
  }

  return `${formatCurrency(amount * monthlyCount)} / 월`
}

function buildCatalogNotice(tableType) {
  if (tableType === '회당 단가표') {
    return '회당 수업료는 실제 진행한 수업 회차만큼 계산되며, 각 금액 아래에 월 기준 환산 금액을 함께 표시합니다.'
  }

  return '월별 수업료는 상품별 고정 월 금액 기준으로 안내합니다.'
}

function sumValues(rows, getter) {
  return rows.reduce((total, row) => total + (getter(row) ?? 0), 0)
}

function formatSignedNumber(value) {
  if (!value) {
    return '0'
  }
  return `${value > 0 ? '+' : ''}${formatNumber(value)}`
}

function formatSignedCurrency(value) {
  if (!value) {
    return formatCurrency(0)
  }
  return `${value > 0 ? '+' : '-'}${formatCurrency(Math.abs(value))}`
}

function isDateInCalendarMonth(dateValue, monthKey) {
  if (!dateValue || !monthKey) {
    return false
  }
  return String(dateValue).slice(0, 7) === monthKey
}

const TRIAL_SOURCE_LABELS = {
  tuition_am: '수업료 AM',
  tuition_month_cell: '수업료 월별열',
  session_m_column: '회당 M',
  session_month_cell: '회당 월별열',
}

function buildTrialLessonItems(data, monthKey, options = {}) {
  if (!data || !monthKey) {
    return []
  }

  const serviceMonths = options.serviceMonths ?? []
  const teacherFilter = options.teacherName
  const items = []
  const seen = new Set()

  const addItem = (dateValue, studentName, teacherName, sourceId, sourceLabel) => {
    if (!dateValue || !studentName) {
      return
    }
    if (teacherFilter && teacherName !== teacherFilter) {
      return
    }
    const key = `${dateValue}|${studentName}|${teacherName || '-'}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    items.push({
      id: sourceId || key,
      date: dateValue,
      student_name: studentName,
      teacher_name: teacherName || '-',
      inMonth: isDateInCalendarMonth(dateValue, monthKey),
      sourceLabel: sourceLabel || '',
    })
  }

  for (const row of data.trial_lessons ?? []) {
    if (!row.trial_lesson_date) {
      continue
    }
    const label = TRIAL_SOURCE_LABELS[row.source] || row.source || ''
    if (isDateInCalendarMonth(row.trial_lesson_date, monthKey)) {
      addItem(
        row.trial_lesson_date,
        row.student_name,
        row.teacher_name,
        `tl-${row.id}`,
        label,
      )
      continue
    }
    if (
      row.lesson_start_date &&
      isDateInCalendarMonth(row.lesson_start_date, monthKey) &&
      row.trial_lesson_date
    ) {
      addItem(row.trial_lesson_date, row.student_name, row.teacher_name, `tl-start-${row.id}`, label)
    }
  }

  const trialDateByPair = new Map()
  for (const row of data.trial_lessons ?? []) {
    if (!row.trial_lesson_date || !row.student_name) {
      continue
    }
    const pairKey = `${row.teacher_name}|${row.student_name}`
    const existing = trialDateByPair.get(pairKey)
    if (!existing || row.trial_lesson_date < existing) {
      trialDateByPair.set(pairKey, row.trial_lesson_date)
    }
  }
  for (const row of data.session_collections ?? []) {
    if (!row.trial_lesson_date || !row.student_name) {
      continue
    }
    const pairKey = `${row.teacher_name}|${row.student_name}`
    const existing = trialDateByPair.get(pairKey)
    if (!existing || row.trial_lesson_date < existing) {
      trialDateByPair.set(pairKey, row.trial_lesson_date)
    }
  }

  for (const row of data.session_collections ?? []) {
    if (!row.student_name) {
      continue
    }

    const pairKey = `${row.teacher_name}|${row.student_name}`
    const linkedTrial = row.trial_lesson_date || trialDateByPair.get(pairKey)

    if (linkedTrial && isDateInCalendarMonth(linkedTrial, monthKey)) {
      addItem(linkedTrial, row.student_name, row.teacher_name, `sc-trial-${row.id}`)
      continue
    }

    if (
      linkedTrial &&
      row.lesson_start_date &&
      isDateInCalendarMonth(row.lesson_start_date, monthKey)
    ) {
      addItem(linkedTrial, row.student_name, row.teacher_name, `sc-start-${row.id}`)
      continue
    }

    if (
      options.includeServiceMonthTrials &&
      serviceMonths.includes(row.service_month) &&
      linkedTrial
    ) {
      addItem(linkedTrial, row.student_name, row.teacher_name, `sc-svc-${row.id}`)
    }
  }

  for (const enrollment of data.enrollments ?? []) {
    if (enrollment.trial_lesson_date && isDateInCalendarMonth(enrollment.trial_lesson_date, monthKey)) {
      addItem(
        enrollment.trial_lesson_date,
        enrollment.student_name,
        enrollment.teacher_name,
        `en-${enrollment.id}`,
      )
    }
  }

  for (const student of data.students ?? []) {
    for (const row of student.imported_rows ?? []) {
      if (!row.trial_lesson_date || !isDateInCalendarMonth(row.trial_lesson_date, monthKey)) {
        continue
      }
      addItem(row.trial_lesson_date, student.student_name, row.teacher_name, `imp-${row.id}`)
    }
  }

  return items.sort((left, right) => left.date.localeCompare(right.date))
}

function matchesServiceMonth(row, monthKey) {
  return Boolean(monthKey && row?.service_month === monthKey)
}

function getCalendarMonthRange(monthKey) {
  const [yearText, monthText] = monthKey.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const start = `${monthKey}-01`
  const end = new Date(year, month, 0).toISOString().slice(0, 10)
  return { start, end }
}

function isLessonActiveInMonth(startDate, endDate, monthKey) {
  if (!monthKey) {
    return false
  }
  const { start, end } = getCalendarMonthRange(monthKey)
  if (startDate && startDate > end) {
    return false
  }
  if (endDate && endDate < start) {
    return false
  }
  return true
}

function createStudentForm(student = null) {
  return {
    student_name: student?.student_name ?? '',
    parent_name: student?.parent_name ?? '',
    contact: student?.contact ?? '',
    payment_method: student?.payment_method ?? student?.current_payment_method ?? '',
    status: student?.status ?? '수업중',
    notes: student?.notes ?? '',
  }
}

function createEventForm(event = null) {
  return {
    event_date: event?.event_date ?? '',
    event_type: event?.event_type ?? '일정변경',
    title: event?.title ?? '',
    teacher_name: event?.teacher_name ?? '',
    payment_method: event?.payment_method ?? '',
    weekly_frequency: event?.weekly_frequency ?? '',
    weekdays: event?.weekdays ?? '',
    time_text: event?.time_text ?? '',
    product_name: event?.product_name ?? '',
    amount: event?.amount ?? '',
    memo: event?.memo ?? '',
  }
}

async function apiRequest(path, options = {}) {
  const isFormData = options.body instanceof FormData
  const response = await fetch(path, {
    headers: isFormData
      ? options.headers
      : {
          'Content-Type': 'application/json',
          ...(options.headers ?? {}),
        },
    ...options,
  })

  if (!response.ok) {
    let detail = '요청 처리 중 오류가 발생했습니다.'
    try {
      const data = await response.json()
      detail = data.detail ?? detail
    } catch {
      // Keep default detail.
    }
    throw new Error(detail)
  }

  return response.json()
}

function DeltaCaption({ value, unit = 'currency' }) {
  if (value === null || value === undefined) {
    return <small className="stat-delta stat-delta--neutral">전월 비교 없음</small>
  }

  const deltaClass =
    value > 0 ? 'stat-delta stat-delta--up' : value < 0 ? 'stat-delta stat-delta--down' : 'stat-delta stat-delta--neutral'
  const deltaText =
    unit === 'currency' ? formatSignedCurrency(value) : `${formatSignedNumber(value)}${unit === 'count' ? '명' : ''}`

  return <small className={deltaClass}>전월 대비 {deltaText}</small>
}

function StatCard({
  label,
  value,
  caption,
  delta,
  breakdown,
  className = '',
  valueClassName = '',
  onClick,
  isActive = false,
}) {
  const cardClassName = [
    'stat-card',
    className,
    onClick ? 'stat-card--clickable' : '',
    isActive ? 'stat-card--active' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article
      className={cardClassName}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span>{label}</span>
      <strong className={valueClassName}>{value}</strong>
      {delta}
      {breakdown}
      {caption ? <small className="stat-card__caption">{caption}</small> : null}
    </article>
  )
}

function buildSmoothLinePath(points) {
  if (points.length === 0) {
    return ''
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`
  }

  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const controlX = (current.x + next.x) / 2
    path += ` C ${controlX} ${current.y}, ${controlX} ${next.y}, ${next.x} ${next.y}`
  }
  return path
}

function StudentTrendLineChart({ items }) {
  const chart = useMemo(() => {
    if (items.length === 0) {
      return null
    }

    const width = 640
    const height = 260
    const padding = { top: 28, right: 24, bottom: 40, left: 48 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom
    const counts = items.map((item) => item.studentCount)
    const maxCount = Math.max(...counts, 1)
    const minCount = Math.min(...counts, 0)
    const range = Math.max(maxCount - minCount, 1)

    const points = items.map((item, index) => {
      const x =
        padding.left +
        (items.length === 1 ? chartWidth / 2 : (index / (items.length - 1)) * chartWidth)
      const y =
        padding.top + chartHeight - ((item.studentCount - minCount) / range) * chartHeight
      return { ...item, x, y }
    })

    const linePath = buildSmoothLinePath(points)
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`
    const yTicks = [maxCount, Math.round((maxCount + minCount) / 2), minCount].filter(
      (value, index, array) => array.indexOf(value) === index,
    )

    return {
      width,
      height,
      padding,
      points,
      linePath,
      areaPath,
      yTicks,
      chartHeight,
    }
  }, [items])

  if (!chart) {
    return <div className="empty-state compact">표시할 추이 데이터가 없습니다.</div>
  }

  return (
    <div className="trend-chart">
      <svg
        className="trend-chart__svg"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-label="학생 수 추이 곡선 그래프"
      >
        <defs>
          <linearGradient id="studentTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f80ed" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#2f80ed" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {chart.yTicks.map((tick) => {
          const minTick = chart.yTicks[chart.yTicks.length - 1]
          const maxTick = chart.yTicks[0]
          const y =
            chart.padding.top +
            chart.chartHeight -
            ((tick - minTick) / Math.max(maxTick - minTick, 1)) * chart.chartHeight
          return (
            <g key={tick}>
              <line
                x1={chart.padding.left}
                y1={y}
                x2={chart.width - chart.padding.right}
                y2={y}
                className="trend-chart__grid"
              />
              <text x={8} y={y + 4} className="trend-chart__axis">
                {tick}
              </text>
            </g>
          )
        })}

        <path d={chart.areaPath} fill="url(#studentTrendFill)" />
        <path d={chart.linePath} className="trend-chart__line" />
        {chart.points.map((point) => (
          <g key={point.month}>
            <circle
              cx={point.x}
              cy={point.y}
              r={point.isCurrent ? 6 : 4.5}
              className={point.isCurrent ? 'trend-chart__dot trend-chart__dot--current' : 'trend-chart__dot'}
            />
            <text x={point.x} y={chart.height - 12} textAnchor="middle" className="trend-chart__axis">
              {formatMonthShort(point.month)}
            </text>
            <text x={point.x} y={point.y - 12} textAnchor="middle" className="trend-chart__value">
              {point.studentCount}
            </text>
          </g>
        ))}
      </svg>
      <div className="trend-chart__legend">
        <span className="trend-chart__legend-item">
          <i className="trend-chart__legend-dot" />
          학생 수
        </span>
        <span>최근 {formatNumber(items.length)}개월 · 운영월 기준</span>
      </div>
    </div>
  )
}

function SectionCard({ title, description, actions, children }) {
  return (
    <section className="section-card">
      <div className="section-card__header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="section-card__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

function SettlementDetailModal({ detail, onClose }) {
  if (!detail) {
    return null
  }

  const { teacherRow, monthlyLines, sessionLines, monthlySettlement, sessionSettlement, trialLessons } =
    detail

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel settlement-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settlement-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settlement-modal__header">
          <div>
            <p className="eyebrow">선생님별 상세 정산</p>
            <h3 id="settlement-modal-title">{teacherRow.teacher_name}</h3>
            <p className="settlement-modal__meta">
              수업월 {formatMonthLabel(teacherRow.service_month)} · 정산월{' '}
              {formatMonthLabel(teacherRow.settlement_month)} · 정산일 {teacherRow.settlement_date || '-'}
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            닫기
          </button>
        </header>

        <div className="settlement-modal__summary">
          <article>
            <span>월별 정산 (세전)</span>
            <strong>{formatCurrency(teacherRow.monthly_pretax_amount)}</strong>
          </article>
          <article>
            <span>회당 정산 (세전)</span>
            <strong>{formatCurrency(teacherRow.session_pretax_amount)}</strong>
          </article>
          <article>
            <span>최종 (세후)</span>
            <strong>{formatCurrency(teacherRow.final_aftertax_amount)}</strong>
          </article>
        </div>

        <section className="settlement-modal__section">
          <h4>월별 정산 · 학생별 수납 내역</h4>
          <p className="settlement-modal__hint">
            수업료 관리 시트 기준 — 어떤 학생이 어떤 수업료를 냈는지입니다.
            {monthlySettlement
              ? ` (수수료율 ${formatPercent(monthlySettlement.fee_rate)}, 선생님 정산 ${formatCurrency(monthlySettlement.pretax_amount)})`
              : ''}
          </p>
          {monthlyLines.length === 0 ? (
            <div className="empty-state compact">이번 달 월별 수납 학생이 없습니다.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>학생</th>
                    <th>결제수단</th>
                    <th>청구</th>
                    <th>수납액</th>
                    <th>정기 수업료</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyLines.map((row) => (
                    <tr key={row.id}>
                      <td>{row.student_name}</td>
                      <td>{row.payment_method || '-'}</td>
                      <td>{row.charge_label || '-'}</td>
                      <td>{formatCurrency(row.amount)}</td>
                      <td>{formatCurrency(row.regular_tuition)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>합계</td>
                    <td>{formatCurrency(sumBy(monthlyLines, (row) => row.amount))}</td>
                    <td>-</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <section className="settlement-modal__section">
          <h4>회당 정산 · 학생별 수업/수금</h4>
          <p className="settlement-modal__hint">
            회당 수금표 기준 — 이번 달 횟수와 금액입니다.
            {sessionSettlement
              ? ` (정기 정산금 ${formatCurrency(sessionSettlement.recurring_payment_commission)})`
              : ''}
          </p>
          {sessionLines.length === 0 ? (
            <div className="empty-state compact">이번 달 회당 정산 학생이 없습니다.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>학생</th>
                    <th>상품</th>
                    <th>과정/요일/시간</th>
                    <th>이번달 횟수</th>
                    <th>수금액</th>
                    <th>수수료</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionLines.map((row) => (
                    <tr key={row.id}>
                      <td>{row.student_name}</td>
                      <td>{row.product_name || '-'}</td>
                      <td>
                        {[row.course, row.weekly_frequency, row.weekdays, row.time_text]
                          .filter(Boolean)
                          .join(' · ') || '-'}
                      </td>
                      <td>{formatNumber(row.current_month_sessions)}회</td>
                      <td>{formatCurrency(row.current_month_amount)}</td>
                      <td>{row.commission_rate ? `${formatNumber(row.commission_rate)}%` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>합계</td>
                    <td>{formatCurrency(sumBy(sessionLines, (row) => row.current_month_amount))}</td>
                    <td>-</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <section className="settlement-modal__section">
          <h4>시범수업 (별도)</h4>
          <p className="settlement-modal__hint">
            시범수업일 기준 · 월별 {formatCurrency(teacherRow.monthly_trial_amount)} / 회당{' '}
            {formatCurrency(teacherRow.session_trial_amount)}
          </p>
          {trialLessons.length === 0 ? (
            <div className="empty-state compact">이 수업월에 등록된 시범수업이 없습니다.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>시범수업일</th>
                    <th>학생</th>
                    <th>상품</th>
                    <th>이번달 수금</th>
                  </tr>
                </thead>
                <tbody>
                  {trialLessons.map((row) => (
                    <tr key={`trial-${row.id}`}>
                      <td>{formatDate(row.trial_lesson_date)}</td>
                      <td>{row.student_name}</td>
                      <td>{row.product_name || '-'}</td>
                      <td>{formatCurrency(row.current_month_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function DataTable({ columns, rows, emptyMessage = '표시할 데이터가 없습니다.' }) {
  if (rows.length === 0) {
    return <div className="empty-state compact">{emptyMessage}</div>
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? `${row.teacher_name ?? 'row'}-${index}`}>
              {columns.map((column) => {
                const value = row[column.key]
                return (
                  <td key={column.key}>
                    {column.render
                      ? column.render(value, row)
                      : value === null || value === undefined || value === ''
                        ? '-'
                        : value}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [selectedPage, setSelectedPage] = useState('dashboard')
  const [dataAdminTable, setDataAdminTable] = useState(null)
  const [selectedMonth, setSelectedMonth] = useState('')
  const [studentQuery, setStudentQuery] = useState('')
  const [selectedCatalogTab, setSelectedCatalogTab] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [studentForm, setStudentForm] = useState(createStudentForm())
  const [studentSaving, setStudentSaving] = useState(false)
  const [eventForm, setEventForm] = useState(createEventForm())
  const [editingEventId, setEditingEventId] = useState(null)
  const [eventSaving, setEventSaving] = useState(false)
  const [showTrialDetails, setShowTrialDetails] = useState(false)
  const [teacherSettlementRows, setTeacherSettlementRows] = useState([])
  const [teacherSettlementLoading, setTeacherSettlementLoading] = useState(false)
  const [teacherSettlementError, setTeacherSettlementError] = useState('')
  const [teacherSettlementDetail, setTeacherSettlementDetail] = useState(null)
  const [studentRows, setStudentRows] = useState([])
  const [studentRowsLoading, setStudentRowsLoading] = useState(false)
  const [studentRowsError, setStudentRowsError] = useState('')
  const [studentDetail, setStudentDetail] = useState(null)
  const [studentDetailLoading, setStudentDetailLoading] = useState(false)
  const [dataModelLoading, setDataModelLoading] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const appData = await apiRequest('/api/app-data')
      setData(appData)
      setSelectedMonth((current) => current || appData.meta.latest_calendar_month || appData.meta.latest_month || '')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (selectedPage !== 'teacher-settlements' || !selectedMonth) {
      return
    }
    let cancelled = false
    const loadTeacherSettlements = async () => {
      setTeacherSettlementLoading(true)
      setTeacherSettlementError('')
      try {
        const res = await apiRequest(`/api/teachers/settlements?month=${encodeURIComponent(selectedMonth)}`)
        if (!cancelled) {
          setTeacherSettlementRows(res.items ?? [])
        }
      } catch (loadError) {
        if (!cancelled) {
          setTeacherSettlementError(loadError.message)
        }
      } finally {
        if (!cancelled) {
          setTeacherSettlementLoading(false)
        }
      }
    }
    loadTeacherSettlements()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedMonth])

  useEffect(() => {
    if (selectedPage !== 'students') {
      return
    }
    let cancelled = false
    const loadStudents = async () => {
      setStudentRowsLoading(true)
      setStudentRowsError('')
      try {
        const res = await apiRequest('/api/students')
        if (!cancelled) {
          setStudentRows(res.items ?? [])
          if (selectedStudentId === null && (res.items ?? []).length > 0) {
            setSelectedStudentId(res.items[0].student_id)
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setStudentRowsError(loadError.message)
        }
      } finally {
        if (!cancelled) {
          setStudentRowsLoading(false)
        }
      }
    }
    loadStudents()
    return () => {
      cancelled = true
    }
  }, [selectedPage])

  useEffect(() => {
    if (selectedPage !== 'students' || selectedStudentId === null) {
      return
    }
    let cancelled = false
    const loadStudentDetail = async () => {
      setStudentDetailLoading(true)
      try {
        const res = await apiRequest(`/api/students/${selectedStudentId}`)
        if (!cancelled) {
          setStudentDetail(res)
        }
      } catch (loadError) {
        if (!cancelled) {
          setStudentRowsError(loadError.message)
        }
      } finally {
        if (!cancelled) {
          setStudentDetailLoading(false)
        }
      }
    }
    loadStudentDetail()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedStudentId])

  useEffect(() => {
    if (selectedPage !== 'data-model' || !data || data.data_model || dataModelLoading) {
      return
    }

    let cancelled = false
    const loadDataModel = async () => {
      setDataModelLoading(true)
      try {
        const model = await apiRequest('/api/data-model')
        if (!cancelled) {
          setData((current) => (current ? { ...current, data_model: model } : current))
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message)
        }
      } finally {
        if (!cancelled) {
          setDataModelLoading(false)
        }
      }
    }

    loadDataModel()
    return () => {
      cancelled = true
    }
  }, [selectedPage, data, dataModelLoading])

  useEffect(() => {
    if (!data || selectedPage === 'dashboard' || selectedPage === 'students') {
      return
    }

    const pageLatestMonth = data.meta.page_latest_months?.[selectedPage]
    if (!pageLatestMonth) {
      return
    }

    const hasCurrentPageData = (() => {
      switch (selectedPage) {
        case 'teacher-settlements':
          return (data.teacher_settlements ?? []).some((row) => row.settlement_month === selectedMonth)
        case 'tuition':
          return (data.tuition_student_months ?? []).some((row) => row.month === selectedMonth)
        default:
          return true
      }
    })()

    if (!selectedMonth || !hasCurrentPageData) {
      setSelectedMonth(pageLatestMonth)
    }
  }, [data, selectedMonth, selectedPage])

  useEffect(() => {
    const students = data?.students ?? []
    if (students.length === 0) {
      setSelectedStudentId(null)
      setStudentForm(createStudentForm())
      return
    }

    const matched = students.find((student) => student.id === selectedStudentId)
    if (!matched && selectedStudentId !== null) {
      setSelectedStudentId(students[0].id)
      return
    }

    if (selectedStudentId === null && selectedPage === 'students') {
      setSelectedStudentId(students[0].id)
    }
  }, [data, selectedPage, selectedStudentId])

  const selectedStudent = useMemo(
    () => (data?.students ?? []).find((student) => student.id === selectedStudentId) ?? null,
    [data, selectedStudentId],
  )

  const selectedStudentEnrollments = useMemo(() => {
    if (!selectedStudent) {
      return []
    }
    return (data?.enrollments ?? []).filter((row) => row.student_name === selectedStudent.student_name)
  }, [data, selectedStudent])

  useEffect(() => {
    if (selectedStudent) {
      setStudentForm(createStudentForm(selectedStudent))
    } else if (selectedPage === 'students') {
      setStudentForm(createStudentForm())
    }
    setEventForm(createEventForm())
    setEditingEventId(null)
  }, [selectedPage, selectedStudent])

  const handleWorkbookImport = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    setSyncing(true)
    setError('')
    setNotice('')
    try {
      const result = await apiRequest('/api/import/workbook', {
        method: 'POST',
        body: formData,
      })
      await loadData()
      setNotice(
        `${result.source_name} 기준으로 ${formatNumber(result.imported_count)}개 레코드를 동기화했습니다.`,
      )
    } catch (importError) {
      setError(importError.message)
    } finally {
      setSyncing(false)
    }
  }

  const handleStudentFormChange = (event) => {
    const { name, value } = event.target
    setStudentForm((current) => ({ ...current, [name]: value }))
  }

  const handleStudentSave = async (event) => {
    event.preventDefault()
    if (!studentForm.student_name.trim()) {
      setError('학생 이름을 입력해 주세요.')
      return
    }

    setStudentSaving(true)
    setError('')
    setNotice('')
    try {
      const payload = {
        ...studentForm,
        student_name: studentForm.student_name.trim(),
      }
      const result = selectedStudentId
        ? await apiRequest(`/api/students/${selectedStudentId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiRequest('/api/students', {
            method: 'POST',
            body: JSON.stringify(payload),
          })

      await loadData()
      setSelectedStudentId(result.id)
      setNotice(selectedStudentId ? '학생 정보를 수정했습니다.' : '새 학생을 등록했습니다.')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setStudentSaving(false)
    }
  }

  const handleCreateStudent = () => {
    setSelectedStudentId(null)
    setStudentForm(createStudentForm())
    setEventForm(createEventForm())
    setEditingEventId(null)
    setError('')
    setNotice('')
  }

  const handleEventFormChange = (event) => {
    const { name, value } = event.target
    setEventForm((current) => ({ ...current, [name]: value }))
  }

  const handleEventEdit = (eventItem) => {
    setEditingEventId(eventItem.id)
    setEventForm(createEventForm(eventItem))
    setError('')
    setNotice('')
  }

  const resetEventEditor = () => {
    setEditingEventId(null)
    setEventForm(createEventForm())
  }

  const handleEventSave = async (event) => {
    event.preventDefault()
    if (!selectedStudentId) {
      setError('먼저 학생을 선택하거나 저장해 주세요.')
      return
    }
    if (!eventForm.title.trim()) {
      setError('이벤트 제목을 입력해 주세요.')
      return
    }

    setEventSaving(true)
    setError('')
    setNotice('')
    try {
      const payload = {
        ...eventForm,
        title: eventForm.title.trim(),
        event_type: eventForm.event_type.trim(),
        amount: eventForm.amount === '' ? null : Number(eventForm.amount),
      }

      if (editingEventId) {
        await apiRequest(`/api/student-events/${editingEventId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      } else {
        await apiRequest(`/api/students/${selectedStudentId}/events`, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }

      await loadData()
      setNotice(editingEventId ? '학생 이벤트를 수정했습니다.' : '학생 이벤트를 추가했습니다.')
      resetEventEditor()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setEventSaving(false)
    }
  }

  const handleEventDelete = async (eventId) => {
    const confirmed = window.confirm('이 학생 이벤트를 삭제할까요?')
    if (!confirmed) {
      return
    }
    try {
      setError('')
      setNotice('')
      await apiRequest(`/api/student-events/${eventId}`, { method: 'DELETE' })
      await loadData()
      if (editingEventId === eventId) {
        resetEventEditor()
      }
      setNotice('학생 이벤트를 삭제했습니다.')
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  const months = data?.meta.available_months ?? []
  const dashboardMonths = useMemo(() => {
    const monthSet = new Set(data?.meta.calendar_months ?? [])
    if (monthSet.size === 0) {
      ;(data?.tuition_student_months ?? []).forEach((row) => {
        if (row.month) {
          monthSet.add(row.month)
        }
      })
      ;(data?.teacher_settlements ?? []).forEach((row) => {
        if (row.service_month) {
          monthSet.add(row.service_month)
        }
      })
      ;(data?.monthly_settlements ?? []).forEach((row) => {
        if (row.service_month) {
          monthSet.add(row.service_month)
        }
      })
      ;(data?.session_collections ?? []).forEach((row) => {
        if (row.service_month) {
          monthSet.add(row.service_month)
        }
      })
    }
    return [...monthSet].sort().reverse()
  }, [data])

  const teacherSettlements = teacherSettlementRows

  const teacherSettlementTotals = useMemo(
    () => ({
      gross_amount: sumBy(teacherSettlements, (row) => row.gross_amount),
      trial_fee: sumBy(teacherSettlements, (row) => row.trial_fee),
      net_amount: sumBy(teacherSettlements, (row) => row.net_amount),
    }),
    [teacherSettlements],
  )

  const settlementDetail = teacherSettlementDetail

  const tuitionStudentMonths = useMemo(() => {
    const query = studentQuery.trim().toLowerCase()
    return (data?.tuition_student_months ?? [])
      .filter((row) => {
        const matchesMonth =
          !selectedMonth ||
          row.month === selectedMonth ||
          teacherSettlements.some(
            (teacherRow) =>
              teacherRow.service_month === row.month && teacherRow.settlement_month === selectedMonth,
          )
        const haystack = [row.student_name, row.teacher_name, row.payment_method, row.charge_label]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return matchesMonth && (!query || haystack.includes(query))
      })
      .sort((left, right) => (left.student_name || '').localeCompare(right.student_name || ''))
  }, [data, selectedMonth, studentQuery, teacherSettlements])
  const students = useMemo(() => {
    const query = studentQuery.trim().toLowerCase()
    return (data?.students ?? []).filter((student) => {
      const haystack = [
        student.student_name,
        ...(student.teacher_names ?? []),
        student.current_product_name,
        student.current_payment_method,
        student.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return !query || haystack.includes(query)
    })
  }, [data, studentQuery])

  const productGroups = useMemo(() => {
    return (data?.product_prices ?? []).reduce((accumulator, row) => {
      if (!accumulator[row.table_name]) {
        accumulator[row.table_name] = []
      }
      accumulator[row.table_name].push(row)
      return accumulator
    }, {})
  }, [data])

  const orderedProductGroups = useMemo(() => {
    const orderedEntries = PRODUCT_GROUP_ORDER.filter((groupName) => productGroups[groupName]).map((groupName) => [
      groupName,
      productGroups[groupName],
    ])
    const remainingEntries = Object.entries(productGroups).filter(
      ([groupName]) => !PRODUCT_GROUP_ORDER.includes(groupName),
    )
    return [...orderedEntries, ...remainingEntries]
  }, [productGroups])

  const rateSections = useMemo(() => {
    return (data?.rate_table_rows ?? []).reduce((accumulator, row) => {
      const section = row.section_name || '기본'
      if (!accumulator[section]) {
        accumulator[section] = []
      }
      accumulator[section].push(row)
      return accumulator
    }, {})
  }, [data])

  const catalogTabs = useMemo(() => {
    const productTabs = orderedProductGroups.map(([groupName]) => ({
      id: `product:${groupName}`,
      type: 'product',
      key: groupName,
      label: PRODUCT_GROUP_META[groupName]?.title ?? groupName,
      description: PRODUCT_GROUP_META[groupName]?.description ?? '현재 등록된 상품 금액표입니다.',
    }))
    const rateTabs = Object.keys(rateSections)
      .filter((sectionName) => !HIDDEN_RATE_SECTIONS.has(sectionName))
      .map((sectionName) => ({
        id: `rate:${sectionName}`,
        type: 'rate',
        key: sectionName,
        label: `${sectionName} 단가표`,
        description: '원본 단가표 구조를 유지해 확인할 수 있습니다.',
      }))
    return [...productTabs, ...rateTabs]
  }, [orderedProductGroups, rateSections])

  useEffect(() => {
    if (catalogTabs.length === 0) {
      if (selectedCatalogTab) {
        setSelectedCatalogTab('')
      }
      return
    }

    if (!catalogTabs.some((tab) => tab.id === selectedCatalogTab)) {
      setSelectedCatalogTab(catalogTabs[0].id)
    }
  }, [catalogTabs, selectedCatalogTab])

  const activeCatalogTab = useMemo(() => {
    if (catalogTabs.length === 0) {
      return null
    }
    return catalogTabs.find((tab) => tab.id === selectedCatalogTab) ?? catalogTabs[0]
  }, [catalogTabs, selectedCatalogTab])

  const activeCatalogSchoolTables = useMemo(() => {
    if (!activeCatalogTab || activeCatalogTab.type !== 'product') {
      return []
    }
    return buildSchoolPriceTables(productGroups[activeCatalogTab.key] ?? [])
  }, [activeCatalogTab, productGroups])

  const activeCatalogTableRows = useMemo(
    () => buildCatalogTableRows(activeCatalogSchoolTables),
    [activeCatalogSchoolTables],
  )

  const dashboardMetricsByMonth = useMemo(() => {
    const sourceMonths =
      dashboardMonths.length > 0 ? dashboardMonths : data?.meta.calendar_months ?? data?.meta.available_months ?? []

    return sourceMonths.reduce((accumulator, month) => {
      const teacherRows = (data?.teacher_settlements ?? []).filter((row) => matchesServiceMonth(row, month))
      const monthlyRows = (data?.monthly_settlements ?? []).filter((row) => matchesServiceMonth(row, month))
      const sessionRows = (data?.session_settlements ?? []).filter((row) => matchesServiceMonth(row, month))
      const collectionRows = (data?.session_collections ?? []).filter((row) => matchesServiceMonth(row, month))
      const tuitionRows = (data?.tuition_student_months ?? []).filter((row) => row.month === month)

      const tuitionSheetRevenue = sumValues(tuitionRows, (row) => row.amount)
      const monthlySettlementRevenue = sumValues(monthlyRows, (row) => row.total_tuition)
      const monthlyRevenue = tuitionSheetRevenue > 0 ? tuitionSheetRevenue : monthlySettlementRevenue
      const sessionRevenueFromRows = sumValues(
        sessionRows,
        (row) => (row.first_payment_fee ?? 0) + (row.recurring_payment_fee ?? 0) - (row.refund_payment_fee ?? 0),
      )
      const sessionRevenueFromCollections = sumValues(collectionRows, (row) => row.current_month_amount)
      const sessionRevenue = sessionRevenueFromCollections > 0 ? sessionRevenueFromCollections : sessionRevenueFromRows
      const totalRevenue = monthlyRevenue + sessionRevenue

      const trialSettlementAmount = sumValues(monthlyRows, (row) => row.trial_lesson_amount)
      const regularSettlementAmount = sumValues(
        teacherRows,
        (row) =>
          (row.final_pretax_amount ?? 0) -
          (row.monthly_trial_amount ?? 0) -
          (row.session_trial_amount ?? 0),
      )
      const teacherPretaxPayout = sumValues(teacherRows, (row) => row.final_pretax_amount)
      const netProfitAmount = totalRevenue - teacherPretaxPayout

      const activeStudentNames = new Set()
      tuitionRows.forEach((row) => {
        if (row.student_name && (row.amount ?? 0) > 0) {
          activeStudentNames.add(row.student_name)
        }
      })
      collectionRows.forEach((row) => {
        if (!row.student_name) {
          return
        }
        if (
          isLessonActiveInMonth(row.lesson_start_date, row.lesson_end_date, month) &&
          (row.current_month_amount ?? 0) > 0
        ) {
          activeStudentNames.add(row.student_name)
        }
      })
      const activeStudentCount =
        activeStudentNames.size > 0
          ? activeStudentNames.size
          : teacherRows.length > 0
            ? sumValues(teacherRows, (row) => row.student_count)
            : sumValues(monthlyRows, (row) => row.student_count) + sumValues(sessionRows, (row) => row.student_count)

      const activeTeacherNames = new Set()
      tuitionRows.forEach((row) => {
        if (row.teacher_name && (row.amount ?? 0) > 0) {
          activeTeacherNames.add(row.teacher_name)
        }
      })
      ;[...monthlyRows, ...sessionRows, ...teacherRows, ...collectionRows].forEach((row) => {
        if (!row.teacher_name) {
          return
        }
        const hasAmount =
          (row.total_tuition ?? 0) > 0 ||
          (row.current_month_amount ?? 0) > 0 ||
          (row.final_pretax_amount ?? 0) > 0 ||
          (row.student_count ?? 0) > 0
        if (hasAmount) {
          activeTeacherNames.add(row.teacher_name)
        }
      })

      const addPaymentMethodAmount = (result, rawMethod, amount) => {
        const key = normalizePaymentMethodLabel(rawMethod)
        if (!key || !amount) {
          return
        }
        result[key] = (result[key] ?? 0) + amount
      }

      const paymentMethodRevenueRows = (data?.payment_method_revenues ?? []).filter((row) => row.month === month)
      const paymentMethodAmounts = paymentMethodRevenueRows.reduce((result, row) => {
        addPaymentMethodAmount(result, row.payment_method, row.amount ?? 0)
        return result
      }, {})

      if (paymentMethodRevenueRows.length === 0) {
        tuitionRows.forEach((row) => {
          addPaymentMethodAmount(paymentMethodAmounts, row.payment_method, row.amount ?? 0)
        })
        collectionRows.forEach((row) => {
          addPaymentMethodAmount(paymentMethodAmounts, row.payment_method, row.current_month_amount ?? 0)
        })
      }

      accumulator[month] = {
        month,
        totalRevenue,
        sessionRevenue,
        monthlyRevenue,
        regularSettlementAmount,
        trialSettlementAmount,
        teacherPretaxPayout,
        netProfitAmount,
        activeStudentCount,
        activeTeacherCount: activeTeacherNames.size,
        activeUserCount: activeStudentCount + activeTeacherNames.size,
        paymentMethodAmounts,
      }
      return accumulator
    }, {})
  }, [data, dashboardMonths])

  const dashboardMonth = selectedMonth || dashboardMonths[0] || ''
  const dashboardMetrics = dashboardMetricsByMonth[dashboardMonth] ?? null
  const dashboardMonthIndex = dashboardMonths.indexOf(dashboardMonth)
  const previousMonthKey = dashboardMonthIndex >= 0 ? months[dashboardMonthIndex + 1] : null
  const threeMonthsAgoKey = dashboardMonthIndex >= 0 ? months[dashboardMonthIndex + 3] : null
  const previousMonthMetrics = previousMonthKey ? dashboardMetricsByMonth[previousMonthKey] : null
  const threeMonthsAgoMetrics = threeMonthsAgoKey ? dashboardMetricsByMonth[threeMonthsAgoKey] : null

  const studentTrendItems = useMemo(() => {
    if (!dashboardMonth || dashboardMonths.length === 0) {
      return []
    }
    const startIndex = Math.max(dashboardMonthIndex, 0)
    const trendMonths = dashboardMonths.slice(startIndex, startIndex + 6).reverse()

    return trendMonths.map((month) => ({
      month,
      studentCount: dashboardMetricsByMonth[month]?.activeStudentCount ?? 0,
      teacherCount: dashboardMetricsByMonth[month]?.activeTeacherCount ?? 0,
      isCurrent: month === dashboardMonth,
    }))
  }, [dashboardMetricsByMonth, dashboardMonth, dashboardMonthIndex, dashboardMonths])

  const trialLessonDetails = useMemo(() => {
    if (!dashboardMonth || !data) {
      return []
    }
    return buildTrialLessonItems(data, dashboardMonth)
  }, [data, dashboardMonth])

  const paymentMethodItems = useMemo(() => {
    if (!dashboardMetrics) {
      return []
    }
    const amounts = dashboardMetrics.paymentMethodAmounts ?? {}
    const extras = Object.keys(amounts).filter((key) => !PAYMENT_METHOD_ORDER.includes(key))

    return [...PAYMENT_METHOD_ORDER, ...extras.sort()].map((paymentMethod) => ({
      paymentMethod,
      amount: amounts[paymentMethod] ?? 0,
    }))
  }, [dashboardMetrics])

  useEffect(() => {
    setShowTrialDetails(false)
  }, [dashboardMonth])

  const pageTitle =
    NAV_ITEMS.find((item) => item.id === selectedPage)?.label ?? '정산 관리'
  const monthFilterOptions = selectedPage === 'dashboard' ? dashboardMonths : months

  const renderDashboard = () => {
    if (!dashboardMetrics) {
      return <div className="empty-state compact">선택한 월의 대시보드 데이터를 계산할 수 없습니다.</div>
    }

    const studentDelta = previousMonthMetrics
      ? dashboardMetrics.activeStudentCount - previousMonthMetrics.activeStudentCount
      : null
    const studentDelta3m = threeMonthsAgoMetrics
      ? dashboardMetrics.activeStudentCount - threeMonthsAgoMetrics.activeStudentCount
      : null
    const teacherDelta = previousMonthMetrics
      ? dashboardMetrics.activeTeacherCount - previousMonthMetrics.activeTeacherCount
      : null
    const profitDelta = previousMonthMetrics
      ? dashboardMetrics.netProfitAmount - previousMonthMetrics.netProfitAmount
      : null
    const revenueDelta = previousMonthMetrics
      ? dashboardMetrics.totalRevenue - previousMonthMetrics.totalRevenue
      : null

    return (
      <>
        <section className="stats-grid">
          <StatCard
            label="이번달 총 매출"
            value={formatCurrency(dashboardMetrics.totalRevenue)}
            valueClassName="stat-value--primary"
            delta={<DeltaCaption value={revenueDelta} />}
            breakdown={
              <div className="revenue-breakdown">
                <div className="revenue-breakdown__item">
                  <span>월별</span>
                  <strong>{formatCurrency(dashboardMetrics.monthlyRevenue)}</strong>
                </div>
                <div className="revenue-breakdown__item">
                  <span>회당</span>
                  <strong>{formatCurrency(dashboardMetrics.sessionRevenue)}</strong>
                </div>
              </div>
            }
          />
          <article className="stat-card stat-card--stacked">
            <span>순수익</span>
            <strong>{formatCurrency(dashboardMetrics.netProfitAmount)}</strong>
            <DeltaCaption value={profitDelta} />
            <div className="stat-card__detail">
              <small>실 지급금액 {formatCurrency(dashboardMetrics.teacherPretaxPayout)}</small>
            </div>
          </article>
          <StatCard
            label="시범수업 정산"
            value={formatCurrency(dashboardMetrics.trialSettlementAmount)}
            caption={showTrialDetails ? '상세 목록 닫기' : '클릭하면 시범수업 내역 보기'}
            onClick={() => setShowTrialDetails((current) => !current)}
            isActive={showTrialDetails}
          />
          <StatCard
            label="수업 학생"
            value={`${formatNumber(dashboardMetrics.activeStudentCount)}명`}
            className="stat-card--user"
            caption={[
              studentDelta !== null ? `전월 ${formatSignedNumber(studentDelta)}명` : null,
              studentDelta3m !== null ? `3개월 전 ${formatSignedNumber(studentDelta3m)}명` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
          <StatCard
            label="수업 선생님"
            value={`${formatNumber(dashboardMetrics.activeTeacherCount)}명`}
            className="stat-card--user"
            caption={
              teacherDelta !== null ? `전월 ${formatSignedNumber(teacherDelta)}명` : '정산·수업 발생 기준'
            }
          />
        </section>

        {showTrialDetails ? (
          <section className="trial-detail-panel">
            <div className="trial-detail-panel__header">
              <h3>시범수업 내역</h3>
              <span>{formatNumber(trialLessonDetails.length)}건</span>
            </div>
            {trialLessonDetails.length === 0 ? (
              <div className="empty-state compact">
                선택한 달(1일~말일) 시범수업일이 시트에 없습니다. 회당 수금표 「시범수업 날짜」 또는 5월
                열에 날짜를 넣은 뒤 워크북을 다시 업로드해 주세요.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>시범수업일</th>
                      <th>학생</th>
                      <th>선생님</th>
                      <th>출처</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trialLessonDetails.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.date)}</td>
                        <td>{row.student_name}</td>
                        <td>{row.teacher_name}</td>
                        <td>{row.sourceLabel || '-'}</td>
                        <td>
                          {row.inMonth
                            ? '당월 시범'
                            : `당월 수업 시작 · 시범 ${formatMonthShort(String(row.date).slice(0, 7))}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        <div className="content-columns">
          <SectionCard
            title="학생 수 추이"
            description="최근 6개월 학생 수 변화를 곡선 그래프로 표시합니다."
          >
            <StudentTrendLineChart items={studentTrendItems} />
          </SectionCard>

          <SectionCard
            title="결제 수단별 수금"
            description="수업료 관리(월별)와 회당 수금표를 계좌이체·카드·납부자·결제·CMS 순으로 합산합니다."
          >
            {paymentMethodItems.every((item) => item.amount <= 0) ? (
              <div className="empty-state compact">선택한 월의 결제 수단 데이터가 없습니다.</div>
            ) : (
              <div className="metric-list">
                {paymentMethodItems.map((item) => (
                  <div
                    className={`metric-item${item.amount <= 0 ? ' metric-item--muted' : ''}`}
                    key={item.paymentMethod}
                  >
                    <span>{item.paymentMethod}</span>
                    <strong>{formatCurrency(item.amount)}</strong>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </>
    )
  }

  const renderStudents = () => (
    <div className="students-layout">
      <SectionCard
        title="학생 목록"
        description="학생 수납·수업 매칭을 관리합니다. 정산 요약은 「선생님 정산」 탭을 이용하세요."
        actions={
          <button type="button" className="secondary-button" onClick={handleCreateStudent}>
            새 학생 추가
          </button>
        }
      >
        <div className="student-list">
          {students.map((student) => (
            <button
              key={student.id}
              type="button"
              className={student.id === selectedStudentId ? 'student-list-item active' : 'student-list-item'}
              onClick={() => setSelectedStudentId(student.id)}
            >
              <div>
                <strong>{student.student_name}</strong>
                <span>
                  {student.teacher_names?.length > 0 ? student.teacher_names.join(', ') : '담당 선생님 미확인'}
                </span>
              </div>
              <div className="student-list-item__meta">
                <span>{student.status || '상태 미입력'}</span>
                <span>시작 {formatDate(student.first_start_date)}</span>
              </div>
            </button>
          ))}
        </div>
      </SectionCard>

      <div className="student-detail">
        <SectionCard
          title={selectedStudent ? `${selectedStudent.student_name} 관리` : '새 학생 등록'}
          description="학생 기본 정보는 직접 수정할 수 있고, 원본 수업 이력은 아래에 함께 표시됩니다."
        >
          <form className="editor-form" onSubmit={handleStudentSave}>
            <div className="editor-grid">
              <label>
                학생 이름
                <input name="student_name" value={studentForm.student_name} onChange={handleStudentFormChange} />
              </label>
              <label>
                보호자명
                <input name="parent_name" value={studentForm.parent_name} onChange={handleStudentFormChange} />
              </label>
              <label>
                연락처
                <input name="contact" value={studentForm.contact} onChange={handleStudentFormChange} />
              </label>
              <label>
                결제 수단
                <select name="payment_method" value={studentForm.payment_method} onChange={handleStudentFormChange}>
                  <option value="">선택</option>
                  {PAYMENT_METHOD_ORDER.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                상태
                <input name="status" value={studentForm.status} onChange={handleStudentFormChange} />
              </label>
            </div>
            <label>
              메모
              <textarea name="notes" rows="4" value={studentForm.notes} onChange={handleStudentFormChange} />
            </label>
            <div className="editor-actions">
              <button type="submit" className="primary-button" disabled={studentSaving}>
                {studentSaving ? '저장 중...' : selectedStudentId ? '학생 정보 저장' : '학생 등록'}
              </button>
            </div>
          </form>

          {selectedStudent ? (
            <div className="student-summary-grid">
              <StatCard label="시범수업일" value={formatDate(selectedStudent.first_trial_date)} />
              <StatCard label="수업 시작일" value={formatDate(selectedStudent.first_start_date)} />
              <StatCard
                label="결제 수단"
                value={selectedStudent.payment_method || selectedStudent.current_payment_method || '-'}
              />
              <StatCard label="현재 수업" value={selectedStudent.current_product_name || '-'} />
            </div>
          ) : null}
        </SectionCard>

        {selectedStudent ? (
          <>
            <SectionCard
              title="수업 매칭 · 스케줄"
              description="담당 선생님, 요금제, 시범/시작/종료일, 수업 요일·시간입니다."
            >
              {selectedStudentEnrollments.length === 0 ? (
                <div className="empty-state compact">등록된 수업 매칭이 없습니다.</div>
              ) : (
                <div className="enrollment-grid">
                  {selectedStudentEnrollments.map((row) => (
                    <article className="enrollment-card" key={row.id}>
                      <div className="enrollment-card__top">
                        <h4>{row.teacher_name}</h4>
                        <span className="pill">{row.billing_plan_label || row.billing_plan}</span>
                      </div>
                      <dl>
                        <div>
                          <dt>시범수업</dt>
                          <dd>{formatDate(row.trial_lesson_date)}</dd>
                        </div>
                        <div>
                          <dt>정규 시작</dt>
                          <dd>{formatDate(row.lesson_start_date)}</dd>
                        </div>
                        <div>
                          <dt>종료</dt>
                          <dd>{formatDate(row.lesson_end_date)}</dd>
                        </div>
                        <div>
                          <dt>현재 스케줄</dt>
                          <dd>
                            {[
                              row.current_schedule?.course,
                              row.current_schedule?.weekly_frequency,
                              row.current_schedule?.weekdays,
                              row.current_schedule?.time_text,
                            ]
                              .filter(Boolean)
                              .join(' · ') || '-'}
                          </dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="회당 수납 이력"
              description="회당 수금표에서 불러온 학생별 수납·수업 횟수입니다."
            >
              <DataTable
                rows={selectedStudent.imported_rows ?? []}
                emptyMessage="회당 수납 이력이 없습니다."
                columns={[
                  { key: 'trial_lesson_date', label: '시범수업일', render: formatDate },
                  { key: 'lesson_start_date', label: '시작일', render: formatDate },
                  { key: 'lesson_end_date', label: '종료일', render: formatDate },
                  { key: 'teacher_name', label: '선생님' },
                  { key: 'payment_method', label: '결제' },
                  { key: 'product_name', label: '상품명' },
                  { key: 'weekly_frequency', label: '주별 횟수' },
                  { key: 'weekdays', label: '요일' },
                  { key: 'time_text', label: '시간' },
                  { key: 'current_month_sessions', label: '횟수' },
                  { key: 'current_month_amount', label: '금액', render: formatCurrency },
                ]}
              />
            </SectionCard>

            <SectionCard
              title="원본 수업 / 결제 이력"
              description="같은 학생에게 여러 줄이 있으면 일정 변경, 상품 변경, 결제 방식 변경 이력을 뜻합니다."
            >
              <DataTable
                rows={selectedStudent.imported_rows ?? []}
                emptyMessage="원본 시트에서 불러온 학생 이력이 없습니다."
                columns={[
                  { key: 'trial_lesson_date', label: '시범수업일', render: formatDate },
                  { key: 'lesson_start_date', label: '시작일', render: formatDate },
                  { key: 'lesson_end_date', label: '종료일', render: formatDate },
                  { key: 'teacher_name', label: '선생님' },
                  { key: 'payment_method', label: '결제' },
                  { key: 'product_name', label: '상품명' },
                  { key: 'weekly_frequency', label: '주별 횟수' },
                  { key: 'weekdays', label: '요일' },
                  { key: 'time_text', label: '시간' },
                  { key: 'current_month_amount', label: '금액', render: formatCurrency },
                ]}
              />
            </SectionCard>

            <SectionCard
              title="변경 / 메모 이력"
              description="일정 변경, 결제 방식 변경, 시작/종료 메모를 직접 추가할 수 있습니다."
            >
              <form className="editor-form" onSubmit={handleEventSave}>
                <div className="editor-grid three-columns">
                  <label>
                    날짜
                    <input name="event_date" type="date" value={eventForm.event_date} onChange={handleEventFormChange} />
                  </label>
                  <label>
                    유형
                    <select name="event_type" value={eventForm.event_type} onChange={handleEventFormChange}>
                      <option value="시범수업">시범수업</option>
                      <option value="시작">시작</option>
                      <option value="일정변경">일정변경</option>
                      <option value="결제변경">결제변경</option>
                      <option value="일시중지">일시중지</option>
                      <option value="종료">종료</option>
                      <option value="메모">메모</option>
                    </select>
                  </label>
                  <label>
                    제목
                    <input name="title" value={eventForm.title} onChange={handleEventFormChange} />
                  </label>
                  <label>
                    선생님
                    <input name="teacher_name" value={eventForm.teacher_name} onChange={handleEventFormChange} />
                  </label>
                  <label>
                    결제 방식
                    <input name="payment_method" value={eventForm.payment_method} onChange={handleEventFormChange} />
                  </label>
                  <label>
                    금액
                    <input name="amount" type="number" value={eventForm.amount} onChange={handleEventFormChange} />
                  </label>
                  <label>
                    주별 횟수
                    <input
                      name="weekly_frequency"
                      value={eventForm.weekly_frequency}
                      onChange={handleEventFormChange}
                    />
                  </label>
                  <label>
                    요일
                    <input name="weekdays" value={eventForm.weekdays} onChange={handleEventFormChange} />
                  </label>
                  <label>
                    시간
                    <input name="time_text" value={eventForm.time_text} onChange={handleEventFormChange} />
                  </label>
                </div>
                <div className="editor-grid">
                  <label>
                    상품명
                    <input name="product_name" value={eventForm.product_name} onChange={handleEventFormChange} />
                  </label>
                </div>
                <label>
                  메모
                  <textarea name="memo" rows="3" value={eventForm.memo} onChange={handleEventFormChange} />
                </label>
                <div className="editor-actions">
                  <button type="submit" className="primary-button" disabled={eventSaving}>
                    {eventSaving ? '저장 중...' : editingEventId ? '이벤트 수정' : '이벤트 추가'}
                  </button>
                  {editingEventId ? (
                    <button type="button" className="secondary-button" onClick={resetEventEditor}>
                      새 이벤트 입력
                    </button>
                  ) : null}
                </div>
              </form>

              <div className="timeline-list">
                {(selectedStudent.manual_events ?? []).length === 0 ? (
                  <div className="empty-state compact">직접 입력한 학생 이력이 아직 없습니다.</div>
                ) : (
                  selectedStudent.manual_events.map((eventItem) => (
                    <div className="timeline-item" key={eventItem.id}>
                      <div>
                        <strong>
                          {formatDate(eventItem.event_date)} · {eventItem.event_type}
                        </strong>
                        <p>{eventItem.title}</p>
                        <span>
                          {[eventItem.payment_method, eventItem.product_name, eventItem.weekdays, eventItem.time_text]
                            .filter(Boolean)
                            .join(' / ')}
                        </span>
                        {eventItem.memo ? <small>{eventItem.memo}</small> : null}
                      </div>
                      <div className="timeline-actions">
                        <button type="button" className="ghost-button" onClick={() => handleEventEdit(eventItem)}>
                          수정
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => handleEventDelete(eventItem.id)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </>
        ) : null}
      </div>
    </div>
  )

  const renderTeacherSettlements = () => (
    <>
      <SectionCard
        title="전체 정산 내역"
        description="선생님별로 이번 달(선택 월) 정산 금액을 한눈에 봅니다. 선생님을 클릭하면 상세 내역을 확인할 수 있습니다."
        actions={
          <span className="summary-chip">
            지급 합계 {formatCurrency(teacherSettlementTotals.net_amount)}
          </span>
        }
      >
        {teacherSettlementError ? <div className="banner error">{teacherSettlementError}</div> : null}
        {teacherSettlementLoading ? (
          <div className="empty-state compact">불러오는 중...</div>
        ) : teacherSettlements.length === 0 ? (
          <div className="empty-state compact">선택한 월의 정산 데이터가 없습니다.</div>
        ) : (
          <div className="table-wrap settlement-overview-wrap">
            <table className="settlement-overview-table">
              <thead>
                <tr>
                  <th>선생님</th>
                  <th>정산 구분</th>
                  <th>총매출</th>
                  <th>시범수업비</th>
                  <th>지급액(순수익)</th>
                </tr>
              </thead>
              <tbody>
                {teacherSettlements.map((row, index) => (
                  <tr key={`${row.teacher_id}-${row.settlement_type}-${index}`}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={async () => {
                          try {
                            const detail = await apiRequest(
                              `/api/teachers/${row.teacher_id}/settlements/${encodeURIComponent(row.billing_month)}`,
                            )
                            setTeacherSettlementDetail(detail)
                          } catch (loadError) {
                            setTeacherSettlementError(loadError.message)
                          }
                        }}
                      >
                        {row.teacher_name}
                      </button>
                      <small className="table-sub">정산월 {formatMonthShort(row.billing_month)}</small>
                    </td>
                    <td>{row.settlement_type === 'per_session' ? '회당' : '월별'}</td>
                    <td>{formatCurrency(row.gross_amount)}</td>
                    <td>{formatCurrency(row.trial_fee)}</td>
                    <td>{formatCurrency(row.net_amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>합계</td>
                  <td>-</td>
                  <td>{formatCurrency(teacherSettlementTotals.gross_amount)}</td>
                  <td>{formatCurrency(teacherSettlementTotals.trial_fee)}</td>
                  <td>{formatCurrency(teacherSettlementTotals.net_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>
      <SettlementDetailModal detail={settlementDetail} onClose={() => setTeacherSettlementDetail(null)} />
    </>
  )

  const renderTuitionManagement = () => (
    <SectionCard
      title="학생별 수납 내역"
      description="수업료 관리 시트 기준 — 학생 중심 수납(월별 결제) 데이터입니다. 선생님 정산은 「선생님 정산」 탭에서 확인하세요."
      actions={
        <span className="summary-chip">
          수납 합계 {formatCurrency(sumBy(tuitionStudentMonths, (row) => row.amount))}
        </span>
      }
    >
      <DataTable
        rows={tuitionStudentMonths}
        columns={[
          { key: 'month', label: '수업월', render: formatMonthLabel },
          { key: 'student_name', label: '학생' },
          { key: 'teacher_name', label: '담당 선생님' },
          { key: 'payment_method', label: '결제수단' },
          { key: 'charge_label', label: '청구' },
          { key: 'amount', label: '수납액', render: formatCurrency },
          { key: 'regular_tuition', label: '정기 수업료', render: formatCurrency },
        ]}
        emptyMessage="선택한 기간의 학생 수납 데이터가 없습니다."
      />
    </SectionCard>
  )

  const renderCatalogs = () => (
    <SectionCard
      title="상품 / 단가표"
      description="스크롤 대신 탭으로 전환하면서 상품표와 단가표를 바로 확인할 수 있습니다."
    >
      {catalogTabs.length === 0 ? (
        <div className="empty-state compact">등록된 상품표가 없습니다.</div>
      ) : (
        <div className="catalog-browser">
          <div className="tab-list">
            {catalogTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={tab.id === activeCatalogTab?.id ? 'tab-button active' : 'tab-button'}
                onClick={() => setSelectedCatalogTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="catalog-panel">
            <div className="catalog-panel__header">
              <div>
                <h3>{activeCatalogTab?.label}</h3>
                <p>{activeCatalogTab?.description}</p>
              </div>
              <span className="summary-chip">
                {activeCatalogTab?.type === 'product'
                  ? `${formatNumber((productGroups[activeCatalogTab.key] ?? []).length)}개 상품`
                  : `${formatNumber((rateSections[activeCatalogTab?.key] ?? []).length)}개 행`}
              </span>
            </div>

            {activeCatalogTab?.type === 'product' ? (
              activeCatalogSchoolTables.length > 0 ? (
                <div className="tuition-guide">
                  <div className="tuition-guide__table table-wrap catalog-table-wrap">
                    <table className="catalog-price-table">
                      <thead>
                        <tr>
                          <th>학년</th>
                          <th>수업 횟수</th>
                          <th>60분</th>
                          <th>90분</th>
                          <th>120분</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeCatalogTableRows.map((row) => (
                          <tr key={`${activeCatalogTab.key}-${row.school}-${row.frequency}`}>
                            <th>{row.school}</th>
                            <td>
                              <div className="frequency-cell">
                                <strong>{row.frequency}</strong>
                                {buildFrequencyCaption(row.frequency, activeCatalogTab.key) ? (
                                  <span>{buildFrequencyCaption(row.frequency, activeCatalogTab.key)}</span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <div className="price-cell">
                                <strong>{row.amount60 ? formatCurrency(row.amount60) : '-'}</strong>
                                {buildMonthlyEquivalent(row.amount60, row.frequency, activeCatalogTab.key) ? (
                                  <small>{buildMonthlyEquivalent(row.amount60, row.frequency, activeCatalogTab.key)}</small>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <div className="price-cell">
                                <strong>{row.amount90 ? formatCurrency(row.amount90) : '-'}</strong>
                                {buildMonthlyEquivalent(row.amount90, row.frequency, activeCatalogTab.key) ? (
                                  <small>{buildMonthlyEquivalent(row.amount90, row.frequency, activeCatalogTab.key)}</small>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <div className="price-cell">
                                <strong>{row.amount120 ? formatCurrency(row.amount120) : '-'}</strong>
                                {buildMonthlyEquivalent(row.amount120, row.frequency, activeCatalogTab.key) ? (
                                  <small>{buildMonthlyEquivalent(row.amount120, row.frequency, activeCatalogTab.key)}</small>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <ul className="catalog-notes">
                    <li>{buildCatalogNotice(activeCatalogTab.key)}</li>
                  </ul>
                </div>
              ) : (
                <div className="catalog-list">
                  {(productGroups[activeCatalogTab.key] ?? []).map((row) => (
                    <div className="catalog-item" key={`${activeCatalogTab.key}-${row.product_name}`}>
                      <span>{row.product_name}</span>
                      <strong>{formatCurrency(row.amount)}</strong>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="table-wrap catalog-table-wrap">
                <table>
                  <tbody>
                    {(rateSections[activeCatalogTab?.key] ?? []).map((row) => (
                      <tr key={row.id}>
                        <th>{row.row_label || ''}</th>
                        {row.values.map((value, index) => (
                          <td key={`${row.id}-${index}`}>{value || '-'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  )

  const renderDataOverview = () => (
    <DataOverviewView
      onOpenAdmin={(table) => {
        setDataAdminTable(table ?? null)
        setSelectedPage('data-admin')
      }}
    />
  )

  const renderDataAdmin = () => (
    <DataAdminView initialTable={dataAdminTable} onDataChanged={loadData} />
  )

  const renderDataModel = () => {
    const model = data?.data_model
    if (!model) {
      return (
        <div className="empty-state">
          {dataModelLoading ? '데이터 구조를 불러오는 중입니다...' : '데이터 구조 정보를 불러오지 못했습니다. 백엔드를 재시작한 뒤 새로고침해 주세요.'}
        </div>
      )
    }

    return (
      <div className="data-model-page">
        <div className="data-model-intro">
          <p>
            전체 DB를 <strong>ER 다이어그램</strong>·<strong>화면별 테이블 매핑</strong>·
            <strong>테이블 사전</strong>으로 볼 수 있습니다. 테이블을 클릭하면 컬럼·연결·어느
            메뉴에서 쓰이는지 확인할 수 있어, 페이지 단위로 개발 지시를 내리기 쉽습니다.
          </p>
        </div>
        <DbSchemaView model={model} />
      </div>
    )
  }

  const renderCurrentPage = () => {
    if (!data && (selectedPage === 'data-overview' || selectedPage === 'data-admin')) {
      switch (selectedPage) {
        case 'data-overview':
          return renderDataOverview()
        case 'data-admin':
          return renderDataAdmin()
        default:
          return null
      }
    }

    if (!data) {
      return null
    }

    switch (selectedPage) {
      case 'students':
        return renderStudents()
      case 'teacher-settlements':
        return renderTeacherSettlements()
      case 'tuition':
        return renderTuitionManagement()
      case 'catalogs':
        return renderCatalogs()
      case 'data-model':
        return renderDataModel()
      case 'data-overview':
        return renderDataOverview()
      case 'data-admin':
        return renderDataAdmin()
      default:
        return renderDashboard()
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true">
              B
            </div>
            <div className="brand-text">
              <strong>보다수학</strong>
              <span>운영 · 정산 관리</span>
            </div>
          </div>

          <nav className="gnb">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === selectedPage ? 'gnb-item active' : 'gnb-item'}
                onClick={() => setSelectedPage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="app-header__meta">
            <div className="header-sync">
              <span>동기화</span>
              <strong>{data?.meta.source_name || '미동기화'}</strong>
            </div>
            <span className="header-user">운영자</span>
          </div>
        </div>
      </header>

      <main className="page-shell">
        <section className="page-panel">
          <header className="page-panel__header">
            <div className="page-heading">
              <p className="eyebrow">{pageTitle}</p>
              <h2 className="topbar__title">{pageTitle}</h2>
              <p className="topbar__description">
                {selectedPage === 'students'
                  ? '학생별 수납·수업 매칭과 이력을 관리합니다.'
                  : selectedPage === 'teacher-settlements'
                  ? '전체 정산은 요약만, 선생님 이름을 누르면 학생별 상세 정산을 확인합니다.'
                  : selectedPage === 'tuition'
                  ? '수업료 관리 시트의 학생 수납(월별) 내역입니다.'
                  : selectedPage === 'data-model'
                  ? '학생(납부)·선생님(정산) 사용자 유형과 DB 테이블·연결 현황입니다.'
                  : selectedPage === 'data-overview'
                  ? '17개 테이블의 전체 행·컬럼을 한 페이지에서 확인합니다. 상단 칩으로 테이블로 이동할 수 있습니다.'
                  : selectedPage === 'data-admin'
                  ? '테이블별 데이터를 조회·수정·삭제합니다. 컬럼 설명은 오른쪽 패널을 참고하세요.'
                  : selectedPage === 'dashboard' && selectedMonth
                  ? `${formatMonth(selectedMonth)} 1일~말일 운영 현황입니다.`
                  : selectedMonth
                  ? `${formatMonth(selectedMonth)} 정산월 기준으로 필터링된 결과입니다.`
                  : '전체 데이터를 보고 있습니다.'}
              </p>
              <small className="page-heading__meta">
                마지막 동기화 {formatDateTime(data?.meta.last_imported_at)}
              </small>
            </div>

            <div className="toolbar">
              {selectedPage !== 'students' &&
              selectedPage !== 'data-model' &&
              selectedPage !== 'data-overview' &&
              selectedPage !== 'data-admin' ? (
                <label className="toolbar-field">
                  <span>{selectedPage === 'dashboard' ? '조회 월' : '정산월 선택'}</span>
                  <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                    {monthFilterOptions.map((month) => (
                      <option key={month} value={month}>
                        {formatMonth(month)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {selectedPage === 'students' || selectedPage === 'tuition' ? (
                <label className="toolbar-field">
                  <span>학생 검색</span>
                  <input
                    value={studentQuery}
                    onChange={(event) => setStudentQuery(event.target.value)}
                    placeholder="학생명, 선생님, 상품명"
                  />
                </label>
              ) : null}

              <label className="upload-button">
                <span>{syncing ? '동기화 중...' : '워크북 다시 업로드'}</span>
                <input
                  type="file"
                  accept=".xlsx,.xlsm,.xltx,.xltm"
                  onChange={handleWorkbookImport}
                  disabled={syncing}
                />
              </label>
            </div>
          </header>

          {notice ? <div className="banner success">{notice}</div> : null}
          {error ? <div className="banner error">{error}</div> : null}

          <div className="page-panel__body">
            {loading ? <div className="empty-state">데이터를 불러오는 중입니다...</div> : renderCurrentPage()}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
