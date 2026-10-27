import { useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT } from '../../i18n'
import { flash } from '../../workspace/notify'
import type { PluginObjectBlockInput, PluginOutputActionsProps, PluginPasteResult, PluginSurfaceHostApi } from '../../workspace/pluginTypes'

/** Host capabilities the shared output actions need; refreshed on every surface render. */
export type OutputActionsDeps = {
  isCurrent(): boolean
  writeText(text: string): Promise<void>
  pasteText(text: string): Promise<PluginPasteResult>
  complete(): void
  returnToLauncher?(block: PluginObjectBlockInput): void | Promise<boolean>
  openInQuickEditor?(text: string): Promise<boolean>
}

type Action = { id: string; label: string; run: () => void | Promise<void> }

/** A launcher Block carries at most this much tool output. */
const CONTINUE_MAX_BYTES = 1024 * 1024

async function foregroundAppName(): Promise<string | undefined> {
  try { return (await invoke<string | null>('current_foreground_app_name'))?.trim() || undefined } catch { return undefined }
}

function HostOutputActions({ deps, text, primary = 'copy', copy, more = [], disabled }: PluginOutputActionsProps & { deps: RefObject<OutputActionsDeps> }) {
  const t = useT('outputActions')
  const [app, setApp] = useState<string>()
  const [menuOpen, setMenuOpen] = useState(false)
  const busy = useRef(false)
  useEffect(() => { let live = true; void foregroundAppName().then(name => { if (live) setApp(name) }); return () => { live = false } }, [])

  const hasText = typeof text === 'function' || Boolean(text)
  const resolveText = () => (typeof text === 'function' ? text() : text) || null
  const canCopy = !disabled && (hasText || Boolean(copy))
  const canTextAct = !disabled && hasText
  const once = (work: () => Promise<void>) => async () => {
    if (busy.current || !deps.current.isCurrent()) return
    busy.current = true
    try { await work() } finally { busy.current = false }
  }
  const doCopy = once(async () => {
    try {
      if (copy) await copy()
      else {
        const value = resolveText()
        if (value === null) return
        await deps.current.writeText(value)
      }
    } catch {
      flash({ level: 'error', message: t('copyFailed') })
      return
    }
    flash({ level: 'success', message: t('copied') })
    deps.current.complete()
  })
  const doPaste = once(async () => {
    const value = resolveText()
    if (value === null) return
    const result = await deps.current.pasteText(value).catch((): PluginPasteResult => ({ ok: false, fallback: 'none', message: '' }))
    if (result.ok) { deps.current.complete(); return }
    if (result.fallback !== 'copied') {
      try { await deps.current.writeText(value) } catch { flash({ level: 'error', message: t('copyFailed') }); return }
    }
    flash({ level: 'info', message: t('pasteCopied') })
    deps.current.complete()
  })
  const doContinue = once(async () => {
    const value = resolveText()
    if (value === null) return
    if (value.length > CONTINUE_MAX_BYTES || new TextEncoder().encode(value).byteLength > CONTINUE_MAX_BYTES) {
      flash({ level: 'error', message: t('continueTooLarge') })
      return
    }
    const accepted = await deps.current.returnToLauncher?.({ kind: 'text', text: value, source: 'tool-result' })
    if (accepted === false) flash({ level: 'error', message: t('continueFailed') })
  })
  const doOpenEditor = once(async () => {
    const value = resolveText()
    if (value !== null && await deps.current.openInQuickEditor?.(value)) deps.current.complete()
  })

  const pasteLabel = app ? t('pasteTo', { app }) : t('pasteToForeground')
  const primaryAction: Action = primary === 'paste' && canTextAct
    ? { id: 'paste', label: pasteLabel, run: doPaste }
    : { id: 'copy', label: t('copy'), run: doCopy }
  const secondary: Action | undefined = primaryAction.id === 'paste'
    ? { id: 'copy', label: t('copy'), run: doCopy }
    : canTextAct ? { id: 'paste', label: pasteLabel, run: doPaste } : undefined
  const menu: Action[] = [
    ...(canTextAct && deps.current.returnToLauncher ? [{ id: 'continue', label: t('continue'), run: doContinue }] : []),
    ...more.map(item => ({ ...item, run: () => { if (deps.current.isCurrent()) return item.run() } })),
    ...(canTextAct && deps.current.openInQuickEditor ? [{ id: 'open-editor', label: t('openEditor'), run: doOpenEditor }] : []),
  ]
  const canPrimary = primaryAction.id === 'copy' ? canCopy : canTextAct

  // ⌘↵ primary, ⌘⇧↵ paste, ⌘K more; ignored while an IME composes.
  const keys = useRef({ primaryAction, canPrimary, canTextAct, doPaste, hasMenu: menu.length > 0 })
  keys.current = { primaryAction, canPrimary, canTextAct, doPaste, hasMenu: menu.length > 0 }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey || !deps.current.isCurrent()) return
      const current = keys.current
      if (event.key === 'Enter' && event.shiftKey && current.canTextAct) { event.preventDefault(); void current.doPaste() }
      else if (event.key === 'Enter' && !event.shiftKey && current.canPrimary) { event.preventDefault(); void current.primaryAction.run() }
      else if (event.key.toLowerCase() === 'k' && !event.shiftKey && current.hasMenu) { event.preventDefault(); setMenuOpen(open => !open) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [deps])

  return <div className="hiven-output-actions">
    {secondary && <Button variant="outline" size="sm" disabled={secondary.id === 'copy' ? !canCopy : !canTextAct} onClick={() => void secondary.run()}>{secondary.label}</Button>}
    {menu.length > 0 && <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>
        {t('more')}<kbd>⌘K</kbd><ChevronDownIcon size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {menu.map(item => <DropdownMenuItem key={item.id} onClick={() => void item.run()}>{item.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>}
    <Button size="sm" disabled={!canPrimary} onClick={() => void primaryAction.run()}>{primaryAction.label}<kbd>⌘↵</kbd></Button>
  </div>
}

/** Derive the output capabilities from the host object handed to the plugin. */
export function outputActionsDeps(host: PluginSurfaceHostApi): OutputActionsDeps {
  return {
    isCurrent: () => host.deliveryFeedbackOwner?.isCurrent() !== false,
    writeText: text => host.clipboard.writeText(text),
    pasteText: text => host.paste.pasteText(text),
    complete: () => host.complete(),
    returnToLauncher: block => host.returnToLauncherWithObject(block),
    openInQuickEditor: async (text) => {
      try {
        const { overwriteQuickEditorText } = await import('../../workspace/quickEditor/quickEditorRequests')
        await overwriteQuickEditorText(text, { source: 'tool-result' })
        return true
      } catch { return false }
    },
  }
}

/** One stable component per surface renderer; capabilities are read through the ref at action time. */
export function useOutputActionsComponent(): { OutputActions: ComponentType<PluginOutputActionsProps>; bind(host: PluginSurfaceHostApi): void } {
  const ref = useRef<OutputActionsDeps>(null as unknown as OutputActionsDeps)
  const OutputActions = useMemo(() => function OutputActions(props: PluginOutputActionsProps) {
    return <HostOutputActions deps={ref} {...props} />
  }, [])
  return { OutputActions, bind: host => { ref.current = outputActionsDeps(host) } }
}
