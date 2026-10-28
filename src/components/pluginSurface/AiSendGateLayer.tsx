import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Switch } from '@/components/ui/switch'
import { Button, Menu } from '../../plugin-ui'
import { pluginRegistry, usePluginRegistryVersion } from '../../workspace/pluginRegistry'
import { usePluginSettingsStore } from '../../workspace/pluginSettingsStore'
import { resolvePluginSettingsSource } from '../../workspace/launcher/pluginSource'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import type { PluginAiApi } from '../../workspace/ai/types'
import type { PluginAiSendGate } from '../../workspace/pluginTypes'
import {
  AI_SEND_PREVIEW_CHARS, addAiSendGrant, aiSendCharCount, aiSendGrantKey, aiUnavailableReasonKey,
  decideAiSend, removeAiSendGrant, type AiSendApproval, type AiSendRequest,
} from '../../workspace/ai/sendGate'
import type { AiPreflightReason, AiPreflightResult } from '../../workspace/ai/types'

type Prompt =
  | { kind: 'unavailable'; reason: AiPreflightReason; resolve: () => void }
  | { kind: 'confirm'; send: AiSendRequest; selection: AiPreflightResult; secret: boolean; resolve: (result: { remember: boolean } | null) => void }

function targetName(selection: AiPreflightResult): string {
  return [selection.providerName || selection.providerId, selection.agentName || selection.agentId].filter(Boolean).join(' · ')
}

function useGrants() {
  const grants = useAppStore(state => state.settings.aiSendGrants ?? [])
  const updateSetting = useAppStore(state => state.updateSetting)
  const revoke = useCallback((key: string) => {
    updateSetting('aiSendGrants', removeAiSendGrant(useAppStore.getState().settings.aiSendGrants ?? [], key))
  }, [updateSetting])
  return { grants, revoke }
}

/** Host-owned AI send permission for one plugin surface: the gate plus the layer that renders its prompts. */
export function useAiSendGate({ pluginId, ai, isCurrent, openAiSettings }: {
  pluginId: string
  ai: PluginAiApi | undefined
  isCurrent: () => boolean
  openAiSettings?: () => void
}): { gate: PluginAiSendGate; layer: ReactNode } {
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const promptRef = useRef<Prompt | null>(null)
  const openRef = useRef(openAiSettings)
  openRef.current = openAiSettings
  const t = useT('aiSendGate')

  const show = useCallback(<T,>(build: (resolve: (value: T) => void) => Prompt) => new Promise<T>(resolve => {
    // One prompt at a time; a newer request cancels the older one.
    if (promptRef.current?.kind === 'confirm') promptRef.current.resolve(null)
    else promptRef.current?.resolve()
    const next = build(value => { if (promptRef.current === next) { promptRef.current = null; setPrompt(null) } resolve(value) })
    promptRef.current = next
    setPrompt(next)
  }), [])

  const gate = useMemo<PluginAiSendGate>(() => {
    const Disclosure: PluginAiSendGate['Disclosure'] = ({ commandId, approval }) => <AiSendDisclosure pluginId={pluginId} commandId={commandId} approval={approval} />
    return {
      Disclosure,
      async request(send, options) {
        if (!isCurrent()) return null
        let selection = send.selection
        if (!selection) {
          try {
            selection = await ai?.preflight?.(send.preflight ?? { capabilities: ['text.generate'], inputModalities: ['text'] })
          } catch { selection = undefined }
        }
        if (options?.signal?.aborted || !isCurrent()) return null
        if (!selection || selection.status !== 'ready' || !selection.providerId || !selection.agentId) {
          const reason = selection?.reason ?? 'metadata_unavailable'
          await show<void>(resolve => ({ kind: 'unavailable', reason, resolve }))
          return null
        }
        const key = aiSendGrantKey(pluginId, send.commandId)
        const granted = (useAppStore.getState().settings.aiSendGrants ?? []).some(grant => grant.key === key)
        const decision = decideAiSend(send, granted)
        if (!decision.confirm) return { selection, remembered: granted && send.consent !== 'implicit' }
        const ready = selection
        const result = await show<{ remember: boolean } | null>(resolve => ({ kind: 'confirm', send, selection: ready, secret: decision.secret, resolve }))
        if (!result || options?.signal?.aborted || !isCurrent()) return null
        if (result.remember) {
          const state = useAppStore.getState()
          state.updateSetting('aiSendGrants', addAiSendGrant(state.settings.aiSendGrants ?? [], { key, label: send.label }))
        }
        return { selection, remembered: false }
      },
    }
  }, [ai, isCurrent, pluginId, show])

  const layer = prompt?.kind === 'unavailable'
    ? <AlertDialog open onOpenChange={open => { if (!open) prompt.resolve() }}>
      <AlertDialogContent className="hiven-ui-confirm-panel">
        <AlertDialogHeader>
          <AlertDialogTitle className="hiven-ui-confirm-title">{t('unavailable', { reason: t(aiUnavailableReasonKey(prompt.reason)) })}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter className="hiven-ui-confirm-actions">
          <AlertDialogCancel>{t('close')}</AlertDialogCancel>
          {openRef.current && <AlertDialogAction onClick={() => { prompt.resolve(); openRef.current?.() }}>{t('openSettings')}</AlertDialogAction>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    : prompt?.kind === 'confirm'
      ? <AiSendConfirm prompt={prompt} t={t} />
      : null
  return { gate, layer }
}

function AiSendConfirm({ prompt, t }: { prompt: Extract<Prompt, { kind: 'confirm' }>; t: ReturnType<typeof useT> }) {
  const [remember, setRemember] = useState(false)
  const { send, selection, secret } = prompt
  const preview = [send.text, ...(send.extras ?? [])].join('\n').slice(0, AI_SEND_PREVIEW_CHARS)
  const canRemember = !secret && send.consent !== 'implicit'
  return <AlertDialog open onOpenChange={open => { if (!open) prompt.resolve(null) }}>
    <AlertDialogContent className="hiven-ui-confirm-panel">
      <AlertDialogHeader>
        <AlertDialogTitle className="hiven-ui-confirm-title">{send.label}</AlertDialogTitle>
        <AlertDialogDescription className="hiven-ui-confirm-message">{t('sendTo')} {targetName(selection)}</AlertDialogDescription>
      </AlertDialogHeader>
      <pre className="ai-send-preview">{preview}</pre>
      <p className="ai-send-meta">{t('total', { count: aiSendCharCount(send).toLocaleString() })}</p>
      {secret && <p className="ai-send-secret" role="alert">{t('secret')}</p>}
      {canRemember && <label className="ai-send-remember">
        <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
        {t('remember')}
      </label>}
      <AlertDialogFooter className="hiven-ui-confirm-actions">
        <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
        <AlertDialogAction onClick={() => prompt.resolve({ remember: canRemember && remember })}>{t('send')}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

/** Shown above results sent through a remembered grant; clicking revokes the grant. */
function AiSendDisclosure({ pluginId, commandId, approval }: { pluginId: string; commandId: string; approval: AiSendApproval | null | undefined }) {
  const t = useT('aiSendGate')
  const { grants, revoke } = useGrants()
  const key = aiSendGrantKey(pluginId, commandId)
  if (!approval?.remembered || !grants.some(grant => grant.key === key)) return null
  return <p className="ai-send-disclosure">
    <span>{t('sentTo', { target: targetName(approval.selection) })}</span>
    <button type="button" title={t('revokeTitle')} onClick={() => revoke(key)}>{t('revoke')}</button>
  </p>
}

/** Host-owned settings section: declarations decide visibility, grants decide rows. */
export function AiSendGrantList({ pluginId }: { pluginId: string }) {
  const t = useT('aiSendGate')
  const { grants, revoke } = useGrants()
  const owned = grants.filter(grant => grant.key.startsWith(`${pluginId}:`))
  return <section className="ai-send-grants" data-ai-send-grants={pluginId}>
    <h3>{t('directSend')}</h3>
    {!owned.length ? <p className="ai-send-meta">{t('pluginGrantsEmpty')}</p> : owned.map(grant => <label key={grant.key} className="flex items-center justify-between gap-3 py-2">
      <span>{grant.label}<span className="ai-send-meta block">{t('directSendHint')}</span></span>
      <Switch checked aria-label={`${grant.label}: ${t('directSendHint')}`} onCheckedChange={() => revoke(grant.key)} />
    </label>)}
  </section>
}

export function AiSendGrantSummary() {
  const t = useT('aiSendGate')
  const { grants } = useGrants()
  const locale = useAppStore(state => state.locale)
  usePluginRegistryVersion()
  const plugins = pluginRegistry.getAllPluginDefinitions().filter(plugin =>
    plugin.permissions.includes('ai.use') && grants.some(grant => grant.key.startsWith(`${plugin.pluginId}:`)))
  const open = (plugin: typeof plugins[number]) => usePluginSettingsStore.getState().openSettingsDialog({
    pluginId: plugin.pluginId, source: resolvePluginSettingsSource(plugin.pluginId, plugin.source), presentation: 'dialog',
  })
  const label = t(grants.length ? 'grantsCount' : 'grantsEmpty', { count: grants.length })
  if (!plugins.length) return <p className="ai-send-meta" data-ai-send-summary>{label}</p>
  const trigger = <Button data-ai-send-summary onClick={plugins.length === 1 ? () => open(plugins[0]) : undefined}>{label}</Button>
  return plugins.length === 1 ? trigger : <Menu trigger={trigger} items={plugins.map(plugin => ({
    key: plugin.pluginId, label: plugin.definition.settings?.titleI18n?.[locale] ?? plugin.definition.settings?.title ?? plugin.pluginId,
    onSelect: () => open(plugin),
  }))} />
}
