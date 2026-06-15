/**
 * Joins a room and holds its synced TSX source. Edits apply on server
 * confirmation: the relay echoes every edit (including your own) with the
 * authoritative version + source, so local and remote converge through one
 * path — we just adopt the source the relay sends. Stale base → reject, and
 * we resync to the relay's source (reject-and-refetch, the v2 model). The
 * source IS the state; there's nothing to merge.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Peer } from '@/packages/protocol'
import { CollabClient } from './client'

type Status = 'connecting' | 'connected' | 'closed' | 'error'

interface RoomState {
  source: string | null
  version: number
  status: Status
  peers: Peer[]
  self: string
}

export function useRoom(roomId: string) {
  const [state, setState] = useState<RoomState>({
    source: null,
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
      onWelcome: (source, version, self) => {
        versionRef.current = version
        setState((s) => ({ ...s, source, version, self }))
      },
      onEdit: (version, source) => {
        versionRef.current = version
        setState((s) => ({ ...s, version, source }))
      },
      onReject: (source, version) => {
        versionRef.current = version
        setState((s) => ({ ...s, source, version }))
      },
      onPresence: (peers) => setState((s) => ({ ...s, peers })),
    })
    clientRef.current = client
    return () => client.close()
  }, [roomId])

  const sendEdit = useCallback((source: string) => {
    clientRef.current?.sendEdit(versionRef.current, source)
  }, [])

  return { ...state, sendEdit }
}
