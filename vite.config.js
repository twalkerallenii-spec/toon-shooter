import { defineConfig } from 'vite'

// `base` is set to './' so the build works when served from a GitHub Pages
// subpath (https://<user>.github.io/<repo>/). Change if you use a custom domain.
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
})
