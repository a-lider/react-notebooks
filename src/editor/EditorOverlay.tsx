/**
 * Edit mode. Maps rendered blocks (direct children of the page's <article>)
 * to AST blocks by index, and turns UI actions into ops for the editor
 * server: replaceInner (text editing), insert (p / h2 / callout), delete.
 *
 * No ids anywhere: DOM order == AST order == block index, the same
 * positional identity React itself uses. A hash guards staleness.
 *
 * Mounted with key={slug}, so per-page state resets by remounting.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Plus, Trash2, Type, Heading2, Megaphone } from 'lucide-react'
import { applyOp, fetchPage, StaleError, type EditOp, type PagePayload } from './api'
import { makeEditable, normalizeInner, serializeInner } from './serialize'

interface Props {
  slug: string
  /** The scrollable <main> element — portal target and event root. */
  main: HTMLElement
}

interface EditSession {
  index: number
  container: HTMLElement
  snapshot: string
  islands: string[]
  committed: boolean
}

const HOVER_OUTLINE = '2px solid color-mix(in oklab, var(--ring) 55%, transparent)'
const EDIT_OUTLINE = '2px solid var(--ring)'

const articleOf = (main: HTMLElement): HTMLElement | null => main.querySelector('article')

const blockElOf = (main: HTMLElement, index: number): HTMLElement | null =>
  (articleOf(main)?.children[index] as HTMLElement | undefined) ?? null

export default function EditorOverlay({ slug, main }: Props) {
  const [page, setPage] = useState<PagePayload | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const pageRef = useRef<PagePayload | null>(null)
  useEffect(() => {
    pageRef.current = page
  }, [page])

  const sessionRef = useRef<EditSession | null>(null)
  const pendingEditRef = useRef<number | null>(null)

  const say = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  // ---- page info ----------------------------------------------------------
  useEffect(() => {
    let alive = true
    fetchPage(slug)
      .then((p) => {
        if (alive) setPage(p)
      })
      .catch((e: unknown) => {
        if (alive) say(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [slug, say])

  /** DOM and AST agree? (False briefly while HMR applies a change.) */
  const domInSync = useCallback((): boolean => {
    const a = articleOf(main)
    return !!a && !!pageRef.current && a.children.length === pageRef.current.blocks.length
  }, [main])

  // ---- ops ----------------------------------------------------------------
  const run = useCallback(
    async (op: EditOp): Promise<PagePayload | undefined> => {
      const p = pageRef.current
      if (!p) return undefined
      try {
        const next = await applyOp(p.slug, p.hash, op)
        setPage(next)
        return next
      } catch (e) {
        if (e instanceof StaleError) {
          setPage(e.payload)
          say('Page changed on disk — refreshed, try again')
        } else {
          say(e instanceof Error ? e.message : String(e))
        }
        return undefined
      }
    },
    [say]
  )

  // ---- text editing -------------------------------------------------------
  const endSession = useCallback(
    (commit: boolean) => {
      const s = sessionRef.current
      if (!s || s.committed) return
      s.committed = true
      const p = pageRef.current
      const block = p?.blocks[s.index]

      let text: string | null = null
      if (commit && p && block?.inner) {
        text = serializeInner(s.container, s.islands)
        if (text === normalizeInner(p.source.slice(block.inner.start, block.inner.end))) {
          text = null
        }
      }

      // restore React-owned DOM before HMR re-renders it
      s.container.innerHTML = s.snapshot
      s.container.removeAttribute('contenteditable')
      s.container.style.outline = ''
      s.container.style.outlineOffset = ''
      sessionRef.current = null
      setEditing(null)

      if (text !== null) void run({ type: 'replaceInner', index: s.index, text })
    },
    [run]
  )

  const startEdit = useCallback(
    (index: number) => {
      const p = pageRef.current
      const block = p?.blocks[index]
      const el = blockElOf(main, index)
      if (!p || !block || !el || sessionRef.current) return
      if (!block.editable || !block.inner) {
        say(`<${block.tag}> isn't text-editable — edit it in your IDE`)
        return
      }
      const container = el.hasAttribute('data-nb-children')
        ? el
        : (el.querySelector<HTMLElement>('[data-nb-children]') ?? el)
      const islands = block.elements.map((s) => p.source.slice(s.start, s.end))
      const snapshot = container.innerHTML

      if (!makeEditable(container, block.elements.length)) {
        say('This block renders differently than its source — edit it in your IDE')
        return
      }
      container.style.outline = EDIT_OUTLINE
      container.style.outlineOffset = '6px'
      container.focus()

      sessionRef.current = { index, container, snapshot, islands, committed: false }
      setEditing(index)
      setMenuOpen(false)

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          cleanup()
          endSession(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cleanup()
          endSession(false)
        }
      }
      const onBlur = () => {
        cleanup()
        endSession(true)
      }
      const cleanup = () => {
        container.removeEventListener('keydown', onKey)
        container.removeEventListener('blur', onBlur)
      }
      container.addEventListener('keydown', onKey)
      container.addEventListener('blur', onBlur)
    },
    [main, endSession, say]
  )

  // ---- hover + click tracking ---------------------------------------------
  useEffect(() => {
    const indexAt = (target: HTMLElement): number | null => {
      if (target.closest('[data-nb-toolbar]')) return null
      const a = articleOf(main)
      if (!a || !domInSync()) return null
      let node: HTMLElement | null = target
      while (node && node.parentElement !== a) node = node.parentElement
      return node ? Array.prototype.indexOf.call(a.children, node) : null
    }

    const onOver = (e: Event) => {
      if (sessionRef.current || menuOpen) return
      const target = e.target as HTMLElement
      if (target.closest('[data-nb-toolbar]')) return
      setHovered(indexAt(target))
    }
    const onLeave = () => {
      if (!sessionRef.current && !menuOpen) setHovered(null)
    }
    const onClick = (e: Event) => {
      if (sessionRef.current || menuOpen) return
      const index = indexAt(e.target as HTMLElement)
      if (index !== null && pageRef.current?.blocks[index]?.editable) startEdit(index)
    }

    main.addEventListener('mouseover', onOver)
    main.addEventListener('mouseleave', onLeave)
    main.addEventListener('click', onClick)
    return () => {
      main.removeEventListener('mouseover', onOver)
      main.removeEventListener('mouseleave', onLeave)
      main.removeEventListener('click', onClick)
    }
  }, [main, menuOpen, domInSync, startEdit])

  // hover outline on the block element
  useEffect(() => {
    if (hovered === null || editing !== null) return
    const el = blockElOf(main, hovered)
    if (!el) return
    el.style.outline = HOVER_OUTLINE
    el.style.outlineOffset = '6px'
    el.style.borderRadius = '4px'
    return () => {
      el.style.outline = ''
      el.style.outlineOffset = ''
      el.style.borderRadius = ''
    }
  }, [main, hovered, editing])

  // auto-edit a freshly inserted block once HMR catches up
  useEffect(() => {
    if (pendingEditRef.current === null || !page) return
    const want = pendingEditRef.current
    pendingEditRef.current = null
    let tries = 0
    const tick = () => {
      if (domInSync()) {
        startEdit(want)
      } else if (++tries < 30) {
        window.setTimeout(tick, 100)
      }
    }
    window.setTimeout(tick, 50)
  }, [page, startEdit, domInSync])

  // ---- toolbar ------------------------------------------------------------
  const current = hovered !== null && page ? page.blocks[hovered] : null
  let pos: { top: number; left: number } | null = null
  if (current && hovered !== null) {
    const el = blockElOf(main, hovered)
    if (el) {
      const mainRect = main.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      pos = {
        top: r.top - mainRect.top + main.scrollTop,
        left: Math.min(r.right - mainRect.left + 14, main.clientWidth - 46),
      }
    }
  }

  const insert = (kind: 'p' | 'h2' | 'callout') => {
    if (hovered === null) return
    const after = hovered
    setMenuOpen(false)
    setHovered(null)
    void run({ type: 'insert', afterIndex: after, kind }).then((next) => {
      if (next) pendingEditRef.current = after + 1
    })
  }

  const remove = () => {
    if (hovered === null) return
    const index = hovered
    setMenuOpen(false)
    setHovered(null)
    void run({ type: 'delete', index })
  }

  return createPortal(
    <>
      {pos && editing === null && (
        <div
          data-nb-toolbar
          className="absolute z-40 flex flex-col gap-0.5 rounded-lg border bg-popover p-0.5 shadow-md"
          style={{ top: pos.top, left: pos.left }}
        >
          {current?.editable && (
            <ToolButton
              title="Edit text (or click the block)"
              onClick={() => hovered !== null && startEdit(hovered)}
            >
              <Pencil className="size-3.5" />
            </ToolButton>
          )}
          <ToolButton title="Add block below" onClick={() => setMenuOpen((v) => !v)}>
            <Plus className="size-3.5" />
          </ToolButton>
          <ToolButton title="Delete block" onClick={remove}>
            <Trash2 className="size-3.5 text-destructive" />
          </ToolButton>

          {menuOpen && (
            <div className="absolute left-full top-0 ml-1 w-36 rounded-lg border bg-popover p-1 shadow-md">
              <MenuItem icon={<Type className="size-3.5" />} label="Text" onClick={() => insert('p')} />
              <MenuItem icon={<Heading2 className="size-3.5" />} label="Heading" onClick={() => insert('h2')} />
              <MenuItem icon={<Megaphone className="size-3.5" />} label="Callout" onClick={() => insert('callout')} />
            </div>
          )}
        </div>
      )}

      {editing !== null && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border bg-popover px-4 py-1.5 text-xs text-muted-foreground shadow-md">
          Editing — <kbd className="font-semibold">Enter</kbd> to save ·{' '}
          <kbd className="font-semibold">Esc</kbd> to cancel
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border bg-popover px-4 py-1.5 text-xs shadow-md">
          {toast}
        </div>
      )}
    </>,
    main
  )
}

function ToolButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </button>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
    >
      {icon}
      {label}
    </button>
  )
}
