import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { notebookEditor } from './vite-plugin-notebook-editor'
import { notebookData } from './vite-plugin-data'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), notebookEditor(), notebookData()],
  server: {
    // share over a tunnel (cloudflared / ngrok): accept the tunnel's hostname
    allowedHosts: true,
    // one tunnel, one origin — proxy the relay (ws + http) under /__relay so a
    // remote peer reaches the relay, the SQL endpoint, and the editor API all
    // through the same public URL. Strip the prefix; the relay serves at root.
    proxy: {
      '/__relay': {
        target: 'http://localhost:8787',
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__relay/, ''),
      },
    },
  },
  resolve: {
    // "@/" points at the repo root so content folders (pages/, components/,
    // metrics/, lib/) live next to the app shell (src/) instead of inside it.
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
