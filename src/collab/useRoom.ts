/**
 * Joins a room and holds its synced doc. Ops apply on server confirmation
 * (the relay echoes every op, including your own, with the authoritative
 * version) — so local and remote converge through one path. Stale base →
 * the relay rejects and we resync (reject-and-refetch, the v1 concurrency
 * model). No optimistic apply, no double-apply.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { applyOp, type Op, type PageDoc, type Peer } from '@/packages/protocol'
import { CollabClient } from './client'

type Status = 'connecting' | 'connected' | 'closed' | 'error'

interface RoomState {
  doc: PageDoc | null
  version: number
  status: Status
  peers: Peer[]
  self: string
}

export function useRoom(roomId: string) {
  const [state, setState] = useState<RoomState>({
    doc: null,
    version: 0,
    status: 'connecting',
    peers: [],
    self: '',
  })
  const clientRef = useRef<CollabClient | null>(null)
  const versionRef = useRef(0)

  useEffect(() => {
    const client = new CollabClient(roomId, {
      onStatus: (status) => setState((s) => ({ ...s, status })),
      onWelcome: (doc, version, self) => {
        versionRef.current = version
        setState((s) => ({ ...s, doc, version, self }))
      },
      onOp: (version, op) => {
        versionRef.current = version
        setState((s) => (s.doc ? { ...s, version, doc: { ...s.doc, blocks: applyOp(s.doc.blocks, op) } } : s))
      },
      onReject: (doc, version) => {
        versionRef.current = version
        setState((s) => ({ ...s, doc, version }))
      },
      onPresence: (peers) => setState((s) => ({ ...s, peers })),
    })
    clientRef.current = client
    return () => client.close()
  }, [roomId])

  const sendOp = useCallback((op: Op) => {
    clientRef.current?.sendOp(versionRef.current, op)
  }, [])

  return { ...state, sendOp }
}
