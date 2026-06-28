import { PluginEditorSurfaceContent } from '../surfaces/PluginEditorSurfaceContent'

/** Compatibility wrapper for older imports. Plugin editor implementation lives in the surface layer. */
export function PluginEditorView() {
  return <PluginEditorSurfaceContent />
}
