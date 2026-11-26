import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    // Node 26 native localStorage shadows jsdom storage unless disabled in workers.
    execArgv: ['--no-experimental-webstorage'],
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    testTimeout: 30000,
  },
})
