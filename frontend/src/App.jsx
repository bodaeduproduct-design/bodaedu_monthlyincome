import { useEffect, useMemo, useState } from 'react'
import './App.css'

const NAV_ITEMS = [
  { id: 'dashboard', label: '대시보드' },
  { id: 'students', label: '학생 관리' },
  { id: 'teacher-settlements', label: '선생님 정산' },
  { id: 'monthly-settlements', label: '월별 정산' },
  { id: 'tuition', label: '수업료 관리' },
  { id: 'session-settlements', label: '회당 정산' },
  { id: 'session-collections', label: '회당 수금표' },
  { id: 'catalogs', label: '상품 / 단가표' },
]

const PRODUCT_GROUP_ORDER = ['35% 할인', '17% 할인', '회당 단가표']
const HIDDEN_RATE_SECTIONS = new Set(['중학교', '고등학교'])
const SCHOOL_ORDER = ['초등', '중등', '고등']
const FREQUENCY_ORDER = ['주1회', '주2회', '주3회', '주4회']
const DETAIL_ORDER = ['60분', '90분', '120분', '개별진도']

const PRODUCT_GROUP_META = {
  '35% 할인': {
    title: '월별 수업료 · 35% 할인',
    description: '최초 수업 학생에게 적용한 월별 수업료 기준입니다.',
  },
  '17% 할인': {
    title: '월별 수업료 · 17% 할인',
    description: '이후 적용한 월별 수업료 기준입니다.',
  },
  '회당 단가표': {
    title: '회당 수업료',
    description: '월별 수업료 이후 회차당 금액으로 전환된 학생 기준입니다.',
  },
}

const currencyFormatter = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
})

const numberFormatter = new Intl.NumberFormat('ko-KR')

function formatCurrency(value) {
  return currencyFormatter.format(value ?? 0)
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

function formatMonthLabel(value) {
  return value ? formatMonth(value) : '-'
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
    if (!parsed) {
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
        values: details.map((detail) => schoolMap.get(frequency)?.get(detail) ?? null),
      })),
    }
  }).filter(Boolean)
}

function createStudentForm(student = null) {
  return {
    student_name: student?.student_name ?? '',
    parent_name: student?.parent_name ?? '',
    contact: student?.contact ?? '',
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

function StatCard({ label, value, caption }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {caption ? <small>{caption}</small> : null}
    </article>
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
  const [selectedMonth, setSelectedMonth] = useState('')
  const [teacherQuery, setTeacherQuery] = useState('')
  const [collectionQuery, setCollectionQuery] = useState('')
  const [studentQuery, setStudentQuery] = useState('')
  const [selectedCatalogTab, setSelectedCatalogTab] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [studentForm, setStudentForm] = useState(createStudentForm())
  const [studentSaving, setStudentSaving] = useState(false)
  const [eventForm, setEventForm] = useState(createEventForm())
  const [editingEventId, setEditingEventId] = useState(null)
  const [eventSaving, setEventSaving] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const appData = await apiRequest('/api/app-data')
      setData(appData)
      setSelectedMonth((current) => current || appData.meta.latest_month || '')
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
    if (!data) {
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
        case 'monthly-settlements':
          return (data.monthly_settlements ?? []).some((row) => row.settlement_month === selectedMonth)
        case 'session-settlements':
          return (data.session_settlements ?? []).some((row) => row.settlement_month === selectedMonth)
        case 'session-collections':
          return (data.session_collections ?? []).some((row) => row.settlement_month === selectedMonth)
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

  const teacherSettlements = useMemo(
    () =>
      (data?.teacher_settlements ?? []).filter(
        (row) => !selectedMonth || row.settlement_month === selectedMonth,
      ),
    [data, selectedMonth],
  )
  const monthlySettlements = useMemo(
    () =>
      (data?.monthly_settlements ?? []).filter(
        (row) => !selectedMonth || row.settlement_month === selectedMonth,
      ),
    [data, selectedMonth],
  )
  const sessionSettlements = useMemo(
    () =>
      (data?.session_settlements ?? []).filter(
        (row) => !selectedMonth || row.settlement_month === selectedMonth,
      ),
    [data, selectedMonth],
  )
  const sessionCollections = useMemo(() => {
    const query = collectionQuery.trim().toLowerCase()
    return (data?.session_collections ?? []).filter((row) => {
      const matchesMonth = !selectedMonth || row.settlement_month === selectedMonth
      const haystack = [row.teacher_name, row.student_name, row.product_name, row.course]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      const matchesQuery = !query || haystack.includes(query)
      return matchesMonth && matchesQuery
    })
  }, [collectionQuery, data, selectedMonth])
  const tuitionRecords = useMemo(() => {
    const query = teacherQuery.trim().toLowerCase()
    return (data?.tuition_records ?? []).filter((row) => {
      const haystack = [row.teacher_name, row.subject, row.available_grades, row.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return !query || haystack.includes(query)
    })
  }, [data, teacherQuery])

  const teacherProfiles = useMemo(() => {
    const query = teacherQuery.trim().toLowerCase()
    return (data?.teacher_profiles ?? []).filter((row) => {
      const haystack = [row.teacher_name, row.subject, row.available_grades, row.education]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return !query || haystack.includes(query)
    })
  }, [data, teacherQuery])

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

  const pageTitle =
    NAV_ITEMS.find((item) => item.id === selectedPage)?.label ?? '정산 관리'

  const renderDashboard = () => (
    <>
      <section className="stats-grid">
        <StatCard
          label="최신 세후 정산 합계"
          value={formatCurrency(data.dashboard.latest_total_aftertax_amount)}
          caption={
            data.dashboard.latest_teacher_month
              ? `${formatMonth(data.dashboard.latest_teacher_month)} 지급 기준`
              : '선생님 정산 기준'
          }
        />
        <StatCard
          label="최신 세전 정산 합계"
          value={formatCurrency(data.dashboard.latest_total_pretax_amount)}
          caption="선생님 정산 시트 기준"
        />
        <StatCard
          label="최신 월별 수업료"
          value={formatCurrency(data.dashboard.latest_monthly_tuition)}
          caption={
            data.dashboard.latest_monthly_month
              ? `${formatMonth(data.dashboard.latest_monthly_month)} 지급 기준`
              : '월별 정산 시트 기준'
          }
        />
        <StatCard
          label="최신 회당 수금"
          value={formatCurrency(data.dashboard.latest_session_collection_amount)}
          caption={
            data.dashboard.latest_collection_month
              ? `${formatMonth(data.dashboard.latest_collection_month)} 회당 수금표 기준`
              : `${formatNumber(data.dashboard.tuition_record_count)}개 수업료 관리 행`
          }
        />
      </section>

      <div className="content-columns">
        <SectionCard
          title="최신 월 상위 선생님"
          description="세후 정산금액 기준으로 상위 순서를 보여줍니다."
        >
          <div className="rank-list">
            {data.dashboard.top_teachers.map((row) => (
              <div className="rank-item" key={row.teacher_name}>
                <div>
                  <strong>{row.teacher_name}</strong>
                  <span>학생 {formatNumber(row.student_count)}명</span>
                </div>
                <strong>{formatCurrency(row.final_aftertax_amount)}</strong>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="결제 방식 분포"
          description="수업료 관리 시트의 결제 컬럼을 기준으로 집계했습니다."
        >
          <div className="metric-list">
            {data.dashboard.payment_method_summary.map((row) => (
              <div className="metric-item" key={row.payment_method}>
                <span>{row.payment_method}</span>
                <strong>{formatNumber(row.count)}건</strong>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="content-columns">
        <SectionCard
          title="월별 정산 추이"
          description="지급월 기준으로 선생님 정산의 세전/세후 합계를 비교합니다."
        >
          <div className="trend-list">
            {data.dashboard.monthly_trend.map((row) => (
              <div className="trend-row" key={row.month}>
                <div>
                  <strong>{formatMonth(row.month)}</strong>
                  <span>{formatNumber(row.teacher_count)}명 정산</span>
                </div>
                <div className="trend-values">
                  <span>세전 {formatCurrency(row.final_pretax_amount)}</span>
                  <strong>세후 {formatCurrency(row.final_aftertax_amount)}</strong>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="인기 상품"
          description="회당 수금표에서 최신 월 금액이 높은 상품입니다."
        >
          <div className="rank-list">
            {data.dashboard.top_products.map((row) => (
              <div className="rank-item" key={row.product_name}>
                <div>
                  <strong>{row.product_name}</strong>
                  <span>{formatNumber(row.teacher_count)}명의 선생님이 사용</span>
                </div>
                <strong>{formatCurrency(row.total_amount)}</strong>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  )

  const renderStudents = () => (
    <div className="students-layout">
      <SectionCard
        title="학생 목록"
        description="시범수업일, 시작일, 결제 방식, 현재 상태를 기준으로 학생별 현황을 묶어 봅니다."
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
              <StatCard label="현재 결제 방식" value={selectedStudent.current_payment_method || '-'} />
              <StatCard label="현재 수업" value={selectedStudent.current_product_name || '-'} />
            </div>
          ) : null}
        </SectionCard>

        {selectedStudent ? (
          <>
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
    <SectionCard
      title="선생님 정산"
      description="수업월과 실제 정산월을 함께 보여주는 최종 지급표입니다."
      actions={
        <span className="summary-chip">
          합계 {formatCurrency(teacherSettlements.reduce((sum, row) => sum + row.final_aftertax_amount, 0))}
        </span>
      }
    >
      <DataTable
        rows={teacherSettlements}
        columns={[
          { key: 'service_month', label: '수업월', render: formatMonthLabel },
          { key: 'settlement_month', label: '정산월', render: formatMonthLabel },
          { key: 'teacher_name', label: '선생님' },
          { key: 'student_count', label: '학생 수', render: (value) => `${formatNumber(value)}명` },
          { key: 'monthly_pretax_amount', label: '월별 세전', render: formatCurrency },
          { key: 'session_pretax_amount', label: '회당 세전', render: formatCurrency },
          { key: 'final_pretax_amount', label: '최종 세전', render: formatCurrency },
          { key: 'final_aftertax_amount', label: '최종 세후', render: formatCurrency },
          { key: 'settlement_date', label: '정산일' },
        ]}
      />
    </SectionCard>
  )

  const renderMonthlySettlements = () => (
    <SectionCard
      title="월별 정산"
      description="수업월과 정산월을 분리해 월별 원장을 확인합니다."
      actions={
        <span className="summary-chip">
          총 수업료 {formatCurrency(monthlySettlements.reduce((sum, row) => sum + row.total_tuition, 0))}
        </span>
      }
    >
      <DataTable
        rows={monthlySettlements}
        columns={[
          { key: 'service_month', label: '수업월', render: formatMonthLabel },
          { key: 'settlement_month', label: '정산월', render: formatMonthLabel },
          { key: 'teacher_name', label: '선생님' },
          { key: 'student_count', label: '학생 수', render: (value) => `${formatNumber(value)}명` },
          { key: 'fee_rate', label: '수수료율', render: formatPercent },
          { key: 'first_payment', label: '첫달결제', render: formatCurrency },
          { key: 'recurring_payment', label: '정기결제', render: formatCurrency },
          { key: 'refund_amount', label: '환불', render: formatCurrency },
          { key: 'total_tuition', label: '총 수업료', render: formatCurrency },
          { key: 'trial_lesson_amount', label: '시범수업', render: formatCurrency },
          { key: 'pretax_amount', label: '세전 정산', render: formatCurrency },
        ]}
      />
    </SectionCard>
  )

  const renderTuitionManagement = () => (
    <>
      <SectionCard
        title="선생님 프로필"
        description="수업료 관리 시트와 최신 정산 데이터를 합쳐 선생님 현황을 보여줍니다."
      >
        <div className="profile-grid">
          {teacherProfiles.map((profile) => (
            <article className="profile-card" key={profile.teacher_name}>
              <div className="profile-card__top">
                <div>
                  <h3>{profile.teacher_name}</h3>
                  <p>{profile.subject || '전문 과목 미입력'}</p>
                </div>
                <span className="pill">{profile.payment_method || '미입력'}</span>
              </div>
              <dl>
                <div>
                  <dt>최신 세후 정산</dt>
                  <dd>{formatCurrency(profile.latest_aftertax_amount)}</dd>
                </div>
                <div>
                  <dt>최신 회당 수금</dt>
                  <dd>{formatCurrency(profile.latest_session_collection_amount)}</dd>
                </div>
                <div>
                  <dt>학생 수</dt>
                  <dd>{formatNumber(profile.latest_student_count)}명</dd>
                </div>
                <div>
                  <dt>가능 학년</dt>
                  <dd>{profile.available_grades || '-'}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="수업료 관리 원본"
        description="검색어로 선생님명, 과목, 학년, 이메일을 찾을 수 있습니다."
      >
        <DataTable
          rows={tuitionRecords}
          columns={[
            { key: 'sequence_no', label: '순번' },
            { key: 'payment_method', label: '결제' },
            { key: 'teacher_name', label: '선생님' },
            { key: 'phone', label: '연락처' },
            { key: 'email', label: '이메일' },
            { key: 'education', label: '학력' },
            { key: 'subject', label: '전문 과목' },
            { key: 'available_grades', label: '가능 학년' },
          ]}
        />
      </SectionCard>
    </>
  )

  const renderSessionSettlements = () => (
    <SectionCard
      title="회당 정산"
      description="회당 정산 시트는 현재 표기된 월을 정산월로 사용합니다."
      actions={
        <span className="summary-chip">
          정기 결제 수업료 {formatCurrency(sessionSettlements.reduce((sum, row) => sum + row.recurring_payment_fee, 0))}
        </span>
      }
    >
      <DataTable
        rows={sessionSettlements}
        columns={[
          { key: 'settlement_month', label: '정산월', render: formatMonthLabel },
          { key: 'teacher_name', label: '선생님' },
          { key: 'student_count', label: '학생 수', render: (value) => `${formatNumber(value)}명` },
          { key: 'first_payment_count', label: '첫달 수' },
          { key: 'first_payment_fee', label: '첫달 수업료', render: formatCurrency },
          { key: 'recurring_payment_count', label: '정기 수' },
          { key: 'recurring_payment_fee', label: '정기 수업료', render: formatCurrency },
          { key: 'refund_payment_count', label: '해지 수' },
          { key: 'refund_payment_fee', label: '해지 수업료', render: formatCurrency },
          { key: 'recurring_payment_commission', label: '정기 정산금', render: formatCurrency },
        ]}
      />
    </SectionCard>
  )

  const renderSessionCollections = () => (
    <SectionCard
      title="회당 수금표"
      description="선생님, 학생, 상품명 기준으로 검색할 수 있고 현재 표기된 월은 정산월입니다."
      actions={
        <span className="summary-chip">
          최신 월 수금 {formatCurrency(sessionCollections.reduce((sum, row) => sum + row.current_month_amount, 0))}
        </span>
      }
    >
      <DataTable
        rows={sessionCollections}
        columns={[
          { key: 'settlement_month', label: '정산월', render: formatMonthLabel },
          { key: 'payment_method', label: '결제' },
          { key: 'teacher_name', label: '선생님' },
          { key: 'student_name', label: '학생' },
          { key: 'commission_rate', label: '수수료', render: (value) => `${formatNumber(value)}%` },
          { key: 'course', label: '과정' },
          { key: 'weekly_frequency', label: '주별 횟수' },
          { key: 'weekdays', label: '요일' },
          { key: 'time_text', label: '시간' },
          { key: 'product_name', label: '상품명' },
          { key: 'current_month_sessions', label: '이번달 횟수' },
          { key: 'current_month_amount', label: '이번달 금액', render: formatCurrency },
        ]}
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
                <div className="school-price-sections">
                  {activeCatalogSchoolTables.map((schoolTable) => (
                    <section className="school-price-section" key={`${activeCatalogTab.key}-${schoolTable.school}`}>
                      <div className="school-price-section__header">
                        <h4>{schoolTable.school}</h4>
                        <span>{formatNumber(schoolTable.rows.length)}개 구간</span>
                      </div>
                      <div className="table-wrap catalog-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>구분</th>
                              {schoolTable.details.map((detail) => (
                                <th key={`${schoolTable.school}-${detail}`}>{detail}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {schoolTable.rows.map((row) => (
                              <tr key={`${schoolTable.school}-${row.frequency}`}>
                                <th>{row.frequency}</th>
                                {row.values.map((value, index) => (
                                  <td key={`${schoolTable.school}-${row.frequency}-${schoolTable.details[index]}`}>
                                    {value ? formatCurrency(value) : '-'}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
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

  const renderCurrentPage = () => {
    if (!data) {
      return null
    }

    switch (selectedPage) {
      case 'students':
        return renderStudents()
      case 'teacher-settlements':
        return renderTeacherSettlements()
      case 'monthly-settlements':
        return renderMonthlySettlements()
      case 'tuition':
        return renderTuitionManagement()
      case 'session-settlements':
        return renderSessionSettlements()
      case 'session-collections':
        return renderSessionCollections()
      case 'catalogs':
        return renderCatalogs()
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
                  ? '학생 페이지는 전체 히스토리를 기준으로 보여줍니다.'
                  : selectedMonth
                  ? `${formatMonth(selectedMonth)} 정산월 기준으로 필터링된 결과입니다.`
                  : '전체 데이터를 보고 있습니다.'}
              </p>
              <small className="page-heading__meta">
                마지막 동기화 {formatDateTime(data?.meta.last_imported_at)}
              </small>
            </div>

            <div className="toolbar">
              {selectedPage !== 'students' ? (
                <label className="toolbar-field">
                  <span>정산월 선택</span>
                  <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                    {months.map((month) => (
                      <option key={month} value={month}>
                        {formatMonth(month)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {selectedPage === 'tuition' ? (
                <label className="toolbar-field">
                  <span>선생님 검색</span>
                  <input
                    value={teacherQuery}
                    onChange={(event) => setTeacherQuery(event.target.value)}
                    placeholder="선생님명, 과목, 학년"
                  />
                </label>
              ) : null}

              {selectedPage === 'students' ? (
                <label className="toolbar-field">
                  <span>학생 검색</span>
                  <input
                    value={studentQuery}
                    onChange={(event) => setStudentQuery(event.target.value)}
                    placeholder="학생명, 선생님, 상품명"
                  />
                </label>
              ) : null}

              {selectedPage === 'session-collections' ? (
                <label className="toolbar-field">
                  <span>수금표 검색</span>
                  <input
                    value={collectionQuery}
                    onChange={(event) => setCollectionQuery(event.target.value)}
                    placeholder="선생님, 학생, 상품명"
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
