export type WorkObjectType =
  | 'text'
  | 'clipboard'
  | 'app'
  | 'window'
  | 'file'
  | 'url'
  | 'plugin-surface'
  | 'editor-document'

export type BaseWorkObject<TType extends WorkObjectType = WorkObjectType> = {
  id: string
  type: TType
  title: string
  subtitle?: string
  icon?: string
  source: string
  createdAt?: number
  updatedAt?: number
}

export type TextWorkObject = BaseWorkObject<'text'> & {
  text: string
  language?: string
}

export type ClipboardWorkObject = BaseWorkObject<'clipboard'> & {
  contentType: 'text' | 'image' | 'files'
  preview?: string
}

export type AppWorkObject = BaseWorkObject<'app'> & {
  bundleId?: string
  executablePath?: string
}

export type WindowWorkObject = BaseWorkObject<'window'> & {
  appName?: string
  processId?: number
  windowTitle?: string
}

export type FileWorkObject = BaseWorkObject<'file'> & {
  path: string
}

export type UrlWorkObject = BaseWorkObject<'url'> & {
  url: string
}

export type PluginSurfaceWorkObject = BaseWorkObject<'plugin-surface'> & {
  pluginId: string
  surfaceId: string
  sourceKind: 'builtin' | 'installed' | 'dev'
  windowLabel?: string
}

export type EditorDocumentWorkObject = BaseWorkObject<'editor-document'> & {
  windowLabel: 'editor'
  paneId: string
  language?: string
}

export type WorkObject =
  | TextWorkObject
  | ClipboardWorkObject
  | AppWorkObject
  | WindowWorkObject
  | FileWorkObject
  | UrlWorkObject
  | PluginSurfaceWorkObject
  | EditorDocumentWorkObject

export type WorkObjectProvider = {
  id: string
  collect(): Promise<WorkObject[]> | WorkObject[]
}
