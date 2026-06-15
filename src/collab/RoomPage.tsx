/**
 * Renders a synced block tree (no source) — the SDUI interpreter. Text blocks
 * are editable; edits commit on blur/Enter as setText ops. Components render
 * from the registry inside an error boundary that falls back to a card.
 */
import { Component, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { TEXT_STYLES } from '@/components/notebook/styles'
import { componentRegistry, resolveProps } from './registry'
import type { BlockNode, Op } from '@/packages/protocol'

const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'blockquote'])

interface Props {
  blocks: BlockNode[]
  editable: boolean
  onOp: (op: Op) => void
}

export function RoomPage({ blocks, editable, onOp }: Props) {
  return (
    <article className={`mx-auto max-w-3xl space-y-5 px-8 py-10 ${TEXT_STYLES}`}>
      {blocks.map((node, i) => (
        <RenderNode key={i} node={node} path={[i]} editable={editable} onOp={onOp} />
      ))}
    </article>
  )
}

function RenderNode({
  node,
  path,
  editable,
  onOp,
}: {
  node: BlockNode
  path: number[]
  editable: boolean
  onOp: (op: Op) => void
}) {
  const { type } = node

  if (TEXT_TAGS.has(type)) {
    return (
      <EditableText
        tag={type}
        text={node.text ?? ''}
        editable={editable}
        onCommit={(value) => onOp({ t: 'setText', path, value })}
      />
    )
  }

  if (type === 'Columns' || type === 'Column') {
    const Comp = componentRegistry[type]
    return (
      <Comp>
        {(node.children ?? []).map((c, i) => (
          <RenderNode key={i} node={c} path={[...path, i]} editable={editable} onOp={onOp} />
        ))}
      </Comp>
    )
  }

  if (type === 'Note' || type === 'Callout') {
    const Comp = componentRegistry[type]
    return (
      <Comp {...resolveProps(node.props)}>
        <EditableText
          tag="span"
          text={node.text ?? ''}
          editable={editable}
          onCommit={(value) => onOp({ t: 'setText', path, value })}
        />
      </Comp>
    )
  }

  const Comp = componentRegistry[type]
  if (!Comp) return <FallbackCard type={type} />
  return (
    <Boundary fallback={<FallbackCard type={type} />}>
      <Comp {...resolveProps(node.props)} />
    </Boundary>
  )
}

/**
 * contentEditable that React doesn't fight: text is written imperatively, and
 * only refreshed from props when this element isn't focused — so a remote edit
 * updates other viewers without clobbering the one who's typing.
 */
function EditableText({
  tag,
  text,
  editable,
  onCommit,
}: {
  tag: string
  text: string
  editable: boolean
  onCommit: (value: string) => void
}) {
  const nodeRef = useRef<HTMLElement | null>(null)
  const setNode = useCallback((el: HTMLElement | null) => {
    nodeRef.current = el
  }, [])
  useEffect(() => {
    const el = nodeRef.current
    if (el && document.activeElement !== el && el.textContent !== text) el.textContent = text
  }, [text])

  const Tag = tag as React.ElementType
  return (
    <Tag
      ref={setNode}
      contentEditable={editable}
      suppressContentEditableWarning
      spellCheck={false}
      style={editable ? { outline: 'none' } : undefined}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).blur()
        }
      }}
      onBlur={(e: React.FocusEvent<HTMLElement>) => {
        const value = (e.currentTarget.textContent ?? '').replace(/\u00A0/g, ' ')
        if (value !== text) onCommit(value)
      }}
    />
  )
}

function FallbackCard({ type }: { type: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
      {type} <span className="text-xs">· renders in the editor</span>
    </div>
  )
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
