/** Decode the entire file before replacing the current source. A UTF-8 BOM is
 * consumed by TextDecoder; invalid bytes must never become replacement text. */
export function decodeCsvFileBytes(bytes: ArrayBuffer): { ok: true; text: string } | { ok: false } {
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false }
  }
}
