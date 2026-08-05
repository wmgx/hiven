import type { Locale } from '../i18n'
import { surfaceTextResult, errorResult } from '../workspace/launcher/output'
import type { LauncherExecutionContext, LauncherItem } from '../workspace/launcher/types'
import {
  listTextPipelines,
  registerBuiltinTextPipelines,
  runTextPipeline,
  type TextPipeline,
} from './pipeline'

/**
 * Resolve pipeline input: explicit collect-input / Object Block text first,
 * then editor active/selection, then clipboard.
 */
async function resolvePipelineInput(ctx: LauncherExecutionContext): Promise<string> {
  const manual = ctx.input?.text
  if (manual !== undefined && manual.length > 0) return manual

  const selection = ctx.api.getSelectionText().trim()
  if (selection) return selection

  const active = ctx.api.getActiveText().trim()
  if (active) return active

  try {
    const clip = (await ctx.api.getClipboardText()).trim()
    if (clip) return clip
  } catch {
    // clipboard may be unavailable outside desktop runtime
  }

  return manual ?? ''
}

function pipelineToLauncherItem(pipeline: TextPipeline): LauncherItem {
  return {
    systemKey: `host:pipeline:${pipeline.id}`,
    kind: 'host',
    display: {
      title: pipeline.title,
      titleI18n: pipeline.titleI18n,
      subtitle: pipeline.steps.map((step) => step.title).join(' → '),
      subtitleI18n: pipeline.titleI18n
        ? {
            zh: pipeline.steps
              .map((step) => step.titleI18n?.zh ?? step.title)
              .join(' → '),
          }
        : undefined,
      icon: 'ListOrdered',
      aliases: [
        ...(pipeline.aliases ?? []),
        'pipeline',
        'workflow',
        '工作流',
        '管道',
      ],
      kindLabel: 'Pipeline',
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher', 'editor-command-bar', 'quick-editor-command'],
    // Global launcher: collect text when no Object Block / editor selection.
    inputPolicy: { mode: 'auto' },
    recordUsage: true,
    execute: async (ctx) => {
      const input = await resolvePipelineInput(ctx)
      if (!input.trim()) {
        return errorResult(
          ctx.locale === 'zh' ? '需要文本输入' : 'Text input is required',
        )
      }
      try {
        const output = await runTextPipeline(pipeline, input)
        return surfaceTextResult(output, ctx.api, ctx.locale as Locale, ctx.surfaceId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return errorResult(message)
      }
    },
  }
}

/**
 * Host static launcher items for registered text pipelines.
 * Ensures builtins are registered once before listing.
 */
export function getTextPipelineLauncherItems(): LauncherItem[] {
  registerBuiltinTextPipelines()
  return listTextPipelines().map(pipelineToLauncherItem)
}

/** Convenience for tests without full host API. */
export function createTextPipelineLauncherItem(
  pipeline: TextPipeline,
): LauncherItem {
  return pipelineToLauncherItem(pipeline)
}
