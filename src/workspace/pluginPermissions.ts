import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Locale } from '../i18n'
import type { PluginPermission, PluginPermissionGrant, PluginPermissionSnapshot } from './pluginTypes'
import type { PluginSettingsSource } from './pluginSettingsStore'

export const ALL_PLUGIN_PERMISSIONS: readonly PluginPermission[] = [
  'clipboard.read',
  'clipboard.write',
  'clipboard.watch',
  'clipboard.image',
  'clipboard.files',
  'storage.private',
  'storage.blob',
  'globalShortcut.register',
  'accessibility.paste',
]

export type PluginPermissionStore = Record<PluginSettingsSource, Record<string, Partial<Record<PluginPermission, PluginPermissionGrant>>>>

type PluginPermissionStoreState = {
  permissions: PluginPermissionStore
  version: number
  grantPermissions: (source: PluginSettingsSource, pluginId: string, permissions: readonly PluginPermission[]) => void
  revokePermissions: (source: PluginSettingsSource, pluginId: string, permissions: readonly PluginPermission[]) => void
  clearPluginPermissions: (source: PluginSettingsSource, pluginId: string) => void
}

function emptyPermissionStore(): PluginPermissionStore {
  return {
    builtin: {},
    installed: {},
    dev: {},
  }
}

export const usePluginPermissionStore = create<PluginPermissionStoreState>()(
  persist(
    (set) => ({
      permissions: emptyPermissionStore(),
      version: 0,
      grantPermissions: (source, pluginId, permissions) =>
        set((state) => {
          const current = state.permissions[source][pluginId] ?? {}
          const now = Date.now()
          const nextPluginPermissions = { ...current }
          for (const permission of permissions) {
            nextPluginPermissions[permission] = { granted: true, grantedAt: now }
          }
          return {
            permissions: {
              ...state.permissions,
              [source]: {
                ...state.permissions[source],
                [pluginId]: nextPluginPermissions,
              },
            },
            version: state.version + 1,
          }
        }),
      revokePermissions: (source, pluginId, permissions) =>
        set((state) => {
          const current = state.permissions[source][pluginId] ?? {}
          const now = Date.now()
          const nextPluginPermissions = { ...current }
          for (const permission of permissions) {
            nextPluginPermissions[permission] = { granted: false, deniedAt: now }
          }
          return {
            permissions: {
              ...state.permissions,
              [source]: {
                ...state.permissions[source],
                [pluginId]: nextPluginPermissions,
              },
            },
            version: state.version + 1,
          }
        }),
      clearPluginPermissions: (source, pluginId) =>
        set((state) => {
          if (!state.permissions[source][pluginId]) return state
          const nextSourcePermissions = { ...state.permissions[source] }
          delete nextSourcePermissions[pluginId]
          return {
            permissions: {
              ...state.permissions,
              [source]: nextSourcePermissions,
            },
            version: state.version + 1,
          }
        }),
    }),
    {
      name: 'hiven-plugin-permissions',
      partialize: (state) => ({ permissions: state.permissions }),
    },
  ),
)

export function getPluginPermissionSnapshot(
  source: PluginSettingsSource,
  pluginId: string,
  requestedPermissions: readonly PluginPermission[] = ALL_PLUGIN_PERMISSIONS,
): PluginPermissionSnapshot {
  const stored = usePluginPermissionStore.getState().permissions[source][pluginId] ?? {}
  const snapshot = {} as PluginPermissionSnapshot
  for (const permission of ALL_PLUGIN_PERMISSIONS) {
    const explicit = stored[permission]
    snapshot[permission] = explicit ?? { granted: !requestedPermissions.includes(permission) }
  }
  return snapshot
}

export function missingPluginPermissions(
  snapshot: PluginPermissionSnapshot,
  required: readonly PluginPermission[],
): PluginPermission[] {
  return required.filter((permission) => !snapshot[permission]?.granted)
}

export function requirePluginPermissions(
  snapshot: PluginPermissionSnapshot,
  required: readonly PluginPermission[],
): void {
  const missing = missingPluginPermissions(snapshot, required)
  if (missing.length === 0) return
  throw new Error(`Plugin permission required: ${missing.join(', ')}`)
}

const permissionLabels: Record<PluginPermission, Record<Locale, string>> = {
  'clipboard.read': { en: 'Read clipboard text', zh: '读取剪贴板文本' },
  'clipboard.write': { en: 'Write to clipboard', zh: '写入剪贴板' },
  'clipboard.watch': { en: 'Watch clipboard changes', zh: '监听剪贴板变化' },
  'clipboard.image': { en: 'Access clipboard images', zh: '访问剪贴板图片' },
  'clipboard.files': { en: 'Access clipboard file paths', zh: '访问剪贴板文件路径' },
  'storage.private': { en: 'Use private plugin storage', zh: '使用插件私有存储' },
  'storage.blob': { en: 'Store private blobs', zh: '存储插件私有 Blob' },
  'globalShortcut.register': { en: 'Register global shortcuts', zh: '注册全局快捷键' },
  'accessibility.paste': { en: 'Paste into the foreground app', zh: '粘贴到前台应用' },
}

export function describePluginPermission(permission: PluginPermission, locale: Locale): string {
  return permissionLabels[permission]?.[locale] ?? permission
}
