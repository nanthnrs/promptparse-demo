import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const lib = JSON.parse(readFileSync('node_modules/promptparse/package.json', 'utf8'))

export default defineConfig({
  define: { __LIB_VERSION__: JSON.stringify(lib.version) },
})
