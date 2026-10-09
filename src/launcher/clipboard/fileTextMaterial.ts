import { detectClipboardFilePath, fileNameFromPath } from './clipboardSnapshot'
import { createToolResultObjectBlock, type LauncherObjectBlock } from './objectBlock'

// Deliberately the same text formats as attached clipboard file-path detection.
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'xml', 'yaml', 'yml', 'sql', 'css'])

function supportedLocalPath(path: string): boolean {
  return !Array.from(path).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) &&
    (path.startsWith('/') && !path.startsWith('//') || /^[A-Za-z]:[\\/]/.test(path)) &&
    TEXT_EXTENSIONS.has(path.match(/\.([A-Za-z0-9]+)$/)?.[1].toLowerCase() ?? '')
}

/** Only an attached file object or explicit clipboard/history path is a file input. */
export function getAttachedTextFilePath(block: LauncherObjectBlock | null): string | null {
  if (!block || block.secretMasked || block.payloadImage || block.meta?.textOrigin === 'file-content') return null
  if (block.kind === 'files') {
    const paths = block.payloadFiles?.paths
    return paths?.length === 1 && supportedLocalPath(paths[0]) ? paths[0] : null
  }
  if (block.payloadFiles || (block.source !== 'clipboard' && block.source !== 'history-item')) return null
  const detected = typeof block.payloadText === 'string' ? detectClipboardFilePath(block.payloadText) : null
  return detected && supportedLocalPath(detected.path) ? detected.path : null
}

export function createFileTextMaterial(path: string, text: string): LauncherObjectBlock {
  const block = createToolResultObjectBlock(text)
  return {
    ...block,
    meta: {
      ...block.meta,
      textOrigin: 'file-content',
      fileName: fileNameFromPath(path),
      charCount: text.length,
      lineCount: text.split(/\r\n|\r|\n/).length,
    },
  }
}

export const FILE_TEXT_ERROR_KEYS = {
  picker_failed: 'palette.fileTextPickerFailed',
  unsupported_file: 'palette.fileTextUnsupported',
  not_found: 'palette.fileTextNotFound',
  permission_denied: 'palette.fileTextPermissionDenied',
  not_regular_file: 'palette.fileTextNotRegular',
  too_large: 'palette.fileTextTooLarge',
  invalid_utf8: 'palette.fileTextInvalidUtf8',
  binary_content: 'palette.fileTextBinary',
  read_failed: 'palette.fileTextReadFailed',
} as const
export type FileTextErrorCode = keyof typeof FILE_TEXT_ERROR_KEYS

export type FileTextReadResult =
  | { status: 'ready'; block: LauncherObjectBlock }
  | { status: 'error'; code: FileTextErrorCode }
  | { status: 'cancelled' }

/** Cancellation only discards the bounded read; it never mutates the current material. */
export function startFileTextMaterialRead(params: {
  block: LauncherObjectBlock
  read: (path: string) => Promise<string>
  isCurrent: () => boolean
}): { result: Promise<FileTextReadResult>; cancel: () => void } {
  let cancelled = false
  const isCurrent = () => !cancelled && params.isCurrent()
  const result = (async (): Promise<FileTextReadResult> => {
    const path = getAttachedTextFilePath(params.block)
    if (!isCurrent()) return { status: 'cancelled' }
    if (!path) return { status: 'error', code: 'unsupported_file' }
    try {
      const text = await params.read(path)
      if (!isCurrent()) return { status: 'cancelled' }
      return { status: 'ready', block: createFileTextMaterial(path, text) }
    } catch (error) {
      if (!isCurrent()) return { status: 'cancelled' }
      const message = error instanceof Error ? error.message : error
      const code = typeof message === 'string' && Object.hasOwn(FILE_TEXT_ERROR_KEYS, message)
        ? message as FileTextErrorCode : 'read_failed'
      return { status: 'error', code }
    }
  })()
  return { result, cancel: () => { cancelled = true } }
}

export async function readAttachedTextFile(path: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('read_text_material_file', { path })
}

/** Explicit native selection is a separate input boundary, never a query-path fallback. */
export async function chooseTextMaterialFile(labels: { title: string; filterName: string }): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  return open({
    title: labels.title,
    multiple: false,
    directory: false,
    filters: [{ name: labels.filterName, extensions: [...TEXT_EXTENSIONS] }],
  })
}

/** Cancellation discards results; the native chooser owns focus until it actually settles. */
export function startPickedTextMaterialRead(params: {
  choose: () => Promise<string | string[] | null>
  read: (path: string) => Promise<string>
  isCurrent: () => boolean
  acquireFocusLease: () => () => void
  onReading: () => void
}): { result: Promise<FileTextReadResult>; cancel: () => void } {
  let cancelled = false
  let releaseFocus = () => {}
  const isCurrent = () => !cancelled && params.isCurrent()
  const result = (async (): Promise<FileTextReadResult> => {
    if (!isCurrent()) return { status: 'cancelled' }
    let path: string | string[] | null
    try {
      // Synchronous acquisition must precede native open and its blur event.
      const release = params.acquireFocusLease()
      let released = false
      releaseFocus = () => { if (!released) { released = true; release() } }
      path = await params.choose()
    } catch {
      return isCurrent() ? { status: 'error', code: 'picker_failed' } : { status: 'cancelled' }
    } finally {
      releaseFocus()
    }
    if (!isCurrent() || path == null) return { status: 'cancelled' }
    if (typeof path !== 'string' || !supportedLocalPath(path)) return { status: 'error', code: 'unsupported_file' }
    params.onReading()
    if (!isCurrent()) return { status: 'cancelled' }
    try {
      const text = await params.read(path)
      if (!isCurrent()) return { status: 'cancelled' }
      return { status: 'ready', block: createFileTextMaterial(path, text) }
    } catch (error) {
      if (!isCurrent()) return { status: 'cancelled' }
      const message = error instanceof Error ? error.message : error
      const code = typeof message === 'string' && Object.hasOwn(FILE_TEXT_ERROR_KEYS, message)
        ? message as FileTextErrorCode : 'read_failed'
      return { status: 'error', code }
    }
  })()
  return { result, cancel: () => { cancelled = true } }
}
