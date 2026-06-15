/**
 * CollabClient — the WebSocket half of the room, talking the protocol to the
 * relay. A thin transport; the hook (useRoom) holds the source + version. The
 * synced value is the page's TSX source.
 */
import { RELAY_HTTP, RELAY_WS } from './config'
import type { ClientMsg, Peer, ServerMsg } from '@/packages/protocol'

export interface RoomHandlers {
  onWelcome: (source: string, version: number, self: string) => void
  onEdit: (version: number, source: string, by: string) => void
  onReject: (source: string, version: number) => void
  onPresence: (peers: Peer[]) => void
  onStatus: (status: 'connecting' | 'connected' | 'closed' | 'error') => void
}

const NAMES = ['Otter', 'Heron', 'Lynx', 'Wren', 'Fox', 'Ibis', 'Vole', 'Stoat']

/** Seed a room from a page's TSX source; returns the new room id. */
export async function createRoom(source: string): Promise<string> {
  const res = await fetch(`${RELAY_HTTP}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  if (!res.ok) throw new Error(`relay: ${res.status}`)
  const { roomId } = (await res.json()) as { roomId: string }
  return roomId
}

export class CollabClient {
  private ws: WebSocket
  private h: RoomHandlers
  private queue: ClientMsg[] = []
  private open = false
  constructor(roomId: string, handlers: RoomHandlers) {
    this.h = handlers
    this.h.onStatus('connecting')
    this.ws = new WebSocket(RELAY_WS)
    const user = { name: NAMES[Math.floor(Math.random() * NAMES.length)], color: '' }
    this.ws.onopen = () => {
      this.open = true
      this.raw({ type: 'join', room: roomId, user })
      for (const m of this.queue) this.raw(m) // flush anything sent before connect
      this.queue = []
    }
    this.ws.onclose = () => this.h.onStatus('closed')
    this.ws.onerror = () => this.h.onStatus('error')
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data as string) as ServerMsg
      switch (m.type) {
        case 'welcome':
          this.h.onStatus('connected')
          this.h.onWelcome(m.source, m.version, m.self)
          break
        case 'edit':
          this.h.onEdit(m.version, m.source, m.by)
          break
        case 'reject':
          this.h.onReject(m.source, m.version)
          break
        case 'presence':
          this.h.onPresence(m.peers)
          break
        case 'error':
          console.warn('[collab] relay error:', m.message)
          break
      }
    }
  }

  private raw(msg: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  /** Queue until the socket is open, then flush — no silently-dropped edits. */
  private send(msg: ClientMsg) {
    if (this.open) this.raw(msg)
    else this.queue.push(msg)
  }

  /** Submit a new full source, based on the version we last saw. */
  sendEdit(baseVersion: number, source: string) {
    this.send({ type: 'edit', baseVersion, source })
  }

  close() {
    this.ws.close()
  }
}
