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
  | { t: 'insert'; parentPath: number[]; index: number; node: BlockNode }
  | { t: 'move'; from: number[]; toParentPath: number[]; toIndex: number }

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

/** The child array at a parent path ([] = root). Creates children if needed. */
function siblingsAt(blocks: BlockNode[], parentPath: number[]): BlockNode[] | null {
  if (parentPath.length === 0) return blocks
  const parent = nodeAt(blocks, parentPath)
  if (!parent) return null
  if (!parent.children) parent.children = []
  return parent.children
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max))

/** Apply an op against a block tree, returning a new tree (immutable). */
export function applyOp(blocks: BlockNode[], op: Op): BlockNode[] {
  const next = structuredClone(blocks)
  switch (op.t) {
    case 'setText': {
      const n = nodeAt(next, op.path)
      if (n) n.text = op.value
      return next
    }
    case 'setProp': {
      const n = nodeAt(next, op.path)
      if (n) n.props = { ...(n.props ?? {}), [op.key]: op.value }
      return next
    }
    case 'delete': {
      const sib = siblingsAt(next, op.path.slice(0, -1))
      const i = op.path[op.path.length - 1]
      if (sib && i >= 0 && i < sib.length) sib.splice(i, 1)
      return next
    }
    case 'insert': {
      const sib = siblingsAt(next, op.parentPath)
      if (sib) sib.splice(clamp(op.index, sib.length), 0, op.node)
      return next
    }
    case 'move': {
      const fromParent = op.from.slice(0, -1)
      const fromIdx = op.from[op.from.length - 1]
      const fromSib = siblingsAt(next, fromParent)
      if (!fromSib || fromIdx < 0 || fromIdx >= fromSib.length) return next
      const [node] = fromSib.splice(fromIdx, 1)
      const toSib = siblingsAt(next, op.toParentPath)
      if (!toSib) return next
      // removing from the same parent shifts later indices down by one
      let idx = op.toIndex
      if (samePath(fromParent, op.toParentPath) && fromIdx < idx) idx--
      toSib.splice(clamp(idx, toSib.length), 0, node)
      return next
    }
  }
}
