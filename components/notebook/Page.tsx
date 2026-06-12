import { useEffect, type ReactNode } from 'react'

interface PageProps {
  title: string
  /** 'document' for notebooks (prose width), 'wide' for dashboards. */
  layout?: 'document' | 'wide'
  children: ReactNode
}

/**
 * The root of every page. Owns typography so pages stay bare JSX:
 * plain h1/h2/p/ul/blockquote children are styled here, not in pages.
 */
export function Page({ title, layout = 'document', children }: PageProps) {
  useEffect(() => {
    document.title = `${title} · react-notebooks`
  }, [title])

  return (
    <article
      className={[
        'mx-auto px-8 py-10',
        layout === 'document' ? 'max-w-3xl' : 'max-w-6xl',
        'space-y-5',
        '[&>h1]:text-3xl [&>h1]:font-semibold [&>h1]:tracking-tight',
        '[&>h2]:mt-8 [&>h2]:text-xl [&>h2]:font-semibold [&>h2]:tracking-tight',
        '[&>h3]:mt-6 [&>h3]:text-lg [&>h3]:font-medium',
        '[&>p]:leading-7 [&>p]:text-[15px]',
        '[&>ul]:list-disc [&>ul]:pl-6 [&>ul]:text-[15px] [&>ul]:leading-7',
        '[&>ol]:list-decimal [&>ol]:pl-6 [&>ol]:text-[15px] [&>ol]:leading-7',
        '[&>blockquote]:border-l-2 [&>blockquote]:pl-4 [&>blockquote]:text-muted-foreground [&>blockquote]:italic',
      ].join(' ')}
    >
      {children}
    </article>
  )
}
