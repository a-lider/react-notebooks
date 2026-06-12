import type { ReactNode } from 'react'

interface NoteProps {
  author: string
  children: ReactNode
}

/** Interpretation and commentary — distinct from findings in the prose. */
export function Note({ author, children }: NoteProps) {
  return (
    <aside className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
      <span className="font-semibold">{author}:</span> {children}
    </aside>
  )
}
