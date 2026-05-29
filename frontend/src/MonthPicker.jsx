import { useEffect, useMemo, useRef, useState } from 'react'

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function parseMonthKey(value) {
  const [y, m] = String(value || '').split('-')
  const year = Number.parseInt(y, 10)
  const month = Number.parseInt(m, 10)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null
  return { year, month }
}

export default function MonthPicker({ label = '조회 월', value, onChange, availableMonths = [] }) {
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const parsed = parseMonthKey(value)
  const [viewYear, setViewYear] = useState(parsed?.year ?? new Date().getFullYear())

  const availableSet = useMemo(() => new Set(availableMonths), [availableMonths])

  const yearBounds = useMemo(() => {
    if (!availableMonths.length) {
      const y = new Date().getFullYear()
      return { minYear: y, maxYear: y }
    }
    const years = availableMonths.map((m) => Number.parseInt(String(m).split('-')[0], 10)).filter(Number.isFinite)
    return { minYear: Math.min(...years), maxYear: Math.max(...years) }
  }, [availableMonths])

  useEffect(() => {
    if (parsed?.year) setViewYear(parsed.year)
  }, [value, open, parsed?.year])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const formatTriggerLabel = () => {
    if (!parsed) return '월 선택'
    return `${parsed.year}년 ${parsed.month}월`
  }

  const handleSelect = (year, month) => {
    const key = monthKey(year, month)
    if (!availableSet.has(key)) return
    onChange(key)
    setOpen(false)
  }

  return (
    <div className={`month-picker toolbar-field${open ? ' month-picker--open' : ''}`} ref={rootRef}>
      <span>{label}</span>
      <button
        type="button"
        className="month-picker__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {formatTriggerLabel()}
      </button>
      {open ? (
        <div className="month-picker__popover" role="dialog" aria-label={`${viewYear}년 월 선택`}>
          <div className="month-picker__header">
            <button
              type="button"
              className="month-picker__nav"
              aria-label="이전 해"
              disabled={viewYear <= yearBounds.minYear}
              onClick={() => setViewYear((y) => y - 1)}
            >
              ‹
            </button>
            <strong>{viewYear}년</strong>
            <button
              type="button"
              className="month-picker__nav"
              aria-label="다음 해"
              disabled={viewYear >= yearBounds.maxYear}
              onClick={() => setViewYear((y) => y + 1)}
            >
              ›
            </button>
          </div>
          <div className="month-picker__grid">
            {Array.from({ length: 12 }, (_, index) => {
              const month = index + 1
              const key = monthKey(viewYear, month)
              const enabled = availableSet.has(key)
              const selected = value === key
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    'month-picker__month',
                    selected ? 'month-picker__month--selected' : '',
                    enabled ? '' : 'month-picker__month--disabled',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={!enabled}
                  onClick={() => handleSelect(viewYear, month)}
                >
                  {month}월
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
