/**
 * Resolve the `{ $ref: name }` placeholders the doc carries back into real
 * values. extractDoc() encodes a JSX identifier prop (e.g. metric={signups})
 * as { $ref: 'signups' }; the SDUI renderer needs the actual object to pass to
 * a component. The registry is every metric the project exports — the cloud
 * equivalent of the page's `import { signups } from '@/metrics/growth'`.
 */
import * as growth from '@/metrics/growth'
import * as retention from '@/metrics/retention'

const REFS: Record<string, unknown> = { ...growth, ...retention }

function isRef(v: unknown): v is { $ref: string } {
  return !!v && typeof v === 'object' && '$ref' in (v as Record<string, unknown>)
}

/** Deep-resolve any { $ref } in a props object to its registered value. */
export function resolveProps(props?: Record<string, unknown>): Record<string, unknown> {
  if (!props) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    out[k] = isRef(v) ? (REFS[v.$ref] ?? v) : v
  }
  return out
}
