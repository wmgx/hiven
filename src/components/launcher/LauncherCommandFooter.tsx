import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { t, type Locale } from '../../i18n'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LauncherHintKey, LauncherHintText } from './LauncherFooterHints'
import { usePasteAvailability } from '../usePasteAvailability'
import { pasteAvailabilityMessageKey } from '../../workspace/pasteAvailability'

export type LauncherCommandMenuAction = { id: string; label: string; run: () => void | Promise<void> }

/** Name of the app that will receive a paste; undefined when the host cannot tell. */
export function useForegroundAppName(): string | undefined {
  const [app, setApp] = useState<string>()
  useEffect(() => {
    let live = true
    void invoke<string | null>('current_foreground_app_name')
      .then((name) => { if (live) setApp(name?.trim() || undefined) })
      .catch(() => {})
    return () => { live = false }
  }, [])
  return app
}

/**
 * Command footer: "esc 换个操作 · ⌘K 更多 … ⇧↵ 粘贴到 X · [↵ 主动作]".
 * ↵ / ⇧↵ are handled by the frame; ⌘K is owned here while the footer is mounted.
 */
export function LauncherCommandFooter({
  locale,
  busy,
  primaryLabel,
  onPrimary,
  pasteApp,
  onPaste,
  menu,
  onBack,
}: {
  locale: Locale
  busy: boolean
  primaryLabel?: string
  onPrimary?: () => void
  /** Target app name for ⇧↵; falls back to a generic label. */
  pasteApp?: string
  /** Present when ⇧↵ can paste the result into the previous app. */
  onPaste?: () => void
  menu: LauncherCommandMenuAction[]
  onBack: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  // Paste falls back to copying when it cannot reach the app; say why up front.
  const pasteBlockedKey = pasteAvailabilityMessageKey(usePasteAvailability(Boolean(onPaste)))
  const hasMenu = useRef(false)
  hasMenu.current = menu.length > 0 && !busy
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'k' || !hasMenu.current) return
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen((open) => !open)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className="global-launcher-footer l-foot launcher-command-footer">
      <button type="button" className="launcher-footer-back-btn" data-no-drag
        onMouseDown={(event) => event.preventDefault()} onClick={onBack}>
        <LauncherHintKey keys="esc" label={t(locale, 'palette.changeAction')} />
      </button>
      {menu.length > 0 && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger render={<button type="button" className="launcher-footer-back-btn" data-no-drag disabled={busy} onMouseDown={(event) => event.preventDefault()} />}>
            <LauncherHintKey keys="⌘K" label={t(locale, 'outputActions.more')} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            {menu.map((item) => (
              <DropdownMenuItem key={item.id} onClick={() => void item.run()}>{item.label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <span className="launcher-command-footer-spacer" />
      {onPaste && pasteBlockedKey && <LauncherHintText label={t(locale, pasteBlockedKey)} />}
      {onPaste && !pasteBlockedKey && (
        <button type="button" className="launcher-footer-back-btn" data-no-drag disabled={busy}
          onMouseDown={(event) => event.preventDefault()} onClick={onPaste}>
          <LauncherHintKey keys="⇧↵" label={pasteApp ? t(locale, 'outputActions.pasteTo', { app: pasteApp }) : t(locale, 'outputActions.pasteToForeground')} />
        </button>
      )}
      {primaryLabel && onPrimary && (
        <button type="button" className="l-foot-primary" data-no-drag disabled={busy}
          onMouseDown={(event) => event.preventDefault()} onClick={onPrimary}>
          <LauncherHintKey keys="↵" label={primaryLabel} />
        </button>
      )}
    </div>
  )
}
