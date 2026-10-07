/**
 * First-party JSON Tools plugin.
 *
 * One global workspace for JSON conversions and expressions.
 * Direct conversion tools remain available in editor command entries.
 */

import { definePlugin, type PluginToolExplicitTextPreviewContext, type PluginToolTextPreviewResult, type PluginToolSurfaces } from '@hiven/plugin'
import { JsonSurface } from './JsonSurface'
import { operationRoutes } from './routes'
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
  sortJsonKeys,
  unescapeJsonString,
  yamlToJson,
} from './jsonCore'
import './style.css'

const LEARNABLE_PURE = { effect: 'pure', learnable: true } as const

// ─── Plugin Definition ────────────────────────────────────────────────────────

const EDITOR_TOOL_SURFACES: PluginToolSurfaces = {
  launcher: { surfaces: ['editor-command-bar', 'quick-editor-command'] },
  panel: true,
}

const WORKSPACE_SHELL = {
  defaultWidth: 860,
  defaultHeight: 660,
  minWidth: 640,
  minHeight: 420,
  closeOnBlur: false,
  resizable: true,
}

function toolError(error: unknown, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (error instanceof JsonCoreError) return t(`error.${error.code}`)
  return t('error.convert', { message: error instanceof Error ? error.message : String(error) })
}

function prettifyText(ctx: PluginToolExplicitTextPreviewContext): PluginToolTextPreviewResult {
  try {
    return { ok: true, text: jsonPrettify(ctx.input.text, Number(ctx.params.indent ?? 2), Boolean(ctx.params.sortKeys)) }
  } catch (error) {
    return { ok: false, message: toolError(error, ctx.t) }
  }
}

export const jsonToolsPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'JSON / YAML',
        titleI18n: { zh: 'JSON / YAML' },
        icon: 'Braces',
        aliases: ['json', 'json tools', 'json工作台'],
        textMatch: (text) => isJson(text) || isQueryString(text),
        component: JsonSurface,
        entry: {
          launcher: { surfaces: ['global-launcher', 'editor-command-bar', 'quick-editor-command'] },
          shortcutBindable: true,
        },
        shell: WORKSPACE_SHELL,
      },
      ...operationRoutes.map((route) => ({
        id: route.id,
        kind: 'custom-view' as const,
        title: 'JSON / YAML',
        titleI18n: { zh: 'JSON / YAML' },
        component: JsonSurface,
        entry: { launcher: false },
        shell: WORKSPACE_SHELL,
      })),
    ],
  },
  launcher: {
    items: operationRoutes.map((route) => ({
      id: `open-${route.id}`,
      display: {
        title: route.id === 'format' ? 'route.formatWorkbench' : route.titleKey,
        subtitle: 'route.open',
        icon: 'Braces',
        aliases: route.aliases,
      },
      behavior: { type: 'perform' as const },
      surfaces: ['global-launcher' as const],
      execute(execution) {
        execution.api.openSurface(route.id, { initialText: execution.input?.text })
        return { ok: true as const, keepOpen: true }
      },
    })),
  },
  tools: [
    {
      id: 'yaml.toJson',
      title: 'yaml.toJson.title',
      subtitle: 'yaml.toJson.description',
      icon: 'FileCode',
      aliases: ['yaml to json', 'yaml2json', 'yaml转json'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      accepts: { kinds: ['yaml'], aliases: ['yaml', '转json'] },
      run(ctx) {
        try { return ctx.output.text(yamlToJson(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'yaml.fromJson',
      title: 'yaml.fromJson.title',
      subtitle: 'yaml.fromJson.description',
      icon: 'FileCode',
      aliases: ['json to yaml', 'json2yaml', 'json转yaml'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      accepts: { kinds: ['json'], aliases: ['转yaml', 'json to yaml', 'json2yaml'] },
      run(ctx) {
        try { return ctx.output.text(jsonToYaml(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'json.prettify',
      title: 'json.prettify.title',
      subtitle: 'json.prettify.description',
      icon: 'Braces',
      aliases: ['fmt', '格式化', 'pretty', 'json format', 'json格式化', 'pretty json', 'json beautify', 'format json'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      explicitTextPreview: { run: prettifyText },
      params: [
        { key: 'indent', label: 'json.indent.label', type: 'number', default: 2, saveable: true },
        { key: 'sortKeys', label: 'json.sortKeys.label', type: 'boolean', default: false, saveable: true },
      ],
      accepts: { kinds: ['json'], aliases: ['fmt', '格式化', 'pretty'] },
      textMatch: isJson,
      run(ctx) {
        const result = prettifyText(ctx)
        return result.ok ? ctx.output.text(result.text) : ctx.output.error(result.message)
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'json.compact',
      title: 'json.compact.title',
      subtitle: 'json.compact.description',
      icon: 'Braces',
      aliases: ['json minify', 'json压缩', 'compact json', 'json compress', 'minify json', '压缩'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      accepts: { kinds: ['json'] },
      textMatch: isJson,
      run(ctx) {
        try { return ctx.output.text(jsonCompact(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'sort-json.run',
      title: 'sortJson.title',
      subtitle: 'sortJson.description',
      icon: 'ArrowUpNarrowWide',
      aliases: ['json sort', 'sort json keys', 'json key排序', 'json排序', '排序'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      accepts: { kinds: ['json'] },
      textMatch: isJson,
      run(ctx) {
        try { return ctx.output.text(sortJsonKeys(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'query-string.toJson',
      title: 'queryString.toJson.title',
      subtitle: 'queryString.toJson.description',
      icon: 'Search',
      aliases: ['qs2json', 'query to json', 'querystring to json', 'qs转json', 'query string to json', '查询参数转json'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      textMatch: isQueryString,
      run(ctx) {
        try { return ctx.output.text(queryStringToJson(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'query-string.fromJson',
      title: 'queryString.fromJson.title',
      subtitle: 'queryString.fromJson.description',
      icon: 'Search',
      aliases: ['json2qs', 'json to query', 'json to querystring', 'json转qs', 'json to query string', 'json转查询参数'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      accepts: { kinds: ['json'] },
      textMatch: isJson,
      run(ctx) {
        try { return ctx.output.text(jsonToQueryString(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'json.escape-string',
      title: 'json.escape.title',
      subtitle: 'json.escape.description',
      icon: 'Quote',
      aliases: ['json escape', 'escape string', '字符串转义', '转义'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      run(ctx) {
        try { return ctx.output.text(escapeJsonString(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'json.unescape-string',
      title: 'json.unescape.title',
      subtitle: 'json.unescape.description',
      icon: 'Quote',
      aliases: ['json unescape', 'unescape string', '字符串反转义', '反转义'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      run(ctx) {
        try { return ctx.output.text(unescapeJsonString(ctx.input.text)) }
        catch (error) { return ctx.output.error(toolError(error, ctx.t)) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
  ],
})

export default jsonToolsPlugin
