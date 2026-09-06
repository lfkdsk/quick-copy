import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The site is served from the root of its custom domain, which is also
// what a dev server wants, so `/` is the default. A build without the
// custom domain — a plain project page under /<repo>/ — passes VITE_BASE;
// the deploy workflow derives it from whether public/CNAME exists.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  build: { target: 'es2022', sourcemap: false },
})
