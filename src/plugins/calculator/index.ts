import BigNumber from 'bignumber.js'
import { getPluginHostSdk, textOutput, textError, type PanelPropsV2, type PluginDefinition, type PluginSurfaceProps, type TextInput, type LauncherDynamicContext, type LauncherItemContribution } from '@hiven/plugin'
import { CalculatorSurface } from './CalculatorSurface'
import './style.css'

// ─── Safe Math Parser ────────────────────────────────────────────────────────
// A small recursive descent parser for arithmetic expressions.
// Supports decimals, variables, common one-argument functions and integer powers.

const MAX_EXPRESSION_LENGTH = 1000
const MAX_ABS_EXPONENT = 1000
const MAX_RESULT_DIGITS = 10_000
const MAX_SERIALIZED_VALUE_LENGTH = MAX_RESULT_DIGITS + 3

function isManageable(value: BigNumber): boolean {
  const digits = value.precision() ?? 0
  const exponent = value.e ?? 0
  return value.isFinite()
    && Math.max(digits, digits - exponent, exponent + 1) <= MAX_RESULT_DIGITS
}

type Token =
  | { type: 'number'; value: BigNumber }
  | { type: 'identifier'; value: string }
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
    if (ch === '*' && expr[i + 1] === '*') {
      tokens.push({ type: 'op', value: '^' })
      i += 2
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
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
    if (/[A-Za-z_]/.test(ch)) {
      const match = expr.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)
      if (!match) return null
      tokens.push({ type: 'identifier', value: match[0] })
      i += match[0].length
      continue
    }
    // Unknown character
    return null
  }
  return tokens.length > 0 ? tokens : null
}

// Recursive descent parser: expr → term ((+|-) term)*
// term → unary ((*|/) unary)*
// unary → (+|-) unary | power
// power → factor (^ unary)?
// factor → (NUMBER | VARIABLE | FUNCTION(expr) | '(' expr ')') %?

function parse(tokens: Token[], variables: ReadonlyMap<string, string>): BigNumber | null {
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
    while (true) {
      const token = peek()
      if (token?.type !== 'op' || (token.value !== '+' && token.value !== '-')) break
      const op = consume()
      if (op.type !== 'op') return null
      const right = parseTerm()
      if (right === null) return null
      left = op.value === '+' ? left.plus(right) : left.minus(right)
      if (!isManageable(left)) return null
    }
    return left
  }

  function parseTerm(): BigNumber | null {
    let left = parseUnary()
    if (left === null) return null
    while (true) {
      const token = peek()
      if (token?.type !== 'op' || (token.value !== '*' && token.value !== '/')) break
      const op = consume()
      if (op.type !== 'op') return null
      const right = parseUnary()
      if (right === null) return null
      if (op.value === '/') {
        if (right.isZero()) return null // division by zero
        left = left.div(right)
      } else {
        left = left.times(right)
      }
      if (!isManageable(left)) return null
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
    return parsePower()
  }

  function parsePower(): BigNumber | null {
    const base = parseFactor()
    if (base === null) return null
    const token = peek()
    if (token?.type !== 'op' || token.value !== '^') return base
    consume()
    const exponent = parseUnary()
    if (exponent === null || !exponent.isInteger() || exponent.abs().gt(MAX_ABS_EXPONENT)) return null
    const exponentNumber = exponent.toNumber()
    const powerCost = Math.max(Math.abs(base.e ?? 0) + 1, base.precision() ?? 0) * Math.abs(exponentNumber)
    if (powerCost > MAX_RESULT_DIGITS) return null
    const result = base.pow(exponentNumber)
    return isManageable(result) ? result : null
  }

  function applyFunction(name: string, value: BigNumber): BigNumber | null {
    switch (name) {
      case 'sqrt': return value.isNegative() ? null : value.sqrt()
      case 'abs': return value.abs()
      case 'round': return value.integerValue(BigNumber.ROUND_HALF_UP)
      case 'floor': return value.integerValue(BigNumber.ROUND_FLOOR)
      case 'ceil': return value.integerValue(BigNumber.ROUND_CEIL)
      default: return null
    }
  }

  function parseFactor(): BigNumber | null {
    const t = peek()
    if (!t) return null

    let value: BigNumber | null = null

    if (t.type === 'number') {
      consume()
      value = t.value
    }

    if (t.type === 'identifier') {
      consume()
      const next = peek()
      if (next?.type === 'paren' && next.value === '(') {
        consume()
        const argument = parseExpr()
        const closing = peek()
        if (argument === null || closing?.type !== 'paren' || closing.value !== ')') return null
        consume()
        value = applyFunction(t.value, argument)
      } else {
        const raw = variables.get(t.value)
        if (raw === undefined || raw.length > MAX_SERIALIZED_VALUE_LENGTH) return null
        const resolved = new BigNumber(raw)
        if (!isManageable(resolved)) return null
        value = resolved
      }
    }

    if (t.type === 'paren' && t.value === '(') {
      consume() // consume '('
      value = parseExpr()
      if (value === null) return null
      const closing = peek()
      if (!closing || closing.type !== 'paren' || closing.value !== ')') return null
      consume() // consume ')'
    }

    if (value === null) return null
    if (peek()?.type === 'percent') {
      consume()
      value = value.div(100)
    }
    return isManageable(value) ? value : null
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

function evaluateExpression(expr: string, variables: ReadonlyMap<string, string>): BigNumber | null {
  const trimmed = expr.trim()
  if (!trimmed || trimmed.length > MAX_EXPRESSION_LENGTH) return null
  const tokens = tokenize(trimmed)
  if (!tokens) return null
  try {
    const result = parse(tokens, variables)
    return result !== null && isManageable(result) ? result : null
  } catch {
    return null
  }
}

function calculateValue(expr: string, variables: ReadonlyMap<string, string> = new Map()): string | null {
  return evaluateExpression(expr, variables)?.toFixed() ?? null
}

function calculateExpression(expr: string, variables: ReadonlyMap<string, string> = new Map()): string | null {
  const result = evaluateExpression(expr, variables)
  return result === null ? null : formatBigNumber(result)
}

function safeCalculate(expr: string): string | null {
  const trimmed = expr.trim()
  // Launcher suggestions only activate for formulas and avoid timestamp-like text.
  if (!/[+\-*/%^()]/.test(trimmed) || /^\d{10,13}$/.test(trimmed)) return null
  return calculateExpression(trimmed)
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

class BaseConversionError extends Error {
  constructor(readonly kind: 'missing' | 'decimal' | 'hex' | 'binary', readonly value: string) {
    super(`${kind}: ${value}`)
  }
}

function parseSignedBaseInteger(raw: string, radix: 2 | 10 | 16): bigint {
  const trimmed = raw.trim()
  const sign = trimmed.startsWith('-') ? -1n : 1n
  const unsigned = trimmed.replace(/^[+-]/, '')
  if (!unsigned) throw new BaseConversionError('missing', raw)

  if (radix === 10) {
    if (!/^\d+$/.test(unsigned)) throw new BaseConversionError('decimal', raw)
    return sign * BigInt(unsigned)
  }

  if (radix === 16) {
    const digits = unsigned.replace(/^0x/i, '')
    if (!/^[0-9a-f]+$/i.test(digits)) throw new BaseConversionError('hex', raw)
    return sign * BigInt(`0x${digits}`)
  }

  const digits = unsigned.replace(/^0b/i, '')
  if (!/^[01]+$/i.test(digits)) throw new BaseConversionError('binary', raw)
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


const RESULT_PANEL_ID = 'calculator.result-panel'

type CalculationResultPanelInputs = {
  sourceText?: string
  resultText?: string
}

function CalculationResultPanel({ inputs, host }: PanelPropsV2<CalculationResultPanelInputs>) {
  const { hooks, effects, react: React } = getPluginHostSdk()
  const t = hooks.useT('calculator')
  const [copyStatus, setCopyStatus] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const sourceText = inputs?.sourceText ?? ''
  const resultText = inputs?.resultText ?? calculateFormulaLines(sourceText)
  const e = React.createElement

  return e('div', { className: 'calculator-result-panel' },
    e('div', { className: 'calculator-result-panel__header' },
      e('div', null,
        e('div', { className: 'calculator-result-panel__title' }, t('panel.result.title')),
        e('div', { className: 'calculator-result-panel__subtitle' }, t('panel.result.subtitle')),
      ),
      e('button', {
        type: 'button',
        className: 'calculator-result-panel__ghost',
        'aria-label': t('panel.result.close'),
        onClick: () => host.close(),
      }, '×'),
    ),
    e('div', { className: 'calculator-result-panel__grid' },
      e('section', null,
        e('span', null, t('panel.result.source')),
        e('pre', null, sourceText || '—'),
      ),
      e('section', null,
        e('span', null, t('panel.result.output')),
        e('pre', null, resultText || '—'),
      ),
    ),
    e('div', { className: 'calculator-result-panel__footer' },
      copyStatus !== 'idle' && e('span', {
        role: copyStatus === 'failed' ? 'alert' : 'status',
        className: `calculator-result-panel__copy-status is-${copyStatus}`,
      }, t(copyStatus === 'copied' ? 'panel.result.copied' : 'panel.result.copyFailed')),
      e('button', {
        type: 'button',
        onClick: async () => {
          try {
            if (!navigator.clipboard) throw new Error('clipboard unavailable')
            await navigator.clipboard.writeText(resultText)
            setCopyStatus('copied')
          } catch {
            setCopyStatus('failed')
          }
        },
      }, t('panel.result.copy')),
      e('button', { type: 'button', onClick: () => host.dispatch([effects.replaceActiveText(resultText)]) }, t('panel.result.replace')),
      e('button', {
        type: 'button',
        onClick: () => host.dispatch([{ type: 'pane.create', pane: { text: resultText, title: t('panel.result.newPaneTitle'), language: 'plaintext' }, focus: true, direction: 'right' }]),
      }, t('panel.result.newPane')),
    ),
  )
}

function CalculatorWorkspace(props: PluginSurfaceProps) {
  const { react: React } = getPluginHostSdk()
  return React.createElement(CalculatorSurface, { ...props, calculate: calculateExpression, calculateValue })
}

// ─── Plugin Definition ───────────────────────────────────────────────────────

const definition: PluginDefinition = {
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Calculator',
        titleI18n: { zh: '计算器', en: 'Calculator' },
        icon: 'Calculator',
        aliases: ['calculator', 'calc', '计算器', '计算'],
        component: CalculatorWorkspace,
        entry: { launcher: { surfaces: ['global-launcher'] }, shortcutBindable: true },
        shell: {
          defaultWidth: 680,
          defaultHeight: 640,
          minWidth: 500,
          minHeight: 360,
          closeOnBlur: false,
          resizable: true,
        },
      },
    ],
  },
  tools: [
    {
      id: 'calculator.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'Calculator',
      aliases: ['calc', 'formula'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        const sourceText = ctx.input.text
        const resultText = calculateFormulaLines(sourceText)
        const opened = ctx.api.dispatchEffects([{
          type: 'panel.openV2' as const,
          panelId: RESULT_PANEL_ID,
          placement: 'pane-bottom' as const,
          inputs: { sourceText, resultText },
        }])
        if (opened.errors.length > 0) return ctx.output.text(resultText)
        return { ok: true }
      },
      surfaces: { launcher: { surfaces: ['editor-command-bar', 'quick-editor-command'] }, panel: true },
    },
    {
      id: 'calculator.sum',
      title: 'command.sum.title',
      subtitle: 'command.sum.description',
      icon: 'Sigma',
      aliases: ['sum', 'add', 'total'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.replaceActiveText(sumNumericTokens(ctx.input.text))
      },
      surfaces: { launcher: { surfaces: ['editor-command-bar', 'quick-editor-command'] }, panel: true },
    },
    {
      id: 'calculator.base',
      title: 'command.base.title',
      subtitle: 'command.base.description',
      icon: 'Binary',
      aliases: ['decimal', 'binary', 'hex', 'hex-convert'],
      inputPolicy: { mode: 'auto' },
      requireParamSelection: true,
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
          if (error instanceof BaseConversionError) {
            return ctx.output.error(ctx.t(`error.base.${error.kind}`, { value: error.value }))
          }
          return ctx.output.error(ctx.t('error.convert', { message: error.message }))
        }
      },
      surfaces: { launcher: { surfaces: ['editor-command-bar', 'quick-editor-command'] }, panel: true },
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
      icon: 'Sigma',
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
  panels: [
    {
      id: RESULT_PANEL_ID,
      title: 'Calculation Result',
      titleI18n: { zh: '计算结果', en: 'Calculation Result' },
      defaultPlacement: 'pane-bottom',
      height: '220px',
      // PanelPropsV2 generics are invariant in practice; cast for registration.
      component: CalculationResultPanel as never,
    },
  ],
  launcher: {
    dynamicItems(ctx: LauncherDynamicContext): LauncherItemContribution[] {
      const input = ctx.query
      const result = safeCalculate(input)
      if (result === null) return []
      return [{
        id: 'calc-result',
        display: { title: `${input.trim()} = ${result}`, subtitle: input, icon: 'Calculator' },
        behavior: { type: 'perform' },
        surfaces: ['global-launcher'],
        directAnswer: true,
        async execute(ctx2) {
          await ctx2.api.copyText(result)
          return { ok: true, output: { choices: [{ id: 'copy', title: result, primaryAction: async () => { await ctx2.api.copyText(result) } }] } }
        },
      }]
    },
  },
}

export default definition
