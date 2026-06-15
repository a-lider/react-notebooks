import { lazy, Suspense, useState } from 'react'
import { pages } from './registry'
import { ErrorBoundary } from './ErrorBoundary'

// dev-only structured editor (vite-plugin-notebook-editor serves its API)
const EditorOverlay = lazy(() => import('./editor/EditorOverlay'))

/**
 * The page render + the editing overlay — the one editing experience, shared
 * by the local workspace and the shared room. Room mode is just this plus a
 * room bar; editing is identical because it IS the same editor (file-backed,
 * so two local tabs sync through the workspace file + live-reload).
 */
export function PageEditor({ slug }: { slug: string }) {
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null)
  const page = pages.find((p) => p.slug === slug) ?? pages[0]

  return (
    <main ref={setMainEl} className="relative flex-1 overflow-y-auto">
      {page ? (
        <ErrorBoundary resetKey={page.slug}>
          <Suspense
            fallback={<div className="px-10 py-12 text-sm text-muted-foreground">Loading page…</div>}
          >
            <page.Component />
          </Suspense>
          {import.meta.env.DEV && mainEl && (
            <Suspense fallback={null}>
              <EditorOverlay key={page.slug} slug={page.slug} main={mainEl} />
            </Suspense>
          )}
        </ErrorBoundary>
      ) : (
        <div className="px-10 py-12 text-sm text-muted-foreground">
          No pages yet. Create one in <code className="font-mono">pages/</code>.
        </div>
      )}
    </main>
  )
}
