/**
 * Always-on, Notion-style editing (dev only).
 *
 * - Click any text block → caret lands where you clicked; type away.
 * - Autosave: 1s debounce after typing, deferred-HMR so the caret never
 *   jumps; the HMR update flushes when the edit session ends.
 * - Hover a block → [+] and [⠿] handles on the LEFT. + inserts below,
 *   grip drags to reorder (blue drop indicator), grip click → Delete.
 * - Type '/' in an empty block → block-type menu. Enter → new paragraph.
 * - Click below the last block → new paragraph.
 *
 * Blocks map to AST by index — DOM order == AST order, the positional
 * identity React itself uses. No outlines, no edit mode: it's just a page.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus,
  GripVertical,
  Trash2,
  Type,
  Heading2,
  Heading3,
  Megaphone,
  Database,
  Copy as CopyIcon,
} from 'lucide-react'
import {
  applyOp,
  fetchPage,
  flushPage,
  historyStep,
  StaleError,
  type BlockKind,
  type EditOp,
  type PagePayload,
} from './api'
import { makeEditable, normalizeInner, serializeInner, unmakeEditable } from './serialize'

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
  /** At least one deferred save happened — flush HMR on session end. */
  saved: boolean
  ended: boolean
}

type SaveStatus = 'saved' | 'editing' | 'saving'

type Menu =
  | { kind: 'insert'; afterIndex: number; x: number; y: number }
  | { kind: 'slash'; index: number; x: number; y: number }
  | { kind: 'grip'; index: number; x: number; y: number }

interface Drag {
  from: number
  /** A vertical gap between top-level units, or a side of a simple block. */
  drop:
    | { kind: 'gap'; gap: number; y: number }
    | { kind: 'side'; unit: number; side: 'left' | 'right'; x: number; top: number; height: number }
  left: number
  width: number
}

const BLOCK_KINDS: { kind: BlockKind; label: string; Icon: typeof Type; domTag: string }[] = [
  { kind: 'p', label: 'Text', Icon: Type, domTag: 'p' },
  { kind: 'h2', label: 'Heading 2', Icon: Heading2, domTag: 'h2' },
  { kind: 'h3', label: 'Heading 3', Icon: Heading3, domTag: 'h3' },
  { kind: 'callout', label: 'Callout', Icon: Megaphone, domTag: 'div' },
  { kind: 'sql', label: 'SQL', Icon: Database, domTag: 'figure' },
]

const PLACEHOLDER = "Type something, or press '/' for blocks"

const articleOf = (main: HTMLElement): HTMLElement | null => main.querySelector('article')

/**
 * Flat DOM block list, mirroring the server's depth-first traversal:
 * top-level article children, with [data-nb-columns] wrappers transparent —
 * their [data-nb-column] children's blocks take the wrapper's place.
 */
function blockEls(main: HTMLElement): HTMLElement[] {
  const a = articleOf(main)
  if (!a) return []
  const out: HTMLElement[] = []
  for (const child of Array.from(a.children)) {
    if (child.hasAttribute('data-nb-columns')) {
      for (const col of Array.from(child.children)) {
        if (!col.hasAttribute('data-nb-column')) continue
        for (const inner of Array.from(col.children)) out.push(inner as HTMLElement)
      }
    } else {
      out.push(child as HTMLElement)
    }
  }
  return out
}

const blockElOf = (main: HTMLElement, index: number): HTMLElement | null =>
  blockEls(main)[index] ?? null

/** Walk up from an event target to the containing block element, if any. */
function blockElFromTarget(main: HTMLElement, target: HTMLElement): HTMLElement | null {
  const a = articleOf(main)
  if (!a || !a.contains(target)) return null
  let node: HTMLElement = target
  for (;;) {
    const parent: HTMLElement | null = node.parentElement
    if (!parent) return null
    if (parent === a || parent.hasAttribute('data-nb-column')) return node
    node = parent
  }
}

/** Rendered DOM tag for a page-level JSX tag (for post-op DOM sync checks). */
function domTagFor(tag: string): string {
  if (tag === 'Note') return 'aside'
  if (tag === 'Callout') return 'div'
  return tag.toLowerCase()
}

function containerOf(el: HTMLElement): HTMLElement {
  return el.hasAttribute('data-nb-children')
    ? el
    : (el.querySelector<HTMLElement>('[data-nb-children]') ?? el)
}

/** Where the caret sits relative to the editable container's content. */
function caretInfo(container: HTMLElement): { empty: boolean; atStart: boolean; atEnd: boolean } {
  const empty =
    (container.textContent ?? '').replace(/\u00A0/g, ' ').trim() === '' &&
    !container.querySelector('[data-ce-ix]')
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return { empty, atStart: false, atEnd: false }
  const r = sel.getRangeAt(0)
  if (!r.collapsed || !container.contains(r.startContainer)) {
    return { empty, atStart: false, atEnd: false }
  }
  const pre = document.createRange()
  pre.selectNodeContents(container)
  pre.setEnd(r.startContainer, r.startOffset)
  const preFrag = pre.cloneContents()
  const atStart = (preFrag.textContent ?? '').trim() === '' && !preFrag.querySelector('[data-ce-ix]')
  const post = document.createRange()
  post.selectNodeContents(container)
  post.setStart(r.startContainer, r.startOffset)
  const postFrag = post.cloneContents()
  const atEnd = (postFrag.textContent ?? '').trim() === '' && !postFrag.querySelector('[data-ce-ix]')
  return { empty, atStart, atEnd }
}

/** Place the caret at a text offset (island text counts; -1 = end). */
function placeCaretAtTextOffset(container: HTMLElement, offset: number): void {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  let placed = false
  if (offset >= 0) {
    let cum = 0
    for (const node of Array.from(container.childNodes)) {
      const len = (node.textContent ?? '').length
      if (cum + len >= offset) {
        if (node.nodeType === Node.TEXT_NODE) {
          range.setStart(node, Math.min(Math.max(offset - cum, 0), len))
        } else {
          range.setStartAfter(node)
        }
        range.collapse(true)
        placed = true
        break
      }
      cum += len
    }
  }
  if (!placed) {
    range.selectNodeContents(container)
    range.collapse(false)
  }
  sel.removeAllRanges()
  sel.addRange(range)
}

function placeCaret(x: number, y: number, fallback: HTMLElement): void {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let range: Range | null = null
  if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(x, y)
    if (p) {
      range = document.createRange()
      range.setStart(p.offsetNode, p.offset)
      range.collapse(true)
    }
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    range = doc.caretRangeFromPoint(x, y)
  }
  if (!range) {
    range = document.createRange()
    range.selectNodeContents(fallback)
    range.collapse(false)
  }
  const sel = window.getSelection()
  if (sel) {
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

export default function EditorOverlay({ slug, main }: Props) {
  const [page, setPage] = useState<PagePayload | null>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [, setScrollTick] = useState(0)

  const pageRef = useRef<PagePayload | null>(null)
  useEffect(() => {
    pageRef.current = page
  }, [page])

  const sessionRef = useRef<EditSession | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingEditRef = useRef<{ index: number; domTag: string; caret?: number } | null>(null)
  /** A real drag just ended — swallow the grip's click event. */
  const draggedRef = useRef(false)

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
    return !!pageRef.current && blockEls(main).length === pageRef.current.blocks.length
  }, [main])

  // refresh the payload after any HMR update (agent edits, Query self-saves)
  // so the overlay's hash/spans stay current; skip mid-session — the session
  // owns its own refresh cycle
  useEffect(() => {
    const hot = import.meta.hot
    if (!hot) return
    const onUpdate = () => {
      if (sessionRef.current) return
      fetchPage(slug)
        .then((p) => {
          if (pageRef.current && p.hash !== pageRef.current.hash) setPage(p)
          else if (!pageRef.current) setPage(p)
        })
        .catch(() => {})
    }
    hot.on('vite:afterUpdate', onUpdate)
    return () => hot.off('vite:afterUpdate', onUpdate)
  }, [slug])

  // ---- saving -------------------------------------------------------------
  const save = useCallback(
    async (op: EditOp, defer: boolean): Promise<PagePayload | undefined> => {
      const p = pageRef.current
      if (!p) return undefined
      setStatus('saving')
      try {
        let next: PagePayload
        try {
          next = await applyOp(p.slug, p.hash, op, defer)
        } catch (e) {
          // text autosaves are safe to retry once against the fresh hash;
          // structural ops aren't (indexes may have shifted) — surface those
          if (e instanceof StaleError && op.type === 'replaceInner') {
            pageRef.current = e.payload
            next = await applyOp(e.payload.slug, e.payload.hash, op, defer)
          } else {
            throw e
          }
        }
        setPage(next)
        setStatus('saved')
        return next
      } catch (e) {
        if (e instanceof StaleError) {
          setPage(e.payload)
          say('Page changed on disk — refreshed, try again')
        } else {
          say(e instanceof Error ? e.message : String(e))
        }
        setStatus('saved')
        return undefined
      }
    },
    [say]
  )

  /** Serialize the live container and autosave if it differs from disk. */
  const saveSession = useCallback(async (): Promise<void> => {
    const s = sessionRef.current
    const p = pageRef.current
    const block = p?.blocks[s?.index ?? -1]
    if (!s || s.ended || !p || !block?.inner) return
    const text = serializeInner(s.container, s.islands)
    if (text === normalizeInner(p.source.slice(block.inner.start, block.inner.end))) {
      setStatus('saved')
      return
    }
    const next = await save({ type: 'replaceInner', index: s.index, text }, true)
    if (next) s.saved = true
  }, [save])

  const scheduleSave = useCallback(() => {
    setStatus('editing')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void saveSession()
    }, 1000)
  }, [saveSession])

  // ---- edit sessions ------------------------------------------------------
  const endSession = useCallback(
    async (commit: boolean): Promise<void> => {
      const s = sessionRef.current
      if (!s || s.ended) return
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      if (commit) await saveSession()
      s.ended = true
      sessionRef.current = null

      // restore React-owned DOM exactly as React last rendered it,
      // then release the deferred HMR update to paint the saved content
      if (s.container.isConnected) {
        s.container.innerHTML = s.snapshot
        unmakeEditable(s.container)
      }
      if (s.saved) await flushPage(slug)
      setStatus('saved')
    },
    [saveSession, slug]
  )

  const endSessionRef = useRef(endSession)
  useEffect(() => {
    endSessionRef.current = endSession
  }, [endSession])

  // commit any open session when the overlay unmounts (page switch)
  useEffect(() => {
    return () => {
      void endSessionRef.current(true)
    }
  }, [])

  const startEdit = useCallback(
    (index: number, at?: { x: number; y: number }) => {
      const p = pageRef.current
      const block = p?.blocks[index]
      const el = blockElOf(main, index)
      if (!p || !block || !el || sessionRef.current?.index === index) return
      if (sessionRef.current) void endSessionRef.current(true)
      if (!block.editable || !block.inner) return

      const container = containerOf(el)
      const islands = block.elements.map((s) => p.source.slice(s.start, s.end))
      const snapshot = container.innerHTML

      if (!makeEditable(container, block.elements.length, PLACEHOLDER)) {
        say('This block renders differently than its source — edit it in your IDE')
        return
      }
      container.focus()
      if (at) placeCaret(at.x, at.y, container)

      const session: EditSession = { index, container, snapshot, islands, saved: false, ended: false }
      sessionRef.current = session
      setHovered(index) // the handles follow the block being typed in

      const onInput = () => {
        if (session.ended) return
        // '/' in an empty block opens the block menu
        if (container.textContent === '/') {
          if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
          const r = container.getBoundingClientRect()
          const mainRect = main.getBoundingClientRect()
          setMenu({
            kind: 'slash',
            index,
            x: r.left - mainRect.left,
            y: r.bottom - mainRect.top + main.scrollTop + 6,
          })
          return
        }
        scheduleSave()
      }
      const onKey = (e: KeyboardEvent) => {
        if (session.ended) return
        if (e.key === 'Enter') {
          e.preventDefault() // newlines don't exist in JSX text — blocks are atomic
          if (e.shiftKey) return
          void (async () => {
            await endSessionRef.current(true)
            const next = await save({ type: 'insert', afterIndex: index, kind: 'p' }, false)
            if (next) pendingEditRef.current = { index: index + 1, domTag: 'p' }
          })()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setMenu(null)
          void endSessionRef.current(true)
        } else if (e.key === 'Backspace') {
          const info = caretInfo(container)
          const pp = pageRef.current
          if (!pp) return
          if (info.empty) {
            // empty block → remove it, caret to the end of the previous block
            e.preventDefault()
            void (async () => {
              await endSessionRef.current(false)
              const prevIx = index - 1
              const next = await save({ type: 'delete', index }, false)
              const prev = next?.blocks[prevIx]
              if (next && prev?.editable) {
                pendingEditRef.current = { index: prevIx, domTag: domTagFor(prev.tag), caret: -1 }
              }
            })()
          } else if (info.atStart) {
            // caret at start → merge this block into the previous text block
            const prevBlock = pp.blocks[index - 1]
            const prevEl = blockElOf(main, index - 1)
            if (!prevBlock?.editable || !prevEl) return
            e.preventDefault()
            const text = serializeInner(container, session.islands)
            const junction = (containerOf(prevEl).textContent ?? '').length
            void (async () => {
              await endSessionRef.current(false)
              const next = await save({ type: 'mergeUp', index, text }, false)
              if (next) {
                pendingEditRef.current = {
                  index: index - 1,
                  domTag: domTagFor(prevBlock.tag),
                  caret: junction,
                }
              }
            })()
          }
        } else if (e.key === 'Delete') {
          // forward delete at the end → merge the next text block into this one
          const info = caretInfo(container)
          const pp = pageRef.current
          const nextBlock = pp?.blocks[index + 1]
          if (!info.atEnd || !nextBlock?.editable) return
          e.preventDefault()
          const prevText = serializeInner(container, session.islands)
          const junction = (container.textContent ?? '').length
          void (async () => {
            await endSessionRef.current(false)
            const next = await save({ type: 'mergeUp', index: index + 1, prevText }, false)
            if (next && pp) {
              pendingEditRef.current = {
                index,
                domTag: domTagFor(pp.blocks[index].tag),
                caret: junction,
              }
            }
          })()
        }
      }
      const onBlur = () => {
        // let menu clicks land before tearing the session down
        window.setTimeout(() => {
          if (!session.ended && sessionRef.current === session) {
            const m = document.activeElement?.closest?.('[data-nb-ui]')
            if (!m) void endSessionRef.current(true)
          }
        }, 0)
      }
      container.addEventListener('input', onInput)
      container.addEventListener('keydown', onKey)
      container.addEventListener('blur', onBlur)
    },
    [main, say, save, scheduleSave]
  )

  // auto-edit a freshly inserted block once HMR catches up
  useEffect(() => {
    if (!pendingEditRef.current || !page) return
    const want = pendingEditRef.current
    pendingEditRef.current = null
    let tries = 0
    // require two consecutive stable reads: starting a session on DOM with
    // in-flight HMR updates makes React's reconciliation fight our snapshot
    let lastEl: HTMLElement | null = null
    let lastText: string | null = null
    const tick = () => {
      const el = blockElOf(main, want.index)
      const ok = domInSync() && !!el && el.tagName.toLowerCase() === want.domTag
      if (ok && el === lastEl && el.textContent === lastText) {
        startEdit(want.index)
        const s = sessionRef.current
        if (s && s.index === want.index && want.caret !== undefined) {
          placeCaretAtTextOffset(s.container, want.caret)
        }
        return
      }
      lastEl = el
      lastText = el?.textContent ?? null
      if (++tries < 40) window.setTimeout(tick, 120)
    }
    window.setTimeout(tick, 60)
  }, [page, startEdit, domInSync, main])

  // ---- hover + click ------------------------------------------------------
  useEffect(() => {
    const indexAt = (target: HTMLElement): number | null => {
      if (target.closest('[data-nb-ui]')) return null
      if (!domInSync()) return null
      const el = blockElFromTarget(main, target)
      if (!el) return null
      const ix = blockEls(main).indexOf(el)
      return ix >= 0 ? ix : null
    }

    const onOver = (e: Event) => {
      if (drag) return
      const target = e.target as HTMLElement
      if (target.closest('[data-nb-ui]')) return
      const ix = indexAt(target)
      if (ix !== null) setHovered(ix)
    }
    const onLeave = () => {
      if (!drag && !menu) setHovered(null)
    }
    const onScroll = () => {
      if (!drag) setHovered(null)
      setScrollTick((t) => t + 1) // keep selection/menu overlays anchored
    }
    const onClick = (e: MouseEvent) => {
      if (drag) return
      const target = e.target as HTMLElement
      if (target.closest('[data-nb-ui]')) return
      // interactive component regions (e.g. the SQL editor) own their clicks —
      // and taking focus there means the block selection must drop
      if (target.closest('[data-nb-interactive]')) {
        setSelected(null)
        return
      }
      const p = pageRef.current
      const a = articleOf(main)
      if (!p || !a || !domInSync()) return

      const ix = indexAt(target)
      if (ix !== null) {
        if (p.blocks[ix]?.editable) {
          setSelected(null)
          if (sessionRef.current?.index !== ix) startEdit(ix, { x: e.clientX, y: e.clientY })
        } else {
          // non-editable block (chart, table…) → Notion-style selection
          void endSessionRef.current(true)
          setSelected(ix)
        }
        return
      }
      setSelected(null)
      // click below the last block → new full-width paragraph at the top
      // level (or focus a trailing empty top-level one)
      if ((target === a || target === main) && p.blocks.length > 0) {
        const last = a.children[a.children.length - 1]
        if (last && e.clientY > last.getBoundingClientRect().bottom && !sessionRef.current) {
          const lastBlock = p.blocks[p.blocks.length - 1]
          const lastIsTopLevel = lastBlock.top.start === lastBlock.span.start
          const lastIsEmptyText =
            lastIsTopLevel &&
            lastBlock.editable &&
            lastBlock.inner &&
            p.source.slice(lastBlock.inner.start, lastBlock.inner.end).trim() === ''
          if (lastIsEmptyText) {
            startEdit(lastBlock.index)
            return
          }
          const after = p.blocks.length - 1
          void save({ type: 'insert', afterIndex: after, kind: 'p', topLevel: true }, false).then(
            (next) => {
              if (next) pendingEditRef.current = { index: next.blocks.length - 1, domTag: 'p' }
            }
          )
        }
      }
    }

    main.addEventListener('mouseover', onOver)
    main.addEventListener('mouseleave', onLeave)
    main.addEventListener('scroll', onScroll, { passive: true })
    main.addEventListener('click', onClick)
    return () => {
      main.removeEventListener('mouseover', onOver)
      main.removeEventListener('mouseleave', onLeave)
      main.removeEventListener('scroll', onScroll)
      main.removeEventListener('click', onClick)
    }
  }, [main, drag, menu, domInSync, startEdit, save])

  // close menus on outside pointerdown
  useEffect(() => {
    if (!menu) return
    const onDown = (e: Event) => {
      if (!(e.target as HTMLElement).closest('[data-nb-ui]')) setMenu(null)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menu])

  // ⌘Z / ⇧⌘Z / ⌘Y — undo/redo against the workspace history file.
  // preventDefault unconditionally: the native contenteditable stack is
  // poisoned by our island attrs / snapshot restores / HMR and must never fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      // interactive regions (SQL textarea) keep native undo while focused;
      // once blurred and saved, the workspace history covers their edits
      if ((e.target as HTMLElement).closest?.('[data-nb-interactive]')) return
      const k = e.key.toLowerCase()
      const isUndo = k === 'z' && !e.shiftKey
      const isRedo = (k === 'z' && e.shiftKey) || k === 'y'
      if (!isUndo && !isRedo) return
      e.preventDefault()
      void (async () => {
        await endSessionRef.current(true) // the live burst becomes the top entry
        setSelected(null)
        setMenu(null)
        setStatus('saving')
        try {
          const res = await historyStep(slug, isUndo ? 'undo' : 'redo')
          setPage(res.payload)
          setStatus('saved')
          if (!res.ok) {
            say(
              res.reason === 'stale'
                ? 'History out of date — cleared'
                : isUndo
                  ? 'Nothing to undo'
                  : 'Nothing to redo'
            )
            return
          }
          if (res.label === 'external') say(isUndo ? 'Undid agent edit' : 'Redid agent edit')
          const block = res.focusBlock !== undefined ? res.payload.blocks[res.focusBlock] : undefined
          if (block?.editable) {
            pendingEditRef.current = { index: block.index, domTag: domTagFor(block.tag), caret: -1 }
            setPage((p) => (p ? { ...p } : p)) // re-trigger the pending-edit effect
          } else if (block) {
            setSelected(block.index)
          }
        } catch (err) {
          setStatus('saved')
          say(err instanceof Error ? err.message : String(err))
        }
      })()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slug, say])

  // keyboard actions on a selected (non-editable) block
  useEffect(() => {
    if (selected === null) return
    const onKey = (e: KeyboardEvent) => {
      if (sessionRef.current) return
      // keystrokes belong to whatever is being typed in, never to selection
      const t = e.target as HTMLElement
      if (
        t.closest?.('[data-nb-interactive]') ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ||
        t.isContentEditable
      ) {
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        const index = selected
        setSelected(null)
        void save({ type: 'delete', index }, false)
      } else if (e.key === 'Escape') {
        setSelected(null)
      }
    }
    // focus moving into an interactive region also drops the selection
    const onFocusIn = (e: FocusEvent) => {
      if ((e.target as HTMLElement).closest?.('[data-nb-interactive]')) setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('focusin', onFocusIn)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('focusin', onFocusIn)
    }
  }, [selected, save])

  // ---- drag to reorder ----------------------------------------------------
  const beginDrag = useCallback(
    (from: number, e: React.PointerEvent) => {
      e.preventDefault()
      const a = articleOf(main)
      const p = pageRef.current
      if (!a || !p || !domInSync()) return
      void endSessionRef.current(true)
      setMenu(null)
      setSelected(null)

      const mainRect = main.getBoundingClientRect()
      const flat = blockEls(main)

      // drag geometry works over TOP-LEVEL units: a unit is a simple block
      // or a whole <Columns> wrapper (which occupies one row)
      const units = Array.from(a.children).map((u) => {
        const r = u.getBoundingClientRect()
        const isWrapper = u.hasAttribute('data-nb-columns')
        const firstBlock = isWrapper
          ? (u.querySelector('[data-nb-column] > *') as HTMLElement | null)
          : (u as HTMLElement)
        return {
          el: u as HTMLElement,
          isWrapper,
          /** flat index used as the `before` anchor for vertical drops */
          flatIndex: firstBlock ? flat.indexOf(firstBlock) : -1,
          top: r.top - mainRect.top + main.scrollTop,
          bottom: r.bottom - mainRect.top + main.scrollTop,
          left: r.left - mainRect.left,
          right: r.right - mainRect.left,
        }
      })
      const articleRect = a.getBoundingClientRect()
      const left = articleRect.left - mainRect.left
      const width = articleRect.width
      const n = units.length

      const gapY = (k: number): number => {
        if (k === 0) return units[0].top - 6
        if (k === n) return units[n - 1].bottom + 6
        return (units[k - 1].bottom + units[k].top) / 2
      }
      const dropAt = (x: number, y: number): Drag['drop'] => {
        // side zones: near the left/right edge of a simple top-level block
        for (let k = 0; k < n; k++) {
          const u = units[k]
          if (u.isWrapper || u.flatIndex === from) continue
          if (y < u.top || y > u.bottom) continue
          const edge = Math.max(48, (u.right - u.left) * 0.18)
          if (x >= u.left - 24 && x < u.left + edge) {
            return { kind: 'side', unit: k, side: 'left', x: u.left - 5, top: u.top, height: u.bottom - u.top }
          }
          if (x > u.right - edge && x <= u.right + 24) {
            return { kind: 'side', unit: k, side: 'right', x: u.right + 2, top: u.top, height: u.bottom - u.top }
          }
        }
        let best = 0
        let bestDist = Infinity
        for (let k = 0; k <= n; k++) {
          const d = Math.abs(gapY(k) - y)
          if (d < bestDist) {
            bestDist = d
            best = k
          }
        }
        return { kind: 'gap', gap: best, y: gapY(best) }
      }

      const el = flat[from]
      if (!el) return
      const fromUnit = units.findIndex((u) => u.el === el || u.el.contains(el))
      const fromIsTopLevel = units[fromUnit] && !units[fromUnit].isWrapper
      const startX = e.clientX
      const startY = e.clientY
      // Notion-style: a click is not a drag — visuals only after real movement
      let active = false
      let current: Drag = { from, drop: { kind: 'gap', gap: fromUnit, y: gapY(Math.max(fromUnit, 0)) }, left, width }

      const toContent = (ev: PointerEvent) => {
        const r = main.getBoundingClientRect()
        return { x: ev.clientX - r.left, y: ev.clientY - r.top + main.scrollTop }
      }

      const onMove = (ev: PointerEvent) => {
        if (!active) {
          if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return
          active = true
          draggedRef.current = true
          el.style.opacity = '0.35'
          document.body.style.userSelect = 'none'
          document.body.style.cursor = 'grabbing'
          setDrag(current)
        }
        const { x, y } = toContent(ev)
        const drop = dropAt(x, y)
        if (JSON.stringify(drop) !== JSON.stringify(current.drop)) {
          current = { ...current, drop }
          setDrag(current)
        }
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        if (!active) return // plain click — the grip's onClick selects + opens the menu
        el.style.opacity = ''
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        setDrag(null)
        setHovered(null)
        const drop = current.drop
        if (drop.kind === 'side') {
          const target = units[drop.unit]?.flatIndex
          if (target !== undefined && target >= 0 && target !== from) {
            void save({ type: 'columnize', from, target, side: drop.side }, false)
          }
          return
        }
        // vertical: no-op only when a top-level block lands beside itself
        if (fromIsTopLevel && (drop.gap === fromUnit || drop.gap === fromUnit + 1)) return
        const before = drop.gap < n ? units[drop.gap].flatIndex : null
        if (before === -1) return
        void save({ type: 'move', from, before }, false)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [main, domInSync, save]
  )

  // ---- menu actions -------------------------------------------------------
  const insertKind = (afterIndex: number, kind: BlockKind, domTag: string) => {
    setMenu(null)
    setHovered(null)
    void (async () => {
      await endSessionRef.current(true)
      const next = await save({ type: 'insert', afterIndex, kind }, false)
      // sql blocks own their editing UI — no text session to open
      if (next && kind !== 'sql') pendingEditRef.current = { index: afterIndex + 1, domTag }
    })()
  }

  const slashPick = (index: number, kind: BlockKind, domTag: string) => {
    setMenu(null)
    void (async () => {
      await endSessionRef.current(false) // discard the typed '/'
      const next = await save({ type: 'replaceBlock', index, kind }, false)
      if (next && kind !== 'sql') pendingEditRef.current = { index, domTag }
    })()
  }

  const deleteBlock = (index: number) => {
    setMenu(null)
    setHovered(null)
    setSelected(null)
    void (async () => {
      await endSessionRef.current(true)
      await save({ type: 'delete', index }, false)
    })()
  }

  const duplicateBlock = (index: number) => {
    setMenu(null)
    setHovered(null)
    setSelected(null)
    void (async () => {
      await endSessionRef.current(true)
      await save({ type: 'duplicate', index }, false)
    })()
  }

  // ---- render -------------------------------------------------------------
  let handles: { top: number; left: number } | null = null
  if (hovered !== null && page && !drag) {
    const el = blockElOf(main, hovered)
    if (el) {
      const mainRect = main.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      handles = {
        top: r.top - mainRect.top + main.scrollTop + 2,
        left: r.left - mainRect.left - 52,
      }
    }
  }

  // Notion-style blue highlight: on the selected block, or the grip-menu's block
  const highlightIx = selected ?? (menu?.kind === 'grip' ? menu.index : null)
  let highlight: { top: number; left: number; width: number; height: number } | null = null
  if (highlightIx !== null) {
    const el = blockElOf(main, highlightIx)
    if (el) {
      const mainRect = main.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      highlight = {
        top: r.top - mainRect.top + main.scrollTop - 3,
        left: r.left - mainRect.left - 6,
        width: r.width + 12,
        height: r.height + 6,
      }
    }
  }

  const statusLabel: Record<SaveStatus, string> = {
    saved: 'Saved',
    editing: 'Editing…',
    saving: 'Saving…',
  }
  const statusDot: Record<SaveStatus, string> = {
    saved: 'bg-emerald-500',
    editing: 'bg-amber-500',
    saving: 'bg-sky-500',
  }

  return createPortal(
    <>
      {/* save status — top right */}
      <div
        data-nb-ui
        className="fixed right-4 top-4 z-50 flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur"
      >
        <span className={`size-1.5 rounded-full ${statusDot[status]}`} />
        {statusLabel[status]}
      </div>

      {/* left-side handles */}
      {handles && hovered !== null && (
        <div
          data-nb-ui
          className="absolute z-40 flex items-center text-muted-foreground/70"
          style={{ top: handles.top, left: handles.left }}
        >
          <button
            title="Add block below"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              const mainRect = main.getBoundingClientRect()
              setMenu({
                kind: 'insert',
                afterIndex: hovered,
                x: e.clientX - mainRect.left,
                y: e.clientY - mainRect.top + main.scrollTop + 12,
              })
            }}
            className="flex size-6 items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
          <button
            title="Drag to move · click for actions"
            onPointerDown={(e) => {
              if (e.button === 0) beginDrag(hovered, e)
            }}
            onClick={(e) => {
              if (draggedRef.current) {
                draggedRef.current = false
                return // that was a drag, not a click
              }
              setSelected(hovered) // Notion-style: grip click selects the block
              const mainRect = main.getBoundingClientRect()
              setMenu({
                kind: 'grip',
                index: hovered,
                x: e.clientX - mainRect.left,
                y: e.clientY - mainRect.top + main.scrollTop + 12,
              })
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              const mainRect = main.getBoundingClientRect()
              setMenu({
                kind: 'grip',
                index: hovered,
                x: e.clientX - mainRect.left,
                y: e.clientY - mainRect.top + main.scrollTop + 4,
              })
            }}
            className="flex size-6 cursor-grab items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        </div>
      )}

      {/* drop indicator: horizontal for gaps, vertical for column drops */}
      {drag && drag.drop.kind === 'gap' && (
        <div
          data-nb-ui
          className="pointer-events-none absolute z-40 h-[3px] rounded-full bg-blue-400"
          style={{ top: drag.drop.y, left: drag.left, width: drag.width }}
        />
      )}
      {drag && drag.drop.kind === 'side' && (
        <div
          data-nb-ui
          className="pointer-events-none absolute z-40 w-[3px] rounded-full bg-blue-400"
          style={{ top: drag.drop.top, left: drag.drop.x, height: drag.drop.height }}
        />
      )}

      {/* block-type menu (+ or slash) */}
      {menu && menu.kind !== 'grip' && (
        <div
          data-nb-ui
          className="absolute z-50 w-44 rounded-lg border bg-popover p-1 shadow-lg"
          style={{ top: menu.y, left: menu.x }}
        >
          <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Blocks
          </div>
          {BLOCK_KINDS.map(({ kind, label, Icon, domTag }) => (
            <button
              key={kind}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                menu.kind === 'insert'
                  ? insertKind(menu.afterIndex, kind, domTag)
                  : slashPick(menu.index, kind, domTag)
              }
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <Icon className="size-4 text-muted-foreground" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* selection / grip-menu highlight */}
      {highlight && (
        <div
          data-nb-ui
          className="pointer-events-none absolute z-30 rounded-md bg-blue-500/15"
          style={highlight}
        />
      )}

      {/* grip menu */}
      {menu && menu.kind === 'grip' && (
        <div
          data-nb-ui
          className="absolute z-50 w-40 rounded-lg border bg-popover p-1 shadow-lg"
          style={{ top: menu.y, left: menu.x }}
        >
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => duplicateBlock(menu.index)}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
          >
            <CopyIcon className="size-4 text-muted-foreground" />
            Duplicate
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => deleteBlock(menu.index)}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-accent"
          >
            <Trash2 className="size-4" />
            Delete
            <span className="ml-auto text-[11px] text-muted-foreground">⌫</span>
          </button>
        </div>
      )}

      {toast && (
        <div
          data-nb-ui
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border bg-popover px-4 py-1.5 text-xs shadow-md"
        >
          {toast}
        </div>
      )}
    </>,
    main
  )
}
