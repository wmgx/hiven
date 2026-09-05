import { useMemo, useState } from 'react'
import { getPluginHostSdk, type PanelPropsV2, type PluginSurfaceProps } from '@hiven/plugin'
import { IconButton } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'

type MatchResult = {
  index: number
  text: string
  groups: string[]
  line: number
  col: number
}

export function RegexTesterPluginPanel({ host, paneId }: PanelPropsV2<unknown>) {
  const { hooks, react: React } = getPluginHostSdk()
  const t = hooks.useT('regex-tester')
  const paneText = hooks.usePaneText(paneId ?? '') ?? ''
  const [pattern, setPattern] = React.useState('')
  const [flags, setFlags] = React.useState('g')
  const result = React.useMemo(() => evaluateRegex(pattern, flags, paneText), [flags, paneText, pattern])

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--color-background-primary)' }}>
      <div
        className="h-[28px] flex items-center px-3 gap-2 shrink-0"
        style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('panel.main.title')}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
          · {paneId || 'editor'}
        </span>
        <button
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
          onClick={host.close}
        >
          {t('panel.close')}
        </button>
      </div>

      <div className="flex items-center px-3 py-1.5 gap-2" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>/</span>
        <input
          className="flex-1 text-[12px] bg-transparent outline-none"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
          placeholder={t('panel.regex.pattern')}
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          autoFocus
        />
        <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>/</span>
        <input
          className="w-[40px] text-[12px] bg-transparent outline-none text-center"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
          placeholder={t('panel.regex.flags')}
          value={flags}
          onChange={(event) => setFlags(event.target.value)}
        />
      </div>

      <div className="flex-1 overflow-auto px-3 py-1.5">
        {result.error && (
          <div role="alert" className="text-[11px] py-1" style={{ color: 'var(--color-error-text)' }}>
            {t('error.invalid')}
          </div>
        )}
        {!result.error && result.matches.length > 0 && (
          <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            <span style={{ color: 'var(--color-success-text)' }}>
              {t(result.matches.length === 1 ? 'panel.regex.match' : 'panel.regex.matches', { count: result.matches.length })}
            </span>
            {result.matches.slice(0, 20).map((match, index) => (
              <div key={`${match.index}-${index}`} className="flex gap-2 py-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                <span className="shrink-0">{match.line}:{match.col}</span>
                <span className="truncate" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {match.text.slice(0, 50)}{match.text.length > 50 ? '…' : ''}
                </span>
                {match.groups.length > 0 && (
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    [{match.groups.map((group) => group || '∅').join(', ')}]
                  </span>
                )}
              </div>
            ))}
            {result.matches.length > 20 && (
              <div className="py-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('panel.regex.more', { count: result.matches.length - 20 })}
              </div>
            )}
          </div>
        )}
        {!result.error && pattern && result.matches.length === 0 && (
          <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {t('panel.regex.noMatches')}
          </div>
        )}
      </div>
    </div>
  )
}

export function RegexTesterSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const [pattern, setPattern] = useState('[a-z]+')
  const [flags, setFlags] = useState('g')
  const [sourceText, setSourceText] = useState(props.initialText ?? 'hello 123\nworld 456')
  const result = useMemo(() => evaluateRegex(pattern, flags, sourceText), [flags, pattern, sourceText])

  return (
    <section className="regex-tester-surface" aria-label={t('surface.title')}>
      <header className="regex-tester-surface__header">
        <IconButton type="button" label={t('surface.back')} onClick={() => host.requestBack()}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong>{t('surface.title')}</strong>
        <span>{t('surface.subtitle')}</span>
        <div className="regex-tester-surface__header-spacer" />
        <IconButton type="button" label={t('surface.close')} onClick={() => host.close()}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <div className="regex-tester-surface__pattern">
        <span>/</span>
        <input
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          placeholder={t('panel.regex.pattern')}
          spellCheck={false}
          autoFocus
        />
        <span>/</span>
        <input
          className="regex-tester-surface__flags"
          value={flags}
          onChange={(event) => setFlags(event.target.value)}
          placeholder="g"
          spellCheck={false}
        />
      </div>

      <div className="regex-tester-surface__body">
        <label className="regex-tester-surface__pane">
          <span>{t('surface.sampleText')}</span>
          <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} spellCheck={false} />
        </label>
        <div className="regex-tester-surface__pane">
          <span>{t('surface.matches')}</span>
          <div className="regex-tester-surface__matches">
            {result.error && <div role="alert" className="regex-tester-surface__error">{t('error.invalid')}</div>}
            {!result.error && result.matches.length === 0 && (
              <div className="regex-tester-surface__empty">{pattern ? t('panel.regex.noMatches') : t('surface.enterPattern')}</div>
            )}
            {!result.error && result.matches.length > 0 && (
              <>
                <div className="regex-tester-surface__summary">
                  {t(result.matches.length === 1 ? 'panel.regex.match' : 'panel.regex.matches', { count: result.matches.length })}
                </div>
                {result.matches.slice(0, 100).map((match, index) => (
                  <div key={`${match.index}:${index}`} className="regex-tester-surface__match">
                    <span>{match.line}:{match.col}</span>
                    <code>{match.text}</code>
                    {match.groups.length > 0 && <em>{match.groups.map((group) => group || t('surface.emptyGroup')).join(', ')}</em>}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function evaluateRegex(pattern: string, flags: string, paneText: string): { error: string | null; matches: MatchResult[] } {
  if (!pattern) return { error: null, matches: [] }
  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), matches: [] }
  }

  const matches: MatchResult[] = []
  if (flags.includes('g')) {
    let match: RegExpExecArray | null
    regex.lastIndex = 0
    while ((match = regex.exec(paneText)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++
        continue
      }
      matches.push(toMatchResult(paneText, match))
      if (matches.length > 1000) break
    }
  } else {
    const match = regex.exec(paneText)
    if (match) matches.push(toMatchResult(paneText, match))
  }
  return { error: null, matches }
}

function toMatchResult(paneText: string, match: RegExpExecArray): MatchResult {
  const beforeMatch = paneText.slice(0, match.index)
  const line = beforeMatch.split('\n').length
  const lastNewline = beforeMatch.lastIndexOf('\n')
  return {
    index: match.index,
    text: match[0],
    groups: match.slice(1),
    line,
    col: match.index - lastNewline,
  }
}
