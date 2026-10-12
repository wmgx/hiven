import type { DiscoveredApp } from './types'

export type FavoriteAppScan = {
  status: 'loading' | 'ready' | 'error' | 'unknown'
  apps: readonly DiscoveredApp[]
}

const APP_FAVORITE_PREFIX = 'host:app-launcher:app:'

/** Describe only the latest complete scan snapshot, never infer uninstallation. */
export function describeFavoriteApp(
  key: string,
  scan: FavoriteAppScan,
): { status: 'loading' | 'available' | 'not-found' | 'unknown'; app?: DiscoveredApp } {
  if (!key.startsWith(APP_FAVORITE_PREFIX)) return { status: 'unknown' }
  const appId = key.slice(APP_FAVORITE_PREFIX.length)
  if (!appId) return { status: 'unknown' }
  if (scan.status === 'loading') return { status: 'loading' }
  if (scan.status !== 'ready') return { status: 'unknown' }
  const app = scan.apps.find((candidate) => candidate.appId === appId)
  return app ? { status: 'available', app } : { status: 'not-found' }
}
