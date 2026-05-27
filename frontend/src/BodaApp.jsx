import { useEffect, useMemo, useState } from 'react'
import { formatPaymentMethodLabel, SimpleBarChart, SimpleDonutChart } from './charts.jsx'
import DataAdminView from './DataAdminView.jsx'
import DataOverviewView from './DataOverviewView.jsx'
import DataRegisterView from './DataRegisterView.jsx'
import DbSchemaView from './DbSchemaView.jsx'
import './App.css'

const MAIN_NAV_ITEMS = [
  { id: 'dashboard', label: '대시보드' },
  { id: 'teacher-settlements', label: '선생님 정산' },
  { id: 'students', label: '학생 수납' },
  { id: 'catalogs', label: '상품 · 단가표' },
]

const DB_SUB_NAV = [
  { id: 'data-register', label: '데이터 등록', description: '사용자·수업·시범 등록' },
  { id: 'data-model', label: '데이터 구조', description: '테이블·관계·ERD' },
  { id: 'data-overview', label: 'DB 전체보기', description: '전 테이블 데이터 조회' },
  { id: 'data-admin', label: '데이터 관리', description: '행 단위 수정·삭제' },
]

const DB_PAGE_IDS = new Set(DB_SUB_NAV.map((item) => item.id))

function isDbPage(pageId) {
  return DB_PAGE_IDS.has(pageId)
}

const currencyFormatter = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
})

function formatCurrency(value) {
  return currencyFormatter.format(value ?? 0)
}

function settlementTypeLabel(settlementType) {
  if (settlementType === 'per_session') return '회당'
  if (settlementType === 'trial') return '시범'
  return '월별'
}

function formatMonth(value) {
  if (!value) return '-'
  const [y, m] = String(value).split('-')
  return `${y}년 ${m}월`
}

function formatMonthShort(value) {
  if (!value) return '-'
  const [, m] = String(value).split('-')
  return `${parseInt(m, 10)}월`
}

function formatMoM(value, rate) {
  if (value === null || value === undefined) return '전월 대비 —'
  const sign = value > 0 ? '+' : ''
  const amount = `${sign}${formatCurrency(value)}`
  if (rate === null || rate === undefined) return `전월 대비 ${amount}`
  return `전월 대비 ${amount} (${sign}${rate}%)`
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
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <div className="settlement-modal">
          <header className="settlement-modal__header">
            <div>
              <h3>{title}</h3>
            </div>
            <button type="button" className="secondary-button" onClick={onClose}>
              닫기
            </button>
          </header>
          <div>{children}</div>
        </div>
      </div>
    </div>
  )
}

export default function BodaApp() {
  const [selectedPage, setSelectedPage] = useState('dashboard')
  const [lastDbPage, setLastDbPage] = useState('data-register')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [dataAdminTable, setDataAdminTable] = useState(null)

  const [appData, setAppData] = useState(null)
  const [dashboardData, setDashboardData] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [productFilter, setProductFilter] = useState('all')
  const [paymentSummary, setPaymentSummary] = useState(null)

  const months = appData?.meta?.available_months ?? []

  const filteredProducts = useMemo(() => {
    const products = appData?.products ?? []
    if (productFilter === 'all') return products
    return products.filter((p) => p.billing_unit === productFilter)
  }, [appData?.products, productFilter])

  const productCounts = useMemo(() => {
    const products = appData?.products ?? []
    return {
      all: products.length,
      monthly: products.filter((p) => p.billing_unit === 'monthly').length,
      per_session: products.filter((p) => p.billing_unit === 'per_session').length,
    }
  }, [appData?.products])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await apiRequest('/api/app-data')
        if (!cancelled) {
          setAppData(res)
          setSelectedMonth((current) => current || res?.meta?.default_month || res?.meta?.latest_month || '')
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

  useEffect(() => {
    if (selectedPage !== 'dashboard' || !selectedMonth) return
    let cancelled = false
    const load = async () => {
      setDashboardLoading(true)
      try {
        const res = await apiRequest(`/api/dashboard?month=${encodeURIComponent(selectedMonth)}`)
        if (!cancelled) setDashboardData(res)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setDashboardLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedMonth])

  useEffect(() => {
    if ((selectedPage !== 'students' && selectedPage !== 'dashboard') || !selectedMonth) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await apiRequest(`/api/students/payment-summary?month=${encodeURIComponent(selectedMonth)}`)
        if (!cancelled) setPaymentSummary(res)
      } catch {
        if (!cancelled) setPaymentSummary(null)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedMonth])

  useEffect(() => {
    if (isDbPage(selectedPage)) {
      setLastDbPage(selectedPage)
    }
  }, [selectedPage])

  const pageMeta = useMemo(() => {
    if (isDbPage(selectedPage)) {
      const sub = DB_SUB_NAV.find((item) => item.id === selectedPage)
      return {
        eyebrow: '데이터베이스',
        title: sub?.label ?? 'DB',
        description: sub?.description ?? 'boda.db 스키마·데이터 운영',
      }
    }
    const main = MAIN_NAV_ITEMS.find((item) => item.id === selectedPage)
    return {
      eyebrow: '운영',
      title: main?.label ?? '정산 관리',
      description: null,
    }
  }, [selectedPage])

  const showMonthToolbar = !isDbPage(selectedPage)

  const renderDashboard = () => {
    if (dashboardLoading) return <div className="empty-state">대시보드를 불러오는 중...</div>
    const summary = dashboardData?.summary
    if (!summary) return <div className="empty-state">대시보드 데이터를 불러오지 못했습니다.</div>

    const revenueChartData = (dashboardData?.revenue_trend_6m ?? []).map((row) => ({
      label: formatMonthShort(row.month),
      value: row.gross_revenue,
    }))
    const studentChartData = (dashboardData?.student_trend_6m ?? []).map((row) => ({
      label: formatMonthShort(row.month),
      value: row.student_count,
    }))

    const momClass =
      summary.revenue_delta > 0 ? 'dash-sub muted-up' : summary.revenue_delta < 0 ? 'dash-sub muted-down' : 'dash-sub'

    return (
      <div className="dash-board">
        <header className="dash-board__head">
          <div>
            <h3 className="dash-board__title">{formatMonth(summary.billing_month)} 운영 현황</h3>
            <p className="dash-board__desc">
              학생 수납 기준 매출
              {summary.revenue_source === 'settlements' ? ' · 수납 스냅샷 없음(정산 데이터 대체)' : ''}
            </p>
          </div>
        </header>

        <div className="dash-kpi">
          <article className="kpi-card">
            <span className="kpi-card__label">총매출</span>
            <p className="kpi-card__value">{formatCurrency(summary.gross_revenue)}</p>
            <ul className="kpi-card__meta">
              <li>월별 {formatCurrency(summary.monthly_revenue)}</li>
              <li>회당 {formatCurrency(summary.per_session_revenue)}</li>
            </ul>
            <p className={momClass}>{formatMoM(summary.revenue_delta, summary.revenue_delta_rate)}</p>
          </article>

          <article className="kpi-card">
            <span className="kpi-card__label">순매출</span>
            <p className="kpi-card__value">{formatCurrency(summary.net_revenue)}</p>
            <ul className="kpi-card__meta">
              <li>선생님 정산 {formatCurrency(summary.teacher_settlement)}</li>
              <li>시범수업비 {formatCurrency(summary.trial_fee)}</li>
            </ul>
          </article>

          <article className="kpi-card kpi-card--compact">
            <span className="kpi-card__label">수강 학생</span>
            <p className="kpi-card__value">
              {summary.active_student_count}
              <span className="kpi-card__unit">명</span>
            </p>
          </article>

          <article className="kpi-card kpi-card--compact">
            <span className="kpi-card__label">활성 선생님</span>
            <p className="kpi-card__value">
              {summary.active_teacher_count}
              <span className="kpi-card__unit">명</span>
            </p>
          </article>
        </div>

        <div className="dash-charts">
          <section className="dash-chart-panel">
            <header>
              <h4>매출 추이</h4>
              <span>최근 6개월 · 학생 수납 합계</span>
            </header>
            <SimpleBarChart
              data={revenueChartData}
              formatValue={(v) => `${Math.round(v / 10000).toLocaleString('ko-KR')}만`}
            />
          </section>
          <section className="dash-chart-panel">
            <header>
              <h4>학생 수 추이</h4>
              <span>최근 6개월 · 수납 학생 수</span>
            </header>
            <SimpleBarChart data={studentChartData} unit="명" barColor="#475569" />
          </section>
          <section className="dash-chart-panel">
            <header>
              <h4>결제 수단 분포</h4>
              <span>{paymentSummary?.billing_month ? `${formatMonth(paymentSummary.billing_month)} 수납 기준` : '조회 월 수납 기준'}</span>
            </header>
            <SimpleDonutChart data={paymentDonutData} formatLabel={(label) => label} />
          </section>
        </div>
      </div>
    )
  }

  const [teacherAggregated, setTeacherAggregated] = useState([])
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
        if (!cancelled) {
          setTeacherAggregated(res.aggregated ?? [])
        }
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
    return (teacherAggregated ?? []).reduce(
      (acc, row) => ({
        net_amount: acc.net_amount + (row.net_amount ?? 0),
      }),
      { net_amount: 0 },
    )
  }, [teacherAggregated])

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
        ) : teacherAggregated.length === 0 ? (
          <div className="empty-state compact">정산 데이터가 없습니다.</div>
        ) : (
          <div className="table-wrap settlement-overview-wrap">
            <table className="settlement-overview-table">
              <thead>
                <tr>
                  <th>선생님</th>
                  <th>월별 지급</th>
                  <th>회당 지급</th>
                  <th>시범수업비</th>
                  <th>총 지급액</th>
                  <th>상세</th>
                </tr>
              </thead>
              <tbody>
                {teacherAggregated.map((row) => (
                  <tr key={`${row.teacher_id}-${row.billing_month}`}>
                    <td>
                      <strong>{row.teacher_name}</strong>
                      <small className="table-sub">정산월 {row.billing_month}</small>
                    </td>
                    <td>{formatCurrency(row.monthly_net_amount)}</td>
                    <td>{formatCurrency(row.per_session_net_amount)}</td>
                    <td>{formatCurrency(row.trial_net_amount)}</td>
                    <td>{formatCurrency(row.net_amount)}</td>
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
                        보기
                      </button>
                    </td>
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
          <>
            <SectionCard title="정산 요약">
              <div className="table-wrap">
                <table className="settlement-overview-table">
                  <thead>
                    <tr>
                      <th>구분</th>
                      <th>총수업료</th>
                      <th>시범수업비</th>
                      <th>지급액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(teacherDetail.settlement_summary ?? []).map((row) => (
                      <tr key={row.settlement_type}>
                        <td>{settlementTypeLabel(row.settlement_type)}</td>
                        <td>{formatCurrency(row.gross_amount)}</td>
                        <td>{formatCurrency(row.trial_fee)}</td>
                        <td>
                          <strong>{formatCurrency(row.net_amount)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard title="수납 상세" description="월별 수납 레코드 기준">
              {(teacherDetail.lesson_records ?? []).length === 0 ? (
                <div className="empty-state compact">해당 월 수납 레코드가 없습니다.</div>
              ) : (
                <div className="table-wrap">
                  <table className="settlement-overview-table">
                    <thead>
                      <tr>
                        <th>학생</th>
                        <th>상품</th>
                        <th>결제기준</th>
                        <th>금액</th>
                        <th>태그</th>
                        <th>메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(teacherDetail.lesson_records ?? []).map((row) => (
                        <tr key={row.id}>
                          <td>{row.student_name ?? `학생#${row.student_id}`}</td>
                          <td>{row.product_name ?? '-'}</td>
                          <td>{settlementTypeLabel(row.billing_unit)}</td>
                          <td>{formatCurrency(row.final_amount)}</td>
                          <td>{row.payment_tag ?? '-'}</td>
                          <td>{row.memo ?? '-'}</td>
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
    if (selectedPage !== 'students' || !selectedMonth) return
    let cancelled = false
    const load = async () => {
      setStudentsLoading(true)
      setStudentsError('')
      try {
        const res = await apiRequest(`/api/students?month=${encodeURIComponent(selectedMonth)}`)
        if (!cancelled) {
          setStudents(res.items ?? [])
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
  }, [selectedPage, selectedMonth])

  // 학생 수납 페이지 진입/월 변경 시 팝업 자동 오픈 방지
  useEffect(() => {
    if (selectedPage !== 'students') return
    setSelectedStudentId(null)
    setStudentDetail(null)
  }, [selectedPage, selectedMonth])

  useEffect(() => {
    if (selectedPage !== 'students' || selectedStudentId === null || !selectedMonth) return
    let cancelled = false
    const load = async () => {
      setStudentDetailLoading(true)
      try {
        const res = await apiRequest(`/api/students/${selectedStudentId}?month=${encodeURIComponent(selectedMonth)}`)
        if (!cancelled) setStudentDetail(res)
      } finally {
        if (!cancelled) setStudentDetailLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedStudentId, selectedMonth])

  const paymentDonutData = useMemo(
    () =>
      (paymentSummary?.items ?? []).map((row) => ({
        label: formatPaymentMethodLabel(row.payment_method),
        value: row.amount,
      })),
    [paymentSummary],
  )

  const renderStudents = () => (
    <div className="students-layout">
      <SectionCard title="학생 수납" description="선택 월에 수납(금액>0)이 있는 학생만 표시합니다.">
        {studentsError ? <div className="banner error">{studentsError}</div> : null}
        {studentsLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
        {students.length === 0 && !studentsLoading ? (
          <div className="empty-state compact">선택한 월에 수납된 학생이 없습니다.</div>
        ) : (
          <div className="table-wrap settlement-overview-wrap">
            <table className="settlement-overview-table">
              <thead>
                <tr>
                  <th>학생</th>
                  <th>상품</th>
                  <th>담당 선생님</th>
                  <th>결제기준</th>
                  <th>결제수단</th>
                  <th>{formatMonth(selectedMonth)} 수납</th>
                  <th>상세</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.student_id}>
                    <td>
                      <strong>{student.student_name}</strong>
                    </td>
                    <td>{(student.products ?? []).join(', ') || '-'}</td>
                    <td>{(student.teachers ?? []).join(', ') || '-'}</td>
                    <td>{(student.billing_units ?? []).map((u) => settlementTypeLabel(u)).join(', ') || '-'}</td>
                    <td>
                      {(student.payment_methods ?? []).map((m) => formatPaymentMethodLabel(m)).join(', ') || '-'}
                    </td>
                    <td>
                      <strong>{formatCurrency(student.month_paid_amount)}</strong>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setSelectedStudentId(student.student_id)}
                      >
                        보기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {selectedStudentId !== null ? (
        <DetailModal
          title={
            studentDetail
              ? `${studentDetail.student_name} · ${formatMonth(studentDetail.billing_month)}`
              : '학생 수납 상세'
          }
          onClose={() => {
            setSelectedStudentId(null)
            setStudentDetail(null)
          }}
        >
          {studentDetailLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
          {studentDetail ? (
            <>
              <SectionCard title="이번달 수납 내역">
                <div className="table-wrap">
                  <table className="settlement-overview-table">
                    <thead>
                      <tr>
                        <th>선생님</th>
                        <th>상품</th>
                        <th>결제기준</th>
                        <th>결제수단</th>
                        <th>금액</th>
                        <th>태그</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(studentDetail.month_payments ?? []).map((row) => (
                        <tr key={row.id}>
                          <td>{row.teacher_name ?? `선생님#${row.teacher_id}`}</td>
                          <td>{row.product_name ?? '-'}</td>
                          <td>{row.billing_unit ? settlementTypeLabel(row.billing_unit) : '-'}</td>
                          <td>{row.payment_method ? formatPaymentMethodLabel(row.payment_method) : '-'}</td>
                          <td>
                            <strong>{formatCurrency(row.final_amount)}</strong>
                          </td>
                          <td>{row.payment_tag ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              <SectionCard title="이전 내역" description="최근 30건">
                <div className="table-wrap">
                  <table className="settlement-overview-table">
                    <thead>
                      <tr>
                        <th>월</th>
                        <th>결제기준</th>
                        <th>금액</th>
                        <th>태그</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(studentDetail.payment_history ?? []).slice(0, 30).map((row) => (
                        <tr key={row.id}>
                          <td>{row.billing_month}</td>
                          <td>{row.billing_unit ? settlementTypeLabel(row.billing_unit) : '-'}</td>
                          <td>{formatCurrency(row.final_amount)}</td>
                          <td>{row.payment_tag ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          ) : null}
        </DetailModal>
      ) : null}
    </div>
  )

  const renderCatalogs = () => (
    <SectionCard
      title="상품 / 단가표"
      description={`총 ${productCounts.all}개 (월별 ${productCounts.monthly} + 회당 ${productCounts.per_session})`}
      actions={
        <div className="filter-chips">
          <button
            type="button"
            className={productFilter === 'all' ? 'chip active' : 'chip'}
            onClick={() => setProductFilter('all')}
          >
            전체
          </button>
          <button
            type="button"
            className={productFilter === 'monthly' ? 'chip active' : 'chip'}
            onClick={() => setProductFilter('monthly')}
          >
            월별
          </button>
          <button
            type="button"
            className={productFilter === 'per_session' ? 'chip active' : 'chip'}
            onClick={() => setProductFilter('per_session')}
          >
            회당
          </button>
        </div>
      }
    >
      {filteredProducts.length === 0 ? (
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
              {filteredProducts.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.billing_unit === 'per_session' ? '회당' : '월별'}</td>
                  <td>{p.billing_unit === 'per_session' ? '-' : formatCurrency(p.price_standard)}</td>
                  <td>{p.billing_unit === 'per_session' ? '-' : formatCurrency(p.price_17)}</td>
                  <td>{p.billing_unit === 'per_session' ? '-' : formatCurrency(p.price_35)}</td>
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
      case 'data-register':
        return (
          <DataRegisterView
            onRegistered={() => {
              apiRequest('/api/app-data').then((res) => setAppData(res)).catch(() => {})
            }}
          />
        )
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
              setLastDbPage('data-admin')
            }}
          />
        )
      case 'data-admin':
        return <DataAdminView initialTable={dataAdminTable} />
      default:
        return renderDashboard()
    }
  }

  const renderDbSubNav = () => (
    <nav className="db-subnav" aria-label="DB 하위 메뉴">
      {DB_SUB_NAV.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === selectedPage ? 'db-subnav__item active' : 'db-subnav__item'}
          onClick={() => setSelectedPage(item.id)}
        >
          <span className="db-subnav__label">{item.label}</span>
          <span className="db-subnav__desc">{item.description}</span>
        </button>
      ))}
    </nav>
  )

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
              <span>운영 · 정산</span>
            </div>
          </div>

          <nav className="gnb" aria-label="주 메뉴">
            {MAIN_NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  item.id === selectedPage && !isDbPage(selectedPage) ? 'gnb-item active' : 'gnb-item'
                }
                onClick={() => setSelectedPage(item.id)}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              className={isDbPage(selectedPage) ? 'gnb-item gnb-item--db active' : 'gnb-item gnb-item--db'}
              onClick={() => setSelectedPage(isDbPage(selectedPage) ? selectedPage : lastDbPage)}
            >
              DB
            </button>
          </nav>
        </div>
      </header>

      <main className="page-shell">
        <section className={isDbPage(selectedPage) ? 'page-panel page-panel--db' : 'page-panel'}>
          <header className="page-panel__header">
            <div className="page-heading">
              <p className="eyebrow">{pageMeta.eyebrow}</p>
              <h2 className="topbar__title">{pageMeta.title}</h2>
              {pageMeta.description ? <p className="page-heading__desc">{pageMeta.description}</p> : null}
            </div>
            {showMonthToolbar ? (
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

          <div className="page-panel__body">
            {error ? <div className="banner error">{error}</div> : null}
            {isDbPage(selectedPage) ? renderDbSubNav() : null}
            {loading && !appData && !isDbPage(selectedPage) ? (
              <div className="empty-state">불러오는 중...</div>
            ) : (
              <div className={isDbPage(selectedPage) ? 'db-workspace' : 'page-content'}>{renderCurrentPage()}</div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

