import { type PluginToolContribution, type PluginToolContext, type PluginToolSurfaces } from '@hiven/plugin'
import {
  isJson,
  isQueryString,
  escapeJsonString,
  jsonCompact,
  jsonPrettify,
  jsonToQueryString,
  jsonToYaml,
  JsonCoreError,
  queryStringToJson,
  unescapeJsonString,
  yamlToJson,
} from './jsonCore'

const PURE_ACTION_POLICY = { effect: 'pure' } as const

// ─── Plugin Definition ────────────────────────────────────────────────────────

const TEXT_TOOL_SURFACES: PluginToolSurfaces = {
  launcher: { surfaces: ['global-launcher', 'quick-editor-command'] },
  panel: true,
}


function toolError(error: unknown, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (error instanceof JsonCoreError) return t(`error.${error.code}`)
  return t('json.error.convert', { message: error instanceof Error ? error.message : String(error) })
}

type TextResult = { ok: true; text: string } | { ok: false; message: string }

function prettifyText(ctx: PluginToolContext): TextResult {
  try {
    return { ok: true, text: jsonPrettify(ctx.input.text, Number(ctx.params.indent ?? 2), Boolean(ctx.params.sortKeys)) }
  } catch (error) {
    return { ok: false, message: toolError(error, ctx.t) }
  }
}

export const jsonTools: PluginToolContribution[] = [
    {
      id: 'yaml.toJson',
      title: 'yaml.toJson.title',
      subtitle: 'yaml.toJson.description',
      icon: 'FileCode',
      aliases: ['yaml to json', 'yaml2json', 'yaml转json'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['yaml'], aliases: ['yaml', '转json'] },
      run(ctx) {
        try { return ctx.output.text(yamlToJson(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'yaml.fromJson',
      title: 'yaml.fromJson.title',
      subtitle: 'yaml.fromJson.description',
      icon: 'FileCode',
      aliases: ['json to yaml', 'json2yaml', 'json转yaml'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['json'], aliases: ['转yaml', 'json to yaml', 'json2yaml'] },
      run(ctx) {
        try { return ctx.output.text(jsonToYaml(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'json.prettify',
      title: 'json.prettify.title',
      subtitle: 'json.prettify.description',
      icon: 'Braces',
      aliases: ['fmt', '格式化', 'pretty', 'json format', 'json格式化', 'format json', '格式化 JSON'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      params: [
        { key: 'indent', label: 'json.indent.label', type: 'number', default: 2, options: ['2', '4'] },
        { key: 'sortKeys', label: 'json.sortKeys.label', type: 'boolean', default: false },
      ],
      accepts: { kinds: ['json'], aliases: ['fmt', '格式化', 'pretty'] },
      textMatch: isJson,
      run(ctx) {
        const result = prettifyText(ctx)
        return result.ok ? ctx.output.text(result.text) : ctx.output.error(result.message)
      },
      surfaces: { launcher: { surfaces: ['global-launcher', 'quick-editor-command'] }, panel: true },
    },
    {
      id: 'json.compact',
      title: 'json.compact.title',
      subtitle: 'json.compact.description',
      icon: 'Braces',
      aliases: ['json minify', 'json压缩', 'compact json', 'json compress', 'minify json', '压缩'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['json'] },
      textMatch: isJson,
      run(ctx) {
        try { return ctx.output.text(jsonCompact(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'query-string.toJson',
      title: 'queryString.toJson.title',
      subtitle: 'queryString.toJson.description',
      icon: 'Search',
      aliases: ['qs2json', 'query to json', 'querystring to json', 'qs转json', 'query string to json', '查询参数转json'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      textMatch: isQueryString,
      run(ctx) {
        try { return ctx.output.text(queryStringToJson(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'query-string.fromJson',
      title: 'queryString.fromJson.title',
      subtitle: 'queryString.fromJson.description',
      icon: 'Search',
      aliases: ['json2qs', 'json to query', 'json to querystring', 'json转qs', 'json to query string', 'json转查询参数'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['json'] },
      textMatch: isJson,
      run(ctx) {
        try { return ctx.output.text(jsonToQueryString(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'json.escape-string',
      title: 'json.escape.title',
      subtitle: 'json.escape.description',
      icon: 'Quote',
      aliases: ['json escape', 'escape string', '字符串转义', '转义'],
      accepts: { aliases: ['json escape', 'escape string', '字符串转义', '转义'] },
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      run(ctx) {
        try { return ctx.output.text(escapeJsonString(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'json.unescape-string',
      title: 'json.unescape.title',
      subtitle: 'json.unescape.description',
      icon: 'Quote',
      aliases: ['json unescape', 'unescape string', '字符串反转义', '反转义'],
      accepts: { regex: '^\\s*".*"\\s*$', aliases: ['json unescape', 'unescape string', '字符串反转义', '反转义'] },
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      run(ctx) {
        try { return ctx.output.text(unescapeJsonString(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
  ]
