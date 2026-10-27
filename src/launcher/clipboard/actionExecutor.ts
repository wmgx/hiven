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
  openPluginTool?: (pluginId: string, toolId: string, text: string) => Promise<void>
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
      // Path conversion accepts one path per text line.
      // Never flatten a legal POSIX filename containing a newline into extra files.
      if (paths.some((path) => /[\r\n]/.test(path))) return { ok: false, error: 'FilePathLineBreakError' }
      if (!handlers.openPluginTool) return { ok: false, error: 'HandlerUnavailable' }
      // shortcut: tools accept text, not structured files; replace when the input protocol supports files.
      await handlers.openPluginTool('text-tools', 'paths.convert', paths.join('\n'))
      return { ok: true }
    }

    switch (target) {
      case 'copy': {
        await handlers.copyText(text)
        return { ok: true }
      }
      case 'open-editor': {
        await handlers.openInEditor(text, { title: action.titleZh })
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

// ─── Get all targets for an action ─────────────────────────────────────────────

export function getActionOutputTargets(action: RecommendedAction): RecommendedOutputTarget[] {
  return [action.defaultOutput, ...(action.alternativeOutputs ?? [])]
}
