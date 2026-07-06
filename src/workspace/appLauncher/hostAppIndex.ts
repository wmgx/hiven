import type { DiscoveredApp } from '../launcher/types'

type HostAppEntry = DiscoveredApp

function normalizedAppName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function appNameKeys(app: HostAppEntry): string[] {
  const values = [
    app.name,
    ...Object.values(app.nameI18n ?? {}),
    ...(app.aliases ?? []),
  ]
  const keys: string[] = []
  for (const value of values) {
    const key = normalizedAppName(value)
    if (key && !keys.includes(key)) keys.push(key)
  }
  return keys
}

function appPreferenceRank(app: HostAppEntry): number {
  if (!app.displayPath) return 100
  if (app.displayPath.startsWith('/Applications/')) return 0
  if (app.displayPath.startsWith('/System/Applications/')) return 1
  if (app.displayPath.includes('/Applications/')) return 2
  return 3
}

function shouldPreferHostApp(candidate: HostAppEntry, existing: HostAppEntry): boolean {
  const candidateRank = appPreferenceRank(candidate)
  const existingRank = appPreferenceRank(existing)
  if (candidateRank !== existingRank) return candidateRank < existingRank
  return (candidate.displayPath ?? candidate.appId) < (existing.displayPath ?? existing.appId)
}

export function normalizeHostAppEntries(apps: HostAppEntry[]): HostAppEntry[] {
  const byId = new Map<string, HostAppEntry>()
  const byName = new Map<string, string>()

  for (const app of apps) {
    if (!app || !app.appId || !app.name) continue
    const keys = [...appNameKeys(app), app.appId]
    const existingIds = keys
      .map((key) => byName.get(key))
      .filter((id): id is string => Boolean(id))
    const targetId = existingIds[0] ?? app.appId
    const existing = byId.get(targetId)

    if (!existing || shouldPreferHostApp(app, existing)) {
      byId.set(targetId, app)
    }
    for (const key of keys) {
      byName.set(key, targetId)
    }
    for (const oldId of existingIds) {
      if (oldId !== targetId) byId.delete(oldId)
    }
  }

  return [...byId.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}
