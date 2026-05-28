import { useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { formatPaymentMethodLabel, SimpleBarChart } from './charts.jsx'
import DataAdminView from './DataAdminView.jsx'
import DataOverviewView from './DataOverviewView.jsx'
import DataRegisterView from './DataRegisterView.jsx'
import DbSchemaView from './DbSchemaView.jsx'
import './App.css'
import './tokens/wanted-components.css'

const MAIN_NAV_ITEMS = [
  { id: 'dashboard', label: '매출 및 운영 현황' },
  { id: 'teacher-settlements', label: '선생님 정산' },
  { id: 'students', label: '학생 수납' },
  { id: 'catalogs', label: '상품 · 단가표' },
]

const DB_SUB_NAV = [
  { id: 'data-register', label: '데이터 등록', description: '등록' },
  { id: 'data-model', label: '데이터 구조', description: '구조' },
  { id: 'data-overview', label: 'DB 전체보기', description: '조회' },
  { id: 'data-admin', label: '데이터 관리', description: '편집' },
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

function paymentTagLabel(paymentTag) {
  if (paymentTag === 'first_month') return '첫달 수업'
  if (paymentTag === 'regular') return '정규수업'
  return paymentTag || '-'
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

function currentMonthKey() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
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

function DetailModal({ title, onClose, open = true, headerActions = null, contentRef = null, children }) {
  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="settlement-modal" ref={contentRef}>
          <header className="settlement-modal__header">
            <div>
              <h3>{title}</h3>
            </div>
            <div className="settlement-modal__header-actions export-exclude">
              {headerActions}
              <button type="button" className="secondary-button export-exclude" onClick={onClose}>
                닫기
              </button>
            </div>
          </header>
          <div className="settlement-modal__body">{children}</div>
        </div>
      </div>
    </div>
  )
}

function SettlementMetric({ label, value, sub }) {
  return (
    <article className="settlement-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </article>
  )
}

function studentDisplayAmount(student, filter) {
  if (filter === 'monthly') return Number(student?.month_paid_amount_monthly || 0)
  if (filter === 'per_session') return Number(student?.month_paid_amount_per_session || 0)
  return Number(student?.month_paid_amount || 0)
}

export default function BodaApp() {
  const [selectedPage, setSelectedPage] = useState('dashboard')
  const [lastDbPage, setLastDbPage] = useState('data-register')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [dataAdminTable, setDataAdminTable] = useState(null)

  const [appData, setAppData] = useState(null)
  const [dashboardData, setDashboardData] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardStudentListOpen, setDashboardStudentListOpen] = useState(false)
  const [dashboardStudentLists, setDashboardStudentLists] = useState(null)
  const [dashboardStudentListsLoading, setDashboardStudentListsLoading] = useState(false)
  const [dashboardStudentListsError, setDashboardStudentListsError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [productFilter, setProductFilter] = useState('all')

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
          const monthsFromApi = res?.meta?.available_months ?? []
          const currentKey = currentMonthKey()
          const defaultMonth = monthsFromApi.includes(currentKey)
            ? currentKey
            : res?.meta?.default_month || res?.meta?.latest_month || ''
          setSelectedMonth((current) => current || defaultMonth)
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
    const inquiryChartData = (dashboardData?.inquiry_trend_6m ?? []).map((row) => ({
      label: formatMonthShort(row.month),
      value: row.inquiry_count,
    }))
    const momClass =
      summary.revenue_delta > 0 ? 'dash-sub muted-up' : summary.revenue_delta < 0 ? 'dash-sub muted-down' : 'dash-sub'

    return (
      <>
      <div className="dash-board">
        <header className="dash-board__head">
          <div className="dash-board__head-main">
            <h3 className="dash-board__title">{formatMonth(summary.billing_month)} 운영 현황</h3>
          </div>
        </header>

        <div className="dash-kpi dash-kpi--overview-top">
          <article className="kpi-card kpi-card--revenue kpi-card--hero">
            <span className="kpi-card__label">총매출</span>
            <p className="kpi-card__value kpi-card__value--primary">{formatCurrency(summary.gross_revenue)}</p>
            <p className={momClass}>{formatMoM(summary.revenue_delta, summary.revenue_delta_rate)}</p>
            <p className="kpi-card__sub">순매출 {formatCurrency(summary.net_revenue)}</p>
          </article>

          <article className="kpi-card kpi-card--compact kpi-card--inquiry">
            <span className="kpi-card__label">신규 문의</span>
            <p className="kpi-card__value">
              {summary.new_inquiry_count ?? 0}
              <span className="kpi-card__unit">건</span>
            </p>
            <p className={summary.inquiry_delta > 0 ? 'dash-sub muted-up' : summary.inquiry_delta < 0 ? 'dash-sub muted-down' : 'dash-sub'}>
              전월 대비 {summary.inquiry_delta > 0 ? '+' : ''}
              {(summary.inquiry_delta ?? 0).toLocaleString('ko-KR')}건
            </p>
            <p className="kpi-card__sub">
              신규 {summary.new_first_payment_count ?? 0}명 | 시범 {summary.trial_lesson_count ?? 0}명
            </p>
          </article>
        </div>

        <div className="dash-kpi dash-kpi--overview-bottom">
          <article
            className="kpi-card kpi-card--compact kpi-card--student kpi-card--clickable"
            onClick={async () => {
              setDashboardStudentListOpen(true)
              setDashboardStudentListsLoading(true)
              setDashboardStudentListsError('')
              try {
                const res = await apiRequest(`/api/dashboard/student-lists?month=${encodeURIComponent(summary.billing_month)}`)
                setDashboardStudentLists(res)
              } catch (e) {
                setDashboardStudentListsError(e.message || '수강학생 상세를 불러오지 못했습니다.')
              } finally {
                setDashboardStudentListsLoading(false)
              }
            }}
          >
            <span className="kpi-card__label">수강 학생</span>
            <p className="kpi-card__value">
              {summary.active_student_count}
              <span className="kpi-card__unit">명</span>
            </p>
            <p className={summary.student_delta > 0 ? 'dash-sub muted-up' : summary.student_delta < 0 ? 'dash-sub muted-down' : 'dash-sub'}>
              전월 대비 {summary.student_delta > 0 ? '+' : ''}
              {(summary.student_delta ?? 0).toLocaleString('ko-KR')}명
            </p>
            <p className="kpi-card__sub">
              신규 {summary.student_new_count ?? 0}명 | 탈회 {summary.student_exit_count ?? 0}명
            </p>
          </article>

          <article className="kpi-card kpi-card--compact kpi-card--teacher">
            <span className="kpi-card__label">수업중인 선생님</span>
            <p className="kpi-card__value">
              {summary.active_teacher_count ?? 0}
              <span className="kpi-card__unit">명</span>
            </p>
            <p className={summary.teacher_delta > 0 ? 'dash-sub muted-up' : summary.teacher_delta < 0 ? 'dash-sub muted-down' : 'dash-sub'}>
              전월 대비 {summary.teacher_delta > 0 ? '+' : ''}
              {(summary.teacher_delta ?? 0).toLocaleString('ko-KR')}명
            </p>
            <p className="kpi-card__sub">
              활성 {summary.active_teacher_total ?? 0}명 중 | 종료 {summary.teacher_ended_count ?? 0}명
            </p>
          </article>

          <article className="kpi-card kpi-card--compact kpi-card--collection">
            <span className="kpi-card__label">수납 관리</span>
            <p className="kpi-card__value">
              {summary.collection_count ?? 0}
              <span className="kpi-card__unit">건</span>
            </p>
            <p className="kpi-card__sub">
              <span>완납 {summary.paid_count ?? 0}건</span> |{' '}
              <span className={(summary.unpaid_count ?? 0) > 0 ? 'kpi-sub-danger' : ''}>
                미납 {summary.unpaid_count ?? 0}건
              </span>
            </p>
          </article>
        </div>

        <div className="dash-charts dash-charts--top">
          <section className="dash-chart-panel dash-chart-panel--revenue">
            <header>
              <h4>매출 추이</h4>
              <span>최근 6개월 · 학생 수납 합계</span>
            </header>
            <SimpleBarChart
              data={revenueChartData}
              formatValue={(v) => `${Math.round(v / 10000).toLocaleString('ko-KR')}만`}
            />
          </section>
          <section className="dash-chart-panel dash-chart-panel--student">
            <header>
              <h4>신규 문의 추이</h4>
              <span>최근 6개월</span>
            </header>
            <SimpleBarChart data={inquiryChartData} unit="건" barColor="#475569" />
          </section>
        </div>
        <div className="dash-charts dash-charts--bottom">
          <section className="dash-chart-panel dash-chart-panel--student">
            <header>
              <h4>학생 수 추이</h4>
              <span>최근 6개월</span>
            </header>
            <SimpleBarChart data={studentChartData} unit="명" barColor="#475569" />
          </section>
        </div>
      </div>
      {dashboardStudentListOpen ? (
        <DetailModal
          open
          title={`${formatMonth(summary.billing_month)} 수강학생 상세`}
          onClose={() => {
            setDashboardStudentListOpen(false)
            setDashboardStudentLists(null)
            setDashboardStudentListsError('')
          }}
        >
          {dashboardStudentListsLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
          {dashboardStudentListsError ? <div className="banner error">{dashboardStudentListsError}</div> : null}
          {!dashboardStudentListsLoading && !dashboardStudentListsError ? (
            <div className="student-collection-sections">
              <section className="student-collection-panel">
                <div className="student-collection-panel__head">
                  <h4>신규학생</h4>
                  <span>{(dashboardStudentLists?.new_students ?? []).length}명</span>
                </div>
                <div className="table-wrap settlement-overview-wrap">
                  <table className="settlement-overview-table">
                    <thead>
                      <tr>
                        <th>학생</th>
                        <th>담당 선생님</th>
                        <th>상품</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dashboardStudentLists?.new_students ?? []).map((student) => (
                        <tr key={`new-${student.student_id}`}>
                          <td>{student.student_name}</td>
                          <td>{(student.teachers ?? []).join(', ') || '-'}</td>
                          <td>{(student.products ?? []).join(', ') || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="student-collection-panel">
                <div className="student-collection-panel__head">
                  <h4>탈회학생</h4>
                  <span>{(dashboardStudentLists?.ended_students ?? []).length}명</span>
                </div>
                <div className="table-wrap settlement-overview-wrap">
                  <table className="settlement-overview-table">
                    <thead>
                      <tr>
                        <th>학생</th>
                        <th>담당 선생님</th>
                        <th>상품</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dashboardStudentLists?.ended_students ?? []).map((student) => (
                        <tr key={`ended-${student.student_id}`}>
                          <td>{student.student_name}</td>
                          <td>{(student.teachers ?? []).join(', ') || '-'}</td>
                          <td>{(student.products ?? []).join(', ') || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : null}
        </DetailModal>
      ) : null}
      </>
    )
  }

  const [teacherAggregated, setTeacherAggregated] = useState([])
  const [teacherLoading, setTeacherLoading] = useState(false)
  const [teacherError, setTeacherError] = useState('')
  const [teacherNotice, setTeacherNotice] = useState('')
  const [teacherSearch, setTeacherSearch] = useState('')
  const [teacherEmailSending, setTeacherEmailSending] = useState(false)
  const [teacherEmailModalOpen, setTeacherEmailModalOpen] = useState(false)
  const [teacherEmailSelection, setTeacherEmailSelection] = useState({})
  const [teacherListExporting, setTeacherListExporting] = useState(false)
  const [teacherDetail, setTeacherDetail] = useState(null)
  const [teacherDetailLoading, setTeacherDetailLoading] = useState(false)
  const [teacherDetailError, setTeacherDetailError] = useState('')
  const [rateAdjustments, setRateAdjustments] = useState({
    changed_count: 0,
    changed_teachers: [],
    notice_count: 0,
    notice_teachers: [],
  })
  const [rateAdjustmentsOpen, setRateAdjustmentsOpen] = useState(false)
  const teacherListCaptureRef = useRef(null)
  const [teacherDetailExporting, setTeacherDetailExporting] = useState(false)
  const teacherDetailCaptureRef = useRef(null)

  useEffect(() => {
    if (selectedPage !== 'teacher-settlements' || !selectedMonth) return
    let cancelled = false
    const load = async () => {
      setTeacherLoading(true)
      setTeacherError('')
      setTeacherNotice('')
      setRateAdjustments({ changed_count: 0, changed_teachers: [], notice_count: 0, notice_teachers: [] })
      try {
        const res = await apiRequest(`/api/teachers/settlements?month=${encodeURIComponent(selectedMonth)}`)
        if (!cancelled) {
          setTeacherAggregated(res.aggregated ?? [])
          setRateAdjustments(
            res.rate_adjustments ?? { changed_count: 0, changed_teachers: [], notice_count: 0, notice_teachers: [] },
          )
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

  const teacherOverview = useMemo(() => {
    const rows = teacherAggregated ?? []
    return {
      teacherCount: rows.length,
      totalMonthly: rows.reduce((sum, row) => sum + (row.monthly_net_amount ?? 0), 0),
      totalPerSession: rows.reduce((sum, row) => sum + (row.per_session_net_amount ?? 0), 0),
      totalTrial: rows.reduce((sum, row) => sum + (row.trial_net_amount ?? 0), 0),
    }
  }, [teacherAggregated])

  const filteredTeacherRows = useMemo(() => {
    const keyword = teacherSearch.trim().toLowerCase()
    if (!keyword) return teacherAggregated
    return teacherAggregated.filter((row) => (row.teacher_name ?? '').toLowerCase().includes(keyword))
  }, [teacherAggregated, teacherSearch])

  const teacherEmailRows = useMemo(() => {
    return (filteredTeacherRows ?? []).map((row) => ({
      teacher_id: row.teacher_id,
      teacher_name: row.teacher_name,
      teacher_email: row.teacher_email ?? '',
    }))
  }, [filteredTeacherRows])

  const selectedTeacherIds = useMemo(() => {
    return teacherEmailRows.filter((row) => teacherEmailSelection[row.teacher_id]).map((row) => row.teacher_id)
  }, [teacherEmailRows, teacherEmailSelection])

  const renderTeacherSettlements = () => (
    <>
      <SectionCard
        title="선생님별 정산"
        description="선택 월에 선생님에게 지급해야 할 금액(순수익)을 한눈에 봅니다."
        actions={
          <div className="teacher-settlement-actions">
            <label className="toolbar-field teacher-search-field">
              <span>선생님 검색</span>
              <input
                type="text"
                value={teacherSearch}
                onChange={(e) => setTeacherSearch(e.target.value)}
                placeholder="이름 입력"
              />
            </label>
            <button
              type="button"
              className="secondary-button icon-only-button"
              aria-label="정산 리스트 이미지 저장"
              title="정산 리스트 이미지 저장"
              disabled={teacherListExporting || teacherLoading || filteredTeacherRows.length === 0}
              onClick={async () => {
                if (!teacherListCaptureRef.current) return
                setTeacherListExporting(true)
                try {
                  const canvas = await html2canvas(teacherListCaptureRef.current, {
                    backgroundColor: '#ffffff',
                    scale: 2,
                    useCORS: true,
                  })
                  const url = canvas.toDataURL('image/png')
                  const anchor = document.createElement('a')
                  anchor.href = url
                  anchor.download = `선생님별 정산_${formatMonth(selectedMonth)}.png`
                  anchor.click()
                } finally {
                  setTeacherListExporting(false)
                }
              }}
            >
              {teacherListExporting ? '…' : '🖼️'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={teacherEmailSending || teacherLoading || filteredTeacherRows.length === 0}
              onClick={() => {
                const initial = {}
                for (const row of teacherEmailRows) {
                  initial[row.teacher_id] = true
                }
                setTeacherEmailSelection(initial)
                setTeacherEmailModalOpen(true)
              }}
            >
              {teacherEmailSending ? '발송 중...' : '메일 발송'}
            </button>
          </div>
        }
      >
        {teacherNotice ? <div className="banner success">{teacherNotice}</div> : null}
        {teacherError ? <div className="banner error">{teacherError}</div> : null}
        {(rateAdjustments?.notice_count ?? 0) > 0 ? (
          <div className="banner rate-adjust-banner">
            <span className="rate-adjust-banner__message">
              <span className="rate-adjust-banner__icon" aria-hidden="true">
                !
              </span>
              수업 정산률 변경학생이 있습니다 {rateAdjustments.notice_count}건
            </span>
            <button type="button" className="rate-adjust-banner__action" onClick={() => setRateAdjustmentsOpen(true)}>
              자세히 보기
            </button>
          </div>
        ) : null}
        {teacherLoading ? (
          <div className="empty-state compact">불러오는 중...</div>
        ) : teacherAggregated.length === 0 ? (
          <div className="empty-state compact">정산 데이터가 없습니다.</div>
        ) : filteredTeacherRows.length === 0 ? (
          <div className="empty-state compact">검색 결과가 없습니다.</div>
        ) : (
          <div className="teacher-report-layout" ref={teacherListCaptureRef}>
            <div className="teacher-settlement-summary">
              <SettlementMetric label="정산 대상 선생님" value={`${teacherOverview.teacherCount}명`} />
              <SettlementMetric label="월별 지급 합계" value={formatCurrency(teacherOverview.totalMonthly)} />
              <SettlementMetric label="회차별 지급 합계" value={formatCurrency(teacherOverview.totalPerSession)} />
              <SettlementMetric label="시범 지급 합계" value={formatCurrency(teacherOverview.totalTrial)} />
              <SettlementMetric label="총 지급 합계" value={formatCurrency(teacherTotals.net_amount)} />
            </div>

            <div className="table-wrap settlement-overview-wrap">
              <table className="settlement-overview-table">
                <thead>
                  <tr>
                    <th>선생님</th>
                    <th>담당학생수</th>
                    <th>월별 수업</th>
                    <th>회차별 수업</th>
                    <th>시범 수업</th>
                    <th>최종 정산금액</th>
                    <th>상세</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTeacherRows.map((row) => (
                    <tr key={`${row.teacher_id}-${row.billing_month}`}>
                      <td>
                        <strong>{row.teacher_name}</strong>
                      </td>
                      <td>
                        <strong>{row.billing_student_count ?? 0}명</strong>
                      </td>
                      <td>{formatCurrency(row.monthly_net_amount)}</td>
                      <td>{formatCurrency(row.per_session_net_amount)}</td>
                      <td>{formatCurrency(row.trial_net_amount)}</td>
                      <td>
                        <strong>{formatCurrency(row.net_amount)}</strong>
                        <small className="table-sub">{formatCurrency(row.gross_amount)}</small>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          onClick={async () => {
                            setTeacherDetailLoading(true)
                            setTeacherDetailError('')
                            setTeacherDetail({
                              teacher_id: row.teacher_id,
                              teacher_name: row.teacher_name,
                              billing_month: row.billing_month,
                            })
                            try {
                              const detail = await apiRequest(
                                `/api/teachers/${row.teacher_id}/settlements/${encodeURIComponent(row.billing_month)}`,
                              )
                              setTeacherDetail(detail)
                            } catch (e) {
                              setTeacherDetailError(e.message || '정산 상세를 불러오지 못했습니다.')
                            } finally {
                              setTeacherDetailLoading(false)
                            }
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
          </div>
        )}
      </SectionCard>

      {teacherDetail ? (
        <DetailModal
          open
          title={`${teacherDetail.teacher_name} · ${formatMonth(teacherDetail.billing_month)}`}
          contentRef={teacherDetailCaptureRef}
          headerActions={
            <button
              type="button"
              className="secondary-button"
              disabled={teacherDetailExporting || teacherDetailLoading}
              onClick={async () => {
                if (!teacherDetailCaptureRef.current) return
                setTeacherDetailExporting(true)
                try {
                  const canvas = await html2canvas(teacherDetailCaptureRef.current, {
                    backgroundColor: '#ffffff',
                    scale: 2,
                    useCORS: true,
                    ignoreElements: (element) => element.classList?.contains('export-exclude') ?? false,
                  })
                  const url = canvas.toDataURL('image/png')
                  const anchor = document.createElement('a')
                  const titleText = `${teacherDetail.teacher_name} · ${formatMonth(teacherDetail.billing_month)}`
                  const safeTitle = titleText.replace(/[\\/:*?"<>|]/g, '_')
                  anchor.href = url
                  anchor.download = `${safeTitle}.png`
                  anchor.click()
                } finally {
                  setTeacherDetailExporting(false)
                }
              }}
            >
              {teacherDetailExporting ? '내보내는 중...' : '이미지 저장'}
            </button>
          }
          onClose={() => {
            setTeacherDetail(null)
            setTeacherDetailError('')
            setTeacherDetailLoading(false)
          }}
        >
          {teacherDetailLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
          {teacherDetailError ? <div className="banner error">{teacherDetailError}</div> : null}
          {!teacherDetailLoading && !teacherDetailError ? (
            <div className="teacher-detail-modal">
              {teacherDetail.payout_flow ? (
                <>
                  <section className="teacher-payout-total teacher-payout-total--plain">
                    <div className="teacher-payout-total__main">
                      <span>최종 지급액</span>
                      <strong>{formatCurrency(teacherDetail.payout_flow.total?.net_amount)}</strong>
                    </div>
                  </section>

                  <div className="teacher-payout-summary-row">
                    <section className="teacher-payout-summary-card">
                      <span>정규 수업료 지급액</span>
                      <strong>{formatCurrency(teacherDetail.payout_flow.regular?.net_amount)}</strong>
                      <p>
                        수업료(세전)
                        {formatCurrency(teacherDetail.payout_flow.regular?.teacher_share_pre_tax)} - 수수료
                        {formatCurrency(
                          teacherDetail.payout_flow.regular?.settlement_fee_amount ??
                            teacherDetail.payout_flow.regular?.withholding_amount,
                        )}
                      </p>
                    </section>
                    <section className="teacher-payout-summary-card">
                      <span>시범 수업료 지급액</span>
                      <strong>{formatCurrency(teacherDetail.payout_flow.trial?.net_amount)}</strong>
                    </section>
                  </div>
                </>
              ) : null}

              <section className="teacher-detail-block teacher-detail-block--flat">
                {(teacherDetail.regular_payments ?? teacherDetail.lesson_records ?? []).length === 0 ? (
                  <div className="empty-state compact">해당 월 정규 수납이 없습니다.</div>
                ) : (
                  <div>
                    <div className="teacher-detail-block__header">
                      <h4>월별 수업</h4>
                      <span>{(teacherDetail.regular_monthly_payments ?? []).length}건</span>
                    </div>
                    {(teacherDetail.regular_monthly_payments ?? []).length === 0 ? (
                      <div className="empty-state compact">해당 월 월별 수업이 없습니다.</div>
                    ) : (
                      <div className="table-wrap">
                        <table className="settlement-overview-table">
                          <thead>
                            <tr>
                              <th>학생</th>
                              <th>상품</th>
                              <th>수납액</th>
                              <th>수수료율</th>
                              <th>정산 수업료</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(teacherDetail.regular_monthly_payments ?? []).map((row) => (
                              <tr key={row.id}>
                                <td>{row.student_name ?? `학생#${row.student_id}`}</td>
                                <td>{row.product_name ?? '-'}</td>
                                <td>{formatCurrency(row.final_amount)}</td>
                                <td>{row.commission_rate != null ? `${row.commission_rate}%` : '-'}</td>
                                <td>
                                  <strong>{formatCurrency(row.teacher_share ?? row.final_amount)}</strong>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="teacher-detail-subsection teacher-detail-subsection--per-session">
                      <div className="teacher-detail-block__header">
                        <h4>회차별 수업</h4>
                        <span>{(teacherDetail.regular_per_session_payments ?? []).length}건</span>
                      </div>
                      {(teacherDetail.regular_per_session_payments ?? []).length === 0 ? (
                        <div className="empty-state compact">해당 월 회차별 수업이 없습니다.</div>
                      ) : (
                        <div className="table-wrap">
                          <table className="settlement-overview-table">
                            <thead>
                              <tr>
                                <th>학생</th>
                                <th>상품</th>
                                <th>회차별 단가</th>
                                <th>총횟수</th>
                                <th>완료횟수</th>
                                <th>정산 수납액</th>
                                <th>수수료율</th>
                              <th>정산 수업료</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(teacherDetail.regular_per_session_payments ?? []).map((row) => (
                                <tr key={row.id}>
                                  <td>{row.student_name ?? `학생#${row.student_id}`}</td>
                                  <td>{row.product_name ?? '-'}</td>
                                  <td>{formatCurrency(row.per_session_unit_price ?? 0)}</td>
                                  <td>{row.total_sessions ?? 0}</td>
                                  <td>{row.completed_sessions ?? 0}</td>
                                  <td>{formatCurrency(row.final_amount)}</td>
                                  <td>{row.commission_rate != null ? `${row.commission_rate}%` : '-'}</td>
                                  <td>
                                    <strong>{formatCurrency(row.teacher_share ?? row.final_amount)}</strong>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section className="teacher-detail-block teacher-detail-block--flat">
                <div className="teacher-detail-block__header teacher-detail-block__header--trial">
                  <h4>시범 수업</h4>
                  <span>{(teacherDetail.trial_lessons ?? []).length}건</span>
                </div>
                {(teacherDetail.trial_lessons ?? []).length === 0 ? (
                  <div className="empty-state compact">해당 월 시범 수업이 없습니다.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="settlement-overview-table">
                      <thead>
                        <tr>
                          <th>학생</th>
                          <th>시범일</th>
                          <th>시범비</th>
                          <th>세전</th>
                          <th>정산 수수료</th>
                          <th>지급액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(teacherDetail.trial_lessons ?? []).map((row) => (
                          <tr key={row.enrollment_id}>
                            <td>{row.student_name}</td>
                            <td>{row.trial_date ?? '-'}</td>
                            <td>{formatCurrency(row.trial_fee)}</td>
                            <td>{formatCurrency(row.pre_tax_amount)}</td>
                            <td>{formatCurrency(row.withholding_amount)}</td>
                            <td>
                              <strong>{formatCurrency(row.net_amount)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </DetailModal>
      ) : null}

      {rateAdjustmentsOpen ? (
        <DetailModal
          open
          title={`정산률 변경 학생 · ${formatMonth(selectedMonth)}`}
          onClose={() => setRateAdjustmentsOpen(false)}
        >
          {(rateAdjustments?.notice_teachers ?? []).length === 0 ? (
            <div className="empty-state compact">변경된 내역이 없습니다.</div>
          ) : (
            <div className="table-wrap settlement-overview-wrap">
              <table className="settlement-overview-table">
                <thead>
                  <tr>
                    <th>선생님</th>
                    <th>학생</th>
                    <th>시작일</th>
                    <th>변경 전</th>
                    <th>변경 후</th>
                  </tr>
                </thead>
                <tbody>
                  {(rateAdjustments.notice_teachers ?? []).flatMap((teacher) =>
                    (teacher.students ?? []).map((student, idx) => (
                      <tr key={`${teacher.teacher_id}-${student.enrollment_id}-${idx}`}>
                        <td>{teacher.teacher_name}</td>
                        <td>{student.student_name ?? '-'}</td>
                        <td>{student.start_date ?? '-'}</td>
                        <td>{`${Math.round(student.current_rate ?? student.old_rate ?? 0)}%`}</td>
                        <td>
                          <strong>{`${Math.round(student.target_rate ?? student.new_rate ?? 0)}%`}</strong>
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </DetailModal>
      ) : null}

      {teacherEmailModalOpen ? (
        <DetailModal
          open
          title={`${formatMonth(selectedMonth)} 정산 메일 발송 대상 선택`}
          onClose={() => setTeacherEmailModalOpen(false)}
          headerActions={
            <button
              type="button"
              className="primary-button"
              disabled={teacherEmailSending || selectedTeacherIds.length === 0}
              onClick={async () => {
                if (!window.confirm(`${selectedTeacherIds.length}명에게 메일을 발송할까요?`)) return
                setTeacherEmailSending(true)
                setTeacherError('')
                setTeacherNotice('')
                try {
                  const res = await apiRequest('/api/teachers/settlements/send-email', {
                    method: 'POST',
                    body: JSON.stringify({ billing_month: selectedMonth, teacher_ids: selectedTeacherIds }),
                  })
                  setTeacherNotice(
                    `메일 발송 완료: 성공 ${res.sent_count}건 / 스킵 ${res.skipped_count}건 / 실패 ${res.failed_count}건`,
                  )
                  setTeacherEmailModalOpen(false)
                } catch (e) {
                  setTeacherError(e.message || '메일 발송에 실패했습니다.')
                } finally {
                  setTeacherEmailSending(false)
                }
              }}
            >
              {teacherEmailSending ? '발송 중...' : `선택 ${selectedTeacherIds.length}명 발송`}
            </button>
          }
        >
          <div className="teacher-email-select-tools">
            <label>
              <input
                type="checkbox"
                checked={teacherEmailRows.length > 0 && selectedTeacherIds.length === teacherEmailRows.length}
                onChange={(e) => {
                  const checked = e.target.checked
                  const next = {}
                  for (const row of teacherEmailRows) {
                    next[row.teacher_id] = checked
                  }
                  setTeacherEmailSelection(next)
                }}
              />{' '}
              전체 선택
            </label>
          </div>
          <div className="table-wrap settlement-overview-wrap">
            <table className="settlement-overview-table">
              <thead>
                <tr>
                  <th>선택</th>
                  <th>선생님</th>
                  <th>이메일</th>
                </tr>
              </thead>
              <tbody>
                {teacherEmailRows.map((row) => (
                  <tr key={`mail-${row.teacher_id}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!teacherEmailSelection[row.teacher_id]}
                        onChange={(e) =>
                          setTeacherEmailSelection((prev) => ({
                            ...prev,
                            [row.teacher_id]: e.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td>{row.teacher_name}</td>
                    <td>{row.teacher_email || '-'}</td>
                  </tr>
                ))}
                {teacherEmailRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="students-table-empty">
                      선택 가능한 선생님이 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </DetailModal>
      ) : null}
    </>
  )

  const [students, setStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [studentsError, setStudentsError] = useState('')
  const [studentBillingFilter, setStudentBillingFilter] = useState('all')
  const [studentPaymentTab, setStudentPaymentTab] = useState('all')
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [studentDetail, setStudentDetail] = useState(null)
  const [studentDetailLoading, setStudentDetailLoading] = useState(false)
  const [studentDetailError, setStudentDetailError] = useState('')

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
    setStudentDetailError('')
    setStudentBillingFilter('all')
    setStudentPaymentTab('all')
  }, [selectedPage, selectedMonth])

  const filteredStudents = useMemo(() => {
    if (studentBillingFilter === 'all') return students
    if (studentBillingFilter === 'monthly') {
      return students.filter(
        (student) =>
          (student.billing_units ?? []).includes('monthly') || (student.month_paid_amount_monthly ?? 0) > 0,
      )
    }
    return students.filter(
      (student) =>
        (student.billing_units ?? []).includes('per_session') || (student.month_paid_amount_per_session ?? 0) > 0,
    )
  }, [students, studentBillingFilter])

  const studentCollectionSummary = useMemo(() => {
    const rows = filteredStudents ?? []
    const paidRows = rows.filter((student) => (student.payment_status ?? 'paid') === 'paid')
    const unpaidRows = rows.filter((student) => (student.payment_status ?? 'paid') !== 'paid')
    const paidAmount = paidRows.reduce((sum, student) => sum + studentDisplayAmount(student, studentBillingFilter), 0)
    return {
      paidRows,
      unpaidRows,
      paidAmount,
      unpaidAmount: 0,
      total: rows.length,
    }
  }, [filteredStudents, studentBillingFilter])

  useEffect(() => {
    if (selectedPage !== 'students' || selectedStudentId === null || !selectedMonth) return
    let cancelled = false
    const load = async () => {
      setStudentDetailLoading(true)
      setStudentDetailError('')
      try {
        const res = await apiRequest(`/api/students/${selectedStudentId}?month=${encodeURIComponent(selectedMonth)}`)
        if (!cancelled) setStudentDetail(res)
      } catch (e) {
        if (!cancelled) {
          setStudentDetail(null)
          setStudentDetailError(e.message || '학생 상세를 불러오지 못했습니다.')
        }
      } finally {
        if (!cancelled) setStudentDetailLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedPage, selectedStudentId, selectedMonth])

  const studentDetailSummary = useMemo(() => {
    const payments = studentDetail?.month_payments ?? []
    const enrollments = studentDetail?.enrollments ?? []
    const totalPaymentAmount = payments.reduce((sum, row) => sum + (Number(row.final_amount) || 0), 0)
    const totalSessions = payments.reduce((sum, row) => sum + (Number(row.total_sessions) || 0), 0)
    const completedSessions = payments.reduce((sum, row) => sum + (Number(row.completed_sessions) || 0), 0)
    const weekdaySet = new Set()
    enrollments.forEach((enrollment) => {
      ;(enrollment.weekdays ?? []).forEach((day) => {
        if (day) weekdaySet.add(day)
      })
    })
    const weekdayText = Array.from(weekdaySet).join(', ')
    return {
      totalPaymentAmount,
      totalSessions,
      completedSessions,
      weekdayText: weekdayText || '-',
    }
  }, [studentDetail])

  const updateStudentPaymentStatus = async (student, paymentStatus) => {
    if (!selectedMonth) return
    try {
      await apiRequest('/api/students/payment-status', {
        method: 'PATCH',
        body: JSON.stringify({
          billing_month: selectedMonth,
          student_id: student.student_id,
          teacher_id: student.teacher_id ?? null,
          payment_status: paymentStatus,
        }),
      })
      setStudents((prev) =>
        (prev ?? []).map((row) =>
          row.student_row_key === student.student_row_key ? { ...row, payment_status: paymentStatus } : row,
        ),
      )
      if (selectedPage === 'dashboard') {
        const dash = await apiRequest(`/api/dashboard?month=${encodeURIComponent(selectedMonth)}`)
        setDashboardData(dash)
      }
    } catch (e) {
      setStudentsError(e.message || '수납 상태를 변경하지 못했습니다.')
    }
  }

  const renderStudents = () => (
    <div className="students-layout">
      <SectionCard
        title="학생 수납"
        description="선택 월 기준 수납 완료/미납을 분리해 확인합니다. 미납은 월초 확인용으로 바로 노출됩니다."
        actions={
          <div className="filter-chips">
            <button
              type="button"
              className={studentBillingFilter === 'all' ? 'chip active' : 'chip'}
              onClick={() => setStudentBillingFilter('all')}
            >
              전체
            </button>
            <button
              type="button"
              className={studentBillingFilter === 'monthly' ? 'chip active' : 'chip'}
              onClick={() => setStudentBillingFilter('monthly')}
            >
              월별
            </button>
            <button
              type="button"
              className={studentBillingFilter === 'per_session' ? 'chip active' : 'chip'}
              onClick={() => setStudentBillingFilter('per_session')}
            >
              회당
            </button>
          </div>
        }
      >
        {studentsError ? <div className="banner error">{studentsError}</div> : null}
        {studentsLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
        {!studentsLoading ? (
          <div className="student-collection-kpis">
            <SettlementMetric label="전체 학생" value={`${studentCollectionSummary.total}명`} />
            <SettlementMetric
              label="수납 완료"
              value={`${studentCollectionSummary.paidRows.length}명`}
              sub={formatCurrency(studentCollectionSummary.paidAmount)}
            />
            <SettlementMetric
              label="미납/예정"
              value={`${studentCollectionSummary.unpaidRows.length}명`}
              sub="이번달 금액 0원"
            />
            <SettlementMetric
              label="최종 수납 금액"
              value={formatCurrency(studentCollectionSummary.paidAmount)}
              sub={`${formatMonth(selectedMonth)} 기준`}
            />
          </div>
        ) : null}
        {!studentsLoading ? (
          <div className="filter-chips">
            <button
              type="button"
              className={studentPaymentTab === 'all' ? 'chip active' : 'chip'}
              onClick={() => setStudentPaymentTab('all')}
            >
              전체
            </button>
            <button
              type="button"
              className={studentPaymentTab === 'paid' ? 'chip active' : 'chip'}
              onClick={() => setStudentPaymentTab('paid')}
            >
              수납 완료
            </button>
            <button
              type="button"
              className={studentPaymentTab === 'unpaid' ? 'chip active' : 'chip'}
              onClick={() => setStudentPaymentTab('unpaid')}
            >
              미납 / 예정
            </button>
          </div>
        ) : null}
        {filteredStudents.length === 0 && !studentsLoading ? (
          <div className="empty-state compact">선택한 조건에 맞는 학생 수납 내역이 없습니다.</div>
        ) : (
          <div className="student-collection-sections">
            {(studentPaymentTab === 'all' || studentPaymentTab === 'paid') && (
              <section className="student-collection-panel">
              <div className="student-collection-panel__head">
                <h4>수납 완료</h4>
                <span>
                  {studentCollectionSummary.paidRows.length}명 · {formatCurrency(studentCollectionSummary.paidAmount)}
                </span>
              </div>
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
                      <th>수납상태</th>
                      <th>상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentCollectionSummary.paidRows.map((student) => (
                      <tr key={student.student_row_key ?? `${student.student_id}:${student.teacher_id ?? 'na'}`}>
                        <td>
                          <strong>{student.student_display_name ?? student.student_name}</strong>
                        </td>
                        <td>{(student.products ?? []).join(', ') || '-'}</td>
                        <td>{(student.teachers ?? []).join(', ') || '-'}</td>
                        <td>{(student.billing_units ?? []).map((u) => settlementTypeLabel(u)).join(', ') || '-'}</td>
                        <td>
                          {(student.payment_methods ?? []).map((m) => formatPaymentMethodLabel(m)).join(', ') || '-'}
                        </td>
                        <td>
                          <strong>{formatCurrency(studentDisplayAmount(student, studentBillingFilter))}</strong>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => updateStudentPaymentStatus(student, 'unpaid')}
                          >
                            미납 처리
                          </button>
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
                    {studentCollectionSummary.paidRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="students-table-empty">
                          해당 조건의 수납 완료 학생이 없습니다.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              </section>
            )}

            {(studentPaymentTab === 'all' || studentPaymentTab === 'unpaid') && (
              <section className="student-collection-panel student-collection-panel--unpaid">
              <div className="student-collection-panel__head">
                <h4>미납 / 예정</h4>
                <span>{studentCollectionSummary.unpaidRows.length}명 · 이번달 금액 0원</span>
              </div>
              <div className="table-wrap settlement-overview-wrap">
                <table className="settlement-overview-table">
                  <thead>
                    <tr>
                      <th>학생</th>
                      <th>상품</th>
                      <th>담당 선생님</th>
                      <th>결제기준</th>
                      <th>결제수단</th>
                      <th>상태</th>
                      <th>수납상태</th>
                      <th>상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentCollectionSummary.unpaidRows.map((student) => (
                      <tr key={student.student_row_key ?? `${student.student_id}:${student.teacher_id ?? 'na'}`}>
                        <td>
                          <strong>{student.student_display_name ?? student.student_name}</strong>
                        </td>
                        <td>{(student.products ?? []).join(', ') || '-'}</td>
                        <td>{(student.teachers ?? []).join(', ') || '-'}</td>
                        <td>{(student.billing_units ?? []).map((u) => settlementTypeLabel(u)).join(', ') || '-'}</td>
                        <td>
                          {(student.payment_methods ?? []).map((m) => formatPaymentMethodLabel(m)).join(', ') || '-'}
                        </td>
                        <td>
                          <strong className="students-amount--pending">미납 / 예정</strong>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => updateStudentPaymentStatus(student, 'paid')}
                          >
                            수납 완료
                          </button>
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
                    {studentCollectionSummary.unpaidRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="students-table-empty">
                          미납/예정 학생이 없습니다.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              </section>
            )}
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
            setStudentDetailError('')
          }}
        >
          {studentDetailLoading ? <div className="empty-state compact">불러오는 중...</div> : null}
          {studentDetailError ? <div className="banner error">{studentDetailError}</div> : null}
          {studentDetail ? (
            <div className="student-detail-modal">
              <div className="student-detail-kpis">
                <article className="student-detail-kpi">
                  <span>총 결제 금액</span>
                  <strong>{formatCurrency(studentDetailSummary.totalPaymentAmount)}</strong>
                </article>
                <article className="student-detail-kpi">
                  <span>이번달 총 수업 횟수</span>
                  <strong>{studentDetailSummary.totalSessions}회</strong>
                </article>
                <article className="student-detail-kpi">
                  <span>수업 요일</span>
                  <strong>{studentDetailSummary.weekdayText}</strong>
                </article>
                <article className="student-detail-kpi">
                  <span>총 진행 수업 횟수</span>
                  <strong>{studentDetailSummary.completedSessions}회</strong>
                </article>
              </div>

              <section className="student-detail-block">
                <div className="student-detail-block__header">
                  <h4>이번달 수납 내역</h4>
                </div>
                {(studentDetail.month_payments ?? []).length === 0 ? (
                  <div className="empty-state compact">이번달 수납 내역이 없습니다.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="settlement-overview-table">
                      <thead>
                        <tr>
                          <th>선생님</th>
                          <th>상품</th>
                          <th>결제기준</th>
                          <th>결제수단</th>
                          <th>금액</th>
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="student-detail-block">
                <div className="student-detail-block__header">
                  <h4>이전 내역</h4>
                  <span>최근 30건</span>
                </div>
                {(studentDetail.payment_history ?? []).length === 0 ? (
                  <div className="empty-state compact">이전 수납 내역이 없습니다.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="settlement-overview-table">
                      <thead>
                        <tr>
                          <th>월</th>
                          <th>상품</th>
                          <th>결제기준</th>
                          <th>결제수단</th>
                          <th>금액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(studentDetail.payment_history ?? []).slice(0, 30).map((row) => (
                          <tr key={row.id}>
                            <td>
                              <span className="student-detail-month">
                                {row.billing_month}
                                {row.payment_tag === 'first_month' ? (
                                  <span className="tag-chip tag-chip--first-month">{paymentTagLabel(row.payment_tag)}</span>
                                ) : null}
                              </span>
                            </td>
                            <td>{row.product_name ?? '-'}</td>
                            <td>{row.billing_unit ? settlementTypeLabel(row.billing_unit) : '-'}</td>
                            <td>{row.payment_method ? formatPaymentMethodLabel(row.payment_method) : '-'}</td>
                            <td>{formatCurrency(row.final_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
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
            selectedMonth={selectedMonth}
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
          onClick={() => {
            if (item.id === 'data-admin') {
              setDataAdminTable(null)
            }
            setSelectedPage(item.id)
            setLastDbPage(item.id)
          }}
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
            <div className="brand-mark brand-mark--logo-only" aria-hidden="true">
              <img src="/logo.svg" alt="" className="brand-logo brand-logo--full" />
            </div>
          </div>
          <div className="page-heading__meta">월별 정산 리포트</div>
        </div>
      </header>

      <main className="page-shell">
        <div className="layout-shell">
          <aside className="sidebar">
            <nav className="sidebar__nav" aria-label="좌측 주 메뉴">
              {MAIN_NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === selectedPage ? 'nav-item active' : 'nav-item'}
                  onClick={() => setSelectedPage(item.id)}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                className={isDbPage(selectedPage) ? 'nav-item active' : 'nav-item'}
                onClick={() => setSelectedPage(isDbPage(selectedPage) ? selectedPage : lastDbPage)}
              >
                DB 관리
              </button>
            </nav>
          </aside>

          <section className={isDbPage(selectedPage) ? 'page-panel page-panel--db main-panel' : 'page-panel main-panel'}>
            <header className="page-panel__header">
              <div className="page-heading">
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
        </div>
      </main>
    </div>
  )
}

