/**
 * The page registry: every .tsx file in pages/ becomes a route.
 * The file tree is the navigation — no router config, no manifest.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

type PageModule = () => Promise<{ default: ComponentType }>

const modules = import.meta.glob('/pages/**/*.tsx') as Record<string, PageModule>

export interface PageEntry {
  /** URL path and identity, e.g. "signup-funnel" or "dashboards/growth". */
  slug: string
  /** Sidebar label derived from the filename. */
  title: string
  /** Sidebar group derived from the folder: "Notebooks" or "Dashboards". */
  group: string
  Component: LazyExoticComponent<ComponentType>
}

function toTitle(slug: string): string {
  const name = slug.split('/').pop() ?? slug
  const words = name.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function toGroup(slug: string): string {
  const dir = slug.includes('/') ? slug.split('/')[0] : ''
  if (!dir) return 'Notebooks'
  return dir.charAt(0).toUpperCase() + dir.slice(1)
}

export const pages: PageEntry[] = Object.entries(modules)
  .map(([file, loader]) => {
    const slug = file.replace(/^\/pages\//, '').replace(/\.tsx$/, '')
    return {
      slug,
      title: toTitle(slug),
      group: toGroup(slug),
      Component: lazy(loader),
    }
  })
  .sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title))

export const groups: string[] = [...new Set(pages.map((p) => p.group))].sort((a, b) => {
  // Notebooks first, then everything else alphabetically
  if (a === 'Notebooks') return -1
  if (b === 'Notebooks') return 1
  return a.localeCompare(b)
})
