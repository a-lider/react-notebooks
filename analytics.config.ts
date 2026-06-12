/**
 * Data source configuration.
 *
 * The demo adapter generates deterministic synthetic data so the app renders
 * with zero setup. Planned adapters implementing the same interface:
 *   - duckdb:  DuckDB-WASM over data/*.parquet (local, offline)
 *   - posthog: the PostHog API (cloud)
 */
import { demoAdapter } from '@/lib/demo-adapter'
import type { Adapter } from '@/lib/data'

export const config: { adapter: Adapter } = {
  adapter: demoAdapter,
}
