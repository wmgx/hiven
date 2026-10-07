// Imported only when the embedded packages need releasing. Keep this raw glob
// out of configInit's eager manifest/index discovery and other startup imports.
const PLUGIN_FILE_MODULES = import.meta.glob('./plugins/*/**/*.{ts,tsx,js,jsx,mjs,json,css,md}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

export function getBuiltinPluginFiles(dir: string): Record<string, string> {
  const prefix = `./plugins/${dir}/`
  const files: Record<string, string> = {}
  for (const [filePath, content] of Object.entries(PLUGIN_FILE_MODULES)) {
    if (filePath.startsWith(prefix)) files[filePath.slice(prefix.length)] = content
  }
  if (!Object.hasOwn(files, 'manifest.json')) {
    throw new Error(`Embedded builtin plugin package is missing: ${dir}`)
  }
  return files
}
