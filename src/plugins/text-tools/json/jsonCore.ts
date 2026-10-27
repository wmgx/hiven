import { inferJsonType, JsonTypeInferenceError } from './jsonTypeInference'
import jsYaml from 'js-yaml'
import { parseUrlQuery, UrlQueryError, type UrlQueryErrorCode } from './urlQueryCore'
import { getPluginHostSdk } from '@hiven/plugin'

const { formatJson, compactJson, parseJsonLossless, stringifyJsonLossless } = getPluginHostSdk().kits.textTransforms
export const { sortKeys } = getPluginHostSdk().kits.textTransforms

export type JsonOperation =
  | 'typescript'
  | 'format'
  | 'compact'
  | 'url-query-edit'
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

export type JsonCoreErrorCode = UrlQueryErrorCode | 'typeDuplicateKey' | 'typeLimit' | 'typeInvalidJson' | 'queryDuplicateKey' | 'objectRequired' | 'stringRequired' | 'expressionRequired' | 'finiteNumberRequired'

export class JsonCoreError extends Error {
  readonly code: JsonCoreErrorCode

  constructor(code: JsonCoreErrorCode) {
    super(code)
    this.code = code
  }
}

function isMarker(value: string): boolean {
  return value.startsWith('\u0001N')
}

export function jsonPrettify(text: string, indent = 2, shouldSort = false): string {
  return formatJson(text, indent, shouldSort)
}

export function jsonCompact(text: string): string {
  return compactJson(text)
}

export function queryStringToJson(text: string): string {
  const query = text.trim().replace(/^\?/, '')
  const params = new URLSearchParams(query)
  const keys = new Set<string>()
  for (const key of params.keys()) {
    if (keys.has(key)) throw new JsonCoreError('queryDuplicateKey')
    keys.add(key)
  }
  return JSON.stringify(Object.fromEntries(params), null, 2)
}

export function jsonToQueryString(text: string): string {
  const value = parseJsonLossless(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JsonCoreError('objectRequired')
  }
  const params = new URLSearchParams()
  for (const [key, entry] of Object.entries(value)) {
    // Scalars keep their plain text; nested values and lossless numbers are written as JSON text.
    params.set(key, typeof entry === 'string' && !isMarker(entry) ? entry : stringifyJsonLossless(entry))
  }
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

// Integers beyond 2^53 become lossless markers so the original digits reach the JSON output.
const DEFAULT_INT = (jsYaml as unknown as { types: { int: { resolve: (data: string) => boolean; construct: (data: string) => number } } }).types.int
const LOSSLESS_INT = new jsYaml.Type('tag:yaml.org,2002:int', {
  kind: 'scalar',
  resolve: DEFAULT_INT.resolve,
  construct(data: string) {
    const value = DEFAULT_INT.construct(data) as number
    const plain = data.replace(/_/g, '').replace(/^\+/, '')
    return !Number.isSafeInteger(value) && /^-?\d+$/.test(plain) ? parseJsonLossless(plain) : value
  },
})
const YAML_SCHEMA = jsYaml.JSON_SCHEMA.extend({ implicit: [LOSSLESS_INT] })

export function yamlToJson(text: string, indent = 2): string {
  const value = jsYaml.load(text, { schema: YAML_SCHEMA })
  assertFinite(value)
  return stringifyJsonLossless(value ?? null, indent)
}

function assertFinite(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new JsonCoreError('finiteNumberRequired')
  if (value && typeof value === 'object') Object.values(value).forEach(assertFinite)
}

export function jsonToYaml(text: string, indent = 2): string {
  const dumped = jsYaml.dump(parseJsonLossless(text), { schema: jsYaml.JSON_SCHEMA, indent })
  // Lossless markers are dumped as quoted strings; write them back as plain numbers.
  return dumped.replace(/(["'])\\?(?:x01|u0001|\u0001)N([^"'\n]*)\1/g, '$2')
}

/** Evaluate the existing JSON Tools expression syntax against parsed JSON. User-triggered only. */
export function evaluateJsonExpression(text: string, expression: string): string {
  const data = parseJsonLossless(text)
  const expr = expression.trim()
  if (!expr) throw new JsonCoreError('expressionRequired')
  const fn = new Function(`"use strict"; return (this)${expr}`)
  const value = fn.call(data)
  if (typeof value === 'string' && !isMarker(value)) return value
  return stringifyJsonLossless(value, 2) || String(value)
}

export function processJson(text: string, options: JsonProcessOptions): JsonProcessResult {
  if (!text) return { ok: true, output: '' }
  if (!text.trim() && options.operation !== 'escape') return { ok: true, output: '' }
  try {
    switch (options.operation) {
      case 'typescript':
        return { ok: true, output: inferJsonType(text) }
      case 'format':
        return { ok: true, output: jsonPrettify(text, options.indent ?? 2, options.sortKeys === true) }
      case 'compact':
        return { ok: true, output: jsonCompact(text) }
      case 'url-query-edit':
        parseUrlQuery(text)
        return { ok: true, output: text }
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
      code: error instanceof JsonCoreError || error instanceof UrlQueryError || error instanceof JsonTypeInferenceError ? error.code : undefined,
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
