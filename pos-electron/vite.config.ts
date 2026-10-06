import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { POS_APP_NAME } from './electron/brand'

// Fills the %POS_APP_NAME% placeholder in index.html from the one brand constant.
const brandTitle = {
  name: 'brand-title',
  transformIndexHtml: (html: string) => html.replace('%POS_APP_NAME%', POS_APP_NAME),
}

export default defineConfig({
  plugins: [react(), brandTitle],
  base: './',
  resolve: {
    // The renderer bundles the shared sale arithmetic from source (the package ships CommonJS).
    alias: { '@athr/domain-core': path.resolve(__dirname, '../packages/domain-core/src/index.ts') },
  },
  build: { outDir: 'dist' },
  server: { port: 5173 },
})
