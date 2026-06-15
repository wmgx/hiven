import { useEffect, useState } from 'react'
import { icons } from 'lucide-react'
import { createPluginPrivateStorage } from '../workspace/pluginStorage'
import type { PluginSettingsSource } from '../workspace/pluginSettingsStore'

type NativeAppIconUrlResult = string | null

const APP_ICON_MAX_CONCURRENT = 2
const appIconUrlCache = new Map<string, string | null>()
const appIconInflight = new Map<string, Promise<string>>()
const appIconQueue: Array<{ appId: string; resolve: (url: string) => void }> = []
let activeAppIconLoads = 0

function cachedAppIconUrl(appId: string): string {
  return appIconUrlCache.get(appId) ?? ''
}

function scheduleAppIconLoads(): void {
  while (activeAppIconLoads < APP_ICON_MAX_CONCURRENT && appIconQueue.length > 0) {
    const job = appIconQueue.shift()
    if (!job) return
    activeAppIconLoads++

    void import('@tauri-apps/api/core')
      .then(({ convertFileSrc, invoke }) =>
        invoke<NativeAppIconUrlResult>('read_installed_app_icon_url', { appId: job.appId })
          .then((path) => path ? convertFileSrc(path) : ''),
      )
      .then((url) => {
        if (!url) {
          appIconUrlCache.set(job.appId, null)
          job.resolve('')
          return
        }
        appIconUrlCache.set(job.appId, url)
        job.resolve(url)
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.warn('[hiven] Failed to read app icon:', job.appId, error)
        appIconUrlCache.set(job.appId, null)
        job.resolve('')
      })
      .finally(() => {
        activeAppIconLoads--
        appIconInflight.delete(job.appId)
        scheduleAppIconLoads()
      })
  }
}

function loadAppIconUrl(appId: string): Promise<string> {
  if (appIconUrlCache.has(appId)) return Promise.resolve(cachedAppIconUrl(appId))
  const inflight = appIconInflight.get(appId)
  if (inflight) return inflight
  const promise = new Promise<string>((resolve) => {
    appIconQueue.push({ appId, resolve })
    scheduleAppIconLoads()
  })
  appIconInflight.set(appId, promise)
  return promise
}

function parsePluginBlobIcon(iconName: string): { source: PluginSettingsSource; pluginId: string; blobId: string } | null {
  const parts = iconName.split(':')
  if (parts.length !== 4 || parts[0] !== 'plugin-blob') return null
  const source = parts[1]
  if (source !== 'builtin' && source !== 'installed' && source !== 'dev') return null
  if (!parts[2] || !parts[3]) return null
  return { source, pluginId: parts[2], blobId: parts[3] }
}

function parseAppIcon(iconName: string): string | null {
  if (!iconName.startsWith('app-icon:')) return null
  const appId = iconName.slice('app-icon:'.length)
  return appId || null
}

function PluginBlobIcon({ iconName, size, fallbackName }: { iconName: string; size: number; fallbackName?: string }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const parsed = parsePluginBlobIcon(iconName)
    if (!parsed) return
    let cancelled = false
    void createPluginPrivateStorage(parsed.source, parsed.pluginId)
      .blob
      .url(parsed.blobId)
      .then((nextUrl) => {
        if (!cancelled) setUrl(nextUrl)
      })
      .catch(() => {
        if (!cancelled) setUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [iconName])

  if (!url) return resolveIcon('AppWindow', size, fallbackName)
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'contain', borderRadius: 3 }}
      draggable={false}
    />
  )
}

function AppIcon({ iconName, size, fallbackName }: { iconName: string; size: number; fallbackName?: string }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const appId = parseAppIcon(iconName)
    if (!appId) return
    let cancelled = false
    setUrl(cachedAppIconUrl(appId))
    void loadAppIconUrl(appId)
      .then((nextUrl) => {
        if (!cancelled) setUrl(nextUrl)
      })
      .catch(() => {
        if (!cancelled) setUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [iconName])

  if (!url) return resolveIcon('AppWindow', size, fallbackName)
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'contain', borderRadius: 6 }}
      draggable={false}
    />
  )
}

/**
 * 根据 icon 名称解析 lucide 图标组件
 * fallback 为 name 前两个字母大写
 */
export function resolveIcon(iconName?: string, size = 16, fallbackName?: string) {
  if (iconName) {
    if (parsePluginBlobIcon(iconName)) {
      return <PluginBlobIcon iconName={iconName} size={size} fallbackName={fallbackName} />
    }
    if (parseAppIcon(iconName)) {
      return <AppIcon iconName={iconName} size={size} fallbackName={fallbackName} />
    }
    const IconComponent = icons[iconName as keyof typeof icons]
    if (IconComponent) return <IconComponent size={size} />
  }
  // fallback: 取 name 前两个字母
  const letters = (fallbackName || '??').slice(0, 2).toUpperCase()
  return <span style={{ fontSize: size * 0.7, fontWeight: 600, lineHeight: 1 }}>{letters}</span>
}
