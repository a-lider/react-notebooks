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
}

export interface PagePayload {
  slug: string
  file: string
  source: string
  hash: string
  blocks: BlockInfo[]
}

export type BlockKind = 'p' | 'h2' | 'h3' | 'callout'

export type EditOp =
  | { type: 'replaceInner'; index: number; text: string }
  | { type: 'insert'; afterIndex: number; kind: BlockKind }
  | { type: 'replaceBlock'; index: number; kind: BlockKind }
  | { type: 'delete'; index: number }
  | { type: 'move'; from: number; before: number | null }
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
