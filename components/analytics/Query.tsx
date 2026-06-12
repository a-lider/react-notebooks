import { useCallback, useEffect, useRef, useState } from 'react'
import { ChartColumn, ChartLine, ChartPie, Loader2, Play, TableProperties } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type QueryChart = 'table' | 'bar' | 'line' | 'pie'

interface QueryProps {
  /** SQL over data/events.db; models/*.sql are available as views. */
  sql: string
  title?: string
  /** Default output: 'table' (default) or a chart type. */
  chart?: QueryChart
  /** Column for the x axis / pie slices. */
  x?: string
  /** Column for the y axis / pie values. */
  y?: string
}

interface QueryResult {
  rows: Record<string, unknown>[]
  ms: number
}

const MAX_ROWS = 100
const MAX_CHART_POINTS = 200

// results survive HMR remounts and repeat visits within the session
const resultCache = new Map<string, QueryResult>()

async function executeQuery(sql: string): Promise<QueryResult> {
  const started = performance.now()
  const res = await fetch('/__data/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  })
  const body = (await res.json()) as { rows?: Record<string, unknown>[]; error?: string }
  if (!res.ok || body.error) throw new Error(body.error ?? `query failed: ${res.status}`)
  return { rows: body.rows ?? [], ms: Math.round(performance.now() - started) }
}

// ---------------------------------------------------------------------------
// Syntax highlighting — tiny and from scratch, like the rest of the editor
// ---------------------------------------------------------------------------

const SQL_TOKEN = new RegExp(
  [
    '(--[^\\n]*)', // 1 comment
    "('(?:[^']|'')*')", // 2 string
    '(\\b\\d+(?:\\.\\d+)?\\b)', // 3 number
    '\\b(select|from|where|and|or|not|in|as|on|join|left|right|inner|outer|cross|group|by|order|limit|offset|having|with|case|when|then|else|end|distinct|count|sum|avg|min|max|null|like|between|cast|union|all|desc|asc|exists|round|coalesce|nullif|date|strftime|julianday|integer|text|real)\\b', // 4 keyword
  ].join('|'),
  'gi'
)

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightSql(src: string): string {
  let out = ''
  let last = 0
  for (const m of src.matchAll(SQL_TOKEN)) {
    out += escapeHtml(src.slice(last, m.index))
    const text = escapeHtml(m[0])
    if (m[1]) out += `<span class="text-emerald-700 dark:text-emerald-500 italic">${text}</span>`
    else if (m[2]) out += `<span class="text-emerald-700 dark:text-emerald-400">${text}</span>`
    else if (m[3]) out += `<span class="text-orange-700 dark:text-orange-400">${text}</span>`
    else out += `<span class="text-sky-700 dark:text-sky-400 font-medium">${text}</span>`
    last = m.index + m[0].length
  }
  return out + escapeHtml(src.slice(last))
}

// ---------------------------------------------------------------------------
// Dev-only self-save: write a prop back into this block's source, addressed
// by DOM position (the same positional identity the editor uses)
// ---------------------------------------------------------------------------

function pageSlug(): string {
  return decodeURIComponent(location.pathname.replace(/^\//, ''))
}

async function savePropToSource(
  root: HTMLElement,
  name: string,
  value: string,
  defer: boolean
): Promise<void> {
  const article = root.closest('article')
  if (!article) throw new Error('not inside a page')
  let node: HTMLElement = root
  while (node.parentElement && node.parentElement !== article) node = node.parentElement
  const index = Array.prototype.indexOf.call(article.children, node)
  if (index < 0) throw new Error('block not found')

  const slug = pageSlug()
  const pageRes = await fetch(`/__editor/page?slug=${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  })
  if (!pageRes.ok) throw new Error('editor server unavailable')
  const { hash } = (await pageRes.json()) as { hash: string }
  const res = await fetch('/__editor/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, hash, op: { type: 'setProp', index, name, value }, defer }),
  })
  if (!res.ok) throw new Error(`save failed: ${res.status}`)
}

function flushSource(): void {
  void fetch('/__editor/flush', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: pageSlug() }),
  })
}

// ---------------------------------------------------------------------------
// Charts — Metabase-style: pick the type and which columns drive the axes
// ---------------------------------------------------------------------------

const PIE_COLORS = [1, 2, 3, 4, 5].map((i) => `var(--chart-${i})`)

function numericColumns(rows: Record<string, unknown>[]): string[] {
  if (!rows.length) return []
  return Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'number')
}

/** Sensible defaults: first text-ish column on x, first numeric on y. */
function inferAxes(rows: Record<string, unknown>[]): { x: string; y: string } {
  const cols = rows.length ? Object.keys(rows[0]) : []
  const numeric = numericColumns(rows)
  const x = cols.find((c) => !numeric.includes(c)) ?? cols[0] ?? ''
  const y = numeric[0] ?? cols[1] ?? cols[0] ?? ''
  return { x, y }
}

function ResultChart({
  rows,
  type,
  x,
  y,
}: {
  rows: Record<string, unknown>[]
  type: Exclude<QueryChart, 'table'>
  x: string
  y: string
}) {
  const data = rows.slice(0, MAX_CHART_POINTS)
  if (!data.length || !x || !y) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
        Nothing to chart — pick the x and y columns above.
      </div>
    )
  }
  const config: ChartConfig = { [y]: { label: y, color: 'var(--chart-2)' } }

  if (type === 'pie') {
    return (
      <ChartContainer config={config} className="mx-auto aspect-[1.8/1] max-h-64 w-full p-3">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey={x} hideLabel />} />
          <Pie
            data={data.slice(0, 12)}
            dataKey={y}
            nameKey={x}
            label={(entry) => String((entry as { payload?: Record<string, unknown> }).payload?.[x] ?? '')}
            outerRadius="78%"
          >
            {data.slice(0, 12).map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
    )
  }

  if (type === 'line') {
    return (
      <ChartContainer config={config} className="aspect-[2.4/1] w-full p-3">
        <LineChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey={x} tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis width={48} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line dataKey={y} type="monotone" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    )
  }

  return (
    <ChartContainer config={config} className="aspect-[2.4/1] w-full p-3">
      <BarChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={x} tickLine={false} axisLine={false} interval={0} />
        <YAxis width={48} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey={y} fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={64} />
      </BarChart>
    </ChartContainer>
  )
}

// ---------------------------------------------------------------------------

/** A runnable SQL block: editor, results table, and chart visualization. */
export function Query({ sql, title, chart = 'table', x, y }: QueryProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  const preRef = useRef<HTMLPreElement | null>(null)
  const [draft, setDraft] = useState(sql)
  const [focused, setFocused] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'editing' | 'saving'>('saved')
  const [result, setResult] = useState<QueryResult | null>(resultCache.get(sql) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const saveTimer = useRef<number | null>(null)
  const savedSinceFocus = useRef(false)

  // visualization config — local state adopting prop changes (derived state)
  const [cfg, setCfg] = useState({ chart, x, y })
  const [prevProps, setPrevProps] = useState({ sql, chart, x, y })
  if (sql !== prevProps.sql || chart !== prevProps.chart || x !== prevProps.x || y !== prevProps.y) {
    setPrevProps({ sql, chart, x, y })
    setCfg({ chart, x, y })
    if (sql !== prevProps.sql && !focused) setDraft(sql)
  }
  const [tab, setTab] = useState<'table' | 'chart'>(chart !== 'table' ? 'chart' : 'table')

  const run = useCallback(async (q: string) => {
    setRunning(true)
    setError(null)
    try {
      const r = await executeQuery(q)
      resultCache.set(q, r)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }, [])

  // run once on mount so the page shows data, like any other block
  useEffect(() => {
    if (!sql.trim() || resultCache.has(sql)) return
    const t = window.setTimeout(() => void run(sql), 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveProp = useCallback(async (name: string, value: string, defer: boolean) => {
    if (!import.meta.env.DEV || !rootRef.current) return
    setSaveState('saving')
    try {
      await savePropToSource(rootRef.current, name, value, defer)
      if (defer) savedSinceFocus.current = true
    } catch (e) {
      console.warn('[Query] save failed:', e)
    }
    setSaveState('saved')
  }, [])

  const onChange = (value: string) => {
    setDraft(value)
    setSaveState('editing')
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void saveProp('sql', value, true)
    }, 1000)
  }

  const onBlur = () => {
    setFocused(false)
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    void (async () => {
      if (draft !== sql) await saveProp('sql', draft, true)
      if (savedSinceFocus.current) {
        savedSinceFocus.current = false
        flushSource()
      }
    })()
  }

  // release any suppressed HMR if we unmount mid-edit (page switch)
  useEffect(() => {
    return () => {
      if (savedSinceFocus.current) flushSource()
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      void saveProp('sql', draft, true)
      void run(draft)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const { selectionStart: s, selectionEnd: end } = ta
      onChange(draft.slice(0, s) + '  ' + draft.slice(end))
      requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2))
    }
  }

  const setChartType = (type: QueryChart) => {
    setCfg((c) => ({ ...c, chart: type }))
    void saveProp('chart', type, false)
  }
  const setAxis = (axis: 'x' | 'y', column: string) => {
    setCfg((c) => ({ ...c, [axis]: column }))
    void saveProp(axis, column, false)
  }

  const lines = draft.split('\n')
  const rows = result?.rows ?? []
  const columns = rows.length ? Object.keys(rows[0]) : []
  const shown = rows.slice(0, MAX_ROWS)
  const inferred = inferAxes(rows)
  const effX = cfg.x ?? inferred.x
  const effY = cfg.y ?? inferred.y
  const chartType: Exclude<QueryChart, 'table'> =
    cfg.chart && cfg.chart !== 'table' ? cfg.chart : 'bar'

  return (
    <figure ref={rootRef} className="overflow-hidden rounded-xl border bg-card">
      {/* header */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <figcaption className="text-sm font-medium text-muted-foreground">
          {title ?? 'SQL'}
        </figcaption>
        {import.meta.env.DEV && saveState !== 'saved' && (
          <span className="text-[11px] text-muted-foreground/70">
            {saveState === 'editing' ? 'Editing…' : 'Saving…'}
          </span>
        )}
        <button
          onClick={() => {
            void saveProp('sql', draft, true)
            void run(draft)
          }}
          disabled={running}
          className="ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          {running ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
          Run
          <kbd className="text-[10px] text-muted-foreground">⌘↵</kbd>
        </button>
      </div>

      {/* editor: highlighted <pre> with a transparent textarea stacked on top */}
      <div data-nb-interactive className="relative bg-muted/20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-10 select-none py-3 pr-2 text-right font-mono text-[13px] leading-6 text-muted-foreground/50"
        >
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <div className="grid">
          <pre
            ref={preRef}
            aria-hidden
            className="col-start-1 row-start-1 m-0 overflow-x-hidden whitespace-pre py-3 pl-12 pr-4 font-mono text-[13px] leading-6"
            dangerouslySetInnerHTML={{
              __html: highlightSql(draft.endsWith('\n') ? draft + ' ' : draft) || ' ',
            }}
          />
          <textarea
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            onScroll={(e) => {
              if (preRef.current) preRef.current.scrollLeft = e.currentTarget.scrollLeft
            }}
            spellCheck={false}
            wrap="off"
            readOnly={!import.meta.env.DEV}
            className="col-start-1 row-start-1 resize-none overflow-x-auto whitespace-pre bg-transparent py-3 pl-12 pr-4 font-mono text-[13px] leading-6 text-transparent outline-none"
            style={{ caretColor: 'var(--foreground)' }}
          />
        </div>
      </div>

      {/* error */}
      {error && (
        <div className="border-t bg-destructive/5 px-4 py-2 font-mono text-xs text-destructive">
          {error}
        </div>
      )}

      {/* output */}
      {result && !error && (
        <div data-nb-interactive className="border-t">
          {/* tabs + chart config */}
          <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
            <OutputTab
              active={tab === 'table'}
              icon={<TableProperties className="size-3.5" />}
              label="Results"
              onClick={() => setTab('table')}
            />
            <OutputTab
              active={tab === 'chart'}
              icon={<ChartColumn className="size-3.5" />}
              label="Chart"
              onClick={() => setTab('chart')}
            />
            {tab === 'chart' && (
              <div className="ml-auto flex flex-wrap items-center gap-2 pr-2 text-xs">
                <div className="flex overflow-hidden rounded-md border">
                  {(
                    [
                      ['bar', ChartColumn],
                      ['line', ChartLine],
                      ['pie', ChartPie],
                    ] as const
                  ).map(([type, Icon]) => (
                    <button
                      key={type}
                      title={type}
                      onClick={() => setChartType(type)}
                      className={[
                        'flex items-center gap-1 px-2 py-1 transition-colors',
                        chartType === type
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50',
                      ].join(' ')}
                    >
                      <Icon className="size-3.5" />
                    </button>
                  ))}
                </div>
                <AxisSelect
                  label={chartType === 'pie' ? 'slices' : 'x'}
                  value={effX}
                  columns={columns}
                  onChange={(c) => setAxis('x', c)}
                />
                <AxisSelect
                  label={chartType === 'pie' ? 'value' : 'y'}
                  value={effY}
                  columns={columns}
                  onChange={(c) => setAxis('y', c)}
                />
              </div>
            )}
          </div>

          {tab === 'chart' ? (
            <ResultChart rows={rows} type={chartType} x={effX} y={effY} />
          ) : (
            <div className="max-h-80 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((c) => (
                      <TableHead key={c} className="whitespace-nowrap font-mono text-xs">
                        {c}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((row, i) => (
                    <TableRow key={i}>
                      {columns.map((c) => (
                        <TableCell
                          key={c}
                          className={
                            typeof row[c] === 'number'
                              ? 'text-right font-mono text-xs tabular-nums'
                              : 'font-mono text-xs'
                          }
                        >
                          {row[c] === null ? '∅' : String(row[c])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-center gap-2 border-t px-4 py-1.5 text-[11px] text-muted-foreground">
            {tab === 'chart'
              ? `${Math.min(rows.length, MAX_CHART_POINTS)} of ${rows.length.toLocaleString('en-US')} rows charted`
              : `Showing ${shown.length}${rows.length > MAX_ROWS ? ` of ${rows.length.toLocaleString('en-US')}` : ''} rows`}
            <span className="ml-auto">{result.ms} ms</span>
          </div>
        </div>
      )}
    </figure>
  )
}

function OutputTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}

function AxisSelect({
  label,
  value,
  columns,
  onChange,
}: {
  label: string
  value: string
  columns: string[]
  onChange: (column: string) => void
}) {
  return (
    <label className="flex items-center gap-1 text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground"
      >
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  )
}
