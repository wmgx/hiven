import type { LauncherItem } from '../../workspace/launcher/types'

type ShortcutMeta = {
  modifier: 'meta' | 'ctrl'
  label: string
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return true
  const platform = navigator.platform || ''
  const userAgent = navigator.userAgent || ''
  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(userAgent)
}

export function getPlatformShortcutMeta(): ShortcutMeta {
  return isMacPlatform() ? { modifier: 'meta', label: '⌘' } : { modifier: 'ctrl', label: 'Ctrl' }
}

export function shouldCustomizeParams(metaKey: boolean, ctrlKey: boolean): boolean {
  const shortcutMeta = getPlatformShortcutMeta()
  return shortcutMeta.modifier === 'meta' ? metaKey : ctrlKey
}

export function hasExplicitDefaultParams(item: LauncherItem): boolean {
  return (item.params ?? []).every((param) => param.default !== undefined || item.defaultParams?.[param.key] !== undefined)
}

export function supportsDefaultParamRun(item: LauncherItem): boolean {
  return !item.params?.length || hasExplicitDefaultParams(item)
}

export function supportsParamCustomization(item: LauncherItem | undefined): boolean {
  return Boolean(item?.executeWithParams && item.params && item.params.length > 0)
}
