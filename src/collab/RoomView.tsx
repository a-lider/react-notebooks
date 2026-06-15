import { useState } from 'react'
import { Check, Copy, Link2, Users } from 'lucide-react'
import { useRoom } from './useRoom'
import { RoomPage } from './RoomPage'

/** The shared-notebook screen: a header bar + the synced page. */
export function RoomView({ roomId, onLeave }: { roomId: string; onLeave: () => void }) {
  const { doc, status, peers, sendOp } = useRoom(roomId)
  const [copied, setCopied] = useState(false)

  const shareUrl = `${location.origin}/?room=${roomId}`
  const copy = () => {
    void navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b px-4 py-2 text-sm">
        <Link2 className="size-4 text-muted-foreground" />
        <span className="font-medium">{doc?.title ?? 'Shared notebook'}</span>
        <span
          className={[
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            status === 'connected'
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : status === 'error' || status === 'closed'
                ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
          ].join(' ')}
        >
          {status}
        </span>

        <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
          <Users className="size-3.5" />
          {peers.length}
          <span className="ml-1 flex -space-x-1">
            {peers.slice(0, 6).map((p) => (
              <span
                key={p.id}
                title={p.user?.name}
                className="inline-block size-4 rounded-full border border-background"
                style={{ background: p.user?.color || 'var(--chart-2)' }}
              />
            ))}
          </span>
        </span>

        <button
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button
          onClick={onLeave}
          className="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Leave
        </button>
      </header>

      <main className="flex-1 overflow-y-auto">
        {doc ? (
          <RoomPage blocks={doc.blocks} editable={status === 'connected'} onOp={sendOp} />
        ) : (
          <div className="px-10 py-12 text-sm text-muted-foreground">
            {status === 'error' || status === 'closed'
              ? 'Could not reach the collaboration relay. Is it running on :8787?'
              : 'Joining room…'}
          </div>
        )}
      </main>
    </div>
  )
}
