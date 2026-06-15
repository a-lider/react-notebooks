import { useState } from 'react'
import { Check, Copy, Users } from 'lucide-react'
import { useRoom } from './useRoom'
import { PageEditor } from '../PageEditor'

/**
 * Shared mode = the exact local editing experience, plus a room bar.
 * Editing is the real file-backed editor (so every gesture works and looks
 * identical); two local tabs sync through the shared workspace file +
 * live-reload. The relay provides presence + the link (and carries edits to
 * remote peers later).
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
  const { status, peers } = useRoom(roomId)
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
        {/* the editor's save status portals in here */}
        <span id="nb-status-slot" className="flex items-center" />

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

      <PageEditor slug={slug} />
    </div>
  )
}
