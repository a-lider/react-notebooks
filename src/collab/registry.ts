/**
 * The SDUI registry: how a synced block tree renders without source.
 * type → component, and { $ref: name } props → the real metric object.
 * This is the cloud/RSC-shaped renderer — interpret a value tree against a
 * prebuilt registry, no code execution.
 */
import type { ComponentType } from 'react'
import * as notebook from '@/components/notebook'
import * as analytics from '@/components/analytics'
import * as growth from '@/metrics/growth'
import * as retention from '@/metrics/retention'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const componentRegistry: Record<string, ComponentType<any>> = {
  ...(notebook as Record<string, ComponentType<unknown>>),
  ...(analytics as Record<string, ComponentType<unknown>>),
}

const metricRegistry: Record<string, unknown> = { ...growth, ...retention }

function isRef(v: unknown): v is { $ref: string } {
  return !!v && typeof v === 'object' && '$ref' in (v as Record<string, unknown>)
}

function resolveValue(v: unknown): unknown {
  if (isRef(v)) return metricRegistry[v.$ref]
  if (Array.isArray(v)) return v.map(resolveValue)
  return v
}

/** Resolve a block's stored props into real React props (refs → metrics). */
export function resolveProps(props?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props ?? {})) out[k] = resolveValue(v)
  return out
}
