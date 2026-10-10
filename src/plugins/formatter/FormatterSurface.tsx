import { Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getPluginHostSdk, type PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, TextEditor, getEditorTheme, useToolDeliveryFeedback } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { ClipboardPaste, CornerDownLeft } from 'lucide-react'
import {
  formatterRoutes,
  processFormatter,
  type FormatterLanguage,
  type FormatterOperation,
} from './core'

const LANGUAGES: FormatterLanguage[] = ['sql', 'css', 'xml']
const OPERATIONS: FormatterOperation[] = ['format', 'compact']

function initialLanguage(surfaceId: string, text: string): FormatterLanguage {
  const route = formatterRoutes.find((item) => item.id === surfaceId)
  if (route) return route.language
  const detected = getPluginHostSdk().kits.content.detectContent(text)
    .find((item) => LANGUAGES.includes(item.kind as FormatterLanguage))?.kind
  return (detected as FormatterLanguage | undefined) ?? 'sql'
}

export function FormatterSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const initialText = props.initialText ?? ''
  const initialRoute = formatterRoutes.find((item) => item.id === props.surfaceId)
  const [inputText, setInputText] = useState(initialText)
  const baseline = useRef(initialText)
  const hasUnsavedChanges = inputText !== baseline.current
  const reportUnsavedChanges = host.setUnsavedChanges
  useLayoutEffect(() => {
    reportUnsavedChanges?.(hasUnsavedChanges)
  }, [hasUnsavedChanges, reportUnsavedChanges])
  const [language, setLanguage] = useState<FormatterLanguage>(() => initialLanguage(props.surfaceId, initialText))
  const [operation, setOperation] = useState<FormatterOperation>(initialRoute?.operation ?? 'format')
  const [busy, setBusy] = useState<'copy' | 'paste' | 'return' | null>(null)
  const pendingRef = useRef<{ action: 'copy' | 'paste' | 'return'; controller: AbortController } | null>(null)
  const result = useMemo(() => processFormatter(language, operation, inputText), [inputText, language, operation])
  const outputText = result.ok ? result.output : ''
  const hasOutput = result.ok && outputText.length > 0
  const editorAppearance = {
    theme: getEditorTheme(props.appearance.theme),
    fontSize: props.appearance.fontSize,
    lineNumbers: props.appearance.lineNumbers,
    wordWrap: props.appearance.wordWrap,
  }
  const editorLoading = <div className="formatter-editor-loading" role="status">{t('surface.editorLoading')}</div>

  const delivery = useToolDeliveryFeedback(result, host.deliveryFeedbackOwner)

  useLayoutEffect(() => () => {
    pendingRef.current?.controller.abort()
    pendingRef.current = null
  }, [])

  const update = (change: () => void) => {
    delivery.invalidate()
    pendingRef.current?.controller.abort()
    // Keep an issued clipboard/paste write locked until it settles.
    if (pendingRef.current?.action === 'return') {
      pendingRef.current = null
      setBusy(null)
    }
    change()
  }

  const deliver = async (action: 'copy' | 'paste' | 'return') => {
    if (!hasOutput || pendingRef.current) return
    const attempt = delivery.beginAttempt()
    if (!attempt.isCurrent()) return
    const submission = { action, controller: new AbortController() }
    pendingRef.current = submission
    setBusy(action)
    const isCurrent = () => pendingRef.current === submission
      && !submission.controller.signal.aborted && attempt.isCurrent()
    const release = () => {
      if (pendingRef.current !== submission) return
      pendingRef.current = null
      setBusy(null)
    }
    try {
      if (action === 'return') {
        const accepted = await host.returnToLauncherWithObject(
          { kind: 'text', text: outputText, source: 'tool-result' },
          { signal: submission.controller.signal },
        )
        if (!isCurrent()) return
        if (accepted === false) release()
        return accepted
      }
      if (action === 'copy') {
        await host.clipboard.writeText(outputText)
        if (!isCurrent()) return
        delivery.invalidate()
        host.showMessage(t('toast.copied'), 'success')
        host.complete()
      } else {
        const delivered = await host.paste.pasteText(outputText)
        if (!isCurrent()) return
        attempt.reportPaste(delivered)
        if (delivered.ok) host.complete()
      }
    } catch {
      if (isCurrent()) {
        attempt.reportError(t(action === 'copy' ? 'toast.copyFailed' : action === 'paste' ? 'toast.pasteFailed' : 'toast.returnFailed'))
        release()
      }
    } finally {
      release()
    }
  }

  return (
    <section className="formatter-surface" aria-label={t('surface.title')} data-no-drag>
      <header className="formatter-header">
        <IconButton type="button" label={t('action.back')} onClick={() => update(() => host.requestBack())}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong className="formatter-title">{t('surface.title')}</strong>
        <IconButton type="button" label={t('action.close')} onClick={() => update(() => host.close())}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <nav className="formatter-languages" aria-label={t('language.label')}>
        {LANGUAGES.map((item) => (
          <button
            key={item}
            type="button"
            className={item === language ? 'is-active' : ''}
            aria-pressed={item === language}
            onClick={() => update(() => setLanguage(item))}
          >
            {t(`language.${item}`)}
          </button>
        ))}
      </nav>

      <nav className="formatter-operations" aria-label={t('operation.label')}>
        {OPERATIONS.map((item) => (
          <button
            key={item}
            type="button"
            className={item === operation ? 'is-active' : ''}
            aria-pressed={item === operation}
            onClick={() => update(() => setOperation(item))}
          >
            {t(`operation.${item}`)}
          </button>
        ))}
      </nav>

      <main className="formatter-editors">
        <section className="formatter-pane">
          <div className="formatter-pane-header">
            <strong>{t('pane.input')}</strong>
            <Button type="button" variant="ghost" disabled={!inputText} onClick={() => update(() => setInputText(''))}>
              {t('action.clear')}
            </Button>
          </div>
          <div className="formatter-editor" data-launcher-scrollable>
            <Suspense fallback={editorLoading}>
              <TextEditor
                {...editorAppearance}
                value={inputText}
                language={language}
                onChange={(value) => update(() => setInputText(value))}
                optionOverrides={{
                  ariaLabel: t('pane.input'),
                  placeholder: t(`surface.${language}Placeholder`),
                  tabSize: 2,
                }}
                onReady={(editor) => {
                  editor.getDomNode()?.querySelector('[role="textbox"]')?.setAttribute('data-plugin-surface-autofocus', '')
                  editor.focus()
                }}
              />
            </Suspense>
          </div>
        </section>

        <section className="formatter-pane formatter-pane-output">
          <div className="formatter-pane-header">
            <strong>{t('pane.output')}</strong>
            <div className="formatter-pane-actions">
              <Button type="button" variant="ghost" title={t('action.useAsInputDescription')} aria-label={t('action.useAsInputDescription')} disabled={!hasOutput || busy !== null} onClick={() => update(() => setInputText(outputText))}>
                {t('action.useAsInput')}
              </Button>
              <Button type="button" variant="ghost" title={t('action.continueProcessingDescription')} aria-label={t('action.continueProcessingDescription')} disabled={!hasOutput || busy !== null} onClick={() => deliver('return')}>
                <CornerDownLeft size={14} aria-hidden="true" />
                {t('action.continueProcessing')}
              </Button>
              <Button type="button" variant="ghost" title={t('action.pasteBackDescription')} aria-label={t('action.pasteBackDescription')} disabled={!hasOutput || busy !== null} onClick={() => void deliver('paste')}>
                <ClipboardPaste size={14} aria-hidden="true" />
                {t('action.pasteBack')}
              </Button>
              <Button type="button" title={t('action.copyDescription')} aria-label={t('action.copyDescription')} disabled={!hasOutput || busy !== null} onClick={() => void deliver('copy')}>
                {t('action.copy')}
              </Button>
            </div>
          </div>
          <div className="formatter-editor formatter-editor-output" data-launcher-scrollable>
            <Suspense fallback={editorLoading}>
              <TextEditor
                {...editorAppearance}
                value={outputText}
                language={language}
                optionOverrides={{
                  ariaLabel: t('pane.output'),
                  readOnly: true,
                  domReadOnly: true,
                  tabSize: 2,
                  placeholder: result.ok ? t('surface.emptyOutput') : '',
                }}
              />
            </Suspense>
            {!result.ok ? (
              <div className="formatter-error" role="alert">
                <strong>{t('surface.invalidTitle')}</strong>
                <span>{result.code ? t(`error.${result.code}`) : t('error.format', { message: result.message })}</span>
              </div>
            ) : null}
          </div>
        </section>
      </main>

      <footer className={`formatter-status${delivery.feedback ? ' has-delivery' : ''}`} aria-live="polite">
        <div>
          <span>{t('meta.characters', { count: inputText.length })}</span>
          <span className={delivery.feedback ? `is-${delivery.feedback.tone}` : !result.ok ? 'is-error' : ''} role="status">
            {delivery.feedback?.message ?? (!result.ok ? t('status.error') : hasOutput ? t('status.ready') : t('status.waiting'))}
          </span>
        </div>
        <span>{t('meta.characters', { count: outputText.length })}</span>
      </footer>
    </section>
  )
}
