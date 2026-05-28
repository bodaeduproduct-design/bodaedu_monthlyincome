import { useCallback, useEffect, useMemo, useState } from 'react'

const TRIAL_FEE_AMOUNT = 10000

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
  if (response.status === 204) {
    return null
  }
  return response.json()
}

function emptyValues(columns) {
  const values = {}
  for (const col of columns) {
    if (col.editable) {
      values[col.name] = ''
    }
  }
  return values
}

function AdminCell({ column, row }) {
  const value = row[column.name]
  const label = row._labels?.[column.name]
  if (value === null || value === undefined || value === '') {
    return label ? <span className="data-admin__fk-muted">{label}</span> : '-'
  }
  if (column.type === 'fk' && label) {
    return (
      <span className="data-admin__fk-cell">
        <span className="data-admin__fk-id">{value}</span>
        <small className="data-admin__fk-label">{label}</small>
      </span>
    )
  }
  return String(value)
}

function FieldInput({ column, value, onChange }) {
  const common = {
    id: `admin-${column.name}`,
    value: value ?? '',
    onChange: (event) => onChange(column.name, event.target.value),
  }

  if (column.type === 'textarea') {
    return <textarea rows={3} {...common} />
  }

  if (column.type === 'integer' || column.type === 'fk') {
    return <input type="number" step="1" {...common} />
  }

  if (column.type === 'float') {
    return <input type="number" step="any" {...common} />
  }

  if (column.type === 'date') {
    return <input type="date" {...common} value={(value ?? '').toString().slice(0, 10)} />
  }

  if (column.type === 'datetime') {
    return (
      <input
        type="datetime-local"
        value={(value ?? '').toString().slice(0, 16)}
        onChange={(event) => onChange(column.name, event.target.value)}
      />
    )
  }

  return <input type="text" {...common} />
}

const DEFAULT_TABLE = 'users'
const ENROLLMENT_TABLE = 'lesson_enrollments'

export default function DataAdminView({ onDataChanged, initialTable }) {
  const [schemas, setSchemas] = useState([])
  const [selectedTable, setSelectedTable] = useState(initialTable ?? DEFAULT_TABLE)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [limit] = useState(50)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [excludeEndedLessons, setExcludeEndedLessons] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editorMode, setEditorMode] = useState(null)
  const [editorValues, setEditorValues] = useState({})
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  const tableSchema = useMemo(
    () => schemas.find((item) => item.table === selectedTable),
    [schemas, selectedTable],
  )

  const displayColumns = useMemo(() => tableSchema?.columns ?? [], [tableSchema])

  const loadSchemas = useCallback(async () => {
    const data = await apiRequest('/api/admin/schemas')
    setSchemas(data.tables ?? [])
  }, [])

  const loadRows = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
      })
      if (query.trim()) {
        params.set('q', query.trim())
      }
      if (selectedTable === ENROLLMENT_TABLE && excludeEndedLessons) {
        params.set('exclude_ended', 'true')
      }
      const data = await apiRequest(`/api/admin/tables/${selectedTable}/rows?${params}`)
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [selectedTable, offset, limit, query, excludeEndedLessons])

  useEffect(() => {
    loadSchemas().catch((loadError) => setError(loadError.message))
  }, [loadSchemas])

  useEffect(() => {
    if (!schemas.length) {
      return
    }
    const exists = schemas.some((schema) => schema.table === selectedTable)
    if (exists) {
      return
    }
    const fallback = schemas.some((schema) => schema.table === DEFAULT_TABLE)
      ? DEFAULT_TABLE
      : schemas[0].table
    setSelectedTable(fallback)
  }, [schemas, selectedTable])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  useEffect(() => {
    setOffset(0)
  }, [selectedTable, query, excludeEndedLessons])

  const openCreate = () => {
    if (!tableSchema) {
      return
    }
    setEditorMode('create')
    setEditingId(null)
    setEditorValues(emptyValues(tableSchema.columns))
  }

  const openEdit = (row) => {
    if (!tableSchema) {
      return
    }
    const values = {}
    for (const col of tableSchema.columns) {
      values[col.name] = row[col.name] ?? ''
    }
    setEditorMode('edit')
    setEditingId(row.id)
    setEditorValues(values)
  }

  const closeEditor = () => {
    setEditorMode(null)
    setEditingId(null)
    setEditorValues({})
  }

  useEffect(() => {
    if (initialTable) {
      setSelectedTable(initialTable)
      closeEditor()
    }
  }, [initialTable])

  const handleSave = async (event) => {
    event.preventDefault()
    if (!tableSchema) {
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const payload = { values: {} }
      for (const col of tableSchema.columns) {
        if (!col.editable) {
          continue
        }
        payload.values[col.name] = editorValues[col.name]
      }
      if (editorMode === 'create') {
        await apiRequest(`/api/admin/tables/${selectedTable}/rows`, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        setNotice('새 행을 저장했습니다.')
      } else {
        await apiRequest(`/api/admin/tables/${selectedTable}/rows/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
        setNotice('수정 내용을 저장했습니다.')
      }
      closeEditor()
      await loadRows()
      onDataChanged?.()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row) => {
    if (!tableSchema?.allow_delete) {
      return
    }
    const label = row._labels?.name || row.name || row.student_name || row.teacher_name || row.id
    if (!window.confirm(`ID ${row.id} (${label}) 행을 삭제할까요?`)) {
      return
    }
    setError('')
    setNotice('')
    try {
      await apiRequest(`/api/admin/tables/${selectedTable}/rows/${row.id}`, { method: 'DELETE' })
      setNotice('행을 삭제했습니다.')
      await loadRows()
      onDataChanged?.()
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / limit))
  const currentPage = Math.floor(offset / limit) + 1

  return (
    <div className="data-admin">
      <div className="data-admin__sidebar">
        <p className="data-admin__sidebar-title">테이블</p>
        {schemas.map((schema) => (
          <button
            key={schema.table}
            type="button"
            className={schema.table === selectedTable ? 'data-admin__table-btn active' : 'data-admin__table-btn'}
            onClick={() => {
              setSelectedTable(schema.table)
              closeEditor()
            }}
          >
            <strong>{schema.label}</strong>
            <code>{schema.table}</code>
          </button>
        ))}
      </div>

      <div className="data-admin__main">
        {tableSchema ? (
          <header className="data-admin__header">
            <div>
              <h3>{tableSchema.label}</h3>
              <p>
                <code>{tableSchema.table}</code> · {tableSchema.sheet}
              </p>
            </div>
            <div className="data-admin__toolbar">
              {selectedTable === ENROLLMENT_TABLE ? (
                <label className="data-admin__filter-check">
                  <input
                    type="checkbox"
                    checked={excludeEndedLessons}
                    onChange={(event) => setExcludeEndedLessons(event.target.checked)}
                  />
                  <span>종료된 수업 제외</span>
                </label>
              ) : null}
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={tableSchema.search_hint || '검색...'}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setQuery(searchInput)
                  }
                }}
              />
              <button type="button" className="secondary-button" onClick={() => setQuery(searchInput)}>
                검색
              </button>
              <button type="button" className="secondary-button" onClick={() => loadRows()}>
                새로고침
              </button>
              {tableSchema.allow_create ? (
                <button type="button" className="primary-button" onClick={openCreate}>
                  새 행
                </button>
              ) : null}
            </div>
          </header>
        ) : null}

        {notice ? <div className="banner success">{notice}</div> : null}
        {error ? <div className="banner error">{error}</div> : null}

        <div className="data-admin__body">
          <div className="data-admin__grid-panel">
            {loading ? (
              <div className="empty-state">불러오는 중...</div>
            ) : (
              <>
                <p className="data-admin__meta">
                  총 {total.toLocaleString()}행 · {currentPage}/{pageCount}페이지
                </p>
                <div className="data-admin__table-scroll table-wrap">
                  <table className="data-admin__table">
                    <thead>
                      <tr>
                        {displayColumns.map((col) => (
                          <th key={col.name}>{col.label}</th>
                        ))}
                        <th className="data-admin__col-actions">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          {displayColumns.map((col) => (
                            <td key={col.name}>
                              <AdminCell column={col} row={row} />
                            </td>
                          ))}
                          <td className="data-admin__actions">
                            <button type="button" className="link-button" onClick={() => openEdit(row)}>
                              수정
                            </button>
                            {tableSchema?.allow_delete ? (
                              <button type="button" className="link-button danger" onClick={() => handleDelete(row)}>
                                삭제
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="data-admin__pager">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={offset <= 0}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                  >
                    이전
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={offset + limit >= total}
                    onClick={() => setOffset(offset + limit)}
                  >
                    다음
                  </button>
                </div>
              </>
            )}
          </div>

          <aside className="data-admin__editor">
            {editorMode && tableSchema ? (
              <form className="data-admin__form" onSubmit={handleSave}>
                <h4>{editorMode === 'create' ? '새 행 추가' : `행 수정 #${editingId}`}</h4>
                {tableSchema.columns.map((col) => (
                  <label key={col.name} className={col.editable ? '' : 'data-admin__field-readonly'}>
                    <span>
                      {col.label} <code>{col.name}</code>
                      {col.required ? ' *' : ''}
                    </span>
                    {col.help ? <small>{col.help}</small> : null}
                    {col.editable ? (
                      <FieldInput
                        column={col}
                        value={editorValues[col.name]}
                        onChange={(name, val) =>
                          setEditorValues((current) => {
                            // lesson_enrollments: trial_date 입력 시 trial_month/trial_fee 자동 채움
                            if (selectedTable === 'lesson_enrollments' && name === 'trial_date') {
                              const trialMonth = val && val.length >= 7 ? val.slice(0, 7) : ''
                              return {
                                ...current,
                                [name]: val,
                                trial_month: trialMonth,
                                trial_fee: val ? TRIAL_FEE_AMOUNT : '',
                              }
                            }

                            return {
                              ...current,
                              [name]: val,
                            }
                          })
                        }
                      />
                    ) : (
                      <input type="text" value={editorValues[col.name] ?? ''} disabled readOnly />
                    )}
                    {col.type === 'fk' && editorMode === 'edit' && rows.find((r) => r.id === editingId)?._labels?.[col.name] ? (
                      <small className="data-admin__fk-label">{rows.find((r) => r.id === editingId)._labels[col.name]}</small>
                    ) : null}
                  </label>
                ))}
                <div className="editor-actions">
                  <button type="button" className="secondary-button" onClick={closeEditor}>
                    취소
                  </button>
                  <button type="submit" className="primary-button" disabled={saving}>
                    {saving ? '저장 중...' : '저장'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="data-admin__schema-help">
                <h4>컬럼 정의</h4>
                {tableSchema ? (
                  <ul>
                    {tableSchema.columns.map((col) => (
                      <li key={col.name}>
                        <strong>{col.label}</strong> <code>{col.name}</code>
                        <span className="data-admin__col-type">{col.type}</span>
                        {col.help ? <p>{col.help}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="data-admin__hint">행의 「수정」을 누르거나 「새 행」으로 직접 편집하세요. 워크북 재업로드 시 import 테이블은 시트 기준으로 덮어씌워질 수 있습니다.</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
