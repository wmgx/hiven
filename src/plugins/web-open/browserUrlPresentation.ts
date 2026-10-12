/** UI-only address summary. Search and activation always retain the original URL. */
export function browserUrlPresentation(raw: string | null | undefined): { text: string; detail: string } | undefined {
  if (!raw || !/^https?:\/\//i.test(raw) || /[\u0000-\u0020\u007f]/.test(raw)) return undefined
  try {
    const url = new URL(raw)
    if (!url.hostname) return undefined
    // Do not decode paths or inspect query values: tracking/secrets stay out of the summary.
    const path = url.pathname === '/' ? '' : url.pathname
    const budget = Math.max(16, 64 - url.host.length)
    const suffix = path.length > budget ? `/…${path.slice(-(budget - 2))}` : path
    return { text: `${url.host}${suffix}${url.search ? '?…' : ''}${url.hash ? '#…' : ''}`, detail: raw }
  } catch {
    return undefined
  }
}
