import { lazy, Suspense, useEffect, useState } from 'react'
import { NotebookText, LayoutDashboard, Pencil, Eye } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { groups, pages } from './registry'
import { ErrorBoundary } from './ErrorBoundary'

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

export default function App() {
  const [path, navigate] = usePath()
  const [editMode, setEditMode] = useState(false)
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null)
  const current = pages.find((p) => p.slug === path) ?? pages[0]

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 px-4 py-4">
          <NotebookText className="size-4" />
          <span className="text-sm font-semibold tracking-tight">react-notebooks</span>
        </div>
        <ScrollArea className="flex-1 px-2">
          {groups.map((group) => (
            <div key={group} className="mb-4">
              <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group === 'Dashboards' && <LayoutDashboard className="size-3" />}
                {group}
              </div>
              <nav className="space-y-0.5">
                {pages
                  .filter((p) => p.group === group)
                  .map((p) => (
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
            </div>
          ))}
        </ScrollArea>
        <div className="border-t px-4 py-3 text-[11px] leading-5 text-muted-foreground">
          Pages are JSX files in <code className="font-mono">pages/</code>.
          <br />
          Add a file — it appears here.
        </div>
      </aside>

      <main ref={setMainEl} className="relative flex-1 overflow-y-auto">
        {import.meta.env.DEV && (
          <button
            onClick={() => setEditMode((v) => !v)}
            title={editMode ? 'Done editing' : 'Edit this page'}
            className={[
              'fixed right-4 top-4 z-50 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors',
              editMode
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {editMode ? <Eye className="size-3.5" /> : <Pencil className="size-3.5" />}
            {editMode ? 'Done' : 'Edit'}
          </button>
        )}
        {current ? (
          <ErrorBoundary resetKey={current.slug}>
            <Suspense
              fallback={
                <div className="px-10 py-12 text-sm text-muted-foreground">Loading page…</div>
              }
            >
              <current.Component />
            </Suspense>
            {import.meta.env.DEV && editMode && mainEl && (
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
