/** 차트 — 단색·플랫 스타일 (그라데이션 없음) */
const BAR_COLOR = '#2563eb'
const GRID = '#e2e8f0'
const AXIS = '#94a3b8'
const LABEL = '#64748b'

const DONUT_COLORS = ['#2563eb', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9']

export function formatPaymentMethodLabel(method) {
  const map = {
    card: '카드',
    transfer: '계좌이체',
    payer: '대리결제',
    cms: 'CMS',
  }
  return map[method] || method || '미입력'
}

function defaultFormatValue(value) {
  return Number(value).toLocaleString('ko-KR')
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
  if (!data?.length) {
    return <div className="chart-empty">표시할 데이터가 없습니다.</div>
  }

  const width = 520
  const height = 200
  const padX = 40
  const padTop = 16
  const padBottom = 32
  const plotW = width - padX * 2
  const plotH = height - padTop - padBottom
  const values = data.map((d) => Number(d[valueKey]) || 0)
  const max = Math.max(...values, 1)
  const fmt = formatValue || defaultFormatValue
  const barGap = 12
  const barWidth = Math.min(48, (plotW - barGap * (data.length - 1)) / data.length)
  const totalBarsWidth = barWidth * data.length + barGap * (data.length - 1)
  const startX = padX + (plotW - totalBarsWidth) / 2

  const gridRatios = [0, 0.5, 1]

  return (
    <div className="bar-chart" role="img" aria-label="막대 추이 차트">
      <svg viewBox={`0 0 ${width} ${height}`} className="bar-chart__svg" preserveAspectRatio="xMidYMid meet">
        {gridRatios.map((ratio) => {
          const y = padTop + plotH * (1 - ratio)
          const val = max * ratio
          return (
            <g key={ratio}>
              <line x1={padX} y1={y} x2={width - padX} y2={y} stroke={GRID} strokeWidth="1" />
              <text x={padX - 6} y={y + 4} textAnchor="end" className="bar-chart__axis">
                {fmt(val)}
                {unit}
              </text>
            </g>
          )
        })}
        {data.map((row, index) => {
          const value = Number(row[valueKey]) || 0
          const barH = (value / max) * plotH
          const x = startX + index * (barWidth + barGap)
          const y = padTop + plotH - barH
          return (
            <g key={row[labelKey] ?? index}>
              <rect x={x} y={y} width={barWidth} height={barH} rx="3" fill={barColor} />
              <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" className="bar-chart__value">
                {fmt(value)}
                {unit}
              </text>
              <text x={x + barWidth / 2} y={height - 10} textAnchor="middle" className="bar-chart__label">
                {row[labelKey]}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** 결제 수단 — SVG 도넛 (conic-gradient 미사용) */
export function SimpleDonutChart({ data, valueKey = 'value', labelKey = 'label', formatLabel }) {
  if (!data?.length) {
    return <div className="chart-empty">표시할 데이터가 없습니다.</div>
  }

  const total = data.reduce((sum, row) => sum + (Number(row[valueKey]) || 0), 0)
  if (total <= 0) {
    return <div className="chart-empty">표시할 데이터가 없습니다.</div>
  }

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
