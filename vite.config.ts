import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@hiven/plugin': fileURLToPath(new URL('./src/plugin-sdk.ts', import.meta.url)),
      '@hiven/plugin-ui/icons': fileURLToPath(new URL('./src/plugin-ui-icons.ts', import.meta.url)),
      '@hiven/plugin-ui': fileURLToPath(new URL('./src/plugin-ui.tsx', import.meta.url)),
      '@fluxtext/plugin': fileURLToPath(new URL('./src/plugin-sdk.ts', import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
})
