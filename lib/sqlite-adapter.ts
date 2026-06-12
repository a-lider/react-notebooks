/**
 * SQLite adapter: translates metric definitions and funnel steps into SQL
 * against the local query engine (vite-plugin-data → data/events.db, with
 * models/*.sql loaded as views).
 */
import type { Interval, Metric } from '@/lib/metrics'
import type { Adapter, FunnelStep, FunnelStepResult, MetricPoint } from '@/lib/data'

async function query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const res = await fetch('/__data/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  })
  const body = (await res.json()) as { rows?: Record<string, unknown>[]; error?: string }
  if (!res.ok || body.error) throw new Error(body.error ?? `query failed: ${res.status}`)
  return body.rows ?? []
}

const BUCKET_EXPR: Record<Interval, string> = {
  day: 'date(timestamp)',
  week: "date(timestamp, 'weekday 0', '-6 days')", // Monday of the week
  month: "date(timestamp, 'start of month')",
}

const INTERVAL_DAYS: Record<Interval, number> = { day: 1, week: 7, month: 30 }

/** Expected bucket keys for a window, so empty periods chart as gaps of 0. */
function bucketKeys(interval: Interval, buckets: number, endIso: string): string[] {
  const end = new Date(endIso + 'T00:00:00Z')
  const keys: string[] = []
  for (let i = buckets - 1; i >= 0; i--) {
    const d = new Date(end)
    if (interval === 'month') d.setUTCMonth(d.getUTCMonth() - i)
    else d.setUTCDate(d.getUTCDate() - i * INTERVAL_DAYS[interval])
    keys.push(d.toISOString().slice(0, 10))
  }
  return keys
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

export const sqliteAdapter: Adapter = {
  async metricSeries(metric: Metric, opts): Promise<MetricPoint[]> {
    const bucket = BUCKET_EXPR[opts.interval]
    // fetch a doubled window so 'previous-period' compares real data
    const windows = opts.compare === 'previous-period' ? 2 : 1
    const sinceDays = opts.buckets * INTERVAL_DAYS[opts.interval] * windows
    const distinct = metric.distinct ?? 'user_id'

    let valueExpr: string
    const where = metric.where ?? '1=1'
    if (metric.agg === 'ratio') {
      valueExpr =
        `ROUND(100.0 * COUNT(DISTINCT CASE WHEN ${metric.num} THEN ${distinct} END)` +
        ` / NULLIF(COUNT(DISTINCT CASE WHEN ${metric.den} THEN ${distinct} END), 0), 1)`
    } else if (metric.agg === 'unique') {
      valueExpr = `COUNT(DISTINCT ${distinct})`
    } else if (metric.agg === 'sum') {
      valueExpr = `SUM(${metric.distinct ?? 'value'})`
    } else {
      valueExpr = 'COUNT(*)'
    }

    const rows = await query(
      `SELECT ${bucket} AS bucket, ${valueExpr} AS value
       FROM ${metric.model}
       WHERE ${where} AND timestamp >= date('now', ?)
       GROUP BY 1 ORDER BY 1`,
      [`-${sinceDays} days`]
    )
    const byBucket = new Map(rows.map((r) => [String(r.bucket), Number(r.value ?? 0)]))

    // align onto the expected bucket grid; SQLite's week/month bucket labels
    // are dates, so the same grid generator works for all intervals
    const today = new Date().toISOString().slice(0, 10)
    const anchorRow = rows.length ? String(rows[rows.length - 1].bucket) : today
    const grid = bucketKeys(opts.interval, opts.buckets * windows, anchorRow)
    const series = grid.map((k) => byBucket.get(k) ?? 0)

    const current = grid.slice(-opts.buckets)
    return current.map((k, i) => {
      const point: MetricPoint = {
        bucket: formatBucket(k, opts.interval),
        value: series[series.length - opts.buckets + i],
      }
      if (opts.compare === 'previous-period') point.previous = series[i]
      return point
    })
  },

  // breakdown is displayed by the component; per-segment computation is a
  // future enhancement of this adapter
  async funnel(steps: FunnelStep[]): Promise<FunnelStepResult[]> {
    // sequential funnel: each step counts users whose step-N event happened
    // at or after their step-(N-1) event
    const condFor = (s: FunnelStep) =>
      `event = '${escapeSqlString(s.event)}'` + (s.url ? ` AND url = '${escapeSqlString(s.url)}'` : '')

    const ctes = steps.map((s, i) =>
      i === 0
        ? `s0 AS (SELECT user_id, MIN(timestamp) AS t FROM events WHERE ${condFor(s)} GROUP BY user_id)`
        : `s${i} AS (SELECT e.user_id, MIN(e.timestamp) AS t FROM events e
             JOIN s${i - 1} p ON p.user_id = e.user_id AND e.timestamp >= p.t
             WHERE ${condFor(s)} GROUP BY e.user_id)`
    )
    const selects = steps.map((_, i) => `(SELECT COUNT(*) FROM s${i}) AS c${i}`)
    const rows = await query(`WITH ${ctes.join(',\n')} SELECT ${selects.join(', ')}`)
    const row = rows[0] ?? {}

    const counts = steps.map((_, i) => Number(row[`c${i}`] ?? 0))
    const first = counts[0] || 1
    return steps.map((s, i) => ({
      label: s.label ?? (s.url ? `${s.event} ${s.url}` : s.event),
      count: counts[i],
      conversion: i === 0 ? 1 : counts[i] / first,
    }))
  },
}

function formatBucket(isoDate: string, interval: Interval): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  const month = d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })
  if (interval === 'month') return `${month} ${d.getUTCFullYear()}`
  return `${month} ${d.getUTCDate()}`
}
