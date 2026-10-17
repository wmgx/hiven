import type { PluginTextResultHudHost, PluginTextResultHudRunner } from '@hiven/plugin'
import { cleanAgentText } from './cleanAgentText'
import { CleanAgentHudSession } from './cleanAgentHudSession'

/** Shortcut -> clean agent terminal text from the clipboard -> native HUD (copy or paste). */
export function createCleanAgentHud(host: PluginTextResultHudHost): PluginTextResultHudRunner {
  return new CleanAgentHudSession({
    read: (signal, isCurrent) => host.readClipboardText(() => {
      if (signal.aborted || !isCurrent()) throw new DOMException('Clipboard read cancelled', 'AbortError')
    }),
    clean: (text) => cleanAgentText(text, false),
    write: (text, signal) => host.writeClipboardText(text, signal),
    canPaste: () => host.canPaste(),
    paste: (sessionId, revision) => host.paste(sessionId, revision),
    present: (view, fullText) => host.present(view, fullText),
    activate: (view) => host.activate(view),
    dismiss: (sessionId, revision) => host.dismiss(sessionId, revision),
    now: () => Date.now(), schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    clearSchedule: (timer) => clearTimeout(timer), randomId: () => crypto.randomUUID(),
  })
}
