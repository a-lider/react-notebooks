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
    // bind 0.0.0.0 + accept the hostname so a hosted sandbox (CodeSandbox)
    // can proxy the dev-server preview (Vite binds localhost only by default)
    host: true,
    allowedHosts: true,
  },
  resolve: {
    // "@/" points at the repo root so content folders (pages/, components/,
    // metrics/, lib/) live next to the app shell (src/) instead of inside it.
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
