/**
 * The page registry: every .tsx file in pages/ becomes a route.
 * The file tree is the navigation — no router config, no manifest.
 * Everything is just a page; layout (columns, width) is the page's own
 * business, not a category.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

type PageModule = () => Promise<{ default: ComponentType }>

const modules = import.meta.glob('/pages/**/*.tsx') as Record<string, PageModule>

export interface PageEntry {
  /** URL path and identity, e.g. "signup-funnel" or "growth". */
  slug: string
  /** Sidebar label derived from the filename. */
  title: string
  Component: LazyExoticComponent<ComponentType>
}

function toTitle(slug: string): string {
  const name = slug.split('/').pop() ?? slug
  const words = name.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const pages: PageEntry[] = Object.entries(modules)
  .map(([file, loader]) => {
    const slug = file.replace(/^\/pages\//, '').replace(/\.tsx$/, '')
    return { slug, title: toTitle(slug), Component: lazy(loader) }
  })
  .sort((a, b) => a.title.localeCompare(b.title))
