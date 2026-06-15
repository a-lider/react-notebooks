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
import type { Plugin, ViteDevServer } from 'vite'
import {
  applyOp,
  extractBlocks,
  extractDoc,
  normalizeColumns,
  removeUnusedNamedImports,
  type BlockInfo,
  type EditOp,
} from './src/editor/tsx-engine'

// ---------------------------------------------------------------------------
// The parse + splice core lives in src/editor/tsx-engine (browser-safe, shared
// with the collab client). This file is the server side: the HTTP API, the
// undo history, and HMR plumbing.
// ---------------------------------------------------------------------------

export interface PagePayload {
  slug: string
  file: string
  source: string
  hash: string
  blocks: BlockInfo[]
  canUndo: boolean
  canRedo: boolean
}

/** Guards an op against a file that changed under the client (server-only). */
function hashSource(source: string): string {
  return crypto.createHash('sha1').update(source).digest('hex').slice(0, 12)
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
    case 'moveInto':
      return op.anchor
    case 'columnize':
      return op.target
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
  const label =
    op.type === 'replaceInner'
      ? 'typing'
      : op.type === 'setProp'
        ? `typing:${op.name}` // sql editing etc. coalesces like text typing
        : op.type

  if (
    defer &&
    (op.type === 'replaceInner' || op.type === 'setProp') &&
    last?.label === label &&
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
      label,
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

          // the collaboration seed: a page parsed into a block-tree value
          if (req.method === 'GET' && url.pathname === '/doc') {
            const page = resolvePage(url.searchParams.get('slug'))
            if (!page) return respond(400, { error: 'bad slug' })
            const source = await fs.readFile(page.file, 'utf8')
            return respond(200, extractDoc(source, page.slug))
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
            let next = applyOp(source, extractBlocks(source), body.op)
            // structural ops can empty a column — keep the layout tidy
            if (body.op.type !== 'replaceInner' && body.op.type !== 'setProp') {
              const normalized = normalizeColumns(next)
              if (normalized !== next) next = removeUnusedNamedImports(normalized)
            }

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
