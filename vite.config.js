import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

const localLevelPreview = {
  name: 'jigsawmult-local-level-preview',
  configureServer(server) {
    server.middlewares.use('/__demo/levels', (request, response, next) => {
      if (request.method !== 'GET') return next()
      const seedPath = path.join(projectRoot, 'scripts', 'levels.seed.json')
      response.statusCode = 200
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(fs.readFileSync(seedPath, 'utf8'))
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), localLevelPreview],
})
