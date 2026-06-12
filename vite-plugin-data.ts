/**
 * The local query engine: dev middleware that runs read-only SQL against
 * data/events.db (node:sqlite — built into Node, zero dependencies).
 *
 *   POST /__data/query { sql, params } → { rows } | { error }
 *
 * Every models/*.sql file is loaded as a TEMP VIEW named after the file,
 * so metrics query the semantic layer, not raw tables. The connection is
 * read-only; only SELECT/WITH statements are accepted.
 */
import { statSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Plugin, ViteDevServer } from 'vite'

async function readBody(req: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}

export function notebookData(): Plugin {
  let db: DatabaseSync | null = null
  let dbMtime = 0

  return {
    name: 'notebook-data',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const root = server.config.root
      const dbFile = path.resolve(root, 'data/events.db')
      const modelsDir = path.resolve(root, 'models')

      const getDb = (): DatabaseSync => {
        const mtime = statSync(dbFile).mtimeMs
        if (db && mtime === dbMtime) return db
        db?.close()
        db = new DatabaseSync(dbFile, { readOnly: true })
        dbMtime = mtime
        // the semantic layer: each models/<name>.sql becomes a view <name>
        if (existsSync(modelsDir)) {
          for (const f of readdirSync(modelsDir)) {
            if (!f.endsWith('.sql')) continue
            const name = f.replace(/\.sql$/, '')
            const sql = readFileSync(path.join(modelsDir, f), 'utf8')
            db.exec(`CREATE TEMP VIEW IF NOT EXISTS ${name} AS ${sql}`)
          }
        }
        return db
      }

      server.middlewares.use('/__data', (req, res) => {
        const respond = (status: number, data: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(data))
        }

        void (async () => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          if (req.method !== 'POST' || url.pathname !== '/query') {
            return respond(404, { error: 'not found' })
          }
          if (!existsSync(dbFile)) {
            return respond(503, { error: 'no dataset — run: python3 data/generate.py' })
          }
          const body = JSON.parse(await readBody(req)) as { sql?: string; params?: unknown[] }
          const sql = body.sql ?? ''
          if (!/^\s*(select|with)\b/i.test(sql)) {
            return respond(400, { error: 'read-only: SELECT/WITH statements only' })
          }
          const stmt = getDb().prepare(sql)
          const rows = stmt.all(...((body.params ?? []) as (string | number | null)[]))
          return respond(200, { rows })
        })().catch((err: unknown) => {
          respond(500, { error: err instanceof Error ? err.message : String(err) })
        })
      })
    },
  }
}
