export type AppPlatform = 'macos' | 'windows' | 'linux'

export type AppSource = 'applications' | 'start-menu' | 'app-paths' | 'desktop-entry'

export type CachedAppEntry = {
  appId: string
  name: string
  nameI18n?: Partial<Record<'zh' | 'en', string>>
  aliases?: string[]
  platform: AppPlatform
  source: AppSource
  displayPath?: string
}

export type AppLauncherCache = {
  version: 4
  locale?: string
  refreshedAt: number
  apps: CachedAppEntry[]
}

export const APP_LAUNCHER_CACHE_KEY = 'app-launcher:index:v4'

export const EMPTY_APP_LAUNCHER_CACHE: AppLauncherCache = {
  version: 4,
  refreshedAt: 0,
  apps: [],
}
