/**
 * Demo adapter: deterministic synthetic data, seeded by metric key.
 * Lets the app render meaningfully with zero setup. Swap for the DuckDB or
 * PostHog adapter in analytics.config.ts when real data is wired up.
 */
import type { Interval, Metric } from '@/lib/metrics'
import type { Adapter, FunnelStep, FunnelStepResult, MetricPoint } from '@/lib/data'

// mulberry32 — tiny seedable PRNG, deterministic across runs
function prng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashKey(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const DAY = 86_400_000
const intervalMs: Record<Interval, number> = { day: DAY, week: 7 * DAY, month: 30 * DAY }

function bucketLabel(ts: number, interval: Interval): string {
  const d = new Date(ts)
  const month = d.toLocaleString('en', { month: 'short' })
  if (interval === 'month') return `${month} ${d.getFullYear()}`
  return `${month} ${d.getDate()}`
}

export const demoAdapter: Adapter = {
  async metricSeries(metric: Metric, opts): Promise<MetricPoint[]> {
    const rand = prng(hashKey(metric.key))
    const isPercent = metric.unit === 'percent'
    const base = isPercent ? 8 + rand() * 30 : 800 + rand() * 4000
    const growth = 0.002 + rand() * 0.01
    const volatility = isPercent ? 0.06 : 0.12
    const start = Date.UTC(2026, 5, 12) - opts.buckets * intervalMs[opts.interval]

    const value = (i: number) => {
      const trend = base * (1 + growth) ** i
      const season = 1 + 0.08 * Math.sin((i / 7) * Math.PI * 2)
      const noise = 1 + (rand() - 0.5) * 2 * volatility
      const n = trend * season * noise
      return isPercent ? Math.round(n * 10) / 10 : Math.round(n)
    }

    return Array.from({ length: opts.buckets }, (_, i) => {
      const point: MetricPoint = {
        bucket: bucketLabel(start + i * intervalMs[opts.interval], opts.interval),
        value: value(i),
      }
      if (opts.compare === 'previous-period') {
        point.previous = value(Math.max(0, i - Math.floor(opts.buckets / 4)))
      }
      return point
    })
  },

  async funnel(steps: FunnelStep[], breakdown?: string): Promise<FunnelStepResult[]> {
    const rand = prng(hashKey(steps.map((s) => s.event).join('>') + (breakdown ?? '')))
    let count = Math.round(3000 + rand() * 3000)
    return steps.map((step, i) => {
      if (i > 0) count = Math.round(count * (0.35 + rand() * 0.4))
      return {
        label: step.label ?? (step.url ? `${step.event} ${step.url}` : step.event),
        count,
        conversion: i === 0 ? 1 : 0, // filled below
      }
    }).map((s, _i, all) => ({ ...s, conversion: s.count / all[0].count }))
  },
}
