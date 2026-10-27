import type { PluginToolContribution } from '@hiven/plugin'
import { cleanInvisibleCharacters } from './line/cleanInvisibleCharacters'
import { cleanAgentText } from './line/cleanAgentText'
import { duplicateLineReport, findDuplicateLines } from './line/core'
import { runMarkdownPlain } from './line/markdownPlainExecution'
import { evaluateJsonExpression, isJson, JsonCoreError } from './json/jsonCore'
import { inferJsonType, JsonTypeInferenceError } from './json/jsonTypeInference'

export const additionalTools: PluginToolContribution[] = ([
  {
    id: 'line-tools.clean-invisible-characters', title: 'invisibleCharacters.title', icon: 'RemoveFormatting',
    run(ctx) { return ctx.output.text(cleanInvisibleCharacters(ctx.input.text).text) },
  },
  {
    id: 'line-tools.markdown-plain-text', title: 'markdownPlain.title', icon: 'FileText',
    aliases: ['markdown plain text', 'Markdown 转纯文本'],
    async run(ctx) {
      try { return ctx.output.text(await runMarkdownPlain(ctx.input.text, ctx.t('markdownPlain.image'))) }
      catch (error) { return ctx.output.error(ctx.t(error instanceof Error ? error.message : 'markdownPlain.failed')) }
    },
  },
  {
    id: 'line-tools.clean-agent-text', title: 'cleanAgent.title', icon: 'RemoveFormatting',
    params: [{ key: 'includeAscii', label: 'cleanAgent.includeAscii', type: 'boolean', default: false }],
    run(ctx) { return ctx.output.text(cleanAgentText(ctx.input.text, ctx.params.includeAscii === true)) },
  },
  {
    id: 'line-tools.find-duplicates', title: 'duplicates.title', icon: 'Copy',
    params: [
      { key: 'ignoreCase', label: 'param.ignoreCase', type: 'boolean', default: false },
      { key: 'trim', label: 'param.cleanList.trim', type: 'boolean', default: false },
    ],
    run(ctx) { return ctx.output.text(duplicateLineReport(findDuplicateLines(ctx.input.text, { ignoreCase: ctx.params.ignoreCase === true, trim: ctx.params.trim === true }))) },
  },
  {
    id: 'json.typescript', title: 'typescript.title', icon: 'FileCode', textMatch: isJson,
    aliases: ['json to typescript', 'JSON 转 TypeScript'],
    run(ctx) {
      try { return ctx.output.text(inferJsonType(ctx.input.text)) }
      catch (error) { return ctx.output.error(ctx.t(error instanceof JsonTypeInferenceError ? `error.${error.code}` : 'error.typeInvalidJson')) }
    },
  },
  {
    id: 'json.expression', title: 'expression.title', icon: 'Braces', textMatch: isJson,
    // shortcut: the existing JavaScript evaluator is unsandboxed; require explicit execution until it is replaced.
    policy: { effect: 'unknown' },
    params: [{ key: 'expression', label: 'expression.label', type: 'text', default: '' }],
    run(ctx) {
      try { return ctx.output.text(evaluateJsonExpression(ctx.input.text, String(ctx.params.expression ?? ''))) }
      catch (error) { return ctx.output.error(ctx.t(error instanceof JsonCoreError ? `error.${error.code}` : 'error.expression')) }
    },
  },
] satisfies PluginToolContribution[]).map((tool): PluginToolContribution => ({
  inputPolicy: { mode: 'auto' }, policy: { effect: 'pure' },
  surfaces: { launcher: { surfaces: ['global-launcher', 'quick-editor-command'] }, panel: true },
  ...tool,
}))
