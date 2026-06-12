import type { ReactNode } from 'react'

interface NoteProps {
  author: string
  /** Optional: the editor creates empty blocks that fill in later. */
  children?: ReactNode
}

/** Interpretation and commentary — distinct from findings in the prose. */
export function Note({ author, children }: NoteProps) {
  return (
    <aside className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
      {/* data-nb-children marks where {children} lands — the editor's contract */}
      <span className="font-semibold">{author}:</span> <span data-nb-children>{children}</span>
    </aside>
  )
}
