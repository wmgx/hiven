export type PluginEditorState = {
  pluginId: string
  folderPath: string
  activeFile?: string
  readOnly?: boolean
  source?: 'builtin' | 'installed' | 'dev'
}
