export async function loadMonacoNls(): Promise<void> {
  try {
    const stored = JSON.parse(localStorage.getItem('hiven-settings') || localStorage.getItem('fluxtext-settings') || '{}')
    const locale = stored?.state?.locale || stored?.state?.settings?.locale || 'en'
    if (!String(locale).toLowerCase().startsWith('zh')) return

    const nls = await import('monaco-editor/esm/nls.messages.zh-cn.js')
    if (nls) new Function(nls.default || '')()
  } catch {
    // Monaco falls back to English when persisted locale or its NLS bundle is unavailable.
  }
}
