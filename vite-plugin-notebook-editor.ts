/**
 * The editor server: dev-only Vite middleware that parses pages with Babel
 * and applies structured edits as surgical, format-preserving splices to
 * the JSX source. Bytes outside the edited span never change.
 *
 *   GET  /__editor/page?slug=<slug>          → PagePayload
 *   POST /__editor/apply {slug, hash, op, defer} → PagePayload (fresh)
 *   POST /__editor/flush {slug}              → releases deferred HMR
 *
 * Autosave (`defer: true`) writes the file but suppresses its HMR update —
 * otherwise every debounced save would re-render the block under the
 * user's caret. When the edit session ends the client flushes, and the
 * queued HMR update fires once.
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
  canUndo: boolean
  canRedo: boolean
}

export type BlockKind = 'p' | 'h2' | 'h3' | 'callout'

export type EditOp =
  | { type: 'replaceInner'; index: number; text: string }
  | { type: 'insert'; afterIndex: number; kind: BlockKind }
  | { type: 'replaceBlock'; index: number; kind: BlockKind }
  | { type: 'delete'; index: number }
  | { type: 'move'; from: number; before: number | null }
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

/** The block's full lines: [line start, end of last line incl. newline). */
function blockLines(source: string, block: BlockInfo): Span {
  const start = lineStartOf(source, block.span.start)
  const lineEnd = source.indexOf('\n', block.span.end)
  return { start, end: lineEnd === -1 ? source.length : lineEnd + 1 }
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

  if (op.type === 'replaceBlock') {
    const block = blocks[op.index]
    if (!block) throw new Error(`no block at index ${op.index}`)
    let next =
      source.slice(0, block.span.start) + SNIPPETS[op.kind] + source.slice(block.span.end)
    if (op.kind === 'callout') next = ensureNamedImport(next, 'Callout', '@/components/notebook')
    return removeUnusedNamedImports(next)
  }

  if (op.type === 'move') {
    const { from, before } = op
    const block = blocks[from]
    if (!block) throw new Error(`no block at index ${from}`)
    if (before === from) return source
    const lines = blockLines(source, block)
    const chunk = source.slice(lines.start, lines.end)
    const cut = blockLinesWithGap(source, block)

    let at: number
    let text: string
    if (before === null) {
      const last = blockLines(source, blocks[blocks.length - 1])
      at = last.end
      text = '\n' + chunk
    } else {
      const target = blocks[before]
      if (!target) throw new Error(`no block at index ${before}`)
      at = lineStartOf(source, target.span.start)
      text = chunk + '\n'
    }
    if (at <= cut.start) {
      return source.slice(0, at) + text + source.slice(at, cut.start) + source.slice(cut.end)
    }
    return source.slice(0, cut.start) + source.slice(cut.end, at) + text + source.slice(at)
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
    const merged = [prevText, curText].filter((t) => t !== '').join(' ')
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
// Undo history — state lives in the workspace (.notebooks/history/<slug>.json,
// gitignored), the process stays amnesiac: read file, mutate, write, forget.
// Entries are diff-like inverse splices; hash guards make them exact — a
// stale entry declines instead of rebasing.
// ---------------------------------------------------------------------------

export interface UndoEntry {
  /** Forward splice: at `at`, `removed` was replaced by `inserted`. */
  at: number
  removed: string
  inserted: string
  baseHash: string
  resultHash: string
  label: string
  /** Block to focus after undoing this entry. */
  block: number
  ts: number
}

interface HistoryFile {
  entries: UndoEntry[]
  /** entries[0..cursor) are undoable; entries[cursor..) are redoable. */
  cursor: number
}

const HISTORY_CAP = 200
/** A pause longer than this starts a new typing-burst undo unit. */
const COALESCE_WINDOW_MS = 5_000

/** Common prefix/suffix trim → one exact splice between two texts. */
function spliceDiff(before: string, after: string): { at: number; removed: string; inserted: string } {
  let p = 0
  const minLen = Math.min(before.length, after.length)
  while (p < minLen && before[p] === after[p]) p++
  let endB = before.length
  let endA = after.length
  while (endB > p && endA > p && before[endB - 1] === after[endA - 1]) {
    endB--
    endA--
  }
  return { at: p, removed: before.slice(p, endB), inserted: after.slice(p, endA) }
}

function applySplice(text: string, at: number, removeLen: number, insert: string): string {
  return text.slice(0, at) + insert + text.slice(at + removeLen)
}

async function readHistory(histFile: string): Promise<HistoryFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(histFile, 'utf8')) as HistoryFile
    if (Array.isArray(parsed.entries) && typeof parsed.cursor === 'number') return parsed
  } catch {
    // missing or corrupted — scratch state, start fresh; the page is never at risk
  }
  return { entries: [], cursor: 0 }
}

async function writeHistory(histFile: string, h: HistoryFile): Promise<void> {
  await fs.mkdir(path.dirname(histFile), { recursive: true })
  const tmp = histFile + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(h), 'utf8')
  await fs.rename(tmp, histFile)
}

function focusBlockFor(op: EditOp): number {
  switch (op.type) {
    case 'insert':
      return op.afterIndex
    case 'move':
      return op.from
    case 'mergeUp':
      return op.index - 1
    default:
      return op.index
  }
}

function recordEntry(h: HistoryFile, before: string, after: string, op: EditOp, defer: boolean): void {
  const d = spliceDiff(before, after)
  if (d.removed === '' && d.inserted === '') return
  h.entries = h.entries.slice(0, h.cursor) // any new edit truncates the redo tail
  const last = h.entries[h.entries.length - 1]
  const beforeHash = hashSource(before)

  if (
    defer &&
    op.type === 'replaceInner' &&
    last?.label === 'typing' &&
    last.block === op.index &&
    last.resultHash === beforeHash && // contiguous: nothing happened in between
    Date.now() - last.ts < COALESCE_WINDOW_MS
  ) {
    // same burst — recompute one splice against the burst's original text
    const burstBefore = applySplice(before, last.at, last.inserted.length, last.removed)
    const d2 = spliceDiff(burstBefore, after)
    Object.assign(last, d2, { resultHash: hashSource(after), ts: Date.now() })
  } else {
    h.entries.push({
      ...d,
      baseHash: beforeHash,
      resultHash: hashSource(after),
      label: op.type === 'replaceInner' ? 'typing' : op.type,
      block: focusBlockFor(op),
      ts: Date.now(),
    })
  }
  if (h.entries.length > HISTORY_CAP) h.entries.shift()
  h.cursor = h.entries.length
}

/** Which block contains a splice offset — focus target for external entries. */
function blockAtOffset(source: string, at: number): number {
  const blocks = extractBlocks(source)
  const hit = blocks.find((b) => at >= b.span.start && at <= b.span.end)
  return hit?.index ?? 0
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function payloadFor(slug: string, file: string, source: string, h?: HistoryFile): PagePayload {
  return {
    slug,
    file,
    source,
    hash: hashSource(source),
    blocks: extractBlocks(source),
    canUndo: !!h && h.cursor > 0,
    canRedo: !!h && h.cursor < h.entries.length,
  }
}

async function readBody(req: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}

const SUPPRESS_TTL_MS = 30_000

export function notebookEditor(): Plugin {
  /** Files whose HMR is deferred while an edit session autosaves into them. */
  const suppressed = new Map<string, number>()
  let devServer: ViteDevServer | null = null

  return {
    name: 'notebook-editor',
    apply: 'serve',

    handleHotUpdate(ctx) {
      const at = suppressed.get(ctx.file)
      if (at !== undefined && Date.now() - at < SUPPRESS_TTL_MS) return []
      suppressed.delete(ctx.file)
    },

    configureServer(server: ViteDevServer) {
      devServer = server
      const pagesDir = path.resolve(server.config.root, 'pages')
      const historyDir = path.resolve(server.config.root, '.notebooks/history')

      const resolvePage = (slug: unknown): { slug: string; file: string } | null => {
        if (typeof slug !== 'string' || !/^[\w-]+(\/[\w-]+)*$/.test(slug)) return null
        const file = path.resolve(pagesDir, `${slug}.tsx`)
        return file.startsWith(pagesDir + path.sep) ? { slug, file } : null
      }

      const historyFileFor = (slug: string) => path.resolve(historyDir, `${slug}.json`)

      /**
       * Last content of each page the plugin has seen (read or written).
       * Ephemeral bookkeeping, not state: lets the watcher tell our writes
       * apart from foreign ones and gives external diffs their `before`.
       */
      const lastSeen = new Map<string, string>()

      const writePage = async (file: string, content: string) => {
        const tmp = file + '.tmp'
        await fs.writeFile(tmp, content, 'utf8')
        await fs.rename(tmp, file)
        lastSeen.set(file, content)
      }

      const releaseHmr = async (file: string) => {
        if (!suppressed.delete(file) || !devServer) return
        for (const mod of devServer.moduleGraph.getModulesByFile(file) ?? []) {
          await devServer.reloadModule(mod)
        }
      }

      // Foreign writes (agent, IDE) become undoable 'external' history entries.
      // Runs in the local process, so it works even with no tab open.
      server.watcher.on('change', (file: string) => {
        if (!file.startsWith(pagesDir + path.sep) || !file.endsWith('.tsx')) return
        void (async () => {
          const content = await fs.readFile(file, 'utf8')
          const prev = lastSeen.get(file)
          lastSeen.set(file, content)
          if (prev === undefined || prev === content) return // our write, or unknown base
          const slug = path.relative(pagesDir, file).replace(/\.tsx$/, '')
          const histFile = historyFileFor(slug)
          const h = await readHistory(histFile)
          const d = spliceDiff(prev, content)
          if (d.removed === '' && d.inserted === '') return
          h.entries = h.entries.slice(0, h.cursor)
          h.entries.push({
            ...d,
            baseHash: hashSource(prev),
            resultHash: hashSource(content),
            label: 'external',
            block: blockAtOffset(content, d.at),
            ts: Date.now(),
          })
          if (h.entries.length > HISTORY_CAP) h.entries.shift()
          h.cursor = h.entries.length
          await writeHistory(histFile, h)
        })().catch(() => {})
      })

      server.middlewares.use('/__editor', (req, res) => {
        const respond = (status: number, data: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store') // stale payloads break hash guards
          res.end(JSON.stringify(data))
        }

        void (async () => {
          const url = new URL(req.url ?? '/', 'http://localhost')

          if (req.method === 'GET' && url.pathname === '/page') {
            const page = resolvePage(url.searchParams.get('slug'))
            if (!page) return respond(400, { error: 'bad slug' })
            const source = await fs.readFile(page.file, 'utf8')
            lastSeen.set(page.file, source)
            const h = await readHistory(historyFileFor(page.slug))
            return respond(200, payloadFor(page.slug, page.file, source, h))
          }

          if (req.method === 'POST' && url.pathname === '/apply') {
            const body = JSON.parse(await readBody(req)) as {
              slug?: string
              hash?: string
              op?: EditOp
              defer?: boolean
            }
            const page = resolvePage(body.slug)
            if (!page || !body.op) return respond(400, { error: 'bad request' })

            const source = await fs.readFile(page.file, 'utf8')
            if (body.hash !== hashSource(source)) {
              lastSeen.set(page.file, source)
              const h = await readHistory(historyFileFor(page.slug))
              return respond(409, { error: 'stale', payload: payloadFor(page.slug, page.file, source, h) })
            }
            const next = applyOp(source, extractBlocks(source), body.op)

            if (body.defer) suppressed.set(page.file, Date.now())
            else suppressed.delete(page.file)

            // history rides in the same request as the page write — transactional
            const histFile = historyFileFor(page.slug)
            const h = await readHistory(histFile)
            recordEntry(h, source, next, body.op, !!body.defer)
            await writeHistory(histFile, h)
            await writePage(page.file, next)
            return respond(200, payloadFor(page.slug, page.file, next, h))
          }

          if (req.method === 'POST' && (url.pathname === '/undo' || url.pathname === '/redo')) {
            const isUndo = url.pathname === '/undo'
            const body = JSON.parse(await readBody(req)) as { slug?: string }
            const page = resolvePage(body.slug)
            if (!page) return respond(400, { error: 'bad slug' })

            const source = await fs.readFile(page.file, 'utf8')
            lastSeen.set(page.file, source)
            const histFile = historyFileFor(page.slug)
            const h = await readHistory(histFile)
            const entry = isUndo ? h.entries[h.cursor - 1] : h.entries[h.cursor]
            if (!entry) {
              return respond(200, { ok: false, reason: 'empty', payload: payloadFor(page.slug, page.file, source, h) })
            }
            // an entry only ever applies to the exact text it was recorded for
            const expected = isUndo ? entry.resultHash : entry.baseHash
            if (hashSource(source) !== expected) {
              h.entries = []
              h.cursor = 0
              await writeHistory(histFile, h)
              return respond(200, { ok: false, reason: 'stale', payload: payloadFor(page.slug, page.file, source, h) })
            }
            const next = isUndo
              ? applySplice(source, entry.at, entry.inserted.length, entry.removed)
              : applySplice(source, entry.at, entry.removed.length, entry.inserted)
            h.cursor += isUndo ? -1 : 1
            suppressed.delete(page.file) // undo/redo always flush HMR via the watcher
            await writeHistory(histFile, h)
            await writePage(page.file, next)
            return respond(200, {
              ok: true,
              payload: payloadFor(page.slug, page.file, next, h),
              focusBlock: entry.block,
              label: entry.label,
            })
          }

          if (req.method === 'POST' && url.pathname === '/flush') {
            const body = JSON.parse(await readBody(req)) as { slug?: string }
            const page = resolvePage(body.slug)
            if (!page) return respond(400, { error: 'bad slug' })
            await releaseHmr(page.file)
            return respond(200, { ok: true })
          }

          respond(404, { error: 'not found' })
        })().catch((err: unknown) => {
          respond(500, { error: err instanceof Error ? err.message : String(err) })
        })
      })
    },
  }
}
