/**
 * The semantic layer: typed, importable metric definitions.
 *
 * Pages import metrics (never SQL) and pass them to components like
 * <Trend metric={signups} /> or <Stat metric={signupConversion} />.
 * "What counts as a signup" is defined exactly once, in metrics/.
 */

export type Interval = 'day' | 'week' | 'month'
export type Aggregation = 'count' | 'unique' | 'sum' | 'ratio'
export type Unit = 'users' | 'events' | 'percent' | 'currency'

export interface MetricDef {
  /** Unique key, also the cache key prefix. */
  key: string
  /** Human label used in chart legends and tooltips. */
  label: string
  /** The model this metric reads from — a view defined in models/<model>.sql */
  model: string
  agg: Aggregation
  unit?: Unit
  /** SQL predicate over the model's rows, e.g. "event = 'signup'". */
  where?: string
  /** For agg: 'ratio' — SQL predicates over the model. */
  num?: string
  den?: string
  /** Column for distinct counting (defaults to user_id for unique/ratio). */
  distinct?: string
  description?: string
  owners?: string[]
}

export type Metric = Readonly<MetricDef>

export function defineMetric(def: MetricDef): Metric {
  return Object.freeze(def)
}
