/**
 * Where the collaboration relay lives.
 *
 * Default: same-origin, proxied at `/__relay` (see vite.config.ts). That means
 * one tunnel over the dev server exposes the app, the relay (ws + http), the
 * SQL query endpoint, and the editor API together — a remote peer reaches
 * everything through a single public URL, no CORS, no second tunnel.
 *
 * Override with VITE_RELAY_HTTP / VITE_RELAY_WS to point at a standalone relay.
 */
function relayBase(): { http: string; ws: string } {
  const envHttp = import.meta.env.VITE_RELAY_HTTP as string | undefined
  const envWs = import.meta.env.VITE_RELAY_WS as string | undefined
  if (envHttp && envWs) return { http: envHttp, ws: envWs }
  const { protocol, host } = location
  return {
    http: `${protocol}//${host}/__relay`,
    ws: `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/__relay`,
  }
}

const base = relayBase()
export const RELAY_HTTP = base.http
export const RELAY_WS = base.ws
