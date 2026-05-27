import { useMemo, useState } from 'react'

const VIEW_TABS = [
  { id: 'diagram', label: 'ER 다이어그램' },
  { id: 'pages', label: '화면별 DB 매핑' },
  { id: 'tables', label: '테이블 사전' },
  { id: 'mermaid', label: 'Mermaid (복사용)' },
]

const LAYER_COLORS = {
  core: { fill: '#eff6ff', stroke: '#2563eb', text: '#1e3a8a' },
  catalog: { fill: '#f5f3ff', stroke: '#7c3aed', text: '#4c1d95' },
  import: { fill: '#fff7ed', stroke: '#ea580c', text: '#9a3412' },
  meta: { fill: '#f8fafc', stroke: '#64748b', text: '#334155' },
}

const EDGE_STYLES = {
  fk: { stroke: '#16a34a', dash: null, width: 2 },
  name: { stroke: '#ea580c', dash: '6 4', width: 1.5 },
  catalog: { stroke: '#7c3aed', dash: '4 3', width: 1.5 },
}

const LINK_TYPE_LABELS = {
  fk: 'FK',
  name: '이름',
  catalog: '상품명',
  none: '-',
  meta: '시스템',
}

function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR').format(value ?? 0)
}

function nodeCenter(node) {
  return {
    x: node.x + node.w / 2,
    y: node.y + node.h / 2,
  }
}

function buildEdgePath(fromNode, toNode) {
  const from = nodeCenter(fromNode)
  const to = nodeCenter(toNode)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const cx1 = from.x + dx * 0.45
  const cy1 = from.y
  const cx2 = to.x - dx * 0.45
  const cy2 = to.y
  return `M ${from.x} ${from.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${to.x} ${to.y}`
}

export default function DbSchemaView({ model }) {
  const [activeView, setActiveView] = useState('diagram')
  const [selectedTable, setSelectedTable] = useState(null)
  const [selectedPageId, setSelectedPageId] = useState(null)
  const [tableQuery, setTableQuery] = useState('')
  const [layerFilter, setLayerFilter] = useState('all')
  const [copied, setCopied] = useState(false)

  const tablesByName = model.tables_by_name ?? {}
  const selectedMeta = selectedTable ? tablesByName[selectedTable] : null

  const highlightedTables = useMemo(() => {
    const set = new Set()
    if (selectedTable) {
      set.add(selectedTable)
      for (const rel of model.relationships ?? []) {
        if (rel.from === selectedTable) {
          set.add(rel.to)
        }
        if (rel.to === selectedTable) {
          set.add(rel.from)
        }
      }
    }
    if (selectedPageId) {
      const page = (model.app_pages ?? []).find((row) => row.id === selectedPageId)
      if (page) {
        for (const table of page.tables_read ?? []) {
          if (table !== '*') {
            set.add(table)
          }
        }
      }
    }
    return set
  }, [selectedTable, selectedPageId, model.relationships, model.app_pages])

  const filteredTables = useMemo(() => {
    return (model.tables ?? []).filter((table) => {
      if (layerFilter !== 'all' && table.layer !== layerFilter) {
        return false
      }
      if (!tableQuery.trim()) {
        return true
      }
      const q = tableQuery.trim().toLowerCase()
      return (
        table.table.toLowerCase().includes(q) ||
        table.label.toLowerCase().includes(q) ||
        (table.role ?? '').toLowerCase().includes(q)
      )
    })
  }, [model.tables, layerFilter, tableQuery])

  const handleCopyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(model.mermaid_er ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const diagramNodes = model.diagram_nodes ?? []
  const nodeMap = Object.fromEntries(diagramNodes.map((node) => [node.table, node]))
  const diagramSize = model.diagram_size ?? { width: 1120, height: 780 }

  return (
    <div className="db-schema-view">
      <div className="db-schema-view__tabs">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeView === tab.id ? 'db-schema-tab active' : 'db-schema-tab'}
            onClick={() => setActiveView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="db-schema-legend">
        <span className="db-schema-legend__item">
          <i className="db-schema-legend__line db-schema-legend__line--fk" /> FK (실선)
        </span>
        <span className="db-schema-legend__item">
          <i className="db-schema-legend__line db-schema-legend__line--name" /> 이름 조인 (점선)
        </span>
        <span className="db-schema-legend__item">
          <i className="db-schema-legend__line db-schema-legend__line--catalog" /> 상품명 (점선)
        </span>
        <span className="db-schema-legend__hint">노드 클릭 → 연결 테이블·컬럼 상세</span>
      </div>

      {activeView === 'diagram' ? (
        <div className="db-schema-diagram-layout">
          <div className="db-schema-diagram-wrap">
            <svg
              className="db-schema-diagram"
              viewBox={`0 0 ${diagramSize.width} ${diagramSize.height}`}
              role="img"
              aria-label="데이터베이스 ER 다이어그램"
            >
              <defs>
                <marker id="arrow-fk" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="#16a34a" />
                </marker>
                <marker id="arrow-name" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="#ea580c" />
                </marker>
                <marker id="arrow-catalog" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="#7c3aed" />
                </marker>
              </defs>

              {(model.relationships ?? []).map((rel) => {
                const fromNode = nodeMap[rel.from]
                const toNode = nodeMap[rel.to]
                if (!fromNode || !toNode) {
                  return null
                }
                const style = EDGE_STYLES[rel.type] ?? EDGE_STYLES.name
                const dimmed =
                  highlightedTables.size > 0 &&
                  !(highlightedTables.has(rel.from) && highlightedTables.has(rel.to))
                return (
                  <path
                    key={`${rel.from}-${rel.to}-${rel.label}`}
                    d={buildEdgePath(fromNode, toNode)}
                    fill="none"
                    stroke={style.stroke}
                    strokeWidth={style.width}
                    strokeDasharray={style.dash ?? undefined}
                    opacity={dimmed ? 0.12 : 0.85}
                    markerEnd={`url(#arrow-${rel.type === 'fk' ? 'fk' : rel.type === 'catalog' ? 'catalog' : 'name'})`}
                  />
                )
              })}

              {diagramNodes.map((node) => {
                const colors = LAYER_COLORS[node.layer] ?? LAYER_COLORS.meta
                const isSelected = selectedTable === node.table
                const isHighlighted = highlightedTables.has(node.table)
                const dimmed = highlightedTables.size > 0 && !isHighlighted
                return (
                  <g
                    key={node.table}
                    className="db-schema-node"
                    transform={`translate(${node.x}, ${node.y})`}
                    onClick={() => setSelectedTable(node.table)}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      width={node.w}
                      height={node.h}
                      rx="8"
                      fill={colors.fill}
                      stroke={isSelected ? '#0f172a' : colors.stroke}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                      opacity={dimmed ? 0.35 : 1}
                    />
                    <text x="10" y="20" fill={colors.text} fontSize="12" fontWeight="700">
                      {node.label}
                    </text>
                    <text x="10" y="36" fill="#64748b" fontSize="10" fontFamily="ui-monospace, monospace">
                      {node.table}
                    </text>
                    <text x={node.w - 10} y="20" fill="#64748b" fontSize="10" textAnchor="end">
                      {formatNumber(node.row_count)}행
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          <aside className="db-schema-detail">
            {selectedMeta ? (
              <>
                <p className="db-schema-detail__eyebrow">{selectedMeta.layer_label}</p>
                <h3>{selectedMeta.label}</h3>
                <code className="db-schema-detail__code">{selectedMeta.table}</code>
                <p>{selectedMeta.role}</p>
                <dl className="db-schema-detail__dl">
                  <div>
                    <dt>연결 방식</dt>
                    <dd>{LINK_TYPE_LABELS[selectedMeta.link_type]}</dd>
                  </div>
                  <div>
                    <dt>행 수</dt>
                    <dd>{formatNumber(selectedMeta.row_count)}</dd>
                  </div>
                  <div>
                    <dt>사용 화면</dt>
                    <dd>{(selectedMeta.used_by_pages ?? []).join(', ') || '-'}</dd>
                  </div>
                </dl>
                {selectedMeta.foreign_keys?.length ? (
                  <p>
                    <strong>FK</strong>
                    <br />
                    {selectedMeta.foreign_keys.join(', ')}
                  </p>
                ) : null}
                {selectedMeta.columns?.length ? (
                  <div className="db-schema-detail__columns">
                    <strong>컬럼 ({selectedMeta.columns.length})</strong>
                    <ul>
                      {selectedMeta.columns.map((col) => (
                        <li key={col}>
                          <code>{col}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p className="db-schema-detail__cmd">
                  명령 예: 「{selectedMeta.label}({selectedMeta.table}) 기준으로 학생 수납 탭을
                  수정해줘」
                </p>
              </>
            ) : (
              <p className="db-schema-detail__empty">다이어그램에서 테이블을 클릭하면 컬럼·화면 매핑이 표시됩니다.</p>
            )}
          </aside>
        </div>
      ) : null}

      {activeView === 'pages' ? (
        <div className="db-schema-pages">
          {(model.app_pages ?? []).map((page) => (
            <article
              key={page.id}
              className={selectedPageId === page.id ? 'db-schema-page-card active' : 'db-schema-page-card'}
              onClick={() => {
                setSelectedPageId(page.id)
                setSelectedTable(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setSelectedPageId(page.id)
                  setSelectedTable(null)
                }
              }}
              role="button"
              tabIndex={0}
            >
              <header>
                <h3>{page.label}</h3>
                <code>{page.nav_id}</code>
              </header>
              <p>{page.focus}</p>
              <div className="db-schema-page-card__section">
                <strong>읽기 테이블</strong>
                <div className="chip-row">
                  {(page.tables_read ?? []).map((table) =>
                    table === '*' ? (
                      <span key="all" className="chip">
                        전체 스키마
                      </span>
                    ) : (
                      <button
                        key={table}
                        type="button"
                        className="chip chip--button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedTable(table)
                          setActiveView('diagram')
                        }}
                      >
                        {tablesByName[table]?.label ?? table}
                      </button>
                    ),
                  )}
                </div>
              </div>
              {(page.tables_write ?? []).length ? (
                <div className="db-schema-page-card__section">
                  <strong>쓰기 테이블</strong>
                  <div className="chip-row">
                    {page.tables_write.map((table) => (
                      <span key={table} className="chip chip--write">
                        {tablesByName[table]?.label ?? table}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {(page.api_keys ?? []).length ? (
                <p className="db-schema-page-card__api">
                  <strong>app-data 키:</strong> {page.api_keys.join(', ')}
                </p>
              ) : null}
              {(page.api_write ?? []).length ? (
                <p className="db-schema-page-card__api">
                  <strong>API:</strong> {page.api_write.join(' · ')}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {activeView === 'tables' ? (
        <div className="db-schema-tables-view">
          <div className="db-schema-tables-toolbar">
            <input
              value={tableQuery}
              onChange={(event) => setTableQuery(event.target.value)}
              placeholder="테이블명·한글명 검색"
            />
            <select value={layerFilter} onChange={(event) => setLayerFilter(event.target.value)}>
              <option value="all">전체 레이어</option>
              <option value="core">운영 코어</option>
              <option value="catalog">상품·단가</option>
              <option value="import">엑셀 import</option>
              <option value="meta">시스템</option>
            </select>
          </div>
          <div className="db-schema-table-grid">
            {filteredTables.map((table) => (
              <button
                key={table.table}
                type="button"
                className={selectedTable === table.table ? 'db-schema-table-tile active' : 'db-schema-table-tile'}
                onClick={() => {
                  setSelectedTable(table.table)
                  setActiveView('diagram')
                }}
              >
                <span className={`db-schema-table-tile__layer db-schema-table-tile__layer--${table.layer}`}>
                  {table.layer_label}
                </span>
                <strong>{table.label}</strong>
                <code>{table.table}</code>
                <span>{formatNumber(table.row_count)}행 · {LINK_TYPE_LABELS[table.link_type]}</span>
                <small>{(table.used_by_pages ?? []).join(' · ') || '전용 화면 없음'}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {activeView === 'mermaid' ? (
        <div className="db-schema-mermaid">
          <div className="db-schema-mermaid__actions">
            <button type="button" className="secondary-button" onClick={handleCopyMermaid}>
              {copied ? '복사됨' : 'Mermaid 코드 복사'}
            </button>
            <span>Notion·GitHub·Mermaid Live Editor에 붙여넣을 수 있습니다.</span>
          </div>
          <pre>{model.mermaid_er}</pre>
        </div>
      ) : null}

      {(model.user_types ?? []).length ? (
        <div className="db-schema-user-strip">
          {(model.user_types ?? []).map((userType) => (
            <div key={userType.id} className={`db-schema-user-strip__item db-schema-user-strip__item--${userType.id}`}>
              <strong>{userType.label}</strong>
              <span>{userType.money_flow_label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
