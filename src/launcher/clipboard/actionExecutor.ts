/**
 * Action Executor — Execute recommended actions with their output targets.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §8
 *
 * Phase R3: Route action execution to appropriate output target.
 */

import type { RecommendedAction, RecommendedOutputTarget } from './actionRecommendation'
import type { LauncherObjectBlock } from './objectBlock'
import { detectClipboardFilePath } from './clipboardSnapshot'
import { getCurrentTextPayload, isCurrentTextDeliveryAction } from './currentTextDelivery'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ActionExecutionContext = {
  block: LauncherObjectBlock
  action: RecommendedAction
  target: RecommendedOutputTarget
}

/** Machine-readable failure; the host maps it to localized copy. */
export type ActionExecutionErrorCode =
  | 'TextPayloadMissing'
  | 'ImagePayloadMissing'
  | 'FilesPayloadMissing'
  | 'HandlerUnavailable'
  | 'FilePathLineBreakError'
  | 'NoPluginSurface'
  | 'ExecutionFailed'

/** Locale keys the host uses to render each failure code. */
export const ACTION_ERROR_KEYS: Record<ActionExecutionErrorCode, string> = {
  TextPayloadMissing: 'palette.actionErrorTextMissing',
  ImagePayloadMissing: 'palette.actionErrorImageMissing',
  FilesPayloadMissing: 'palette.actionErrorFilesMissing',
  HandlerUnavailable: 'palette.actionErrorUnavailable',
  FilePathLineBreakError: 'workspace.filePaths.lineBreakUnsupported',
  NoPluginSurface: 'palette.actionErrorNoSurface',
  ExecutionFailed: 'palette.quickEntryError',
}

export type ActionExecutionResult =
  | { ok: true }
  | { ok: false; error: ActionExecutionErrorCode; detail?: string }

export type ActionExecutionHandlers = {
  copyText: (text: string) => Promise<void>
  openInEditor: (text: string, options?: { language?: string; title?: string }) => Promise<void>
  openPluginSurface: (pluginId: string, options?: { initialText?: string }) => Promise<void>
  /** Resolve a local file path to its text content when the clipboard holds a path. */
  readLocalFileText?: (path: string) => Promise<string>
  getPluginSurfaceInitialTextMode?: (pluginId: string) => 'literal' | undefined
  /** Paste plain text into the app that was foreground before launcher. */
  pasteText?: (text: string) => Promise<void>
  pasteImage?: (blobId: string) => Promise<void>
  writeImage?: (blobId: string) => Promise<void>
  pasteFiles?: (paths: string[]) => Promise<void>
  writeFiles?: (paths: string[]) => Promise<void>
}

// ─── Executor ──────────────────────────────────────────────────────────────────

export async function executeRecommendedAction(
  ctx: ActionExecutionContext,
  handlers: ActionExecutionHandlers,
): Promise<ActionExecutionResult> {
  const { block, action, target } = ctx
  const text = block.payloadText ?? block.preview ?? ''

  try {
    if (isCurrentTextDeliveryAction(action.id)) {
      const payload = getCurrentTextPayload(block)
      if (payload === null) return { ok: false, error: 'TextPayloadMissing' }
      if (action.id === 'paste-current-text' || action.id === 'paste-history-text') {
        if (!handlers.pasteText) return { ok: false, error: 'HandlerUnavailable' }
        await handlers.pasteText(payload)
      } else {
        await handlers.copyText(payload)
      }
      return { ok: true }
    }
    // History media actions retain their private blob/permission boundary.
    if (action.id === 'paste-history-image') {
      const blobId = block.payloadImage?.blobId
      if (!blobId) return { ok: false, error: 'ImagePayloadMissing' }
      if (!handlers.pasteImage) return { ok: false, error: 'HandlerUnavailable' }
      await handlers.pasteImage(blobId)
      return { ok: true }
    }
    if (action.id === 'copy-history-image') {
      const blobId = block.payloadImage?.blobId
      if (!blobId) return { ok: false, error: 'ImagePayloadMissing' }
      if (!handlers.writeImage) return { ok: false, error: 'HandlerUnavailable' }
      await handlers.writeImage(blobId)
      return { ok: true }
    }
    if (action.id === 'paste-history-files') {
      const paths = block.payloadFiles?.paths
      if (!paths?.length) return { ok: false, error: 'FilesPayloadMissing' }
      if (!handlers.pasteFiles) return { ok: false, error: 'HandlerUnavailable' }
      await handlers.pasteFiles(paths)
      return { ok: true }
    }
    if (action.id === 'copy-history-file-paths') {
      const paths = block.payloadFiles?.paths
      if (!paths?.length) return { ok: false, error: 'FilesPayloadMissing' }
      await handlers.copyText(paths.join('\n'))
      return { ok: true }
    }
    if (action.id === 'convert-history-file-paths') {
      const paths = block.payloadFiles?.paths
      if (!paths?.length) return { ok: false, error: 'FilesPayloadMissing' }
      // The file-paths surface intentionally accepts one path per text line.
      // Never flatten a legal POSIX filename containing a newline into extra files.
      if (paths.some((path) => /[\r\n]/.test(path))) return { ok: false, error: 'FilePathLineBreakError' }
      await handlers.openPluginSurface('file-paths', { initialText: paths.join('\n') })
      return { ok: true }
    }

    switch (target) {
      case 'copy': {
        const result = await transformActionText(action, text)
        await handlers.copyText(result)
        return { ok: true }
      }
      case 'open-editor': {
        const result = await transformActionText(action, text)
        await handlers.openInEditor(result, { title: action.titleZh })
        return { ok: true }
      }
      case 'open-plugin-surface': {
        if (action.pluginId) {
          let initialText = text
          const filePath = block.meta?.textOrigin === 'file-content' || handlers.getPluginSurfaceInitialTextMode?.(action.pluginId) === 'literal' ? null : detectClipboardFilePath(text)
          if (filePath && handlers.readLocalFileText) {
            try {
              initialText = await handlers.readLocalFileText(filePath.path)
            } catch {
              // Keep path text; surface can still show / retry load.
              initialText = text
            }
          }
          await handlers.openPluginSurface(action.pluginId, { initialText })
          return { ok: true }
        }
        return { ok: false, error: 'NoPluginSurface' }
      }
      default:
        return { ok: false, error: 'HandlerUnavailable' }
    }
  } catch (error) {
    return { ok: false, error: 'ExecutionFailed', detail: error instanceof Error ? error.message : String(error) }
  }
}

// ─── Text transform (MVP: identity for most actions) ───────────────────────────

async function transformActionText(action: RecommendedAction, text: string): Promise<string> {
  switch (action.id) {
    case 'format-clipboard-json':
    case 'format-selection': {
      return withJsonFallback(text, (value) => JSON.stringify(value, null, 2))
    }
    case 'minify-json':
    case 'minify-selection': {
      return withJsonFallback(text, (value) => JSON.stringify(value))
    }
    case 'sort-json-keys': {
      return withJsonFallback(text, (value) => JSON.stringify(sortJsonKeys(value), null, 2))
    }
    case 'json-to-yaml':
    case 'selection-to-yaml': {
      return withJsonFallback(text, (value) => jsonToYaml(value))
    }
    case 'base64-encode': {
      return btoa(unescape(encodeURIComponent(text)))
    }
    case 'base64-decode': {
      try { return decodeURIComponent(escape(atob(text.trim()))) } catch { return text }
    }
    case 'url-encode': {
      return encodeURIComponent(text)
    }
    case 'url-decode': {
      try { return decodeURIComponent(text.trim()) } catch { return text }
    }
    case 'html-encode': {
      return htmlEncode(text)
    }
    case 'html-decode': {
      return htmlDecode(text)
    }
    case 'convert-timestamp': {
      return convertTimestampText(text)
    }
    case 'decode-jwt': {
      return decodeJwt(text)
    }
    case 'yaml-to-json': {
      return yamlToJson(text)
    }
    case 'query-string-to-json': {
      return queryStringToJson(text)
    }
    case 'format-css':
    case 'format-sql':
    case 'format-xml':
    default:
      return text
  }
}

function withJsonFallback(text: string, transform: (value: unknown) => string): string {
  try {
    return transform(JSON.parse(text))
  } catch {
    return text
  }
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys)
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortJsonKeys((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}



function convertTimestampText(text: string): string {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return ''
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric) && /^\d{10,13}$/.test(trimmed)) {
      const ms = trimmed.length === 10 ? numeric * 1000 : numeric
      return formatDateTime(new Date(ms))
    }
    const date = new Date(trimmed)
    if (!Number.isNaN(date.getTime())) return String(date.getTime())
    return line
  }).join('\n')
}

function formatDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function decodeJwt(text: string): string {
  const parts = text.trim().split('.')
  if (parts.length < 2) return text
  try {
    const decodePart = (part: string) => JSON.stringify(JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))), null, 2)
    return `Header\n${decodePart(parts[0])}\n\nPayload\n${decodePart(parts[1])}`
  } catch {
    return text
  }
}

function htmlEncode(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlDecode(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

// ─── Get all targets for an action ─────────────────────────────────────────────

export function getActionOutputTargets(action: RecommendedAction): RecommendedOutputTarget[] {
  return [action.defaultOutput, ...(action.alternativeOutputs ?? [])]
}

function jsonToYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value.map((item) => {
      if (item && typeof item === 'object') return `${pad}-\n${jsonToYaml(item, indent + 1)}`
      return `${pad}- ${formatYamlScalar(item)}`
    }).join('\n')
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return entries.map(([key, item]) => {
      if (item && typeof item === 'object') return `${pad}${key}:\n${jsonToYaml(item, indent + 1)}`
      return `${pad}${key}: ${formatYamlScalar(item)}`
    }).join('\n')
  }
  return `${pad}${formatYamlScalar(value)}`
}

function formatYamlScalar(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  return String(value)
}

function yamlToJson(text: string): string {
  // Lightweight YAML-to-JSON for simple key:value YAML (no nested structures)
  // Handles the common case; complex YAML should go through the plugin's js-yaml
  try {
    const lines = text.split(/\r?\n/).filter(Boolean)
    const obj: Record<string, string> = {}
    for (const line of lines) {
      if (line.startsWith('---') || line.startsWith('#')) continue
      const match = line.match(/^([\w.-]+):\s*(.*)$/)
      if (match) {
        obj[match[1]] = match[2]
      }
    }
    return JSON.stringify(obj, null, 2)
  } catch {
    return text
  }
}

function queryStringToJson(text: string): string {
  try {
    let qs = text.trim()
    if (qs.startsWith('?')) qs = qs.slice(1)
    const params = new URLSearchParams(qs)
    const obj: Record<string, string> = {}
    params.forEach((v, k) => { obj[k] = v })
    return JSON.stringify(obj, null, 2)
  } catch {
    return text
  }
}
