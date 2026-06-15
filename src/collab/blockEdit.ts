import { createContext, useContext } from 'react'

/**
 * Lets an interactive block (the SQL <Query>) save a prop without knowing
 * whether it's in a local file-backed page or a relay-synced room. RenderDoc
 * provides a path-bound emitter per component block; when present, the block
 * routes its prop writes through it (→ a setProp op on the wire) instead of
 * splicing the .tsx file. Absent (null) → the block keeps its local behaviour.
 */
export interface BlockEditApi {
  emitProp: (name: string, value: unknown) => void
}

export const BlockEditContext = createContext<BlockEditApi | null>(null)

export function useBlockEdit(): BlockEditApi | null {
  return useContext(BlockEditContext)
}
