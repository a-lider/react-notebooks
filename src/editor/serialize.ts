/**
 * Text editing happens in a contenteditable on the block's children
 * container. Inline JSX elements (<Stat/>, <Mention/>, <code>…) are
 * preserved as atomic, non-editable "islands": DOM element children map
 * to JSX element children by index (the same positional identity React
 * uses), and on commit each island re-emits its original source slice —
 * so an edit around an island never touches the island's code.
 */

/**
 * Prepare a container for editing: tag element children with their JSX
 * child index and make them atomic. Returns false when the DOM doesn't
 * structurally match the JSX (the safe bail-out: don't edit).
 */
export function makeEditable(container: HTMLElement, islandCount: number): boolean {
  const children = Array.from(container.children)
  if (children.length !== islandCount) return false
  children.forEach((child, i) => {
    child.setAttribute('data-ce-ix', String(i))
    child.setAttribute('contenteditable', 'false')
  })
  container.setAttribute('contenteditable', 'true')
  return true
}

function escapeJsxText(text: string): string {
  return text
    .replace(/\u00A0/g, ' ') // contenteditable inserts nbsp
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
}

/** Serialize the edited container back to JSX inner source. */
export function serializeInner(container: HTMLElement, islandSources: string[]): string {
  let out = ''
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += escapeJsxText(node.nodeValue ?? '')
    } else if (node instanceof HTMLElement) {
      const ix = node.getAttribute('data-ce-ix')
      if (ix !== null && islandSources[Number(ix)] !== undefined) {
        out += islandSources[Number(ix)]
      } else if (node.tagName === 'BR') {
        out += ' '
      } else {
        // pasted / browser-created wrapper — keep its text, drop the markup
        out += escapeJsxText(node.textContent ?? '')
      }
    }
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** Normalized text of an inner JSX source span, for "did anything change?" */
export function normalizeInner(innerSource: string): string {
  return innerSource.replace(/\s+/g, ' ').trim()
}
