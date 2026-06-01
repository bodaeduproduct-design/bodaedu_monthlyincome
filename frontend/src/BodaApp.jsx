import { useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import {
  formatPaymentMethodLabel,
  normalizePaymentMethodKey,
  paymentMethodFilterLabel,
  SimpleBarChart,
  SimpleDonutChart,
} from './charts.jsx'
import DataAdminView from './DataAdminView.jsx'
import DataOverviewView from './DataOverviewView.jsx'
import DataRegisterView from './DataRegisterView.jsx'
import DbSchemaView from './DbSchemaView.jsx'
import MonthPicker from './MonthPicker.jsx'
import TeacherSettlementDetailBody from './TeacherSettlementDetailBody.jsx'
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

const SETTLEMENT_TEST_EMAIL = 'bodaedu_product@bodaedu.kr'

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
  let response
  try {
    response = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      ...options,
    })
  } catch {
    throw new Error(
      '서버에 연결할 수 없습니다. 백엔드(uvicorn --port 8001)가 실행 중인지 확인한 뒤 새로고침해 주세요.',
    )
  }
  if (!response.ok) {
    let detail = '요청 처리 중 오류가 발생했습니다.'
    try {
      const data = await response.json()
      if (typeof data.detail === 'string') detail = data.detail
      else if (Array.isArray(data.detail)) {
        detail = data.detail.map((item) => item?.msg ?? JSON.stringify(item)).join(', ')
      }
    } catch {
      if (response.status === 502 || response.status === 503) {
        detail =
          '백엔드 서버에 연결하지 못했습니다. 잠시 후 새로고침하거나 uvicorn(8001) 실행 여부를 확인해 주세요.'
      }
    }
    throw new Error(detail)
  }
  if (response.status === 204) return null
  return response.json()
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function studentDisplayAmountBreakdown(student) {
  const monthly = Number(student?.month_paid_amount_monthly || 0)
  const perSession = Number(student?.month_paid_amount_per_session || 0)
  const total = Number(student?.month_paid_amount || 0)
  return { monthly, perSession, total }
}

export default function BodaApp() {
  const [selectedPage, setSelectedPage] = useState('dashboard')
  const [lastDbPage, setLastDbPage] = useState('data-register')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [dataAdminTable, setDataAdminTable] = useState(null)

  const [appData, setAppData] = useState(null)
  const [dashboardData, setDashboardData] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [paymentSummary, setPaymentSummary] = useState(null)
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
      const maxAttempts = 4
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
          return
        } catch (e) {
          if (cancelled) return
          if (attempt < maxAttempts) {
            await waitMs(600 * attempt)
            continue
          }
          setError(e.message)
        }
      }
      if (!cancelled) setLoading(false)
    }
    load().finally(() => {
      if (!cancelled) setLoading(false)
    })
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

  const paymentDonutData = useMemo(
    () =>
      (paymentSummary?.items ?? []).map((row) => ({
        label: formatPaymentMethodLabel(row.payment_method),
        value: row.amount,
      })),
    [paymentSummary],
  )

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
              <span>
                {paymentSummary?.billing_month
                  ? `${formatMonth(paymentSummary.billing_month)} 수납 기준`
                  : '조회 월 수납 기준'}
              </span>
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
  const [teacherNotice, setTeacherNotice] = useState('')
  const [teacherSearch, setTeacherSearch] = useState('')
  const [teacherEmailSending, setTeacherEmailSending] = useState(false)
  const [teacherEmailPreviewing, setTeacherEmailPreviewing] = useState(false)
  const [teacherEmailModalOpen, setTeacherEmailModalOpen] = useState(false)
  const [teacherEmailSelection, setTeacherEmailSelection] = useState({})
  const [settlementEmailStatus, setSettlementEmailStatus] = useState({
    smtp_ready: false,
    test_email: SETTLEMENT_TEST_EMAIL,
  })
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
  const emailCaptureRef = useRef(null)
  const [emailCaptureDetail, setEmailCaptureDetail] = useState(null)

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

  useEffect(() => {
    if (selectedPage !== 'teacher-settlements') return
    let cancelled = false
    apiRequest('/api/teachers/settlements/email-status')
      .then((res) => {
        if (!cancelled) setSettlementEmailStatus(res)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedPage])

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
      totalMonthlyPreTax: rows.reduce((sum, row) => sum + (row.monthly_pre_tax_amount ?? 0), 0),
      totalPerSessionPreTax: rows.reduce((sum, row) => sum + (row.per_session_pre_tax_amount ?? 0), 0),
      totalTrialPreTax: rows.reduce((sum, row) => sum + (row.trial_pre_tax_amount ?? 0), 0),
      totalPreTax: rows.reduce((sum, row) => sum + (row.pre_tax_amount ?? 0), 0),
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

  const waitForPaint = () =>
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    })

  const resolveSettlementTestTeacher = () => {
    if (selectedTeacherIds.length > 0) {
      const row = teacherEmailRows.find((item) => item.teacher_id === selectedTeacherIds[0])
      if (row) {
        return { teacher_id: row.teacher_id, teacher_name: row.teacher_name }
      }
    }
    const fallback = (teacherAggregated ?? []).find((row) => row.teacher_name === '서재현')
    if (fallback) {
      return { teacher_id: fallback.teacher_id, teacher_name: fallback.teacher_name }
    }
    return null
  }

  const captureTeacherSummaryPngBase64 = async (teacherId, billingMonth, teacherName) => {
    setTeacherNotice(`요약 이미지 준비 중… ${teacherName ?? ''}`)
    const detail = await apiRequest(
      `/api/teachers/${teacherId}/settlements/${encodeURIComponent(billingMonth)}`,
    )
    setEmailCaptureDetail(detail)
    await waitForPaint()
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (!emailCaptureRef.current) {
      setEmailCaptureDetail(null)
      throw new Error('이미지 캡처 영역을 찾을 수 없습니다.')
    }
    const canvas = await html2canvas(emailCaptureRef.current, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
    })
    setEmailCaptureDetail(null)
    return canvas.toDataURL('image/png').split(',')[1]
  }

  const downloadTeacherSummaryPreview = async () => {
    const target = resolveSettlementTestTeacher()
    if (!target) {
      setTeacherError('미리볼 선생님을 찾을 수 없습니다. 메일 모달에서 선택하거나 서재현 데이터가 필요합니다.')
      return
    }
    setTeacherEmailPreviewing(true)
    setTeacherError('')
    try {
      const pngBase64 = await captureTeacherSummaryPngBase64(
        target.teacher_id,
        selectedMonth,
        target.teacher_name,
      )
      const anchor = document.createElement('a')
      anchor.href = `data:image/png;base64,${pngBase64}`
      const safeName = `${target.teacher_name}_${formatMonth(selectedMonth)}`.replace(/[\\/:*?"<>|]/g, '_')
      anchor.download = `정산요약_${safeName}.png`
      anchor.click()
      setTeacherNotice(`${target.teacher_name} 요약 이미지를 저장했습니다.`)
    } catch (e) {
      setTeacherError(e.message || '요약 이미지 저장에 실패했습니다.')
    } finally {
      setTeacherEmailPreviewing(false)
    }
  }

  const sendSettlementTestEmail = async () => {
    const target = resolveSettlementTestTeacher()
    const testEmail = settlementEmailStatus?.test_email ?? SETTLEMENT_TEST_EMAIL
    if (!target) {
      setTeacherError('테스트할 선생님을 찾을 수 없습니다.')
      return
    }
    if (
      !window.confirm(
        `${target.teacher_name} 선생님 ${formatMonth(selectedMonth)} 요약 PNG를\n${testEmail} 로 테스트 발송할까요?`,
      )
    ) {
      return
    }
    setTeacherEmailSending(true)
    setTeacherError('')
    setTeacherNotice('')
    try {
      const pngBase64 = await captureTeacherSummaryPngBase64(
        target.teacher_id,
        selectedMonth,
        target.teacher_name,
      )
      setTeacherNotice('테스트 메일 발송 중…')
      const res = await apiRequest('/api/teachers/settlements/send-email/test', {
        method: 'POST',
        body: JSON.stringify({
          billing_month: selectedMonth,
          teacher_id: target.teacher_id,
          png_base64: pngBase64,
          to_email: testEmail,
        }),
      })
      setTeacherNotice(
        `테스트 메일 발송 완료: ${res.teacher_name} → ${res.to_email} (${formatCurrency(res.net_amount ?? 0)})`,
      )
    } catch (e) {
      setEmailCaptureDetail(null)
      setTeacherError(e.message || '테스트 메일 발송에 실패했습니다.')
    } finally {
      setTeacherEmailSending(false)
    }
  }

  const buildTeacherEmailAttachments = async (teacherIds, billingMonth) => {
    const attachments = []
    for (let index = 0; index < teacherIds.length; index += 1) {
      const teacherId = teacherIds[index]
      const row = teacherEmailRows.find((item) => item.teacher_id === teacherId)
      setTeacherNotice(
        `정산서 이미지 준비 중 (${index + 1}/${teacherIds.length})… ${row?.teacher_name ?? ''}`,
      )
      const png_base64 = await captureTeacherSummaryPngBase64(
        teacherId,
        billingMonth,
        row?.teacher_name,
      )
      attachments.push({
        teacher_id: teacherId,
        png_base64,
      })
    }
    return attachments
  }

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
              disabled={teacherEmailPreviewing || teacherLoading || !selectedMonth}
              title="요약 PNG 저장 (선택 1명 또는 서재현)"
              onClick={() => downloadTeacherSummaryPreview()}
            >
              {teacherEmailPreviewing ? '저장 중...' : '요약 미리보기'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={teacherEmailSending || teacherLoading || !selectedMonth}
              title={`테스트 수신: ${settlementEmailStatus?.test_email ?? SETTLEMENT_TEST_EMAIL}`}
              onClick={() => sendSettlementTestEmail()}
            >
              {teacherEmailSending ? '발송 중...' : '테스트 메일'}
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
        {teacherNotice || teacherError ? (
          <div className="teacher-settlement-alerts">
            {teacherNotice ? <div className="banner success">{teacherNotice}</div> : null}
            {teacherError ? <div className="banner error">{teacherError}</div> : null}
          </div>
        ) : null}
        {settlementEmailStatus && !settlementEmailStatus.smtp_ready ? (
          <div className="banner error">
            SMTP가 설정되지 않았습니다. 터미널에서{' '}
            <code>정산앱/backend/start-smtp.sh</code> 로 백엔드를 실행한 뒤 테스트 메일을 보내세요.
          </div>
        ) : null}
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
              <SettlementMetric label="월별 수업 (세전)" value={formatCurrency(teacherOverview.totalMonthlyPreTax)} />
              <SettlementMetric label="회차별 수업 (세전)" value={formatCurrency(teacherOverview.totalPerSessionPreTax)} />
              <SettlementMetric label="시범 수업 (세전)" value={formatCurrency(teacherOverview.totalTrialPreTax)} />
              <SettlementMetric
                label="최종 정산 합계"
                value={formatCurrency(teacherOverview.totalPreTax)}
                sub={formatCurrency(teacherTotals.net_amount)}
              />
            </div>

            <div className="table-wrap settlement-overview-wrap">
              <table className="settlement-overview-table">
                <thead>
                  <tr>
                    <th>선생님</th>
                    <th>담당학생수</th>
                    <th>월별 수업 (세전)</th>
                    <th>회차별 수업 (세전)</th>
                    <th>시범 수업 (세전)</th>
                    <th>최종 정산</th>
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
                      <td>{formatCurrency(row.monthly_pre_tax_amount ?? 0)}</td>
                      <td>{formatCurrency(row.per_session_pre_tax_amount ?? 0)}</td>
                      <td>{formatCurrency(row.trial_pre_tax_amount ?? 0)}</td>
                      <td>
                        <strong>{formatCurrency(row.pre_tax_amount ?? 0)}</strong>
                        <small className="table-sub">{formatCurrency(row.net_amount)}</small>
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
            <TeacherSettlementDetailBody detail={teacherDetail} formatCurrency={formatCurrency} />
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
            <div className="teacher-email-modal-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={teacherEmailPreviewing || teacherEmailSending}
              onClick={() => downloadTeacherSummaryPreview()}
            >
              {teacherEmailPreviewing ? '저장 중...' : '요약 미리보기'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={teacherEmailSending}
              onClick={() => sendSettlementTestEmail()}
            >
              {teacherEmailSending ? '발송 중...' : '테스트 메일'}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={teacherEmailSending || selectedTeacherIds.length === 0}
              onClick={async () => {
                if (
                  !window.confirm(
                    `${selectedTeacherIds.length}명에게 정산서 이미지(PNG)를 첨부해 메일을 발송할까요?`,
                  )
                ) {
                  return
                }
                setTeacherEmailSending(true)
                setTeacherError('')
                setTeacherNotice('')
                try {
                  const attachments = await buildTeacherEmailAttachments(selectedTeacherIds, selectedMonth)
                  if (attachments.length !== selectedTeacherIds.length) {
                    throw new Error('정산 상세 내역서 이미지를 모두 만들지 못했습니다.')
                  }
                  setTeacherNotice('메일 발송 중…')
                  const res = await apiRequest('/api/teachers/settlements/send-email', {
                    method: 'POST',
                    body: JSON.stringify({
                      billing_month: selectedMonth,
                      teacher_ids: selectedTeacherIds,
                      attachments,
                    }),
                  })
                  const failedReasons = (res.failed ?? [])
                    .map((row) => `${row.teacher_name ?? row.teacher_id}: ${row.reason ?? '실패'}`)
                    .slice(0, 3)
                  if ((res.failed_count ?? 0) > 0) {
                    const suffix = failedReasons.length ? ` (${failedReasons.join(' / ')})` : ''
                    setTeacherError(
                      `메일 발송 실패 ${res.failed_count}건 / 성공 ${res.sent_count}건 / 스킵 ${res.skipped_count}건${suffix}`,
                    )
                    setTeacherNotice('')
                  } else {
                    setTeacherNotice(
                      `메일 발송 완료: 성공 ${res.sent_count}건 / 스킵 ${res.skipped_count}건`,
                    )
                    setTeacherEmailModalOpen(false)
                  }
                } catch (e) {
                  setEmailCaptureDetail(null)
                  setTeacherError(e.message || '메일 발송에 실패했습니다.')
                } finally {
                  setTeacherEmailSending(false)
                }
              }}
            >
              {teacherEmailSending ? '발송 중...' : `선택 ${selectedTeacherIds.length}명 발송`}
            </button>
            </div>
          }
        >
          <p className="teacher-email-send__hint">
            테스트 메일은 <strong>{settlementEmailStatus?.test_email ?? SETTLEMENT_TEST_EMAIL}</strong> 로만
            발송됩니다. 요약 미리보기·테스트는 선택한 첫 번째 선생님 기준이며, 선택이 없으면 서재현 선생님
            데이터를 사용합니다.
          </p>
          <div className="teacher-email-send">
            <div className="teacher-email-send__toolbar">
              <label className="teacher-email-send__select-all">
                <input
                  type="checkbox"
                  className="teacher-email-send__checkbox"
                  checked={teacherEmailRows.length > 0 && selectedTeacherIds.length === teacherEmailRows.length}
                  onChange={(e) => {
                    const checked = e.target.checked
                    const next = {}
                    for (const row of teacherEmailRows) {
                      next[row.teacher_id] = checked
                    }
                    setTeacherEmailSelection(next)
                  }}
                />
                <span className="teacher-email-send__checkbox-ui" aria-hidden="true" />
                <span>전체 선택</span>
              </label>
              <span className="teacher-email-send__count">{selectedTeacherIds.length}명 선택</span>
            </div>
            <div className="table-wrap teacher-email-send__table-wrap">
              <table className="teacher-email-send-table">
                <colgroup>
                  <col className="teacher-email-send-table__col-check" />
                  <col className="teacher-email-send-table__col-name" />
                  <col className="teacher-email-send-table__col-email" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className="teacher-email-send-table__check">
                      선택
                    </th>
                    <th scope="col" className="teacher-email-send-table__name">
                      선생님
                    </th>
                    <th scope="col" className="teacher-email-send-table__email">
                      이메일
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {teacherEmailRows.map((row) => (
                    <tr
                      key={`mail-${row.teacher_id}`}
                      className={teacherEmailSelection[row.teacher_id] ? 'is-selected' : undefined}
                    >
                      <td className="teacher-email-send-table__check">
                        <label className="teacher-email-send__row-check">
                          <input
                            type="checkbox"
                            className="teacher-email-send__checkbox"
                            checked={!!teacherEmailSelection[row.teacher_id]}
                            onChange={(e) =>
                              setTeacherEmailSelection((prev) => ({
                                ...prev,
                                [row.teacher_id]: e.target.checked,
                              }))
                            }
                          />
                          <span className="teacher-email-send__checkbox-ui" aria-hidden="true" />
                        </label>
                      </td>
                      <td className="teacher-email-send-table__name">{row.teacher_name}</td>
                      <td className="teacher-email-send-table__email">{row.teacher_email || '-'}</td>
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
          </div>
        </DetailModal>
      ) : null}

      <div
        className="teacher-email-capture-host teacher-email-capture-host--summary"
        ref={emailCaptureRef}
        aria-hidden="true"
      >
        {emailCaptureDetail ? (
          <TeacherSettlementDetailBody
            detail={emailCaptureDetail}
            formatCurrency={formatCurrency}
            variant="summary"
          />
        ) : null}
      </div>
    </>
  )

  const [students, setStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [studentsError, setStudentsError] = useState('')
  const [studentBillingFilter, setStudentBillingFilter] = useState('all')
  const [studentPaymentMethodFilter, setStudentPaymentMethodFilter] = useState('all')
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
    setStudentPaymentMethodFilter('all')
    setStudentPaymentTab('all')
  }, [selectedPage, selectedMonth])

  const studentPaymentMethodFilterOptions = useMemo(() => {
    const keys = new Set()
    for (const student of students) {
      for (const method of student.payment_methods ?? []) {
        keys.add(normalizePaymentMethodKey(method))
      }
    }
    const order = ['card', 'transfer', 'payer', 'cms', 'other']
    return ['all', ...order.filter((key) => keys.has(key)), ...[...keys].filter((key) => !order.includes(key)).sort()]
  }, [students])

  const billingFilteredStudents = useMemo(() => {
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

  const filteredStudents = useMemo(() => {
    if (studentPaymentMethodFilter === 'all') return billingFilteredStudents
    return billingFilteredStudents.filter((student) =>
      (student.payment_methods ?? []).some(
        (method) => normalizePaymentMethodKey(method) === studentPaymentMethodFilter,
      ),
    )
  }, [billingFilteredStudents, studentPaymentMethodFilter])

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
        description="선택한 조회 월 기준 수납 금액만 표시합니다. 미납은 월초 확인용으로 바로 노출됩니다."
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
        {!studentsLoading && studentPaymentMethodFilterOptions.length > 1 ? (
          <div className="filter-chips filter-chips--payment-method">
            <span className="filter-chips__label">결제수단</span>
            {studentPaymentMethodFilterOptions.map((key) => (
              <button
                key={key}
                type="button"
                className={studentPaymentMethodFilter === key ? 'chip active' : 'chip'}
                onClick={() => setStudentPaymentMethodFilter(key)}
              >
                {paymentMethodFilterLabel(key)}
              </button>
            ))}
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
                          {(() => {
                            const amounts = studentDisplayAmountBreakdown(student)
                            const display = studentDisplayAmount(student, studentBillingFilter)
                            return (
                              <>
                                <strong>{formatCurrency(display)}</strong>
                                {studentBillingFilter === 'all' ? (
                                  <small className="table-sub">
                                    월별 {formatCurrency(amounts.monthly)} / 회당 {formatCurrency(amounts.perSession)}
                                  </small>
                                ) : null}
                              </>
                            )
                          })()}
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
                      <th>{formatMonth(selectedMonth)} 수납</th>
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
                          {studentDisplayAmount(student, studentBillingFilter) > 0 ? (
                            <strong className="students-amount--pending">
                              {(() => {
                                const amounts = studentDisplayAmountBreakdown(student)
                                const display = studentDisplayAmount(student, studentBillingFilter)
                                return (
                                  <>
                                    {formatCurrency(display)}
                                    {studentBillingFilter === 'all' ? (
                                      <small className="table-sub">
                                        월별 {formatCurrency(amounts.monthly)} / 회당 {formatCurrency(amounts.perSession)}
                                      </small>
                                    ) : null}
                                  </>
                                )
                              })()}
                            </strong>
                          ) : (
                            <strong className="students-amount--pending">미납 / 예정</strong>
                          )}
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
              <div className="student-detail-summary">
                <article className="student-detail-summary-card">
                  <span className="student-detail-summary-card__label">총 결제 금액</span>
                  <p className="student-detail-summary-card__value">
                    {formatCurrency(studentDetailSummary.totalPaymentAmount)}
                  </p>
                  <span className="student-detail-summary-card__hint">
                    {formatMonth(studentDetail.billing_month ?? selectedMonth)} 기준
                  </span>
                </article>
                <article className="student-detail-summary-card">
                  <span className="student-detail-summary-card__label">이번달 총 수업 횟수</span>
                  <p className="student-detail-summary-card__value">
                    {studentDetailSummary.totalSessions}
                    <span className="student-detail-summary-card__unit">회</span>
                  </p>
                </article>
                <article className="student-detail-summary-card">
                  <span className="student-detail-summary-card__label">수업 요일</span>
                  <p className="student-detail-summary-card__value student-detail-summary-card__value--text">
                    {studentDetailSummary.weekdayText}
                  </p>
                </article>
                <article className="student-detail-summary-card">
                  <span className="student-detail-summary-card__label">총 진행 수업 횟수</span>
                  <p className="student-detail-summary-card__value">
                    {studentDetailSummary.completedSessions}
                    <span className="student-detail-summary-card__unit">회</span>
                  </p>
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
                    <table className="settlement-overview-table student-payment-table">
                      <thead>
                        <tr>
                          <th>선생님</th>
                          <th>상품</th>
                          <th>결제기준</th>
                          <th>결제수단</th>
                          <th className="col-amount">금액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(studentDetail.month_payments ?? []).map((row) => (
                          <tr key={row.id}>
                            <td>{row.teacher_name ?? `선생님#${row.teacher_id}`}</td>
                            <td>{row.product_name ?? '-'}</td>
                            <td>{row.billing_unit ? settlementTypeLabel(row.billing_unit) : '-'}</td>
                            <td>{row.payment_method ? formatPaymentMethodLabel(row.payment_method) : '-'}</td>
                            <td className="col-amount">
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
                    <table className="settlement-overview-table student-payment-table">
                      <thead>
                        <tr>
                          <th>월</th>
                          <th>선생님</th>
                          <th>상품</th>
                          <th>결제기준</th>
                          <th>결제수단</th>
                          <th className="col-amount">금액</th>
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
                            <td>{row.teacher_name ?? (row.teacher_id ? `선생님#${row.teacher_id}` : '-')}</td>
                            <td>{row.product_name ?? '-'}</td>
                            <td>{row.billing_unit ? settlementTypeLabel(row.billing_unit) : '-'}</td>
                            <td>{row.payment_method ? formatPaymentMethodLabel(row.payment_method) : '-'}</td>
                            <td className="col-amount">{formatCurrency(row.final_amount)}</td>
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
                  <MonthPicker
                    label="조회 월"
                    value={selectedMonth}
                    onChange={setSelectedMonth}
                    availableMonths={months}
                  />
                </div>
              ) : null}
            </header>

          <div className="page-panel__body">
            {error ? (
              <div className="banner error">
                {error}
                <button
                  type="button"
                  className="ghost-button"
                  style={{ marginLeft: '0.75rem' }}
                  onClick={() => window.location.reload()}
                >
                  새로고침
                </button>
              </div>
            ) : null}
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

