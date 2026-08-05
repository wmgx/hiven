import type { Locale } from '../i18n'
import { minifyJsonText } from './editorTextTransforms'

/**
 * Linear text pipeline: each step receives the previous step's text output.
 * Steps are pure functions in MVP — no plugin runtime dependency.
 */

export type TextPipelineStep = {
  id: string
  /** Human-readable step title (English default). */
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  run: (input: string) => Promise<string> | string
}

export type TextPipeline = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  aliases?: string[]
  steps: TextPipelineStep[]
}

const pipelines = new Map<string, TextPipeline>()
let builtinsRegistered = false

export function registerTextPipeline(pipeline: TextPipeline): void {
  if (!pipeline.id.trim()) {
    throw new Error('TextPipeline.id is required')
  }
  if (!pipeline.steps.length) {
    throw new Error(`TextPipeline "${pipeline.id}" must have at least one step`)
  }
  pipelines.set(pipeline.id, pipeline)
}

export function listTextPipelines(): TextPipeline[] {
  return Array.from(pipelines.values())
}

export function getTextPipeline(id: string): TextPipeline | undefined {
  return pipelines.get(id)
}

/** Test helper — clears registry and builtin flag. */
export function clearTextPipelinesForTests(): void {
  pipelines.clear()
  builtinsRegistered = false
}

export async function runTextPipeline(pipeline: TextPipeline, input: string): Promise<string> {
  let current = input
  for (const step of pipeline.steps) {
    current = await Promise.resolve(step.run(current))
  }
  return current
}

/** Built-in demo pipelines (pure functions, no plugin runtime). */
export function registerBuiltinTextPipelines(): void {
  if (builtinsRegistered) return
  builtinsRegistered = true

  registerTextPipeline({
    id: 'trim-uppercase',
    title: 'Trim → Uppercase',
    titleI18n: { zh: '去空白 → 转大写' },
    aliases: ['trim upper', 'trim uppercase', 'pipeline trim', '去空白大写', '转大写'],
    steps: [
      {
        id: 'trim',
        title: 'Trim',
        titleI18n: { zh: '去空白' },
        run: (input) => input.trim(),
      },
      {
        id: 'uppercase',
        title: 'Uppercase',
        titleI18n: { zh: '转大写' },
        run: (input) => input.toUpperCase(),
      },
    ],
  })

  registerTextPipeline({
    id: 'json-minify',
    title: 'JSON Minify',
    titleI18n: { zh: 'JSON 压缩' },
    aliases: ['minify json', 'json minify', 'compact json', '压缩 json', 'json压缩'],
    steps: [
      {
        id: 'minify',
        title: 'Minify',
        titleI18n: { zh: '压缩' },
        run: (input) => {
          const minified = minifyJsonText(input)
          if (minified == null) {
            throw new Error('Invalid JSON')
          }
          return minified
        },
      },
    ],
  })
}
