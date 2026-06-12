/** Client for the dev-only editor server (vite-plugin-notebook-editor). */

export interface Span {
  start: number
  end: number
}

export interface BlockInfo {
  index: number
  tag: string
  span: Span
  inner: Span | null
  elements: Span[]
  editable: boolean
  /** Span of the block's top-level unit (its Columns wrapper when inside one). */
  top: Span
}

export interface PagePayload {
  slug: string
  file: string
  source: string
  hash: string
  blocks: BlockInfo[]
  canUndo: boolean
  canRedo: boolean
}

export type BlockKind = 'p' | 'h2' | 'h3' | 'callout' | 'sql'

export type EditOp =
  | { type: 'replaceInner'; index: number; text: string }
  | { type: 'insert'; afterIndex: number; kind: BlockKind; topLevel?: boolean }
  | { type: 'replaceBlock'; index: number; kind: BlockKind }
  | { type: 'delete'; index: number }
  | { type: 'move'; from: number; before: number | null }
  | { type: 'setProp'; index: number; name: string; value: string }
  | { type: 'columnize'; from: number; target: number; side: 'left' | 'right' }
  | { type: 'mergeUp'; index: number; text?: string; prevText?: string }
  | { type: 'duplicate'; index: number }

export class StaleError extends Error {
  payload: PagePayload
  constructor(payload: PagePayload) {
    super('page changed on disk')
    this.payload = payload
  }
}

export async function fetchPage(slug: string): Promise<PagePayload> {
  const res = await fetch(`/__editor/page?slug=${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`editor server: ${res.status}`)
  return res.json() as Promise<PagePayload>
}

/**
 * Apply one op. `defer: true` (autosave while typing) writes the file but
 * holds back its HMR update so the block under the caret isn't re-rendered;
 * call flushPage() when the edit session ends.
 */
export async function applyOp(
  slug: string,
  hash: string,
  op: EditOp,
  defer = false
): Promise<PagePayload> {
  const res = await fetch('/__editor/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, hash, op, defer }),
  })
  if (res.status === 409) {
    const body = (await res.json()) as { payload: PagePayload }
    throw new StaleError(body.payload)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
    throw new Error(body.error ?? `editor server: ${res.status}`)
  }
  return res.json() as Promise<PagePayload>
}

export async function flushPage(slug: string): Promise<void> {
  await fetch('/__editor/flush', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  })
}

export interface HistoryResult {
  ok: boolean
  reason?: 'empty' | 'stale'
  payload: PagePayload
  focusBlock?: number
  label?: string
}

/**
 * Step the workspace history (.notebooks/history/<slug>.json) one entry
 * back or forward. The server validates the entry's hash against the file
 * and declines (never rebases) when they diverge.
 */
export async function historyStep(slug: string, kind: 'undo' | 'redo'): Promise<HistoryResult> {
  const res = await fetch(`/__editor/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  })
  if (!res.ok) throw new Error(`editor server: ${res.status}`)
  return res.json() as Promise<HistoryResult>
}
