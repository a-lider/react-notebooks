/**
 * The data runtime. Components call useMetric()/useFunnel(); pages never do.
 *
 * Data flows through an adapter (analytics.config.ts) and a result cache,
 * so data never lives in pages. The demo adapter generates deterministic
 * synthetic series; the real adapters (DuckDB over local parquet, PostHog
 * API) implement the same Adapter interface and will be async + file-cached.
 */
import { useMemo } from 'react'
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

export interface MetricResult {
  data: MetricPoint[]
  summary: MetricSummary
  status: 'ready' | 'loading' | 'error'
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

export interface Adapter {
  metricSeries(metric: Metric, opts: Required<MetricOptions>): MetricPoint[]
  funnel(steps: FunnelStep[], breakdown?: string): FunnelStepResult[]
}

// ---------------------------------------------------------------------------
// Result cache. In-memory for the demo adapter; the warehouse adapters will
// persist results under lib/cache/ keyed the same way (gitignored by default;
// commit the cache to freeze a fully reproducible report).
// ---------------------------------------------------------------------------
const cache = new Map<string, unknown>()

function cached<T>(key: string, compute: () => T): T {
  if (!cache.has(key)) cache.set(key, compute())
  return cache.get(key) as T
}

export function useMetric(metric: Metric, opts: MetricOptions = {}): MetricResult {
  const interval = opts.interval ?? 'day'
  const compare = opts.compare ?? 'none'
  const buckets = opts.buckets ?? (interval === 'day' ? 30 : 12)

  return useMemo(() => {
    const key = `${metric.key}:${interval}:${compare}:${buckets}`
    const data = cached(key, () =>
      config.adapter.metricSeries(metric, { interval, compare, buckets })
    )
    const half = Math.floor(data.length / 2)
    const sum = (points: MetricPoint[]) => points.reduce((acc, p) => acc + p.value, 0)
    const current = sum(data.slice(half))
    const previous = sum(data.slice(0, half))
    const change = previous === 0 ? 0 : (current - previous) / previous
    return { data, summary: { current, previous, change }, status: 'ready' as const }
  }, [metric, interval, compare, buckets])
}

export function useFunnel(steps: FunnelStep[], breakdown?: string): FunnelStepResult[] {
  return useMemo(() => {
    const key = `funnel:${steps.map((s) => s.event + (s.url ?? '')).join('>')}:${breakdown ?? ''}`
    return cached(key, () => config.adapter.funnel(steps, breakdown))
  }, [steps, breakdown])
}
