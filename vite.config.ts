import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // "@/" points at the repo root so content folders (pages/, components/,
    // metrics/, lib/) live next to the app shell (src/) instead of inside it.
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
