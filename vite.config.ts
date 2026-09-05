import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages project sites live under /<repo>/, so the default base
// matches https://lfkdsk.github.io/quick-copy/. Building for a custom
// domain (or any root-served host) only needs VITE_BASE=/ at build time.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/quick-copy/',
  plugins: [react()],
  build: { target: 'es2022', sourcemap: false },
})
