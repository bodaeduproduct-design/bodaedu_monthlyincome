import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

async function apiRequest(path) {
  const response = await fetch(path)
  if (!response.ok) {
    let detail = '데이터를 불러오지 못했습니다.'
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

function formatCell(value) {
  if (value === null || value === undefined || value === '') {
    return '—'
  }
  const text = String(value)
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

export default function DataOverviewView({ onOpenAdmin }) {
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hideEmpty, setHideEmpty] = useState(false)
  const [filter, setFilter] = useState('')
  const [expandAll, setExpandAll] = useState(true)
  const sectionRefs = useRef({})

  const loadOverview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/admin/overview?max_rows=5000')
      setOverview(data)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadOverview()
  }, [loadOverview])

  const tables = useMemo(() => {
    if (!overview?.tables) {
      return []
    }
    const term = filter.trim().toLowerCase()
    return overview.tables.filter((table) => {
      if (hideEmpty && table.total === 0) {
        return false
      }
      if (!term) {
        return true
      }
      return (
        table.table.toLowerCase().includes(term) ||
        table.label.toLowerCase().includes(term) ||
        (table.sheet ?? '').toLowerCase().includes(term)
      )
    })
  }, [overview, hideEmpty, filter])

  const scrollToTable = (tableName) => {
    sectionRefs.current[tableName]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (loading && !overview) {
    return <div className="empty-state">전체 DB 데이터를 불러오는 중...</div>
  }

  if (error && !overview) {
    return (
      <div className="data-overview">
        <div className="banner error">{error}</div>
        <button type="button" className="secondary-button" onClick={loadOverview}>
          다시 시도
        </button>
      </div>
    )
  }

  return (
    <div className="data-overview">
      <div className="data-overview__toolbar">
        <div className="data-overview__stats">
          <span className="data-overview__stat">
            <strong>{overview?.table_count ?? 0}</strong>개 테이블
          </span>
          <span className="data-overview__stat">
            <strong>{(overview?.row_count ?? 0).toLocaleString()}</strong>행 합계
          </span>
          {overview?.max_rows_per_table ? (
            <span className="data-overview__stat muted">
              테이블당 최대 {overview.max_rows_per_table.toLocaleString()}행까지 표시
            </span>
          ) : null}
        </div>
        <div className="data-overview__actions">
          <input
            type="search"
            placeholder="테이블명·한글명 검색..."
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <label className="data-overview__check">
            <input type="checkbox" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} />
            빈 테이블 숨기기
          </label>
          <label className="data-overview__check">
            <input
              type="checkbox"
              checked={expandAll}
              onChange={(event) => setExpandAll(event.target.checked)}
            />
            모두 펼치기
          </label>
          <button type="button" className="secondary-button" onClick={loadOverview} disabled={loading}>
            {loading ? '새로고침 중...' : '새로고침'}
          </button>
          {onOpenAdmin ? (
            <button type="button" className="secondary-button" onClick={onOpenAdmin}>
              데이터 관리로 편집
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <nav className="data-overview__nav" aria-label="테이블 바로가기">
        {tables.map((table) => (
          <button
            key={table.table}
            type="button"
            className={table.total === 0 ? 'data-overview__chip empty' : 'data-overview__chip'}
            onClick={() => scrollToTable(table.table)}
          >
            <span>{table.label}</span>
            <code>{table.table}</code>
            <em>{table.total.toLocaleString()}</em>
          </button>
        ))}
      </nav>

      <div className="data-overview__sections">
        {tables.length === 0 ? (
          <div className="empty-state">조건에 맞는 테이블이 없습니다.</div>
        ) : (
          tables.map((table) => (
            <section
              key={table.table}
              id={`overview-${table.table}`}
              className="data-overview__section"
              ref={(node) => {
                if (node) {
                  sectionRefs.current[table.table] = node
                }
              }}
            >
              <details open={expandAll}>
                <summary className="data-overview__section-head">
                  <div>
                    <h3>{table.label}</h3>
                    <p>
                      <code>{table.table}</code>
                      {table.sheet ? <span> · {table.sheet}</span> : null}
                    </p>
                  </div>
                  <div className="data-overview__section-meta">
                    <span>
                      {table.total.toLocaleString()}행
                      {table.truncated ? ` (상위 ${table.rows.length.toLocaleString()}행만 표시)` : ''}
                    </span>
                    {onOpenAdmin ? (
                      <button
                        type="button"
                        className="link-button"
                        onClick={(event) => {
                          event.preventDefault()
                          onOpenAdmin(table.table)
                        }}
                      >
                        편집
                      </button>
                    ) : null}
                  </div>
                </summary>
                <div className="data-overview__table-wrap">
                  {table.total === 0 ? (
                    <p className="data-overview__empty">데이터 없음</p>
                  ) : (
                    <table className="data-overview__table">
                      <thead>
                        <tr>
                          {table.columns.map((col) => (
                            <th key={col.name} title={col.help ?? col.name}>
                              <span>{col.label}</span>
                              <code>{col.name}</code>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row, index) => (
                          <tr key={row.id ?? index}>
                            {table.columns.map((col) => (
                              <td key={col.name} title={String(row[col.name] ?? '')}>
                                {formatCell(row[col.name])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </details>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
