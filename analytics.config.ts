/**
 * Data source configuration.
 *
 * sqlite: the local query engine (vite-plugin-data) over data/events.db,
 *         with models/*.sql as the semantic layer. Generate the dataset
 *         with `python3 data/generate.py`.
 * demo:   deterministic synthetic data, zero setup — swap it in if you
 *         don't have a dataset: `adapter: demoAdapter`.
 */
import { sqliteAdapter } from '@/lib/sqlite-adapter'
import type { Adapter } from '@/lib/data'

export const config: { adapter: Adapter } = {
  adapter: sqliteAdapter,
}
