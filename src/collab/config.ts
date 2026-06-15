/** Where the collaboration relay lives. Local for now; a cloud URL later. */
export const RELAY_HTTP = import.meta.env.VITE_RELAY_HTTP ?? 'http://localhost:8787'
export const RELAY_WS = import.meta.env.VITE_RELAY_WS ?? 'ws://localhost:8787'
