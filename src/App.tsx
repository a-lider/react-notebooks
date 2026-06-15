import { lazy, Suspense, useEffect, useState } from 'react'
import { NotebookText, Share2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { pages } from './registry'
import { ErrorBoundary } from './ErrorBoundary'
import { RoomView } from './collab/RoomView'
import { createRoom } from './collab/client'
import { RELAY_HTTP } from './collab/config'

// dev-only structured editor (vite-plugin-notebook-editor serves its API)
const EditorOverlay = lazy(() => import('./editor/EditorOverlay'))

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

/** Track the ?room= param so opening a share link enters room mode. */
function useRoomParam(): [string | null, (id: string | null) => void] {
  const [room, setRoom] = useState(() => new URLSearchParams(location.search).get('room'))
  useEffect(() => {
    const onPop = () => setRoom(new URLSearchParams(location.search).get('room'))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const set = (id: string | null) => {
    history.pushState(null, '', id ? `/?room=${id}` : '/')
    setRoom(id)
  }
  return [room, set]
}

export default function App() {
  const [roomId, setRoomId] = useRoomParam()
  if (roomId) return <RoomView roomId={roomId} onLeave={() => setRoomId(null)} />
  return <Workspace />
}

function Workspace() {
  const [path, navigate] = usePath()
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null)
  const [sharing, setSharing] = useState(false)
  const current = pages.find((p) => p.slug === path) ?? pages[0]

  const share = async () => {
    if (!current) return
    setSharing(true)
    try {
      const doc = await (await fetch(`/__editor/doc?slug=${encodeURIComponent(current.slug)}`)).json()
      const roomId = await createRoom(doc)
      location.href = `/?room=${roomId}` // enter the room (and give a copyable link)
    } catch (e) {
      console.error('[share] failed', e)
      alert(`Share failed — is the relay running on ${RELAY_HTTP}?  (cd react-collab && npm run dev)`)
      setSharing(false)
    }
  }

  // keep the URL canonical (e.g. '/' resolves to the first page) — components
  // like <Query> derive the page slug from location.pathname
  useEffect(() => {
    if (current && decodeURIComponent(location.pathname.slice(1)) !== current.slug) {
      history.replaceState(null, '', '/' + current.slug)
    }
  }, [current])

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

      <main ref={setMainEl} className="relative flex-1 overflow-y-auto">
        <button
          onClick={share}
          disabled={sharing}
          title="Share this notebook to a live room"
          className="fixed right-4 top-4 z-50 flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Share2 className="size-3.5" />
          {sharing ? 'Sharing…' : 'Share'}
        </button>
        {current ? (
          <ErrorBoundary resetKey={current.slug}>
            <Suspense
              fallback={
                <div className="px-10 py-12 text-sm text-muted-foreground">Loading page…</div>
              }
            >
              <current.Component />
            </Suspense>
            {import.meta.env.DEV && mainEl && (
              <Suspense fallback={null}>
                <EditorOverlay key={current.slug} slug={current.slug} main={mainEl} />
              </Suspense>
            )}
          </ErrorBoundary>
        ) : (
          <div className="px-10 py-12 text-sm text-muted-foreground">
            No pages yet. Create one in <code className="font-mono">pages/</code>.
          </div>
        )}
      </main>
    </div>
  )
}
