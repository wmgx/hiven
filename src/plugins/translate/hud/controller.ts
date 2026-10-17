import { getPluginHostSdk, type PluginTextResultHudHost, type PluginTextResultHudRunner } from '@hiven/plugin'
import { AiTranslationReadiness } from '../ai/readiness'
import { resolveSmartTargetLang, translateWithAi } from '../providers/adapters'
import { profileExecutionKey } from '../settings/executionKey'
import type { TranslateProfile, TranslateSettings } from '../settings/model'
import { HudTranslationSession } from './session'

/** The AI profile the shortcut HUD translates with; other providers are not used by the HUD. */
export function hudTranslationProfile(settings: TranslateSettings): TranslateProfile | null {
  const profile = settings.profiles.find((candidate) => candidate.enabled && candidate.id === settings.defaultProfileId)
  return profile?.provider === 'ai' ? profile : null
}

/** Shortcut -> translate clipboard text with the system AI -> native HUD. */
export function createTranslationHud(host: PluginTextResultHudHost<TranslateSettings>): PluginTextResultHudRunner {
  const { detectContent } = getPluginHostSdk().kits.content
  return new HudTranslationSession({
    async prepare() {
      const profile = hudTranslationProfile(host.settings())
      if (!profile || !host.isCurrent()) return null
      const executionKey = profileExecutionKey(profile)
      const ai = host.createAi()
      const readiness = new AiTranslationReadiness()
      readiness.setAi(ai)
      readiness.setSelection(profile)
      try {
        // Each explicit shortcut is a retry boundary. Recheck metadata so a
        // recovered local provider is not hidden behind the normal cache TTL.
        await readiness.refresh(true)
        if (readiness.getSnapshot().status !== 'ready') return null
        const selection = readiness.execution(ai, profile)
        if (!selection) return null
        return {
          async translate(input, options) {
            const current = hudTranslationProfile(host.settings())
            if (!current || profileExecutionKey(current) !== executionKey || !host.isCurrent()) {
              throw new DOMException('Translation configuration changed', 'AbortError')
            }
            const targetLang = profile.defaultTargetLang === 'smart' ? resolveSmartTargetLang(input) : profile.defaultTargetLang
            const result = await translateWithAi({ text: input, sourceLang: profile.defaultSourceLang, targetLang }, profile, ai, {
              signal: options.signal, onText: options.onText, aiSelection: selection,
            })
            return result.text
          },
        }
      } finally {
        readiness.dispose()
      }
    },
    readClipboard: async (signal) => signal.aborted ? '' : host.readClipboardText(),
    isSensitive: (text) => detectContent(text).some(({ kind }) => kind === 'secret' || kind === 'secret-like'),
    writeClipboard: (text, signal) => host.writeClipboardText(text, signal),
    present: (view, fullText) => host.present(view, fullText),
    activate: (view) => host.activate(view),
    dismiss: (sessionId, revision) => host.dismiss(sessionId, revision),
    now: () => Date.now(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    clearSchedule: (timer) => clearTimeout(timer),
    randomId: () => crypto.randomUUID(),
  })
}
