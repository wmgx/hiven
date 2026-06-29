/**
 * Action Executor — Execute recommended actions with their output targets.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §8
 *
 * Phase R3: Route action execution to appropriate output target.
 */

import type { RecommendedAction, RecommendedOutputTarget } from './actionRecommendation'
import type { LauncherObjectBlock } from './objectBlock'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ActionExecutionContext = {
  block: LauncherObjectBlock
  action: RecommendedAction
  target: RecommendedOutputTarget
}

export type ActionExecutionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string }

export type ActionExecutionHandlers = {
  copyText: (text: string) => Promise<void>
  pasteToForeground: (text: string) => Promise<void>
  openInEditor: (text: string, options?: { language?: string; title?: string }) => Promise<void>
  openPluginSurface: (pluginId: string) => Promise<void>
}

// ─── Executor ──────────────────────────────────────────────────────────────────

export async function executeRecommendedAction(
  ctx: ActionExecutionContext,
  handlers: ActionExecutionHandlers,
): Promise<ActionExecutionResult> {
  const { block, action, target } = ctx
  const text = block.preview ?? ''

  try {
    switch (target) {
      case 'copy': {
        const result = await transformActionText(action, text)
        await handlers.copyText(result)
        return { ok: true, message: '已复制' }
      }
      case 'paste-to-foreground': {
        const result = await transformActionText(action, text)
        await handlers.pasteToForeground(result)
        return { ok: true, message: '已粘贴' }
      }
      case 'open-editor': {
        const result = await transformActionText(action, text)
        await handlers.openInEditor(result, { title: action.titleZh })
        return { ok: true }
      }
      case 'open-plugin-surface': {
        if (action.pluginId) {
          await handlers.openPluginSurface(action.pluginId)
          return { ok: true }
        }
        return { ok: false, error: 'No plugin surface available' }
      }
      default:
        return { ok: false, error: `Unknown output target: ${target}` }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ─── Text transform (MVP: identity for most actions) ───────────────────────────

async function transformActionText(action: RecommendedAction, text: string): Promise<string> {
  switch (action.id) {
    case 'format-clipboard-json':
    case 'format-selection': {
      try {
        return JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        return text
      }
    }
    case 'minify-json':
    case 'minify-selection': {
      try {
        return JSON.stringify(JSON.parse(text))
      } catch {
        return text
      }
    }
    default:
      return text
  }
}

// ─── Output target labels ──────────────────────────────────────────────────────

export const OUTPUT_TARGET_LABELS: Record<RecommendedOutputTarget, { en: string; zh: string }> = {
  copy: { en: 'Copy result', zh: '复制结果' },
  'paste-to-foreground': { en: 'Paste to active app', zh: '粘贴到当前应用' },
  'open-editor': { en: 'Open in Editor', zh: '打开到编辑器' },
  'open-plugin-surface': { en: 'Open tool', zh: '打开工具' },
}

export function getOutputTargetLabel(target: RecommendedOutputTarget, locale: 'en' | 'zh' = 'zh'): string {
  return OUTPUT_TARGET_LABELS[target]?.[locale] ?? target
}

// ─── Get all targets for an action ─────────────────────────────────────────────

export function getActionOutputTargets(action: RecommendedAction): RecommendedOutputTarget[] {
  return [action.defaultOutput, ...(action.alternativeOutputs ?? [])]
}
