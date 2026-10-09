import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { IconButton, TextInput, Tooltip, useImeKeyboard } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { readHistory, rememberCalculation, type HistoryEntry } from './history'

let historyWrite = Promise.resolve()

type CalculatorSurfaceProps = PluginSurfaceProps & {
  calculate: (expression: string, variables?: ReadonlyMap<string, string>) => string | null
  calculateValue: (expression: string, variables?: ReadonlyMap<string, string>) => string | null
}

export function CalculatorSurface({ host, initialText, t, calculate, calculateValue }: CalculatorSurfaceProps) {
  const initialExpression = initialText?.trim() ?? ''
  const [expression, setExpression] = useState(initialExpression)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [variables, setVariables] = useState<ReadonlyMap<string, string>>(() => new Map())
  const inputRef = useRef<HTMLInputElement>(null)
  const syntaxId = useId()
  const draftRef = useRef(initialExpression)
  const hostRef = useRef(host)
  hostRef.current = host
  const ime = useImeKeyboard()
  const assignment = expression.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/s)
  const formula = assignment?.[2] ?? expression
  const result = useMemo(() => calculate(formula, variables), [calculate, formula, variables])
  const displayedResult = expression.trim() ? result : history[0]?.result ?? null

  useEffect(() => {
    let cancelled = false
    void historyWrite.then(() => hostRef.current.storage.kv.get('history')).then((stored) => {
      if (cancelled) return
      setHistory(readHistory(stored))
      setHistoryStatus('ready')
    }).catch(() => {
      if (!cancelled) setHistoryStatus('unavailable')
    })
    return () => { cancelled = true }
  }, [])

  const saveHistory = (next: HistoryEntry[]) => {
    setHistory(next)
    if (historyStatus !== 'ready') return
    historyWrite = historyWrite
      .then(() => hostRef.current.storage.kv.set('history', next))
      .catch(() => hostRef.current.showMessage(t('surface.historySaveFailed'), 'error'))
  }

  const focusAtEnd = (value: string) => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(value.length, value.length)
    })
  }

  const useExpression = (value: string, index = -1) => {
    setExpression(value)
    setHistoryIndex(index)
    if (index === -1) draftRef.current = value
    focusAtEnd(value)
  }

  const commit = () => {
    if (!result || historyStatus === 'loading') return
    if (assignment) {
      const value = calculateValue(formula, variables)
      if (value === null) return
      setVariables((current) => new Map(current).set(assignment[1], value))
    }
    const normalizedExpression = expression.trim()
    saveHistory(rememberCalculation(history, { expression: normalizedExpression, result }))
    setExpression('')
    draftRef.current = ''
    setHistoryIndex(-1)
  }

  const copyResult = async () => {
    if (!displayedResult) return
    try {
      await host.clipboard.writeText(displayedResult)
      host.showMessage(t('surface.copied'), 'success')
      host.complete()
    } catch {
      host.showMessage(t('surface.copyFailed'), 'error')
    }
  }

  const navigateHistory = (direction: 'older' | 'newer') => {
    if (history.length === 0) return
    if (direction === 'older') {
      if (historyIndex === -1) draftRef.current = expression
      const nextIndex = Math.min(historyIndex + 1, history.length - 1)
      useExpression(history[nextIndex].expression, nextIndex)
      return
    }
    if (historyIndex === -1) return
    const nextIndex = historyIndex - 1
    useExpression(nextIndex < 0 ? draftRef.current : history[nextIndex].expression, nextIndex)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (ime.shouldIgnoreKeyDown(event)) return

    const input = inputRef.current
    const hasSelection = input?.selectionStart !== input?.selectionEnd
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'c' && !hasSelection) {
      event.preventDefault()
      void copyResult()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      return
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !hasSelection) {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        navigateHistory('older')
      } else if (event.key === 'ArrowDown' && historyIndex !== -1) {
        event.preventDefault()
        navigateHistory('newer')
      }
    }
  }

  return (
    <section className="calculator-surface" aria-label={t('surface.title')}>
      <header className="calculator-surface__header">
        <IconButton type="button" label={t('surface.back')} onClick={() => host.requestBack()}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong>{t('surface.title')}</strong>
        <div className="calculator-surface__spacer" />
        <IconButton type="button" label={t('surface.close')} onClick={() => host.close()}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <main className="calculator-surface__body">
        <div className="calculator-surface__expression">
          <label htmlFor="calculator-expression">{t('surface.expression')}</label>
          <TextInput
            ref={inputRef}
            id="calculator-expression"
            className="calculator-surface__input"
            value={expression}
            onChange={(event) => {
              setExpression(event.target.value)
              setHistoryIndex(-1)
              draftRef.current = event.target.value
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('surface.placeholder')}
            autoFocus
            data-plugin-surface-autofocus
            autoComplete="off"
            spellCheck={false}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
          />
        </div>

        {variables.size > 0 && (
          <div className="calculator-surface__variables" aria-label={t('surface.variables')} data-launcher-scrollable>
            <span>{t('surface.variables')}</span>
            {[...variables].map(([name, value]) => (
              <code key={name} title={`${name} = ${value}`}>{name} = {value}</code>
            ))}
          </div>
        )}

        <div className={`calculator-surface__result${expression.trim() && !result ? ' is-invalid' : ''}`} aria-live="polite">
          <span>{expression.trim() && !result
            ? t('surface.invalid')
            : assignment ? t('surface.assignHint', { name: assignment[1] }) : t('surface.result')}</span>
          <output>{displayedResult ?? '—'}</output>
        </div>

        <p className="calculator-surface__keyboard-hint">
          {t('surface.keyboardHint')}{' · '}
          <button type="button" disabled={!displayedResult} onClick={() => void copyResult()}>
            {t('surface.copyResult')}
          </button>
        </p>
        <Tooltip.Root>
          <Tooltip.Trigger className="calculator-surface__syntax-trigger" aria-describedby={syntaxId} delay={150}>
            {t('surface.syntax')}
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner side="top" align="start" sideOffset={8} className="calculator-surface__syntax-positioner">
              <Tooltip.Popup id={syntaxId} role="tooltip" className="calculator-surface__syntax" data-launcher-scrollable>
                <p>{t('surface.variableHint')}</p>
                <dl>
                  <div><dt>{t('surface.power')}</dt><dd><code>a^2 · a^3 · a**n</code></dd></div>
                  <div><dt>{t('surface.root')}</dt><dd><code>sqrt(a)</code></dd></div>
                  <div><dt>{t('surface.absolute')}</dt><dd><code>abs(a)</code></dd></div>
                  <div><dt>{t('surface.rounding')}</dt><dd><code>round(a) · floor(a) · ceil(a)</code></dd></div>
                </dl>
                <p>{t('surface.powerHint')}</p>
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>

        <section className="calculator-surface__history" aria-label={t('surface.history')}>
          <div className="calculator-surface__history-heading">
            <strong>{t('surface.history')}</strong>
            {history.length > 0 && (
              <button type="button" onClick={() => {
                saveHistory([])
                setHistoryIndex(-1)
              }}>
                {t('surface.clearHistory')}
              </button>
            )}
          </div>
          <p className="calculator-surface__history-hint">
            {t(historyStatus === 'loading' ? 'surface.historyLoading'
              : historyStatus === 'unavailable' ? 'surface.historyLoadFailed' : 'surface.historyHint')}
          </p>
          {history.length === 0 ? (
            <p>{t('surface.emptyHistory')}</p>
          ) : (
            <ol data-launcher-scrollable>
              {history.map((item, index) => (
                <li key={`${item.expression}:${item.result}`}>
                  <button type="button" className="calculator-surface__history-expression"
                    title={t('surface.reuseExpression', { value: item.expression })}
                    aria-label={t('surface.reuseExpression', { value: item.expression })}
                    onClick={() => useExpression(item.expression, index)}>
                    <span>{item.expression}</span>
                  </button>
                  <button type="button" className="calculator-surface__history-result"
                    title={t('surface.reuseResult', { value: item.result })}
                    aria-label={t('surface.reuseResult', { value: item.result })}
                    onClick={() => useExpression(item.result)}>
                    <strong>{item.result}</strong>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </section>
  )
}
