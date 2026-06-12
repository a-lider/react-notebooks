/**
 * The data runtime. Components call useMetric()/useFunnel(); pages never do.
 *
 * Adapters are async (they query the local engine or, later, a warehouse);
 * results flow through an in-memory result cache keyed by metric + options,
 * so data never lives in pages and repeat renders are instant.
 */
import { useEffect, useReducer } from 'react'
import type { Interval, Metric } from '@/lib/metrics'
import { config } from '@/analytics.config'

export interface MetricPoint {
  bucket: string
  value: number
  previous?: number
}

export interface MetricSummary {
  current: number
  previous: number
  /** Relative change vs the previous period, e.g. -0.14 for a 14% drop. */
  change: number
}

export type QueryStatus = 'loading' | 'ready' | 'error'

export interface MetricResult {
  data: MetricPoint[]
  summary: MetricSummary
  status: QueryStatus
  error?: string
}

export interface MetricOptions {
  interval?: Interval
  compare?: 'previous-period' | 'none'
  buckets?: number
}

export interface FunnelStep {
  event: string
  url?: string
  label?: string
}

export interface FunnelStepResult {
  label: string
  count: number
  /** Conversion from the first step, 0..1 */
  conversion: number
}

export interface FunnelResult {
  steps: FunnelStepResult[]
  status: QueryStatus
  error?: string
}

export interface Adapter {
  metricSeries(metric: Metric, opts: Required<MetricOptions>): Promise<MetricPoint[]>
  funnel(steps: FunnelStep[], breakdown?: string): Promise<FunnelStepResult[]>
}

// ---------------------------------------------------------------------------
// Result cache. In-memory; the warehouse adapters may add a file cache under
// lib/cache/ later (gitignored by default; commit it to freeze a report).
// ---------------------------------------------------------------------------
type CacheEntry<T> = { ok: T } | { err: string }
const cache = new Map<string, CacheEntry<unknown>>()

function useCachedAsync<T>(key: string, compute: () => Promise<T>): {
  data: T | null
  status: QueryStatus
  error?: string
} {
  const [, force] = useReducer((x: number) => x + 1, 0)

  useEffect(() => {
    if (cache.has(key)) return
    let alive = true
    compute()
      .then((value) => {
        cache.set(key, { ok: value })
        if (alive) force()
      })
      .catch((e: unknown) => {
        cache.set(key, { err: e instanceof Error ? e.message : String(e) })
        if (alive) force()
      })
    return () => {
      alive = false
    }
    // compute is derived from key; key is the identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (!entry) return { data: null, status: 'loading' }
  if ('err' in entry) return { data: null, status: 'error', error: entry.err }
  return { data: entry.ok, status: 'ready' }
}

const EMPTY_SUMMARY: MetricSummary = { current: 0, previous: 0, change: 0 }

export function useMetric(metric: Metric, opts: MetricOptions = {}): MetricResult {
  const interval = opts.interval ?? 'day'
  const compare = opts.compare ?? 'none'
  const buckets = opts.buckets ?? (interval === 'day' ? 30 : 12)
  const key = `metric:${metric.key}:${interval}:${compare}:${buckets}`

  const { data, status, error } = useCachedAsync(key, () =>
    config.adapter.metricSeries(metric, { interval, compare, buckets })
  )

  if (!data) return { data: [], summary: EMPTY_SUMMARY, status, error }
  const half = Math.floor(data.length / 2)
  const sum = (points: MetricPoint[]) => points.reduce((acc, p) => acc + p.value, 0)
  const current = sum(data.slice(half))
  const previous = sum(data.slice(0, half))
  const change = previous === 0 ? 0 : (current - previous) / previous
  return { data, summary: { current, previous, change }, status, error }
}

export function useFunnel(steps: FunnelStep[], breakdown?: string): FunnelResult {
  const key = `funnel:${steps.map((s) => s.event + (s.url ?? '')).join('>')}:${breakdown ?? ''}`
  const { data, status, error } = useCachedAsync(key, () => config.adapter.funnel(steps, breakdown))
  return { steps: data ?? [], status, error }
}
