/** Sample inference only; numeric lexemes never pass through JavaScript Number. */
export class JsonTypeInferenceError extends Error {
  readonly code: 'typeDuplicateKey' | 'typeLimit' | 'typeInvalidJson'
  constructor(code: JsonTypeInferenceError['code']) { super(code); this.code = code }
}
type Shape = { kind: 'string' | 'number' | 'boolean' | 'null' }
  | { kind: 'array'; items: Shape[] }
  | { kind: 'object'; fields: Map<string, Shape> }
const INPUT_LIMIT = 128 * 1024, OUTPUT_LIMIT = 512 * 1024, NODE_LIMIT = 20000, DEPTH_LIMIT = 64
const encoder = new TextEncoder()
export function inferJsonType(input: string): string {
  const fail = (code: JsonTypeInferenceError['code']): never => { throw new JsonTypeInferenceError(code) }
  if (input.length > INPUT_LIMIT || encoder.encode(input).length > INPUT_LIMIT) fail('typeLimit')
  let at = 0, nodes = 0
  const whitespace = () => { while (/[\x20\t\r\n]/.test(input[at] ?? '') && at < input.length) at++ }
  const string = (): string => {
    const start = at++
    while (at < input.length) {
      const char = input[at++]
      if (char === '"') {
        try { return JSON.parse(input.slice(start, at)) as string } catch { return fail('typeInvalidJson') }
      }
      if (char === '\\') at++
    }
    return fail('typeInvalidJson')
  }
  const parse = (depth: number): Shape => {
    if (depth > DEPTH_LIMIT || ++nodes > NODE_LIMIT) fail('typeLimit')
    whitespace()
    const char = input[at]
    if (char === '"') { string(); return { kind: 'string' } }
    if (char === '{') {
      at++; whitespace(); const fields = new Map<string, Shape>()
      if (input[at] === '}') { at++; return { kind: 'object', fields } }
      while (true) {
        whitespace(); if (input[at] !== '"') fail('typeInvalidJson')
        const key = string(); whitespace()
        if (fields.has(key)) fail('typeDuplicateKey')
        if (input[at++] !== ':') fail('typeInvalidJson')
        fields.set(key, parse(depth + 1)); whitespace()
        if (input[at] === '}') { at++; break }
        if (input[at++] !== ',') fail('typeInvalidJson')
      }
      return { kind: 'object', fields }
    }
    if (char === '[') {
      at++; whitespace(); const items: Shape[] = []
      if (input[at] === ']') { at++; return { kind: 'array', items } }
      while (true) {
        items.push(parse(depth + 1)); whitespace()
        if (input[at] === ']') { at++; break }
        if (input[at++] !== ',') fail('typeInvalidJson')
      }
      return { kind: 'array', items }
    }
    for (const [literal, kind] of [['true', 'boolean'], ['false', 'boolean'], ['null', 'null']] as const) {
      if (input.startsWith(literal, at)) { at += literal.length; return { kind } }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(at))
    if (number) { at += number[0].length; return { kind: 'number' } }
    return fail('typeInvalidJson')
  }
  const root = parse(0); whitespace(); if (at !== input.length) fail('typeInvalidJson')
  let renderedNodes = 0
  const bounded = (value: string) => { if (value.length > OUTPUT_LIMIT) fail('typeLimit'); return value }
  const render = (shapes: Shape[], depth: number): string => {
    if (depth > DEPTH_LIMIT || ++renderedNodes > NODE_LIMIT) fail('typeLimit')
    const groups = new Map<Shape['kind'], Shape[]>()
    for (const shape of shapes) { const group = groups.get(shape.kind) ?? []; group.push(shape); groups.set(shape.kind, group) }
    const parts: string[] = []
    for (const [kind, group] of groups) {
      if (kind === 'object') {
        const objects = group as Extract<Shape, { kind: 'object' }>[]
        const fields = new Map<string, Shape[]>()
        for (const object of objects) for (const [key, value] of object.fields) {
          const values = fields.get(key) ?? []; values.push(value); fields.set(key, values)
        }
        if (!fields.size) { parts.push('Record<string, never>'); continue }
        const lines: string[] = []; let length = 0
        for (const [key, values] of fields) {
          // Always quote keys, including __proto__, reserved words and Unicode.
          const quoted = JSON.stringify(key).replace(/[\u2028\u2029]/g, c => c === '\u2028' ? '\\u2028' : '\\u2029')
          const line = `${'  '.repeat(depth + 1)}${quoted}${values.length < objects.length ? '?' : ''}: ${render(values, depth + 1)};`
          length += line.length + 1; if (length > OUTPUT_LIMIT) fail('typeLimit')
          lines.push(line)
        }
        parts.push(bounded(`{\n${lines.join('\n')}\n${'  '.repeat(depth)}}`))
      } else if (kind === 'array') {
        const items: Shape[] = []
        for (const array of group as Extract<Shape, { kind: 'array' }>[]) items.push(...array.items)
        parts.push(items.length ? bounded(`Array<${render(items, depth + 1)}>`) : 'unknown[]')
      } else parts.push(kind)
    }
    return bounded(parts.join(' | '))
  }
  const result = bounded(`export type Root = ${render([root], 0)};\n`)
  if (encoder.encode(result).length > OUTPUT_LIMIT) fail('typeLimit')
  return result
}
