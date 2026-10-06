import jsYaml from 'js-yaml'

export type JsonOperation =
  | 'format'
  | 'compact'
  | 'sort'
  | 'query-to-json'
  | 'json-to-query'
  | 'escape'
  | 'unescape'
  | 'expression'
  | 'yaml-to-json'
  | 'json-to-yaml'

export type JsonProcessOptions = {
  operation: JsonOperation
  indent?: number
  sortKeys?: boolean
  expression?: string
}

export type JsonProcessResult =
  | { ok: true; output: string }
  | { ok: false; message: string; code?: JsonCoreErrorCode }

export type JsonCoreErrorCode = 'objectRequired' | 'stringRequired' | 'expressionRequired' | 'finiteNumberRequired'

export class JsonCoreError extends Error {
  readonly code: JsonCoreErrorCode

  constructor(code: JsonCoreErrorCode) {
    super(code)
    this.code = code
  }
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      sortKeys((value as Record<string, unknown>)[key]),
    ]))
  }
  return value
}

export function jsonPrettify(text: string, indent = 2, shouldSort = false): string {
  const value = JSON.parse(text)
  return JSON.stringify(shouldSort ? sortKeys(value) : value, null, indent)
}

export function jsonCompact(text: string): string {
  return JSON.stringify(JSON.parse(text))
}

export function sortJsonKeys(text: string): string {
  return JSON.stringify(sortKeys(JSON.parse(text)), null, 2)
}

export function queryStringToJson(text: string): string {
  const query = text.trim().replace(/^\?/, '')
  const params = new URLSearchParams(query)
  return JSON.stringify(Object.fromEntries(params), null, 2)
}

export function jsonToQueryString(text: string): string {
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JsonCoreError('objectRequired')
  }
  const params = new URLSearchParams()
  for (const [key, entry] of Object.entries(value)) params.set(key, String(entry))
  return params.toString()
}

export function escapeJsonString(text: string): string {
  return JSON.stringify(text)
}

export function unescapeJsonString(text: string): string {
  const value = JSON.parse(text)
  if (typeof value !== 'string') throw new JsonCoreError('stringRequired')
  return value
}

export function yamlToJson(text: string, indent = 2): string {
  const value = jsYaml.load(text, { schema: jsYaml.JSON_SCHEMA })
  return JSON.stringify(value ?? null, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new JsonCoreError('finiteNumberRequired')
    return item
  }, indent)
}

export function jsonToYaml(text: string, indent = 2): string {
  return jsYaml.dump(JSON.parse(text), { schema: jsYaml.JSON_SCHEMA, indent })
}

/** Evaluate the existing JSON Tools expression syntax against parsed JSON. User-triggered only. */
export function evaluateJsonExpression(text: string, expression: string): string {
  const data = JSON.parse(text)
  const expr = expression.trim()
  if (!expr) throw new JsonCoreError('expressionRequired')
  const fn = new Function(`"use strict"; return (this)${expr}`)
  const value = fn.call(data)
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value)
}

export function processJson(text: string, options: JsonProcessOptions): JsonProcessResult {
  if (!text) return { ok: true, output: '' }
  if (!text.trim() && options.operation !== 'escape') return { ok: true, output: '' }
  try {
    switch (options.operation) {
      case 'format':
        return { ok: true, output: jsonPrettify(text, options.indent ?? 2, options.sortKeys === true) }
      case 'compact':
        return { ok: true, output: jsonCompact(text) }
      case 'sort':
        return { ok: true, output: sortJsonKeys(text) }
      case 'query-to-json':
        return { ok: true, output: queryStringToJson(text) }
      case 'json-to-query':
        return { ok: true, output: jsonToQueryString(text) }
      case 'escape':
        return { ok: true, output: escapeJsonString(text) }
      case 'unescape':
        return { ok: true, output: unescapeJsonString(text) }
      case 'expression':
        return { ok: true, output: evaluateJsonExpression(text, options.expression ?? '') }
      case 'yaml-to-json':
        return { ok: true, output: yamlToJson(text, options.indent ?? 2) }
      case 'json-to-yaml':
        return { ok: true, output: jsonToYaml(text, options.indent ?? 2) }
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      code: error instanceof JsonCoreError ? error.code : undefined,
    }
  }
}

export function isJson(text: string): boolean {
  const value = text.trim()
  if (!(value.startsWith('{') || value.startsWith('['))) return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

export function isQueryString(text: string): boolean {
  const value = text.trim().replace(/^\?/, '')
  return /^[\w%+.-]+=[\w%+.*-]*(?:&[\w%+.-]+=[\w%+.*-]*)*$/.test(value)
}
