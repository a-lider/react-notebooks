import { Children, type ReactNode } from 'react'
import { TEXT_STYLES } from './styles'

/**
 * Side-by-side layout — Notion-style columns. Wrap blocks in Columns with
 * one Column per stack:
 *
 *   <Columns>
 *     <Column>
 *       <p>Left.</p>
 *     </Column>
 *     <Column>
 *       <Trend metric={signups} />
 *     </Column>
 *   </Columns>
 *
 * The editor creates these when a block is dragged to the side of another,
 * and dissolves them when only one column remains. Top-level only — don't
 * nest Columns. data-nb-columns / data-nb-column are the editor's contract.
 */
export function Columns({ children }: { children: ReactNode }) {
  const count = Math.max(Children.count(children), 1)
  return (
    <div
      data-nb-columns
      className="grid items-start gap-6"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  )
}

export function Column({ children }: { children: ReactNode }) {
  return (
    <div data-nb-column className={`min-w-0 space-y-5 ${TEXT_STYLES}`}>
      {children}
    </div>
  )
}
