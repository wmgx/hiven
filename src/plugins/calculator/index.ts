import type { PluginDefinition, InstantSuggestionContext, InstantSuggestion, TextInput } from '../../workspace/pluginTypes'

// ─── Safe Math Parser ────────────────────────────────────────────────────────
// A simple recursive descent parser for arithmetic expressions.
// Supports: numbers, decimals, parentheses, +, -, *, /, unary +/-, %

type Token =
  | { type: 'number'; value: number }
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
      let numStr = ''
      let hasDot = false
      while (i < expr.length && (/[0-9]/.test(expr[i]) || (expr[i] === '.' && !hasDot))) {
        if (expr[i] === '.') hasDot = true
        numStr += expr[i]
        i++
      }
      const num = Number(numStr)
      if (isNaN(num)) return null
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

function parse(tokens: Token[]): number | null {
  let pos = 0

  function peek(): Token | undefined {
    return tokens[pos]
  }

  function consume(): Token {
    return tokens[pos++]
  }

  function parseExpr(): number | null {
    let left = parseTerm()
    if (left === null) return null
    while (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      const op = consume().value as string
      const right = parseTerm()
      if (right === null) return null
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  function parseTerm(): number | null {
    let left = parseUnary()
    if (left === null) return null
    while (peek()?.type === 'op' && (peek()!.value === '*' || peek()!.value === '/')) {
      const op = consume().value as string
      const right = parseUnary()
      if (right === null) return null
      if (op === '/') {
        if (right === 0) return null // division by zero
        left = left / right
      } else {
        left = left * right
      }
    }
    return left
  }

  function parseUnary(): number | null {
    const t = peek()
    if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
      consume()
      const val = parseUnary()
      if (val === null) return null
      return t.value === '-' ? -val : val
    }
    return parseFactor()
  }

  function parseFactor(): number | null {
    const t = peek()
    if (!t) return null

    if (t.type === 'number') {
      consume()
      let value = t.value
      // Check for trailing percent
      if (peek()?.type === 'percent') {
        consume()
        value = value / 100
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
        result = result / 100
      }
      return result
    }

    return null
  }

  const result = parseExpr()
  if (result === null || pos !== tokens.length) return null
  return result
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
  if (result === null || !isFinite(result)) return null

  // Format: remove trailing zeros from decimals, max 10 decimal places
  const formatted = Number(result.toFixed(10)).toString()
  return formatted
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
    if (trimmed.includes('=')) {
      results.push(line)
      continue
    }

    const result = safeCalculate(trimmed)
    if (result === null) {
      stopped = true
      results.push(line)
      continue
    }

    results.push(`${line} = ${result}`)
  }

  return results.join('\n')
}

// ─── Plugin Definition ───────────────────────────────────────────────────────

const definition: PluginDefinition = {
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
        const target = input?.paneId ? { paneId: input.paneId } : 'active-input'
        return {
          effects: [{
            type: 'text.replace' as const,
            target,
            text: calculateFormulaLines(text),
          }],
        }
      },
    },
  ],
  instantSuggestions: [
    {
      id: 'calculator.inline',
      title: 'provider.title',
      priority: 100,
      suggest(ctx: InstantSuggestionContext): InstantSuggestion | null {
        const expr = ctx.query.trim()
        const result = safeCalculate(expr)
        if (result === null) return null

        return {
          id: `calculator:${expr}`,
          title: `${expr} = ${result}`,
          subtitle: ctx.t('provider.subtitle'),
          value: result,
          icon: 'Calculator',
          actionLabel: ctx.t('provider.actionLabel'),
          action: { type: 'copy', text: result },
        }
      },
    },
  ],
}

export default definition
