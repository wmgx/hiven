import { detectContent } from '../../kits/content/index'
import { detectClipboardFilePath, isSoftClipboardOperand, type ClipboardSnapshot } from './clipboardSnapshot'

/** Recognition is shared with plugins; acceptance declarations only affect ranking. */
export function shouldShowClipboardHint(snapshot: ClipboardSnapshot, dismissedHash: string | null): boolean {
  if (snapshot.hash === dismissedHash) return false
  if (snapshot.image || snapshot.files?.length) return true
  const text = snapshot.text.trim()
  if (!text || isSoftClipboardOperand(text)) return false
  if (detectClipboardFilePath(text)) return true
  return detectContent(text).some(({ kind, confidence }) => confidence >= 0.75 &&
    !['text', 'command', 'markdown', 'unknown', 'url-encoded'].includes(kind))
}

/** The input measures wrapping using its own font and width; typing never calls this. */
export function shouldPasteAsBlock(text: string, wrappedLines: number): boolean {
  return /[\r\n]/.test(text) || wrappedLines > 4
}
