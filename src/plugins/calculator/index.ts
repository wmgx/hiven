import BigNumber from 'bignumber.js'
import { textOutput, textError, type PluginDefinition, type TextInput, type LauncherDynamicContext, type LauncherItemContribution } from '@hiven/plugin'

// ─── Safe Math Parser ────────────────────────────────────────────────────────
// A simple recursive descent parser for arithmetic expressions.
// Supports: numbers, decimals, parentheses, +, -, *, /, unary +/-, %

type Token =
  | { type: 'number'; value: BigNumber }
  | { type: 'op'; value: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'percent' }

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (ch === ' ' || ch === '\t') {
      i++
      continue
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch })
      i++
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch })
      i++
      continue
    }
    if (ch === '%') {
      tokens.push({ type: 'percent' })
      i++
      continue
    }
    if (/[0-9.]/.test(ch)) {
      const match = expr.slice(i).match(/^(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)/)
      if (!match) return null
      const numStr = match[0]
      i += numStr.length
      const num = new BigNumber(numStr.replaceAll(',', ''))
      if (num.isNaN()) return null
      tokens.push({ type: 'number', value: num })
      continue
    }
    // Unknown character
    return null
  }
  return tokens.length > 0 ? tokens : null
}

// Recursive descent parser: expr → term ((+|-) term)*
// term → unary ((*|/) unary)*
// unary → (+|-) unary | factor
// factor → NUMBER %? | '(' expr ')' %?

function parse(tokens: Token[]): BigNumber | null {
  let pos = 0

  function peek(): Token | undefined {
    return tokens[pos]
  }

  function consume(): Token {
    return tokens[pos++]
  }

  function parseExpr(): BigNumber | null {
    let left = parseTerm()
    if (left === null) return null
    while (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      const op = consume().value as string
      const right = parseTerm()
      if (right === null) return null
      left = op === '+' ? left.plus(right) : left.minus(right)
    }
    return left
  }

  function parseTerm(): BigNumber | null {
    let left = parseUnary()
    if (left === null) return null
    while (peek()?.type === 'op' && (peek()!.value === '*' || peek()!.value === '/')) {
      const op = consume().value as string
      const right = parseUnary()
      if (right === null) return null
      if (op === '/') {
        if (right.isZero()) return null // division by zero
        left = left.div(right)
      } else {
        left = left.times(right)
      }
    }
    return left
  }

  function parseUnary(): BigNumber | null {
    const t = peek()
    if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
      consume()
      const val = parseUnary()
      if (val === null) return null
      return t.value === '-' ? val.negated() : val
    }
    return parseFactor()
  }

  function parseFactor(): BigNumber | null {
    const t = peek()
    if (!t) return null

    if (t.type === 'number') {
      consume()
      let value = t.value
      // Check for trailing percent
      if (peek()?.type === 'percent') {
        consume()
        value = value.div(100)
      }
      return value
    }

    if (t.type === 'paren' && t.value === '(') {
      consume() // consume '('
      const val = parseExpr()
      if (val === null) return null
      const closing = peek()
      if (!closing || closing.type !== 'paren' || closing.value !== ')') return null
      consume() // consume ')'
      // Check for trailing percent
      let result = val
      if (peek()?.type === 'percent') {
        consume()
        result = result.div(100)
      }
      return result
    }

    return null
  }

  const result = parseExpr()
  if (result === null || pos !== tokens.length) return null
  return result
}

function formatBigNumber(value: BigNumber): string {
  if (value.isZero()) return '0'
  return value
    .decimalPlaces(10)
    .toFixed()
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
}

function safeCalculate(expr: string): string | null {
  const trimmed = expr.trim()
  if (!trimmed) return null

  // Must contain at least one operator or percent to be a calculation
  if (!/[+\-*/%(]/.test(trimmed)) return null

  // Avoid matching things that look like timestamps or dates
  if (/^\d{10,13}$/.test(trimmed)) return null

  const tokens = tokenize(trimmed)
  if (!tokens) return null

  const result = parse(tokens)
  if (result === null || !result.isFinite()) return null

  // Format: remove trailing zeros from decimals, max 10 decimal places
  return formatBigNumber(result)
}

function calculateFormulaLines(text: string): string {
  const lines = text.split(/\r?\n/)
  const results: string[] = []
  let stopped = false

  for (const line of lines) {
    if (stopped) {
      results.push(line)
      continue
    }

    const trimmed = line.trim()
    const hasTrailingEquals = trimmed.endsWith('=')
    if (trimmed.includes('=') && !hasTrailingEquals) {
      results.push(line)
      continue
    }

    const formulaText = hasTrailingEquals ? line.slice(0, line.lastIndexOf('=')).trimEnd() : line
    const result = safeCalculate(formulaText.trim())
    if (result === null) {
      stopped = true
      results.push(line)
      continue
    }

    results.push(`${formulaText} = ${result}`)
  }

  return results.join('\n')
}

function sumNumericTokens(text: string): string {
  const tokens = text.match(/(?<![\w.])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\w.])/g) ?? []
  const nums = tokens
    .map((token: string) => new BigNumber(token.replaceAll(',', '')))
    .filter((num: BigNumber) => !num.isNaN())

  if (nums.length === 0) return '0'
  return nums.reduce((acc: BigNumber, num: BigNumber) => acc.plus(num), new BigNumber(0)).toFixed()
}

type BaseConversionMode = 'dec2hex' | 'hex2dec' | 'dec2bin' | 'bin2dec'

function parseSignedBaseInteger(raw: string, radix: 2 | 10 | 16): bigint {
  const trimmed = raw.trim()
  const sign = trimmed.startsWith('-') ? -1n : 1n
  const unsigned = trimmed.replace(/^[+-]/, '')
  if (!unsigned) throw new Error('Missing number')

  if (radix === 10) {
    if (!/^\d+$/.test(unsigned)) throw new Error(`Invalid decimal number: ${raw}`)
    return sign * BigInt(unsigned)
  }

  if (radix === 16) {
    const digits = unsigned.replace(/^0x/i, '')
    if (!/^[0-9a-f]+$/i.test(digits)) throw new Error(`Invalid hex number: ${raw}`)
    return sign * BigInt(`0x${digits}`)
  }

  const digits = unsigned.replace(/^0b/i, '')
  if (!/^[01]+$/i.test(digits)) throw new Error(`Invalid binary number: ${raw}`)
  return sign * BigInt(`0b${digits}`)
}

function convertBaseValue(value: string, mode: BaseConversionMode): string {
  switch (mode) {
    case 'dec2hex':
      return parseSignedBaseInteger(value, 10).toString(16).toUpperCase()
    case 'hex2dec':
      return parseSignedBaseInteger(value, 16).toString(10)
    case 'dec2bin':
      return parseSignedBaseInteger(value, 10).toString(2)
    case 'bin2dec':
      return parseSignedBaseInteger(value, 2).toString(10)
  }
}

function convertBaseLines(text: string, mode: BaseConversionMode): string {
  return text.trim().split('\n').map((line) => convertBaseValue(line, mode)).join('\n')
}

// ─── Plugin Definition ───────────────────────────────────────────────────────

const definition: PluginDefinition = {
  tools: [
    {
      id: 'calculator.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'Calculator',
      aliases: ['calc', 'formula'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.replaceActiveText(calculateFormulaLines(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'calculator.sum',
      title: 'command.sum.title',
      subtitle: 'command.sum.description',
      icon: 'Calculator',
      aliases: ['sum', 'add', 'total'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.replaceActiveText(sumNumericTokens(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'calculator.base',
      title: 'command.base.title',
      subtitle: 'command.base.description',
      icon: 'Binary',
      aliases: ['decimal', 'binary', 'hex', 'hex-convert'],
      inputPolicy: { mode: 'auto' },
      params: [
        {
          key: 'mode',
          label: 'param.base.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.base.mode.option.dec2hex.label', value: 'dec2hex' },
            { label: 'param.base.mode.option.hex2dec.label', value: 'hex2dec' },
            { label: 'param.base.mode.option.dec2bin.label', value: 'dec2bin' },
            { label: 'param.base.mode.option.bin2dec.label', value: 'bin2dec' },
          ],
          default: 'dec2hex',
        },
      ],
      run(ctx) {
        try {
          return ctx.output.replaceActiveText(convertBaseLines(
            ctx.input.text,
            (ctx.params.mode ?? 'dec2hex') as BaseConversionMode,
          ))
        } catch (error: any) {
          return ctx.output.error(`Error: ${error.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'calculator.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Calculator',
      aliases: ['calc', 'formula'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        return textOutput(calculateFormulaLines(text))
      },
    },
    {
      id: 'calculator.sum',
      title: 'command.sum.title',
      description: 'command.sum.description',
      icon: 'Calculator',
      aliases: ['sum', 'add', 'total'],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        return textOutput(sumNumericTokens(text))
      },
    },
    {
      id: 'calculator.base',
      title: 'command.base.title',
      description: 'command.base.description',
      icon: 'Binary',
      aliases: ['decimal', 'binary', 'hex', 'hex-convert'],
      params: [
        {
          key: 'mode',
          label: 'param.base.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.base.mode.option.dec2hex.label', value: 'dec2hex' },
            { label: 'param.base.mode.option.hex2dec.label', value: 'hex2dec' },
            { label: 'param.base.mode.option.dec2bin.label', value: 'dec2bin' },
            { label: 'param.base.mode.option.bin2dec.label', value: 'bin2dec' },
          ],
          default: 'dec2hex',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        try {
          return textOutput(convertBaseLines(text, (ctx.params.mode ?? 'dec2hex') as BaseConversionMode))
        } catch (error: any) {
          return textError(`Error: ${error.message}`)
        }
      },
    },
  ],
  launcher: {
    dynamicItems(ctx: LauncherDynamicContext): LauncherItemContribution[] {
      const result = safeCalculate(ctx.query)
      if (result === null) return []
      return [{
        id: 'calc-result',
        display: { title: `${ctx.query.trim()} = ${result}`, subtitle: ctx.query, icon: 'Calculator' },
        behavior: { type: 'perform' },
        async execute(ctx2) {
          await ctx2.api.copyText(result)
          return { ok: true, output: { choices: [{ id: 'copy', title: result, primaryAction: async () => { await ctx2.api.copyText(result) } }] } }
        },
      }]
    },
  },
}

export default definition
