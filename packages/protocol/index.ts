/**
 * @react-notebooks/protocol — the collaboration wire contract.
 *
 * Canonical, OSS-owned (MIT). The relay (react-collab) carries a kept-in-sync
 * mirror; this is the source of truth. Will be published when the protocol
 * stabilizes. v1: positional ops over a block-tree value + a version guard
 * (no CRDT, no session ids — see plans/sync-foundation.html).
 */

export const PROTOCOL_VERSION = 1

/** A node in the synced block tree — an RSC-shaped value, not source. */
export interface BlockNode {
  type: string // 'h1' | 'p' | 'Trend' | 'Columns' | ... (a component reference)
  text?: string // for text blocks (h1-h4, p, blockquote, Note, Callout)
  props?: Record<string, unknown> // literals; references encoded as { $ref: name }
  children?: BlockNode[] // for containers (Columns, Column)
}

export interface PageDoc {
  slug: string
  title: string
  blocks: BlockNode[]
}

/** Positional ops — addressed by a path of child indices (React-style). */
export type Op =
  | { t: 'setText'; path: number[]; value: string }
  | { t: 'setProp'; path: number[]; key: string; value: unknown }
  | { t: 'delete'; path: number[] }

export interface Peer {
  id: string
  user?: { name: string; color: string }
}

export type ClientMsg =
  | { type: 'join'; room: string; user?: Peer['user'] }
  | { type: 'op'; baseVersion: number; op: Op }
  | { type: 'presence'; user: Peer['user'] }

export type ServerMsg =
  | { type: 'welcome'; doc: PageDoc; version: number; protocol: number; self: string }
  | { type: 'op'; version: number; op: Op; by: string }
  | { type: 'reject'; reason: 'stale'; doc: PageDoc; version: number } // refetch + retry
  | { type: 'presence'; peers: Peer[] }
  | { type: 'error'; message: string }

// ---------------------------------------------------------------------------
// applyOp — pure, shared by the relay and every client so they converge.
// ---------------------------------------------------------------------------

function nodeAt(blocks: BlockNode[], path: number[]): BlockNode | null {
  let nodes = blocks
  let node: BlockNode | null = null
  for (const i of path) {
    node = nodes[i] ?? null
    if (!node) return null
    nodes = node.children ?? []
  }
  return node
}

/** Apply an op against a block tree, returning a new tree (immutable). */
export function applyOp(blocks: BlockNode[], op: Op): BlockNode[] {
  const next = structuredClone(blocks)
  if (op.t === 'delete') {
    const parentPath = op.path.slice(0, -1)
    const idx = op.path[op.path.length - 1]
    const siblings = parentPath.length ? (nodeAt(next, parentPath)?.children ?? null) : next
    if (siblings && idx >= 0 && idx < siblings.length) siblings.splice(idx, 1)
    return next
  }
  const node = nodeAt(next, op.path)
  if (!node) return next
  if (op.t === 'setText') node.text = op.value
  else if (op.t === 'setProp') node.props = { ...(node.props ?? {}), [op.key]: op.value }
  return next
}
