import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { useMetric } from '@/lib/data'
import type { Interval, Metric } from '@/lib/metrics'

interface TrendProps {
  metric: Metric
  interval?: Interval
  compare?: 'previous-period' | 'none'
}

/**
 * A metric over time. The canonical chart component — copy this file's
 * shape when adding new visualizations.
 */
export function Trend({ metric, interval = 'day', compare = 'none' }: TrendProps) {
  const { data, status, error } = useMetric(metric, { interval, compare })

  const config: ChartConfig = {
    value: { label: metric.label, color: 'var(--chart-2)' },
    ...(compare !== 'none' && {
      previous: { label: 'Previous period', color: 'var(--chart-1)' },
    }),
  }

  return (
    <figure className="rounded-xl border bg-card p-4">
      <figcaption className="mb-3 text-sm font-medium text-muted-foreground">
        {metric.label}
        <span className="ml-2 text-xs font-normal">by {interval}</span>
      </figcaption>
      {status === 'loading' && <div className="aspect-[2.4/1] w-full animate-pulse rounded-md bg-muted/40" />}
      {status === 'error' && (
        <div className="flex aspect-[2.4/1] w-full items-center justify-center rounded-md bg-muted/20 px-6 text-center text-xs text-muted-foreground">
          {error}
        </div>
      )}
      {status === 'ready' && (
      <ChartContainer config={config} className="aspect-[2.4/1] w-full">
        <LineChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="bucket" tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis width={42} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={false} />
          {compare !== 'none' && (
            <Line
              dataKey="previous"
              type="monotone"
              stroke="var(--color-previous)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />
          )}
        </LineChart>
      </ChartContainer>
      )}
    </figure>
  )
}
