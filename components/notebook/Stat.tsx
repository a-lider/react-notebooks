import { useMetric } from '@/lib/data'
import type { Metric } from '@/lib/metrics'

interface StatProps {
  metric: Metric
  /**
   * - 'percent-change': change vs the previous period, e.g. "−14.2%"
   * - 'number': the current period total, e.g. "4,281"
   * - 'percent': the current value for percent-unit metrics, e.g. "31.4%"
   */
  format?: 'percent-change' | 'number' | 'percent'
}

/**
 * A live number in prose. Pages never hardcode values into text —
 * <Stat> keeps them current when data refreshes.
 */
export function Stat({ metric, format = 'number' }: StatProps) {
  const { data, summary, status } = useMetric(metric, { compare: 'previous-period' })

  if (status !== 'ready') {
    return (
      <span className="text-muted-foreground" title={status === 'error' ? 'query failed' : 'loading'}>
        {status === 'error' ? 'n/a' : '…'}
      </span>
    )
  }

  if (format === 'percent-change') {
    const pct = summary.change * 100
    const sign = pct > 0 ? '+' : '−'
    const tone = pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
    return (
      <strong className={`font-semibold tabular-nums ${tone}`} title={metric.label}>
        {sign}{Math.abs(pct).toFixed(1)}%
      </strong>
    )
  }

  const latest = data[data.length - 1]?.value ?? 0
  const text =
    format === 'percent' ? `${latest.toFixed(1)}%` : summary.current.toLocaleString('en-US')
  return (
    <strong className="font-semibold tabular-nums" title={metric.label}>
      {text}
    </strong>
  )
}
