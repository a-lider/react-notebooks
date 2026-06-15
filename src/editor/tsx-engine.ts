/**
 * The TSX engine — parse + splice for notebook pages, with no Node deps so it
 * runs in the browser as well as the dev server.
 *
 * The page's `.tsx` source is the source of truth. This module turns that
 * source into a renderable block tree (`extractDoc`), locates blocks by their
 * byte spans (`extractBlocks`), and applies structured edits back onto the
 * source text (`applyOp` / `applyEditOp`) — surgically, preserving everything
 * it doesn't touch. The dev plugin imports it server-side; the collab client
 * imports it to render and edit a room's source in the browser. One engine,
 * both sides, so the toolchain understands the format everywhere.
 */
import { parse } from '@babel/parser'
import type * as t from '@babel/types'
import type { BlockNode, PageDoc } from '../../packages/protocol'

// ---------------------------------------------------------------------------
// Types (shared with the client + the dev plugin)
// ---------------------------------------------------------------------------

export interface Span {
  start: number
  end: number
}

export interface BlockInfo {
  index: number
  tag: string
  span: Span
  /** Children region between the open/close tags; null when self-closing. */
  inner: Span | null
  /** Spans of JSXElement children, in order — the inline "islands". */
  elements: Span[]
  /** Whether in-place text editing is supported for this block. */
  editable: boolean
  /**
   * Span of the block's top-level unit: itself, or the <Columns> wrapper it
   * lives in. Top-level vertical moves anchor on this, never inside columns.
   */
  top: Span
}

export type BlockKind = 'p' | 'h2' | 'h3' | 'callout' | 'sql'

export type EditOp =
  | { type: 'replaceInner'; index: number; text: string }
  /**
   * Insert after a block, at its own level — inside its column when it lives
   * in one (Enter / + in a column stays in the column). With `topLevel`,
   * insert after the block's whole unit at the top level instead (click
   * below the page → full width, even when the last unit is a Columns).
   */
  | { type: 'insert'; afterIndex: number; kind: BlockKind; topLevel?: boolean }
  | { type: 'replaceBlock'; index: number; kind: BlockKind }
  | { type: 'delete'; index: number }
  | { type: 'move'; from: number; before: number | null }
  /** Move a block beside another at ITS level — into/within a column. */
  | { type: 'moveInto'; from: number; anchor: number; pos: 'before' | 'after' }
  /** Set a component prop to a template-literal value (e.g. a Query's sql). */
  | { type: 'setProp'; index: number; name: string; value: string }
  /** Drop a block beside another → wrap both in a 2-column layout. */
  | { type: 'columnize'; from: number; target: number; side: 'left' | 'right' }
  /**
   * Merge block[index] into block[index-1] (Backspace at start / Delete at
   * end). `prevText`/`text` carry unsaved live content; omitted = use disk.
   */
  | { type: 'mergeUp'; index: number; text?: string; prevText?: string }
  | { type: 'duplicate'; index: number }

// ---------------------------------------------------------------------------
// Page parsing
// ---------------------------------------------------------------------------

const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'blockquote'])
/** Components that render {children} inside a [data-nb-children] container. */
const CONTAINER_COMPONENTS = new Set(['Note', 'Callout'])

/** New blocks are empty; the editor opens them with a placeholder caret. */
const SNIPPETS: Record<BlockKind, string> = {
  p: '<p></p>',
  h2: '<h2></h2>',
  h3: '<h3></h3>',
  callout: '<Callout></Callout>',
  sql: '<Query sql={`SELECT event, COUNT(*) AS count\nFROM events\nGROUP BY event ORDER BY count DESC`} />',
}

/** Imports each snippet needs, added to the page when the block is created. */
const SNIPPET_IMPORTS: Partial<Record<BlockKind, { name: string; from: string }>> = {
  callout: { name: 'Callout', from: '@/components/notebook' },
  sql: { name: 'Query', from: '@/components/analytics' },
}

export function parseAst(source: string): t.File {
  return parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
}

function jsxName(el: t.JSXElement): string {
  const name = el.openingElement.name
  return name.type === 'JSXIdentifier' ? name.name : ''
}

function findPageElement(ast: t.File): t.JSXElement | null {
  for (const node of ast.program.body) {
    if (node.type !== 'ExportDefaultDeclaration') continue
    const decl = node.declaration
    let fnBody: t.BlockStatement | t.Expression | null = null
    if (decl.type === 'FunctionDeclaration') fnBody = decl.body
    else if (decl.type === 'ArrowFunctionExpression') fnBody = decl.body
    if (!fnBody) return null

    let returned: t.Node | null = null
    if (fnBody.type === 'BlockStatement') {
      for (const stmt of fnBody.body) {
        if (stmt.type === 'ReturnStatement' && stmt.argument) returned = stmt.argument
      }
    } else {
      returned = fnBody
    }
    if (returned?.type === 'JSXElement' && jsxName(returned) === 'Page') return returned
  }
  return null
}

/**
 * Blocks are a depth-first flattening: top-level page children, with
 * <Columns> wrappers transparent — their <Column> grandchildren's blocks
 * take the wrapper's place in the sequence. The flat index stays the only
 * identity; the same traversal order is mirrored client-side over the DOM.
 */
/** The flat element list in block order — single source of truth. */
function elementsInBlockOrder(page: t.JSXElement): { el: t.JSXElement; top: t.JSXElement }[] {
  const out: { el: t.JSXElement; top: t.JSXElement }[] = []
  for (const child of page.children) {
    if (child.type !== 'JSXElement') continue
    if (jsxName(child) === 'Columns') {
      for (const col of child.children) {
        if (col.type !== 'JSXElement' || jsxName(col) !== 'Column') continue
        for (const inner of col.children) {
          if (inner.type === 'JSXElement') out.push({ el: inner, top: child })
        }
      }
    } else {
      out.push({ el: child, top: child })
    }
  }
  return out
}

export function extractBlocks(source: string): BlockInfo[] {
  const page = findPageElement(parseAst(source))
  if (!page) return []
  const out: BlockInfo[] = []

  const push = (el: t.JSXElement, top: t.JSXElement) => {
    const tag = jsxName(el)
    const inner: Span | null = el.closingElement
      ? { start: el.openingElement.end!, end: el.closingElement.start! }
      : null
    const elements = el.children
      .filter((c): c is t.JSXElement => c.type === 'JSXElement')
      .map((c) => ({ start: c.start!, end: c.end! }))
    out.push({
      index: out.length,
      tag,
      span: { start: el.start!, end: el.end! },
      inner,
      elements,
      editable: inner !== null && (TEXT_TAGS.has(tag) || CONTAINER_COMPONENTS.has(tag)),
      top: { start: top.start!, end: top.end! },
    })
  }

  for (const { el, top } of elementsInBlockOrder(page)) push(el, top)
  return out
}

// ---------------------------------------------------------------------------
// Block-tree value — parse a page into a renderable tree (the render input).
// References (metric={signups}) become { $ref: name }; the client resolves
// them against the metrics registry. A throwaway view of the source, never a
// separate document.
// ---------------------------------------------------------------------------

const DOC_TEXT = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'blockquote'])
const DOC_CONTAINER = new Set(['Columns', 'Column'])
const DOC_TEXTBOX = new Set(['Note', 'Callout'])

function jsxInnerText(el: t.JSXElement): string {
  return el.children
    .filter((c): c is t.JSXText => c.type === 'JSXText')
    .map((c) => c.value)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function evalLiteral(node: t.Node | null | undefined): unknown {
  if (!node) return undefined
  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value
    case 'NullLiteral':
      return null
    case 'TemplateLiteral':
      return node.expressions.length === 0
        ? node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('')
        : undefined
    case 'ArrayExpression':
      return node.elements.map((e) => evalLiteral(e as t.Node))
    case 'ObjectExpression': {
      const obj: Record<string, unknown> = {}
      for (const p of node.properties) {
        if (p.type !== 'ObjectProperty') continue
        const k =
          p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null
        if (k !== null) obj[k] = evalLiteral(p.value as t.Node)
      }
      return obj
    }
    case 'Identifier':
      return { $ref: node.name } // a reference — resolved client-side
    default:
      return undefined
  }
}

function jsxPropsValue(el: t.JSXElement): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const a of el.openingElement.attributes) {
    if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier') continue
    const name = a.name.name
    if (!a.value) props[name] = true
    else if (a.value.type === 'StringLiteral') props[name] = a.value.value
    else if (a.value.type === 'JSXExpressionContainer') props[name] = evalLiteral(a.value.expression as t.Node)
  }
  return props
}

function toBlockNode(el: t.JSXElement): BlockNode | null {
  const type = jsxName(el)
  if (!type) return null
  if (DOC_CONTAINER.has(type)) {
    const children = el.children
      .filter((c): c is t.JSXElement => c.type === 'JSXElement')
      .map(toBlockNode)
      .filter((n): n is BlockNode => n !== null)
    return { type, children }
  }
  if (DOC_TEXTBOX.has(type)) return { type, props: jsxPropsValue(el), text: jsxInnerText(el) }
  if (DOC_TEXT.has(type)) return { type, text: jsxInnerText(el) }
  return { type, props: jsxPropsValue(el) } // a component (Trend, Query, …)
}

export function extractDoc(source: string, slug: string): PageDoc {
  const page = findPageElement(parseAst(source))
  let title = slug
  if (page) {
    const titleAttr = page.openingElement.attributes.find(
      (a): a is t.JSXAttribute =>
        a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'title'
    )
    if (titleAttr?.value?.type === 'StringLiteral') title = titleAttr.value.value
  }
  const blocks = page
    ? page.children
        .filter((c): c is t.JSXElement => c.type === 'JSXElement')
        .map(toBlockNode)
        .filter((n): n is BlockNode => n !== null)
    : []
  return { slug, title, blocks }
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

function lineStartOf(source: string, pos: number): number {
  return source.lastIndexOf('\n', pos - 1) + 1
}

function indentOf(source: string, pos: number): string {
  const ls = lineStartOf(source, pos)
  const m = /^[ \t]*/.exec(source.slice(ls, pos))
  return m ? m[0] : ''
}

/** The block's full lines: [line start, end of last line incl. newline). */
function blockLines(source: string, block: BlockInfo): Span {
  const start = lineStartOf(source, block.span.start)
  const lineEnd = source.indexOf('\n', block.span.end)
  return { start, end: lineEnd === -1 ? source.length : lineEnd + 1 }
}

/** Like blockLines, but for an arbitrary span. */
function spanLines(source: string, span: Span): Span {
  const start = lineStartOf(source, span.start)
  const lineEnd = source.indexOf('\n', span.end)
  return { start, end: lineEnd === -1 ? source.length : lineEnd + 1 }
}

/** Shift a chunk of full lines from one indentation level to another. */
function reindentChunk(chunk: string, oldIndent: string, newIndent: string): string {
  if (oldIndent === newIndent) return chunk
  return chunk
    .split('\n')
    .map((line) => {
      if (line.trim() === '') return line
      if (line.startsWith(oldIndent)) return newIndent + line.slice(oldIndent.length)
      return line
    })
    .join('\n')
}

/** Extend block lines with one adjacent blank line (after, else before). */
function blockLinesWithGap(source: string, block: BlockInfo): Span {
  const { start, end } = blockLines(source, block)
  const nextLineEnd = source.indexOf('\n', end)
  if (nextLineEnd !== -1 && source.slice(end, nextLineEnd).trim() === '') {
    return { start, end: nextLineEnd + 1 }
  }
  const prevLineStart = lineStartOf(source, start - 1)
  if (source.slice(prevLineStart, start).trim() === '') return { start: prevLineStart, end }
  return { start, end }
}

export function applyOp(source: string, blocks: BlockInfo[], op: EditOp): string {
  if (op.type === 'replaceInner') {
    const block = blocks[op.index]
    if (!block?.inner) throw new Error(`block ${op.index} is not text-editable`)
    return source.slice(0, block.inner.start) + op.text + source.slice(block.inner.end)
  }

  if (op.type === 'insert') {
    const block = blocks[op.afterIndex]
    if (!block) throw new Error(`no block at index ${op.afterIndex}`)
    const anchor = op.topLevel ? block.top : block.span
    const indent = indentOf(source, anchor.start)
    const lineEnd = source.indexOf('\n', anchor.end)
    const at = lineEnd === -1 ? anchor.end : lineEnd
    let next = source.slice(0, at) + `\n\n${indent}${SNIPPETS[op.kind]}` + source.slice(at)
    const imp = SNIPPET_IMPORTS[op.kind]
    if (imp) next = ensureNamedImport(next, imp.name, imp.from)
    return next
  }

  if (op.type === 'replaceBlock') {
    const block = blocks[op.index]
    if (!block) throw new Error(`no block at index ${op.index}`)
    let next =
      source.slice(0, block.span.start) + SNIPPETS[op.kind] + source.slice(block.span.end)
    const imp = SNIPPET_IMPORTS[op.kind]
    if (imp) next = ensureNamedImport(next, imp.name, imp.from)
    return removeUnusedNamedImports(next)
  }

  if (op.type === 'setProp') {
    // re-find the element's attribute via the AST and replace its value —
    // surgical, like every other op. Plain values become string attrs
    // (chart="bar"); multiline/awkward ones become template literals.
    const page = findPageElement(parseAst(source))
    const el = page ? elementsInBlockOrder(page)[op.index]?.el : undefined
    if (!el) throw new Error(`no block at index ${op.index}`)
    let literal: string
    if (/[\n"`\\]|\$\{/.test(op.value)) {
      const escaped = op.value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
      literal = `{\`${escaped}\`}`
    } else {
      literal = `"${op.value}"`
    }
    const attr = el.openingElement.attributes.find(
      (a): a is t.JSXAttribute => a.type === 'JSXAttribute' && a.name.name === op.name
    )
    if (attr?.value) {
      return source.slice(0, attr.value.start!) + literal + source.slice(attr.value.end!)
    }
    const at = el.openingElement.name.end!
    return source.slice(0, at) + ` ${op.name}=${literal}` + source.slice(at)
  }

  if (op.type === 'move') {
    const { from, before } = op
    const block = blocks[from]
    if (!block) throw new Error(`no block at index ${from}`)
    if (before === from) return source
    const lines = blockLines(source, block)
    const fromIndent = indentOf(source, block.span.start)
    const cut = blockLinesWithGap(source, block)

    // vertical moves land at the top level: anchor on the target's unit
    // (its <Columns> wrapper when it lives in one), never inside a column
    let at: number
    let destIndent: string
    if (before === null) {
      const lastTop = spanLines(source, blocks[blocks.length - 1].top)
      at = lastTop.end
      destIndent = indentOf(source, blocks[blocks.length - 1].top.start)
    } else {
      const target = blocks[before]
      if (!target) throw new Error(`no block at index ${before}`)
      at = lineStartOf(source, target.top.start)
      destIndent = indentOf(source, target.top.start)
    }
    const chunk = reindentChunk(source.slice(lines.start, lines.end), fromIndent, destIndent)
    const text = before === null ? '\n' + chunk : chunk + '\n'
    if (at <= cut.start) {
      return source.slice(0, at) + text + source.slice(at, cut.start) + source.slice(cut.end)
    }
    if (at < cut.end) return source // anchor inside the cut — degenerate, no-op
    return source.slice(0, cut.start) + source.slice(cut.end, at) + text + source.slice(at)
  }

  if (op.type === 'moveInto') {
    const fromB = blocks[op.from]
    const anchorB = blocks[op.anchor]
    if (!fromB || !anchorB) throw new Error('bad moveInto indexes')
    if (op.from === op.anchor) return source
    const lines = blockLines(source, fromB)
    const cut = blockLinesWithGap(source, fromB)
    const destIndent = indentOf(source, anchorB.span.start)
    const chunk = reindentChunk(
      source.slice(lines.start, lines.end),
      indentOf(source, fromB.span.start),
      destIndent
    )
    const anchorLines = blockLines(source, anchorB)
    const at = op.pos === 'before' ? anchorLines.start : anchorLines.end
    // anchor point swallowed by the cut → the block is already there; no-op
    if (at >= cut.start && at <= cut.end) return source
    const text = op.pos === 'before' ? chunk + '\n' : '\n' + chunk
    if (at <= cut.start) {
      return source.slice(0, at) + text + source.slice(at, cut.start) + source.slice(cut.end)
    }
    return source.slice(0, cut.start) + source.slice(cut.end, at) + text + source.slice(at)
  }

  if (op.type === 'columnize') {
    const fromB = blocks[op.from]
    const targetB = blocks[op.target]
    if (!fromB || !targetB) throw new Error('bad columnize indexes')
    if (op.from === op.target) return source
    if (targetB.top.start !== targetB.span.start) {
      throw new Error('columnize target must be a top-level block')
    }
    const indent = indentOf(source, targetB.span.start)
    const colIndent = indent + '  '
    const innerIndent = colIndent + '  '

    const fromLines = blockLines(source, fromB)
    const fromChunk = reindentChunk(
      source.slice(fromLines.start, fromLines.end),
      indentOf(source, fromB.span.start),
      innerIndent
    )
    const cut = blockLinesWithGap(source, fromB)
    const targetLines = blockLines(source, targetB)
    const targetChunk = reindentChunk(
      source.slice(targetLines.start, targetLines.end),
      indent,
      innerIndent
    )

    const [left, right] = op.side === 'left' ? [fromChunk, targetChunk] : [targetChunk, fromChunk]
    const wrapper =
      `${indent}<Columns>\n` +
      `${colIndent}<Column>\n${left}${colIndent}</Column>\n` +
      `${colIndent}<Column>\n${right}${colIndent}</Column>\n` +
      `${indent}</Columns>\n`

    const edits = [
      { start: targetLines.start, end: targetLines.end, text: wrapper },
      { start: cut.start, end: cut.end, text: '' },
    ].sort((a, b) => b.start - a.start)
    let next = source
    for (const e of edits) next = next.slice(0, e.start) + e.text + next.slice(e.end)
    next = ensureNamedImport(next, 'Columns', '@/components/notebook')
    next = ensureNamedImport(next, 'Column', '@/components/notebook')
    return next
  }

  if (op.type === 'duplicate') {
    const block = blocks[op.index]
    if (!block) throw new Error(`no block at index ${op.index}`)
    const lines = blockLines(source, block)
    const chunk = source.slice(lines.start, lines.end)
    return source.slice(0, lines.end) + '\n' + chunk + source.slice(lines.end)
  }

  if (op.type === 'mergeUp') {
    const block = blocks[op.index]
    const prev = blocks[op.index - 1]
    if (!block?.inner || !block.editable) throw new Error(`block ${op.index} is not mergeable`)
    if (!prev?.inner || !prev.editable) throw new Error(`block ${op.index - 1} is not mergeable`)
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
    const curText = op.text ?? norm(source.slice(block.inner.start, block.inner.end))
    const prevText = op.prevText ?? norm(source.slice(prev.inner.start, prev.inner.end))
    const merged = [prevText, curText].filter((x) => x !== '').join(' ')
    const cut = blockLinesWithGap(source, block) // entirely after prev — splice order safe
    const removed = source.slice(0, cut.start) + source.slice(cut.end)
    return removed.slice(0, prev.inner.start) + merged + removed.slice(prev.inner.end)
  }

  // delete
  const block = blocks[op.index]
  if (!block) throw new Error(`no block at index ${op.index}`)
  const cut = blockLinesWithGap(source, block)
  return removeUnusedNamedImports(source.slice(0, cut.start) + source.slice(cut.end))
}

/**
 * Notion-style column hygiene: drop empty <Column>s, unwrap a <Columns>
 * that has fewer than two columns left, remove empty wrappers entirely.
 * Runs after every structural op; iterates until stable.
 */
export function normalizeColumns(source: string): string {
  for (let pass = 0; pass < 10; pass++) {
    const page = findPageElement(parseAst(source))
    if (!page) return source
    let edited = false

    for (const child of page.children) {
      if (child.type !== 'JSXElement' || jsxName(child) !== 'Columns') continue
      const cols = child.children.filter(
        (c): c is t.JSXElement => c.type === 'JSXElement' && jsxName(c) === 'Column'
      )
      const wrapperSpan: Span = { start: child.start!, end: child.end! }
      const wrapperLines = spanLines(source, wrapperSpan)
      const wrapperIndent = indentOf(source, child.start!)

      const emptyCol = cols.find((c) => !c.children.some((cc) => cc.type === 'JSXElement'))
      if (emptyCol) {
        const lines = spanLines(source, { start: emptyCol.start!, end: emptyCol.end! })
        source = source.slice(0, lines.start) + source.slice(lines.end)
        edited = true
        break
      }
      if (cols.length === 0) {
        // only remove a wrapper that is truly empty — never drop stray
        // non-Column content an agent may have written inside
        if (!child.children.some((c) => c.type === 'JSXElement')) {
          source = source.slice(0, wrapperLines.start) + source.slice(wrapperLines.end)
          edited = true
          break
        }
        continue
      }
      if (cols.length === 1) {
        // unwrap: the surviving column's blocks return to the top level
        const blocksIn = cols[0].children.filter((c): c is t.JSXElement => c.type === 'JSXElement')
        const chunks = blocksIn.map((b) => {
          const lines = spanLines(source, { start: b.start!, end: b.end! })
          return reindentChunk(
            source.slice(lines.start, lines.end),
            indentOf(source, b.start!),
            wrapperIndent
          )
        })
        source = source.slice(0, wrapperLines.start) + chunks.join('\n') + source.slice(wrapperLines.end)
        edited = true
        break
      }
    }
    if (!edited) return source
  }
  return source
}

/** Add `name` to an existing named import from `from`, or add a new import. */
export function ensureNamedImport(source: string, name: string, from: string): string {
  const ast = parseAst(source)
  let lastImportEnd = 0
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue
    lastImportEnd = node.end!
    if (node.source.value !== from) continue
    const named = node.specifiers.filter((s): s is t.ImportSpecifier => s.type === 'ImportSpecifier')
    if (named.some((s) => s.local.name === name)) return source
    const last = named[named.length - 1]
    if (last) return source.slice(0, last.end!) + `, ${name}` + source.slice(last.end!)
  }
  return source.slice(0, lastImportEnd) + `\nimport { ${name} } from '${from}'` + source.slice(lastImportEnd)
}

/** Drop named imports from '@/...' whose name no longer appears in the body. */
export function removeUnusedNamedImports(source: string): string {
  const ast = parseAst(source)
  const imports = ast.program.body.filter(
    (n): n is t.ImportDeclaration => n.type === 'ImportDeclaration'
  )
  if (imports.length === 0) return source
  const bodyStart = Math.max(...imports.map((n) => n.end!))
  const body = source.slice(bodyStart)

  const cuts: Span[] = []
  for (const imp of imports) {
    if (!String(imp.source.value).startsWith('@/')) continue
    const named = imp.specifiers.filter((s): s is t.ImportSpecifier => s.type === 'ImportSpecifier')
    if (named.length === 0 || named.length !== imp.specifiers.length) continue
    const unused = named.filter((s) => !new RegExp(`\\b${s.local.name}\\b`).test(body))
    if (unused.length === named.length) {
      // whole import is dead — remove its line
      const from = lineStartOf(source, imp.start!)
      const lineEnd = source.indexOf('\n', imp.end!)
      cuts.push({ start: from, end: lineEnd === -1 ? source.length : lineEnd + 1 })
    } else {
      for (const spec of unused) {
        const i = named.indexOf(spec)
        cuts.push(
          i > 0
            ? { start: named[i - 1].end!, end: spec.end! }
            : { start: spec.start!, end: named[1].start! }
        )
      }
    }
  }
  let result = source
  for (const cut of cuts.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, cut.start) + result.slice(cut.end)
  }
  return result
}

/**
 * Apply one structured edit to a page's source and return the new source —
 * the browser-friendly entry point (parses, applies, and tidies columns the
 * same way the dev server's /__editor/apply does, so both sides agree).
 */
export function applyEditOp(source: string, op: EditOp): string {
  let next = applyOp(source, extractBlocks(source), op)
  if (op.type !== 'replaceInner' && op.type !== 'setProp') {
    const normalized = normalizeColumns(next)
    if (normalized !== next) next = removeUnusedNamedImports(normalized)
  }
  return next
}
