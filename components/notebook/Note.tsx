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
      {/* data-nb-children marks where {children} lands — the editor's contract.
          when empty it gets an inline-block box so the caret can blink and the
          note keeps one line of height; with content it stays inline so text
          wraps under the author label normally */}
      <span className="font-semibold">{author}:</span>{' '}
      <span data-nb-children className="empty:inline-block empty:min-h-6 empty:min-w-2 empty:align-top">
        {children}
      </span>
    </aside>
  )
}
