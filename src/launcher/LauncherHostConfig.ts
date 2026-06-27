import type { LauncherHostId } from '../workspace/launcher/types'

export type LauncherHostCapability =
  | 'global-search'
  | 'editor-actions'
  | 'plugin-surfaces'
  | 'pinned-actions'
  | 'param-input'
  | 'result-choice'
  | 'collect-input'

export type LauncherHostPresentation = {
  shellClassName: string
  panelClassName: string
  overlayZIndex: number
  topOffset: number
}

export type LauncherHostCloseBehavior = {
  closeOnBlur?: boolean
  restoreFocus?: boolean
  requestClose: () => void
}

export type LauncherHostConfig = {
  hostId: LauncherHostId
  capabilities: LauncherHostCapability[]
  presentation: LauncherHostPresentation
  closeBehavior: LauncherHostCloseBehavior
}
