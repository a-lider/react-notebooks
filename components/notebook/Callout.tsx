import type { ReactNode } from 'react'

interface CalloutProps {
  variant?: 'info' | 'warning'
  children: ReactNode
}

export function Callout({ variant = 'info', children }: CalloutProps) {
  const styles =
    variant === 'warning'
      ? 'border-orange-200 bg-orange-50 text-orange-950 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-100'
      : 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100'
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm leading-6 ${styles}`}>
      {/* data-nb-children marks where {children} lands — the editor's contract */}
      <span data-nb-children>{children}</span>
    </div>
  )
}
