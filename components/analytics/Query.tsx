import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface QueryProps {
  /** SQL over data/events.db; models/*.sql are available as views. */
  sql: string
  title?: string
}

interface QueryResult {
  rows: Record<string, unknown>[]
  ms: number
}

const MAX_ROWS = 100

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
// Dev-only self-save: write the draft back into this block's sql prop,
// addressed by DOM position (the same positional identity the editor uses)
// ---------------------------------------------------------------------------

function pageSlug(): string {
  return decodeURIComponent(location.pathname.replace(/^\//, ''))
}

async function saveSqlToSource(root: HTMLElement, value: string): Promise<void> {
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
    body: JSON.stringify({
      slug,
      hash,
      op: { type: 'setProp', index, name: 'sql', value },
      defer: true, // suppress HMR while typing; flushed on blur/unmount
    }),
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

/** A runnable SQL block: editor with highlighting, results as a table. */
export function Query({ sql, title }: QueryProps) {
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

  // adopt external changes (agent edits, undo) when not actively editing —
  // the derived-state-during-render pattern
  const [prevSql, setPrevSql] = useState(sql)
  if (sql !== prevSql) {
    setPrevSql(sql)
    if (!focused) setDraft(sql)
  }

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

  const save = useCallback(async (value: string) => {
    if (!import.meta.env.DEV || !rootRef.current) return
    setSaveState('saving')
    try {
      await saveSqlToSource(rootRef.current, value)
      savedSinceFocus.current = true
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
      void save(value)
    }, 1000)
  }

  const onBlur = () => {
    setFocused(false)
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    void (async () => {
      if (draft !== sql) await save(draft)
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
      void save(draft)
      void run(draft)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const { selectionStart: s, selectionEnd: end } = ta
      onChange(draft.slice(0, s) + '  ' + draft.slice(end))
      requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2))
    }
  }

  const lines = draft.split('\n')
  const columns = result?.rows.length ? Object.keys(result.rows[0]) : []
  const shown = result?.rows.slice(0, MAX_ROWS) ?? []

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
            void save(draft)
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

      {/* results */}
      {result && !error && (
        <div className="border-t">
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
          <div className="flex items-center gap-2 border-t px-4 py-1.5 text-[11px] text-muted-foreground">
            Showing {shown.length}
            {result.rows.length > MAX_ROWS && ` of ${result.rows.length.toLocaleString('en-US')}`}{' '}
            rows
            <span className="ml-auto">{result.ms} ms</span>
          </div>
        </div>
      )}
    </figure>
  )
}
