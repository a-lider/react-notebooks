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

export type EditOp =
  | { type: 'replaceInner'; index: number; text: string }
  | { type: 'insert'; afterIndex: number; kind: 'p' | 'h2' | 'callout' }
  | { type: 'delete'; index: number }

export class StaleError extends Error {
  payload: PagePayload
  constructor(payload: PagePayload) {
    super('page changed on disk')
    this.payload = payload
  }
}

export async function fetchPage(slug: string): Promise<PagePayload> {
  const res = await fetch(`/__editor/page?slug=${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error(`editor server: ${res.status}`)
  return res.json() as Promise<PagePayload>
}

export async function applyOp(slug: string, hash: string, op: EditOp): Promise<PagePayload> {
  const res = await fetch('/__editor/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, hash, op }),
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
