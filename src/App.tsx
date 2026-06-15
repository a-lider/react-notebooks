import { useEffect, useReducer, useState } from 'react'
import { NotebookText, Share2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { pages } from './registry'
import { PageEditor } from './PageEditor'
import { RoomView } from './collab/RoomView'
import { createRoom } from './collab/client'
import { RELAY_HTTP } from './collab/config'

function usePath(): [string, (slug: string) => void] {
  const [path, setPath] = useState(() => decodeURIComponent(location.pathname.slice(1)))
  useEffect(() => {
    const onPop = () => setPath(decodeURIComponent(location.pathname.slice(1)))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = (slug: string) => {
    history.pushState(null, '', '/' + slug)
    setPath(slug)
  }
  return [path, navigate]
}

export default function App() {
  // Derive the room from the LIVE url every render (not mount-time state), so
  // an HMR re-render can't transiently drop room mode and strip ?room.
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    const onPop = () => bump()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const roomId = new URLSearchParams(window.location.search).get('room')
  if (roomId) {
    // share links are /<slug>?room=<id> — the slug lives in the path so the
    // page renders and <Query> can resolve its source; room mode = the local
    // editor + a room bar.
    const slug = decodeURIComponent(location.pathname.slice(1)) || pages[0]?.slug
    return (
      <RoomView
        roomId={roomId}
        slug={slug}
        onLeave={() => {
          history.pushState(null, '', '/' + slug)
          bump()
        }}
      />
    )
  }
  return <Workspace />
}

function Workspace() {
  const [path, navigate] = usePath()
  const [sharing, setSharing] = useState(false)
  const current = pages.find((p) => p.slug === path) ?? pages[0]

  // keep the URL canonical (e.g. '/' resolves to the first page)
  useEffect(() => {
    if (current && decodeURIComponent(location.pathname.slice(1)) !== current.slug) {
      history.replaceState(null, '', '/' + current.slug)
    }
  }, [current])

  const share = async () => {
    if (!current) return
    setSharing(true)
    try {
      const page = await (await fetch(`/__editor/page?slug=${encodeURIComponent(current.slug)}`)).json()
      const roomId = await createRoom(page.source)
      location.href = `/${current.slug}?room=${roomId}` // enter the room (full editor + room bar)
    } catch (e) {
      console.error('[share] failed', e)
      alert(`Share failed — is the relay running on ${RELAY_HTTP}?  (cd react-collab && npm run dev)`)
      setSharing(false)
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 px-4 py-4">
          <NotebookText className="size-4" />
          <span className="text-sm font-semibold tracking-tight">react-notebooks</span>
        </div>
        <ScrollArea className="flex-1 px-2">
          <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pages
          </div>
          <nav className="space-y-0.5">
            {pages.map((p) => (
              <button
                key={p.slug}
                onClick={() => navigate(p.slug)}
                className={[
                  'block w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  p.slug === current?.slug
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                ].join(' ')}
              >
                {p.title}
              </button>
            ))}
          </nav>
        </ScrollArea>
        <div className="border-t px-4 py-3 text-[11px] leading-5 text-muted-foreground">
          Pages are JSX files in <code className="font-mono">pages/</code>.
          <br />
          Add a file — it appears here.
        </div>
      </aside>

      <div className="relative flex flex-1 flex-col">
        {/* top-right row: editor save status (portaled into the slot) + Share */}
        <div className="fixed right-4 top-4 z-50 flex items-center gap-3">
          <span id="nb-status-slot" className="flex items-center" />
          <button
            onClick={share}
            disabled={sharing}
            title="Share this notebook to a live room"
            className="flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Share2 className="size-3.5" />
            {sharing ? 'Sharing…' : 'Share'}
          </button>
        </div>
        {current ? (
          <PageEditor slug={current.slug} />
        ) : (
          <div className="px-10 py-12 text-sm text-muted-foreground">
            No pages yet. Create one in <code className="font-mono">pages/</code>.
          </div>
        )}
      </div>
    </div>
  )
}
