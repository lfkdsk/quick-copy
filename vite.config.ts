import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Pages has no rewrite rules, so a deep link like /<owner>/<repo> would
// 404. Pages serves 404.html for any missing path, though, so making it
// a copy of the app lets the app read the path and open that repo.
function spaFallback(): Plugin {
  let outDir = 'dist'
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      await copyFile(resolve(outDir, 'index.html'), resolve(outDir, '404.html'))
    },
  }
}

// The site is served from the root of its custom domain, which is also
// what a dev server wants, so `/` is the default. A build without the
// custom domain — a plain project page under /<repo>/ — passes VITE_BASE;
// the deploy workflow derives it from whether public/CNAME exists.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), spaFallback()],
  build: { target: 'es2022', sourcemap: false },
})
