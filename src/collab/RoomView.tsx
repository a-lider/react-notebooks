import { useState } from 'react'
import { Check, Copy, Users } from 'lucide-react'
import { useRoom } from './useRoom'
import { RenderDoc } from './RenderDoc'

/**
 * Shared mode = the notebook rendered from the relay's block tree (SDUI), with
 * a room bar. Editing emits protocol ops over the relay, so a remote peer with
 * no repo / file / dev server can render and edit — the relay is the edit
 * transport, not the local file. (The local Workspace still uses the
 * file-backed editor; this is the cloud path.)
 */
export function RoomView({
  roomId,
  slug,
  onLeave,
}: {
  roomId: string
  slug: string
  onLeave: () => void
}) {
  const { status, peers, source, sendEdit } = useRoom(roomId)
  const [copied, setCopied] = useState(false)

  const shareUrl = `${location.origin}/${slug}?room=${roomId}`
  const copy = () => {
    void navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-2.5 border-b px-4 py-2 text-sm">
        <span
          className={[
            'rounded-full px-2.5 py-0.5 text-[11px] font-medium',
            status === 'connected'
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : status === 'error' || status === 'closed'
                ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
          ].join(' ')}
        >
          {status}
        </span>
        <span className="text-muted-foreground">{slug}</span>

        <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
          <Users className="size-3.5" />
          {peers.length}
          <span className="ml-1 flex -space-x-1.5">
            {peers.slice(0, 6).map((p) => (
              <span
                key={p.id}
                title={p.user?.name}
                className="inline-block size-4 rounded-full border-2 border-background"
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
        {source !== null ? (
          <RenderDoc
            source={source}
            slug={slug}
            sendEdit={sendEdit}
            editable={status === 'connected'}
          />
        ) : (
          <div className="px-10 py-12 text-sm text-muted-foreground">
            {status === 'error' || status === 'closed'
              ? 'Could not reach the room. Is the relay running?'
              : 'Joining the room…'}
          </div>
        )}
      </main>
    </div>
  )
}
