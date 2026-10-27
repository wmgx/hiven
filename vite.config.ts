import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'

// Host launcher providers live in this module's state and are installed once at
// startup (App.tsx); a hot-swapped copy starts without them and silently drops apps
// and host actions from search. Reload the page instead of hot-swapping it.
const FULL_RELOAD_MODULES = ['/src/workspace/launcher/registry.ts']

function fullReloadStatefulModules(): Plugin {
  return {
    name: 'hiven-full-reload-stateful-modules',
    handleHotUpdate({ file, server }) {
      if (!FULL_RELOAD_MODULES.some((suffix) => file.endsWith(suffix))) return
      server.ws.send({ type: 'full-reload' })
      return []
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), fullReloadStatefulModules()],
  resolve: {
    alias: {
      ...(command === 'serve' ? { '@tauri-apps/api/core': fileURLToPath(new URL('./src/workspace/debugNativeCore.ts', import.meta.url)) } : {}),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@hiven/plugin': fileURLToPath(new URL('./src/plugin-sdk.ts', import.meta.url)),
      '@hiven/plugin-diff': fileURLToPath(new URL('./src/pluginHostDiff.ts', import.meta.url)),
      '@hiven/plugin-ui/icons': fileURLToPath(new URL('./src/plugin-ui-icons.ts', import.meta.url)),
      '@hiven/plugin-ui': fileURLToPath(new URL('./src/plugin-ui.tsx', import.meta.url)),
      '@fluxtext/plugin': fileURLToPath(new URL('./src/plugin-sdk.ts', import.meta.url)),
    },
  },
  server: {
    host: 'localhost',
    port: 1420,
    strictPort: true,
  },
}))
