import { useFunnel, type FunnelStep } from '@/lib/data'

interface FunnelProps {
  steps: FunnelStep[]
  /** Event property to break results down by, e.g. "$browser". */
  breakdown?: string
}

/** Step-by-step conversion. Bespoke viz — no chart library needed. */
export function Funnel({ steps, breakdown }: FunnelProps) {
  const { steps: results, status, error } = useFunnel(steps, breakdown)

  return (
    <figure className="rounded-xl border bg-card p-4">
      <figcaption className="mb-4 text-sm font-medium text-muted-foreground">
        Funnel{breakdown && <span className="ml-2 text-xs font-normal">breakdown: {breakdown}</span>}
      </figcaption>
      {status === 'loading' && <div className="h-36 w-full animate-pulse rounded-md bg-muted/40" />}
      {status === 'error' && (
        <div className="flex h-36 w-full items-center justify-center rounded-md bg-muted/20 px-6 text-center text-xs text-muted-foreground">
          {error}
        </div>
      )}
      <div className="flex items-end gap-3">
        {results.map((step, i) => (
          <div key={i} className="flex-1 space-y-1.5">
            <div className="text-xs text-muted-foreground truncate" title={step.label}>
              {i + 1} · {step.label}
            </div>
            <div className="flex h-28 items-end rounded-md bg-muted/40">
              <div
                className="w-full rounded-md bg-[var(--chart-2)] transition-[height]"
                style={{ height: `${Math.max(step.conversion * 100, 4)}%` }}
              />
            </div>
            <div className="text-sm font-semibold tabular-nums">
              {step.count.toLocaleString('en-US')}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {Math.round(step.conversion * 100)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </figure>
  )
}
