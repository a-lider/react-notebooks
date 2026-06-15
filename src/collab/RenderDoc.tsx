import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Note, Stat, Mention, Callout } from '@/components/notebook'
import { Funnel, Trend, Query, DataTable } from '@/components/analytics'
import { TEXT_STYLES } from '@/components/notebook/styles'
import { applyEditOp, extractDoc, type BlockNode, type EditOp } from '@/src/editor/tsx-engine'
import { BlockEditContext } from './blockEdit'
import { resolveProps } from './refs'

/**
 * The cloud renderer. The room's value is the page's TSX source; this parses it
 * into a throwaway block tree (extractDoc) and renders it against the components
 * the app already ships. A remote peer with no repo / file / dev server renders
 * the notebook from this + the source on the wire.
 *
 * Editing splices the source with the TSX engine (applyEditOp) and sends the
 * new source; the relay echoes it and every peer re-parses + re-renders. Blocks
 * are addressed by their flat index — top-level children with <Columns>
 * transparent — exactly the order extractBlocks/applyOp use, computed here as
 * we walk so it matches.
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
  source,
  slug,
  sendEdit,
  editable,
}: {
  source: string
  slug: string
  sendEdit: (source: string) => void
  editable: boolean
}) {
  const doc = useMemo(() => {
    try {
      return extractDoc(source, slug)
    } catch {
      return null
    }
  }, [source, slug])

  // splice the current source with one structured op and ship the new source
  const edit = useCallback(
    (op: EditOp) => {
      try {
        sendEdit(applyEditOp(source, op))
      } catch (e) {
        console.warn('[room] edit failed', e)
      }
    },
    [source, sendEdit]
  )

  useEffect(() => {
    if (doc) document.title = `${doc.title} · react-notebooks`
  }, [doc])

  if (!doc) {
    return (
      <div className="px-10 py-12 text-sm text-muted-foreground">
        Couldn't parse the page source.
      </div>
    )
  }

  // walk the tree assigning each leaf its flat index (columns transparent),
  // synchronously during this render so the indices match the engine's
  const counter = { n: 0 }
  const renderLeaf = (node: BlockNode, key: number | string) => {
    const flat = counter.n++
    return <BlockShell key={key} node={node} index={flat} edit={edit} editable={editable} />
  }
  const renderBlocks = (nodes: BlockNode[]): ReactNode =>
    nodes.map((node, i) => {
      if (node.type === 'Columns') {
        const cols = node.children ?? []
        return (
          <div
            key={i}
            data-nb-columns
            className="grid items-start gap-6"
            style={{ gridTemplateColumns: `repeat(${Math.max(cols.length, 1)}, minmax(0, 1fr))` }}
          >
            {cols.map((col, ci) => (
              <div key={ci} data-nb-column className={`min-w-0 space-y-5 ${TEXT_STYLES}`}>
                {(col.children ?? []).map((leaf, li) => renderLeaf(leaf, li))}
              </div>
            ))}
          </div>
        )
      }
      return renderLeaf(node, i)
    })

  const body = renderBlocks(doc.blocks)
  const lastIndex = counter.n - 1

  return (
    <article className={`mx-auto max-w-3xl space-y-5 px-8 py-10 ${TEXT_STYLES}`}>
      {body}
      {editable && lastIndex >= 0 && (
        <AddButton
          label="Add a block"
          onClick={() => edit({ type: 'insert', afterIndex: lastIndex, kind: 'p', topLevel: true })}
        />
      )}
    </article>
  )
}

/** A block + its hover controls (insert-after, delete) in the left gutter. */
function BlockShell({
  node,
  index,
  edit,
  editable,
}: {
  node: BlockNode
  index: number
  edit: (op: EditOp) => void
  editable: boolean
}) {
  return (
    <div className="group/blk relative">
      {editable && (
        <div className="absolute -left-9 top-0.5 flex flex-col gap-0.5 opacity-0 transition-opacity group-hover/blk:opacity-100">
          <GutterButton
            title="Add block below"
            onClick={() => edit({ type: 'insert', afterIndex: index, kind: 'p' })}
          >
            <Plus className="size-3.5" />
          </GutterButton>
          <GutterButton title="Delete block" onClick={() => edit({ type: 'delete', index })}>
            <Trash2 className="size-3.5" />
          </GutterButton>
        </div>
      )}
      <RenderBlock node={node} index={index} edit={edit} editable={editable} />
    </div>
  )
}

function RenderBlock({
  node,
  index,
  edit,
  editable,
}: {
  node: BlockNode
  index: number
  edit: (op: EditOp) => void
  editable: boolean
}) {
  // text blocks — inline-editable, splice via replaceInner
  if (TEXT_TAGS.has(node.type)) {
    return (
      <EditableText
        tag={node.type as TextTag}
        text={node.text ?? ''}
        editable={editable}
        onCommit={(value) => edit({ type: 'replaceInner', index, text: value })}
      />
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
  const text = TEXT_BODY.has(node.type) ? node.text : undefined

  // bind a flat-index prop emitter so <Query> can sync its SQL through the
  // relay (a setProp splice) instead of writing the file
  return (
    <BlockEditContext.Provider
      value={
        editable
          ? { emitProp: (name, value) => edit({ type: 'setProp', index, name, value: String(value) }) }
          : null
      }
    >
      <Comp {...props}>{text}</Comp>
    </BlockEditContext.Provider>
  )
}

/**
 * A contentEditable text element. The DOM owns the text while editing; React
 * never re-renders the children (captured once at mount), so the caret is never
 * disturbed. Remote edits arrive as a changed `text` prop and are applied
 * imperatively, but only when this element isn't focused.
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
