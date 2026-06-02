import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@fluxtext/plugin': fileURLToPath(new URL('./src/plugin-sdk.ts', import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
})
