/** App composition: show the bundled countdown's native availability before execution. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from './store'
import { makePluginT } from './i18n/pluginI18nRegistry'
import { pluginRegistry } from './workspace/pluginRegistry'
import { isCurrentBundledDefinition } from './workspace/bundledPluginIdentity'
import { nativeToastRoutingAvailable } from './workspace/toastRouting'
import type { LauncherItem } from './workspace/launcher/types'

type Availability = 'checking' | 'supported' | 'unavailable' | 'checkFailed'
export function useShortCountdownAvailability() {
  const open = useAppStore(s => s.globalLauncherOpen)
  const session = useAppStore(s => s.globalLauncherSessionId)
  const locale = useAppStore(s => s.locale)
  const [result, setResult] = useState<{ session: number; value: Availability }>()
  const availability = open && result?.session === session ? result.value : 'checking'
  const current = useRef({ session, availability })
  current.current = { session, availability }
  useEffect(() => {
    if (!open) return
    let active = true
    if (!nativeToastRoutingAvailable()) {
      setResult({ session, value: 'unavailable' })
      return
    }
    void invoke<{ supported: boolean }>('short_countdown_status').then(snapshot => {
      if (active) setResult({ session, value: snapshot.supported === true ? 'supported' : snapshot.supported === false ? 'unavailable' : 'checkFailed' })
    }, () => { if (active) setResult({ session, value: 'checkFailed' }) })
    return () => { active = false }
  }, [open, session])
  return useCallback((item: LauncherItem): LauncherItem => {
    if (item.source !== 'builtin' || item.pluginId !== 'date-time-assistant' || !['plugin:date-time-assistant:launcher:countdown-status', 'plugin:date-time-assistant:dynamic:countdown-start'].includes(item.systemKey ?? '')) return item
    const definition = pluginRegistry.getPluginDefinition('date-time-assistant', 'production')
    if (!isCurrentBundledDefinition('date-time-assistant', 'builtin', definition)) return item
    const t = makePluginT('date-time-assistant', locale)
    const message = () => t(`countdown.${current.current.availability === 'supported' ? 'checking' : current.current.availability}`)
    return { ...item,
      ...(availability === 'supported' ? {} : { display: { ...item.display,
        title: `${t('countdown.title')} · ${t(`countdown.${availability}Title`)}`, titleI18n: undefined,
        subtitle: t(`countdown.${availability}`), subtitleI18n: undefined, subtitlePresentation: undefined,
        aliases: [...(item.display.aliases ?? []), item.display.title, ...Object.values(item.display.titleI18n ?? {}).filter((value): value is string => typeof value === 'string')],
      } }),
      execute: ctx => {
        const state = useAppStore.getState()
        if (!state.globalLauncherOpen || state.globalLauncherSessionId !== session || current.current.session !== session || current.current.availability !== 'supported') return { ok: false, message: message() }
        return item.execute(ctx)
      },
    }
  }, [availability, session, locale])
}
