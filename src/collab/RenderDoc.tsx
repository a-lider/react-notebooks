import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { BlockNode, Op, PageDoc } from '@/packages/protocol'
import { Note, Stat, Mention, Callout } from '@/components/notebook'
import { Funnel, Trend, Query, DataTable } from '@/components/analytics'
import { TEXT_STYLES } from '@/components/notebook/styles'
import { BlockEditContext } from './blockEdit'
import { resolveProps } from './refs'

/**
 * The cloud renderer — Server-Driven UI. It draws the relay's block tree
 * (BlockNode[]) against the components the app already ships, instead of
 * importing a page module. A remote peer with no repo, no file, and no Vite
 * dev server renders the notebook from this + the doc on the wire.
 *
 * Editing emits protocol ops (setText / setProp / insert / delete) addressed
 * by the block's path; the relay echoes them and every peer re-renders from
 * the converged doc. This is the edit transport the file+HMR trick can't be.
 */

const COMPONENTS: Record<string, React.ComponentType<Record<string, unknown>>> = {
  Note: Note as never,
  Stat: Stat as never,
  Mention: Mention as never,
  Callout: Callout as never,
  Funnel: Funnel as never,
  Trend: Trend as never,
  Query: Query as never,
  DataTable: DataTable as never,
}

type TextTag = 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'blockquote'
const TEXT_TAGS = new Set<string>(['h1', 'h2', 'h3', 'h4', 'p', 'blockquote'])
/** Components that take their (editable) body as `text`. */
const TEXT_BODY = new Set(['Note', 'Callout'])

export function RenderDoc({
  doc,
  sendOp,
  editable,
}: {
  doc: PageDoc
  sendOp: (op: Op) => void
  editable: boolean
}) {
  useEffect(() => {
    document.title = `${doc.title} · react-notebooks`
  }, [doc.title])

  return (
    <article className={`mx-auto max-w-3xl space-y-5 px-8 py-10 ${TEXT_STYLES}`}>
      {doc.blocks.map((node, i) => (
        <BlockShell key={i} node={node} path={[i]} sendOp={sendOp} editable={editable} />
      ))}
      {editable && (
        <AddButton
          onClick={() =>
            sendOp({ t: 'insert', parentPath: [], index: doc.blocks.length, node: emptyParagraph() })
          }
          label="Add a block"
        />
      )}
    </article>
  )
}

const emptyParagraph = (): BlockNode => ({ type: 'p', text: '' })

/** A block + its hover controls (insert-after, delete) in the left gutter. */
function BlockShell({
  node,
  path,
  sendOp,
  editable,
}: {
  node: BlockNode
  path: number[]
  sendOp: (op: Op) => void
  editable: boolean
}) {
  const parentPath = path.slice(0, -1)
  const index = path[path.length - 1]

  return (
    <div className="group/blk relative">
      {editable && (
        <div className="absolute -left-9 top-0.5 flex flex-col gap-0.5 opacity-0 transition-opacity group-hover/blk:opacity-100">
          <GutterButton
            title="Add block below"
            onClick={() =>
              sendOp({ t: 'insert', parentPath, index: index + 1, node: emptyParagraph() })
            }
          >
            <Plus className="size-3.5" />
          </GutterButton>
          <GutterButton title="Delete block" onClick={() => sendOp({ t: 'delete', path })}>
            <Trash2 className="size-3.5" />
          </GutterButton>
        </div>
      )}
      <RenderBlock node={node} path={path} sendOp={sendOp} editable={editable} />
    </div>
  )
}

function RenderBlock({
  node,
  path,
  sendOp,
  editable,
}: {
  node: BlockNode
  path: number[]
  sendOp: (op: Op) => void
  editable: boolean
}) {
  // text blocks — inline-editable, emit setText
  if (TEXT_TAGS.has(node.type)) {
    return (
      <EditableText
        tag={node.type as TextTag}
        text={node.text ?? ''}
        editable={editable}
        onCommit={(value) => sendOp({ t: 'setText', path, value })}
      />
    )
  }

  // containers — recurse into children (columns)
  if (node.type === 'Columns' || node.type === 'Column') {
    const children: ReactNode = (node.children ?? []).map((child, i) => (
      <BlockShell key={i} node={child} path={[...path, i]} sendOp={sendOp} editable={editable} />
    ))
    if (node.type === 'Columns') {
      const count = Math.max(node.children?.length ?? 1, 1)
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
    return (
      <div data-nb-column className={`min-w-0 space-y-5 ${TEXT_STYLES}`}>
        {children}
      </div>
    )
  }

  // component blocks — look up the registry, resolve $ref props, render
  const Comp = COMPONENTS[node.type]
  if (!Comp) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Unknown block <code className="font-mono">{node.type}</code>
      </div>
    )
  }
  const props = resolveProps(node.props)
  const body = TEXT_BODY.has(node.type) ? node.text : undefined

  // bind a path-scoped prop emitter so <Query> can sync its SQL through the
  // relay (setProp) instead of writing the file
  return (
    <BlockEditContext.Provider
      value={
        editable ? { emitProp: (name, value) => sendOp({ t: 'setProp', path, key: name, value }) } : null
      }
    >
      <Comp {...props}>{body}</Comp>
    </BlockEditContext.Provider>
  )
}

/**
 * A contentEditable text element. The DOM owns the text while editing; React
 * never re-renders the children (they're captured once at mount), so the caret
 * is never disturbed. Remote edits arrive as a changed `text` prop and are
 * applied imperatively, but only when this element isn't focused.
 */
function EditableText({
  tag: Tag,
  text,
  editable,
  onCommit,
}: {
  tag: TextTag
  text: string
  editable: boolean
  onCommit: (value: string) => void
}) {
  const node = useRef<HTMLElement | null>(null)
  const focused = useRef(false)
  const timer = useRef<number | null>(null)
  const [initial] = useState(text)

  // adopt remote changes (and the echo of our own) when we're not the typist
  useEffect(() => {
    const el = node.current
    if (el && !focused.current && el.textContent !== text) el.textContent = text
  }, [text])

  const commit = (value: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    onCommit(value)
  }

  return (
    <Tag
      ref={(n: HTMLElement | null) => {
        node.current = n
      }}
      data-nb-text
      contentEditable={editable}
      suppressContentEditableWarning
      className={
        (text === '' ? 'min-h-[1.5em] ' : '') +
        (editable ? 'rounded-sm outline-none focus:bg-accent/30' : '')
      }
      onFocus={() => {
        focused.current = true
      }}
      onBlur={(e) => {
        focused.current = false
        commit(e.currentTarget.textContent ?? '')
      }}
      onInput={(e) => {
        const value = e.currentTarget.textContent ?? ''
        if (timer.current !== null) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => commit(value), 450)
      }}
    >
      {initial}
    </Tag>
  )
}

function GutterButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      title={title}
      // keep the editor's focus/caret while clicking a gutter control
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground"
    >
      <Plus className="size-4" />
      {label}
    </button>
  )
}
