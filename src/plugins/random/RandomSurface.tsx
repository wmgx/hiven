import { useMemo, useState, type FormEvent } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, Select, TextInput } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'

export type RandomSurfaceMode = 'integer' | 'float' | 'string' | 'uuid' | 'password' | 'hex' | 'color' | 'boolean'

export type RandomSurfaceConfig = {
  min: number
  max: number
  decimals: number
  length: number
  bytes: number
  charset: string
  count: number
}

type RandomSurfaceProps = PluginSurfaceProps & {
  generate: (mode: RandomSurfaceMode, config: RandomSurfaceConfig) => string[]
  getGenerationKey: (mode: RandomSurfaceMode, config: RandomSurfaceConfig) => string
}

const MODES: RandomSurfaceMode[] = ['integer', 'float', 'string', 'uuid', 'password', 'hex', 'color', 'boolean']

const DEFAULT_CONFIG: RandomSurfaceConfig = {
  min: 0,
  max: 100,
  decimals: 2,
  length: 16,
  bytes: 16,
  charset: 'alphanumeric',
  count: 5,
}

function errorKey(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  if (code === 'COUNT') return 'error.count'
  if (code === 'RANGE') return 'error.range'
  if (code === 'LENGTH') return 'error.length'
  if (code === 'BYTES') return 'error.bytes'
  return 'surface.generateFailed'
}

export function RandomSurface({ host, t, generate, getGenerationKey, surfaceId }: RandomSurfaceProps) {
  const initialMode = MODES.includes(surfaceId as RandomSurfaceMode) ? surfaceId as RandomSurfaceMode : 'integer'
  const [mode, setMode] = useState<RandomSurfaceMode>(initialMode)
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [batch, setBatch] = useState(() => ({
    mode: initialMode,
    results: generate(initialMode, DEFAULT_CONFIG),
    generationKey: getGenerationKey(initialMode, DEFAULT_CONFIG),
  }))
  const { results } = batch
  const [error, setError] = useState('')
  const parametersChanged = useMemo(() => {
    try {
      return getGenerationKey(mode, config) !== batch.generationKey
    } catch {
      return true
    }
  }, [mode, config, batch.generationKey, getGenerationKey])
  const charsetOptions = useMemo(() => [
    'alphanumeric', 'alpha', 'numeric', 'hex', 'base64url', 'symbols', 'lower', 'upper',
  ].map((value) => ({ value, label: t(`param.charset.${value}`) })), [t])

  const updateNumber = (key: keyof RandomSurfaceConfig, raw: string) => {
    setConfig((current) => ({ ...current, [key]: Number(raw) }))
  }

  const generateBatch = (nextMode: RandomSurfaceMode) => {
    try {
      const generationKey = getGenerationKey(nextMode, config)
      const nextResults = generate(nextMode, config)
      setBatch({ mode: nextMode, results: nextResults, generationKey })
      setError('')
    } catch (cause) {
      setError(t(errorKey(cause)))
    }
  }

  const run = (event?: FormEvent) => {
    event?.preventDefault()
    generateBatch(mode)
  }

  const chooseMode = (next: RandomSurfaceMode) => {
    setMode(next)
    generateBatch(next)
  }

  const copy = async (value: string) => {
    try {
      await host.clipboard.writeText(value)
      host.showMessage(t('surface.copied'), 'success')
      host.complete()
    } catch {
      host.showMessage(t('surface.copyFailed'), 'error')
    }
  }

  return (
    <section className="random-surface" aria-label={t('surface.title')}>
      <header className="random-surface__header">
        <IconButton type="button" label={t('surface.back')} onClick={() => host.requestBack()}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <div>
          <strong>{t('surface.title')}</strong>
          <span>{t('surface.subtitle')}</span>
        </div>
        <div className="random-surface__spacer" />
        <IconButton type="button" label={t('surface.close')} onClick={() => host.close()}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <div className="random-surface__body">
        <nav className="random-surface__types" aria-label={t('surface.type')}>
          {MODES.map((item) => (
            <button
              key={item}
              type="button"
              className={item === mode ? 'is-active' : undefined}
              aria-pressed={item === mode}
              onClick={() => chooseMode(item)}
            >
              <span>{t(`${item}.title`)}</span>
              <small>{t(`${item}.description`)}</small>
            </button>
          ))}
        </nav>

        <form className="random-surface__workspace" onSubmit={run}>
          <div className="random-surface__controls">
            {(mode === 'integer' || mode === 'float') && (
              <>
                <label>
                  <span>{t('param.min')}</span>
                  <TextInput type="number" value={config.min} onChange={(event) => updateNumber('min', event.target.value)} />
                </label>
                <label>
                  <span>{t('param.max')}</span>
                  <TextInput type="number" value={config.max} onChange={(event) => updateNumber('max', event.target.value)} />
                </label>
              </>
            )}
            {mode === 'float' && (
              <label>
                <span>{t('param.decimals')}</span>
                <TextInput type="number" min={0} max={12} value={config.decimals} onChange={(event) => updateNumber('decimals', event.target.value)} />
              </label>
            )}
            {(mode === 'string' || mode === 'password') && (
              <label>
                <span>{t('param.length')}</span>
                <TextInput type="number" min={1} max={1024} value={config.length} onChange={(event) => updateNumber('length', event.target.value)} />
              </label>
            )}
            {mode === 'hex' && (
              <label>
                <span>{t('param.bytes')}</span>
                <TextInput type="number" min={1} max={1024} value={config.bytes} onChange={(event) => updateNumber('bytes', event.target.value)} />
              </label>
            )}
            {mode === 'string' && (
              <label className="random-surface__wide-control">
                <span>{t('param.charset')}</span>
                <Select
                  value={config.charset}
                  options={charsetOptions}
                  aria-label={t('param.charset')}
                  onChange={(event) => setConfig((current) => ({ ...current, charset: event.target.value }))}
                />
              </label>
            )}
            <label>
              <span>{t('param.count')}</span>
              <TextInput type="number" min={1} max={100} value={config.count} onChange={(event) => updateNumber('count', event.target.value)} />
            </label>
            <Button type="submit" variant="primary">{t('surface.generate')}</Button>
          </div>

          <div className="random-surface__result-heading">
            <div>
              <strong>{t(`${batch.mode}.title`)}</strong>
              <span aria-live="polite">{t(parametersChanged ? 'surface.resultCountChanged' : 'surface.resultCount', { count: results.length })}</span>
            </div>
            <Button type="button" disabled={results.length === 0} onClick={() => void copy(results.join('\n'))}>{t('surface.copyAll')}</Button>
          </div>

          <div className="random-surface__results" aria-live="polite">
            {error && <p className="random-surface__error" role="alert">{error}</p>}
            {results.map((result, index) => (
              <div className="random-surface__result" key={`${index}:${result}`}>
                {batch.mode === 'color' && <i style={{ backgroundColor: result }} aria-hidden="true" />}
                <code>{result}</code>
                <button type="button" aria-label={t('surface.copyOne', { value: result })} onClick={() => void copy(result)}>{t('surface.copy')}</button>
              </div>
            ))}
          </div>
        </form>
      </div>
    </section>
  )
}
