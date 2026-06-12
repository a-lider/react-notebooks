/**
 * The editor server: dev-only Vite middleware that parses pages with Babel
 * and applies structured edits as surgical, format-preserving splices to
 * the JSX source. Bytes outside the edited span never change.
 *
 *   GET  /__editor/page?slug=<slug>          → PagePayload
 *   POST /__editor/apply {slug, hash, op}    → PagePayload (fresh)
 *
 * Ops are index-based: client block order == AST block order == DOM order
 * (the same positional identity React itself uses). The `hash` guards
 * against applying ops to a file that changed under the client.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parse } from '@babel/parser'
import type * as t from '@babel/types'
import type { Plugin, ViteDevServer } from 'vite'

// ---------------------------------------------------------------------------
// Types shared with the client (kept in sync by hand — small surface)
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
}

export interface PagePayload {
  slug: string
  file: string
  source: string
  hash: string
  blocks: BlockInfo[]
}

export type EditOp =
  | { type: 'replaceInner'; index: number; text: string }
  | { type: 'insert'; afterIndex: number; kind: 'p' | 'h2' | 'callout' }
  | { type: 'delete'; index: number }

// ---------------------------------------------------------------------------
// Page parsing
// ---------------------------------------------------------------------------

const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'blockquote'])
/** Components that render {children} inside a [data-nb-children] container. */
const CONTAINER_COMPONENTS = new Set(['Note', 'Callout'])

const SNIPPETS: Record<'p' | 'h2' | 'callout', string> = {
  p: '<p>New paragraph — click to edit.</p>',
  h2: '<h2>New heading</h2>',
  callout: '<Callout>Something worth calling out.</Callout>',
}

function hashSource(source: string): string {
  return crypto.createHash('sha1').update(source).digest('hex').slice(0, 12)
}

function parseAst(source: string): t.File {
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

function extractBlocks(source: string): BlockInfo[] {
  const page = findPageElement(parseAst(source))
  if (!page) return []
  const children = page.children.filter((c): c is t.JSXElement => c.type === 'JSXElement')
  return children.map((el, index) => {
    const tag = jsxName(el)
    const inner: Span | null = el.closingElement
      ? { start: el.openingElement.end!, end: el.closingElement.start! }
      : null
    const elements = el.children
      .filter((c): c is t.JSXElement => c.type === 'JSXElement')
      .map((c) => ({ start: c.start!, end: c.end! }))
    return {
      index,
      tag,
      span: { start: el.start!, end: el.end! },
      inner,
      elements,
      editable: inner !== null && (TEXT_TAGS.has(tag) || CONTAINER_COMPONENTS.has(tag)),
    }
  })
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

function applyOp(source: string, blocks: BlockInfo[], op: EditOp): string {
  if (op.type === 'replaceInner') {
    const block = blocks[op.index]
    if (!block?.inner) throw new Error(`block ${op.index} is not text-editable`)
    return source.slice(0, block.inner.start) + op.text + source.slice(block.inner.end)
  }

  if (op.type === 'insert') {
    const block = blocks[op.afterIndex]
    if (!block) throw new Error(`no block at index ${op.afterIndex}`)
    const indent = indentOf(source, block.span.start)
    const lineEnd = source.indexOf('\n', block.span.end)
    const at = lineEnd === -1 ? block.span.end : lineEnd
    let next = source.slice(0, at) + `\n\n${indent}${SNIPPETS[op.kind]}` + source.slice(at)
    if (op.kind === 'callout') next = ensureNamedImport(next, 'Callout', '@/components/notebook')
    return next
  }

  // delete: remove the block's full lines plus one adjacent blank line
  const block = blocks[op.index]
  if (!block) throw new Error(`no block at index ${op.index}`)
  let from = lineStartOf(source, block.span.start)
  const lineEnd = source.indexOf('\n', block.span.end)
  let to = lineEnd === -1 ? source.length : lineEnd + 1
  const nextLineEnd = source.indexOf('\n', to)
  if (nextLineEnd !== -1 && source.slice(to, nextLineEnd).trim() === '') {
    to = nextLineEnd + 1 // swallow the blank line after
  } else {
    const prevLineStart = lineStartOf(source, from - 1)
    if (source.slice(prevLineStart, from).trim() === '') from = prevLineStart // …or before
  }
  return removeUnusedNamedImports(source.slice(0, from) + source.slice(to))
}

/** Add `name` to an existing named import from `from`, or add a new import. */
function ensureNamedImport(source: string, name: string, from: string): string {
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
function removeUnusedNamedImports(source: string): string {
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

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function payloadFor(slug: string, file: string, source: string): PagePayload {
  return { slug, file, source, hash: hashSource(source), blocks: extractBlocks(source) }
}

async function readBody(req: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}

export function notebookEditor(): Plugin {
  return {
    name: 'notebook-editor',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const pagesDir = path.resolve(server.config.root, 'pages')

      const resolvePage = (slug: unknown): { slug: string; file: string } | null => {
        if (typeof slug !== 'string' || !/^[\w-]+(\/[\w-]+)*$/.test(slug)) return null
        const file = path.resolve(pagesDir, `${slug}.tsx`)
        return file.startsWith(pagesDir + path.sep) ? { slug, file } : null
      }

      server.middlewares.use('/__editor', (req, res) => {
        const respond = (status: number, data: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        }

        void (async () => {
          const url = new URL(req.url ?? '/', 'http://localhost')

          if (req.method === 'GET' && url.pathname === '/page') {
            const page = resolvePage(url.searchParams.get('slug'))
            if (!page) return respond(400, { error: 'bad slug' })
            const source = await fs.readFile(page.file, 'utf8')
            return respond(200, payloadFor(page.slug, page.file, source))
          }

          if (req.method === 'POST' && url.pathname === '/apply') {
            const body = JSON.parse(await readBody(req)) as {
              slug?: string
              hash?: string
              op?: EditOp
            }
            const page = resolvePage(body.slug)
            if (!page || !body.op) return respond(400, { error: 'bad request' })

            const source = await fs.readFile(page.file, 'utf8')
            if (body.hash !== hashSource(source)) {
              return respond(409, { error: 'stale', payload: payloadFor(page.slug, page.file, source) })
            }
            const next = applyOp(source, extractBlocks(source), body.op)
            const tmp = page.file + '.tmp'
            await fs.writeFile(tmp, next, 'utf8')
            await fs.rename(tmp, page.file)
            return respond(200, payloadFor(page.slug, page.file, next))
          }

          respond(404, { error: 'not found' })
        })().catch((err: unknown) => {
          respond(500, { error: err instanceof Error ? err.message : String(err) })
        })
      })
    },
  }
}
