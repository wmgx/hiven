import { detectContent } from './kits/content'

/** Conservative local-only classification before QR text reaches a passive HUD. */
export function isSensitiveQrText(text: string): boolean {
  const trimmed = text.trim()
  if (/^otpauth(?:-migration)?:\/\//i.test(trimmed)) return true
  if (/^WIFI:/i.test(trimmed) && /(?:^|;)P:(?:[^;\\]|\\.)+/i.test(trimmed)) return true
  return detectContent(text).some(({ kind }) => kind === 'secret' || kind === 'secret-like' || kind === 'jwt')
}
