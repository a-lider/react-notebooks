import { useEffect, type ReactNode } from 'react'
import { TEXT_STYLES } from './styles'

interface PageProps {
  title: string
  /** 'document' (prose width, default) or 'wide'. */
  layout?: 'document' | 'wide'
  children: ReactNode
}

/** The root of every page. Owns typography so pages stay bare JSX. */
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
        TEXT_STYLES,
      ].join(' ')}
    >
      {children}
    </article>
  )
}
