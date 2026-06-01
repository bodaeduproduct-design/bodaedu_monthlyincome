/** 차트 — Wanted DS 토큰 기준 단색 (그라데이션 없음) */
const BAR_COLOR = '#3182f6'
const GRID = '#e5e5e7'
const AXIS = '#aeb0b6'
const LABEL = '#878a93'

const DONUT_COLORS = ['#3182f6', '#70737c', '#aeb0b6', '#d9d9dc', '#e5e5e7', '#f0f0f1']

const PAYMENT_METHOD_LABELS = {
  card: '카드',
  transfer: '계좌이체',
  payer: '납부자',
  cms: 'CMS',
  other: '기타',
}

/** 결제수단 필터·집계용 키 (DB 표기 card/카드 등 통일) */
export function normalizePaymentMethodKey(method) {
  const raw = String(method ?? '').trim()
  if (!raw) return 'other'
  const lower = raw.toLowerCase()
  if (lower === 'card' || raw === '카드') return 'card'
  if (lower === 'transfer' || raw === '계좌이체') return 'transfer'
  if (lower === 'payer' || raw === '납부자') return 'payer'
  if (lower === 'cms') return 'cms'
  if (raw === '결제' || raw === '미입력') return 'other'
  return lower
}

export function paymentMethodFilterLabel(key) {
  if (key === 'all') return '전체'
  return PAYMENT_METHOD_LABELS[key] || key
}

export function formatPaymentMethodLabel(method) {
  const key = normalizePaymentMethodKey(method)
  if (key !== 'other' && PAYMENT_METHOD_LABELS[key]) {
    return PAYMENT_METHOD_LABELS[key]
  }
  const map = {
    card: '카드(효성)',
    transfer: '계좌이체',
    payer: '납부자(효성)',
    cms: 'CMS(효성)',
  }
  return map[method] || method || '미입력'
}

function defaultFormatValue(value) {
  return Number(value).toLocaleString('ko-KR')
}

function hasPositiveValues(data, valueKey = 'value') {
  return (data ?? []).some((row) => Number(row[valueKey]) > 0)
}

function hasPositiveStackTotals(data, stacks) {
  return (data ?? []).some((row) =>
    stacks.some((stack) => Number(row[stack.key]) > 0),
  )
}

/** 월별 추이 — 세로 막대 (가독성 우선) */
export function SimpleBarChart({
  data,
  valueKey = 'value',
  labelKey = 'label',
  formatValue,
  unit = '',
  barColor = BAR_COLOR,
}) {
  if (!data?.length || !hasPositiveValues(data, valueKey)) {
    return <div className="chart-empty">표시할 데이터가 없습니다.</div>
  }

  const width = 560
  const height = 220
  const padX = 30
  const padTop = 18
  const padBottom = 36
  const plotW = width - padX * 2
  const plotH = height - padTop - padBottom
  const values = data.map((d) => Number(d[valueKey]) || 0)
  const max = Math.max(...values, 1)
  const fmt = formatValue || defaultFormatValue
  const stepX = data.length > 1 ? plotW / (data.length - 1) : plotW
  const points = data.map((row, index) => {
    const value = Number(row[valueKey]) || 0
    const x = padX + stepX * index
    const y = padTop + plotH - (value / max) * plotH
    return { x, y, value, label: row[labelKey] }
  })
  const lineD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ')
  const areaD = `${lineD} L ${padX + plotW} ${padTop + plotH} L ${padX} ${padTop + plotH} Z`
  const gridRatios = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="bar-chart bar-chart--area" role="img" aria-label="추이 차트">
      <svg viewBox={`0 0 ${width} ${height}`} className="bar-chart__svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`areaFill-${barColor.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={barColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={barColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {gridRatios.map((ratio) => {
          const y = padTop + plotH * (1 - ratio)
          const val = max * ratio
          return (
            <g key={ratio}>
              <line x1={padX} y1={y} x2={width - padX} y2={y} stroke={GRID} strokeWidth="1" strokeOpacity="0.7" />
              <text x={padX - 6} y={y + 4} textAnchor="end" className="bar-chart__axis">
                {fmt(val)}
                {unit}
              </text>
            </g>
          )
        })}
        <path d={areaD} fill={`url(#areaFill-${barColor.replace('#', '')})`} />
        <path d={lineD} fill="none" stroke={barColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, index) => (
          <g key={`${p.label ?? index}`}>
            <circle cx={p.x} cy={p.y} r="4" fill={barColor} />
            <text x={p.x} y={p.y - 12} textAnchor="middle" className="bar-chart__value">
              {fmt(p.value)}
              {unit}
            </text>
            <text x={p.x} y={height - 10} textAnchor="middle" className="bar-chart__label">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

/** 결제 수단 — SVG 도넛 (conic-gradient 미사용) */
export function SimpleDonutChart({ data, valueKey = 'value', labelKey = 'label', formatLabel }) {
  if (!data?.length || !hasPositiveValues(data, valueKey)) {
    return <div className="chart-empty">표시할 데이터가 없습니다.</div>
  }

  const total = data.reduce((sum, row) => sum + (Number(row[valueKey]) || 0), 0)

  const cx = 90
  const cy = 90
  const radius = 72
  const stroke = 28
  const circumference = 2 * Math.PI * radius
  let offset = 0

  const segments = data.map((row, index) => {
    const value = Number(row[valueKey]) || 0
    const pct = value / total
    const length = pct * circumference
    const seg = {
      color: DONUT_COLORS[index % DONUT_COLORS.length],
      label: formatLabel ? formatLabel(row[labelKey]) : row[labelKey],
      value,
      pct: Math.round(pct * 100),
      dasharray: `${length} ${circumference - length}`,
      dashoffset: -offset,
    }
    offset += length
    return seg
  })

  return (
    <div className="donut-chart donut-chart--simple">
      <div className="donut-chart__visual">
        <svg width="180" height="180" viewBox="0 0 180 180" className="donut-chart__svg">
          <g transform={`rotate(-90 ${cx} ${cy})`}>
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
            {segments.map((seg) => (
              <circle
                key={seg.label}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={stroke}
                strokeDasharray={seg.dasharray}
                strokeDashoffset={seg.dashoffset}
              />
            ))}
          </g>
        </svg>
        <div className="donut-chart__center">
          <strong>{total.toLocaleString('ko-KR')}</strong>
          <span>원</span>
        </div>
      </div>
      <ul className="donut-chart__legend">
        {segments.map((seg) => (
          <li key={seg.label}>
            <span className="donut-chart__swatch" style={{ background: seg.color }} />
            <span className="donut-chart__name">{seg.label}</span>
            <span className="donut-chart__amount">
              {seg.pct}% · {seg.value.toLocaleString('ko-KR')}원
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SimpleStackedBarChart({
  data,
  labelKey = 'label',
  stacks = [
    { key: 'monthly', label: '월별', color: '#22c55e' },
    { key: 'perSession', label: '회차별', color: '#3b82f6' },
    { key: 'trial', label: '시범', color: '#f59e0b' },
  ],
  formatValue,
}) {
  if (!data?.length || !hasPositiveStackTotals(data, stacks)) {
    return <div className="chart-empty">표시할 데이터가 없습니다.</div>
  }

  const width = 560
  const height = 260
  const padX = 68
  const padTop = 16
  const padBottom = 28
  const rowGap = 12
  const barH = 22
  const plotW = width - padX - 28
  const max = Math.max(
    ...data.map((row) => stacks.reduce((sum, s) => sum + (Number(row[s.key]) || 0), 0)),
    1,
  )
  const fmt = formatValue || defaultFormatValue

  return (
    <div className="stacked-chart" role="img" aria-label="선생님별 정산 구성 비율">
      <div className="stacked-chart__legend">
        {stacks.map((stack) => (
          <span key={stack.key}>
            <i style={{ background: stack.color }} />
            {stack.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="stacked-chart__svg" preserveAspectRatio="xMidYMid meet">
        {data.map((row, idx) => {
          const y = padTop + idx * (barH + rowGap)
          let xCursor = padX
          const total = stacks.reduce((sum, s) => sum + (Number(row[s.key]) || 0), 0)
          return (
            <g key={row[labelKey] ?? idx}>
              <text x={8} y={y + 15} className="stacked-chart__label">
                {row[labelKey]}
              </text>
              {stacks.map((stack) => {
                const value = Number(row[stack.key]) || 0
                const segW = (value / max) * plotW
                const x = xCursor
                xCursor += segW
                if (segW <= 0) return null
                return <rect key={stack.key} x={x} y={y} width={segW} height={barH} rx="4" fill={stack.color} />
              })}
              <text x={padX + Math.min(plotW, (total / max) * plotW) + 8} y={y + 15} className="stacked-chart__value">
                {fmt(total)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function SmoothCurveChart(props) {
  return <SimpleBarChart {...props} />
}

export function BarTrendChart(props) {
  return <SimpleBarChart {...props} />
}

export function LineTrendChart(props) {
  return <SimpleBarChart {...props} />
}

export function DonutChart(props) {
  return <SimpleDonutChart {...props} />
}
