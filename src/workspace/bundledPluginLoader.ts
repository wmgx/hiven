import { pluginRegistry } from './pluginRegistry'
import type { PluginDefinition, PluginManifest } from './pluginTypes'

type BundledPluginModule = {
  default?: PluginDefinition
}

type BundledPluginPackage = {
  dir: string
  manifest: PluginManifest
  definition: PluginDefinition
}

const manifestModules = import.meta.glob('../plugins/*/manifest.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const entryModules = import.meta.glob('../plugins/*/index.{ts,tsx}', {
  eager: true,
}) as Record<string, BundledPluginModule>

function pluginDirFromPath(path: string): string {
  const match = path.match(/\/plugins\/([^/]+)\//)
  if (!match) throw new Error(`Invalid bundled plugin path: ${path}`)
  return match[1]
}

function readBundledPluginPackages(): BundledPluginPackage[] {
  return Object.entries(manifestModules).map(([manifestPath, rawManifest]) => {
    const dir = pluginDirFromPath(manifestPath)
    const manifest = JSON.parse(rawManifest) as PluginManifest
    const entryPath = `../plugins/${dir}/index.tsx`
    const fallbackEntryPath = `../plugins/${dir}/index.ts`
    const mod = entryModules[entryPath] ?? entryModules[fallbackEntryPath]
    const entry = entryModules[entryPath] ? 'index.tsx' : 'index.ts'
    const definition = mod?.default

    if (!definition) {
      throw new Error(`Bundled plugin "${manifest.pluginId}" entry "${entry}" has no default export`)
    }
    if (definition.id !== manifest.pluginId) {
      throw new Error(`Bundled plugin id mismatch: manifest "${manifest.pluginId}", entry "${definition.id}"`)
    }

    return { dir, manifest: { ...manifest, entry }, definition }
  })
}

let registered = false

export function registerBundledPluginPackages() {
  if (registered) return
  registered = true

  for (const { manifest, definition } of readBundledPluginPackages()) {
    pluginRegistry.registerProductionPlugin(
      manifest.pluginId,
      definition.commands ?? [],
      definition.renderers ?? [],
      definition.panels ?? [],
    )
  }
}
