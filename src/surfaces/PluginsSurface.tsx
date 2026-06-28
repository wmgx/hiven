import { useAppStore } from '../store'
import { ScriptsView } from '../views/ScriptsView'
import { PluginEditorSurface } from './PluginEditorSurface'

export function PluginsSurface() {
  const pluginEditor = useAppStore((s) => s.pluginEditor)
  return pluginEditor ? <PluginEditorSurface /> : <ScriptsView />
}
