/**
 * @react-notebooks/protocol — the collaboration wire contract.
 *
 * Canonical, OSS-owned (MIT). The relay (react-collab) carries a kept-in-sync
 * mirror; this is the source of truth. Will be published when it stabilizes.
 *
 * v2: the synced value is the page's TSX source — the same file that's the
 * source of truth locally, carried verbatim. An edit ships { baseVersion,
 * source }; the relay version-guards (stale base → reject + refetch) and
 * broadcasts { version, source }. No block-JSON document, no per-node ops, no
 * Babel on the wire — clients parse/splice/render with the TSX engine. The
 * slug stays off the wire: a client knows it from the room URL (/<slug>?room=).
 */

export const PROTOCOL_VERSION = 2

export interface Peer {
  id: string
  user?: { name: string; color: string }
}

export type ClientMsg =
  | { type: 'join'; room: string; user?: Peer['user'] }
  | { type: 'edit'; baseVersion: number; source: string }
  | { type: 'presence'; user: Peer['user'] }

export type ServerMsg =
  | { type: 'welcome'; source: string; version: number; protocol: number; self: string }
  | { type: 'edit'; version: number; source: string; by: string }
  | { type: 'reject'; reason: 'stale'; source: string; version: number } // refetch + retry
  | { type: 'presence'; peers: Peer[] }
  | { type: 'error'; message: string }
