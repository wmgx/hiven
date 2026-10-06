import { Suspense, useMemo, useState } from 'react'
import { getPluginHostSdk, type PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, TextEditor, getEditorTheme } from '@hiven/plugin-ui'
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
  const [language, setLanguage] = useState<FormatterLanguage>(() => initialLanguage(props.surfaceId, initialText))
  const [operation, setOperation] = useState<FormatterOperation>(initialRoute?.operation ?? 'format')
  const [pasting, setPasting] = useState(false)
  const result = useMemo(() => processFormatter(language, operation, inputText), [inputText, language, operation])
  const outputText = result.ok ? result.output : ''
  const hasOutput = result.ok && inputText.length > 0
  const editorAppearance = {
    theme: getEditorTheme(props.appearance.theme),
    fontSize: props.appearance.fontSize,
    lineNumbers: props.appearance.lineNumbers,
    wordWrap: props.appearance.wordWrap,
  }
  const editorLoading = <div className="formatter-editor-loading" role="status">{t('surface.editorLoading')}</div>

  const copyOutput = async () => {
    if (!hasOutput) return
    try {
      await host.clipboard.writeText(outputText)
      host.showMessage(t('toast.copied'), 'success')
      host.complete()
    } catch {
      host.showMessage(t('toast.copyFailed'), 'error')
    }
  }

  const pasteOutput = async () => {
    if (!hasOutput || pasting) return
    setPasting(true)
    try {
      const pasteResult = await host.paste.pasteText(outputText)
      if (pasteResult.ok) {
        host.complete()
      } else if (pasteResult.fallback === 'copied') {
        host.showMessage(pasteResult.message || t('toast.copied'), 'info')
        host.complete()
      } else {
        host.showMessage(pasteResult.message || t('toast.pasteFailed'), 'error')
      }
    } catch {
      host.showMessage(t('toast.pasteFailed'), 'error')
    } finally {
      setPasting(false)
    }
  }

  return (
    <section className="formatter-surface" aria-label={t('surface.title')} data-no-drag>
      <header className="formatter-header">
        <IconButton type="button" label={t('action.back')} onClick={() => host.requestBack()}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong className="formatter-title">{t('surface.title')}</strong>
        <IconButton type="button" label={t('action.close')} onClick={() => host.close()}>
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
            onClick={() => setLanguage(item)}
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
            onClick={() => setOperation(item)}
          >
            {t(`operation.${item}`)}
          </button>
        ))}
      </nav>

      <main className="formatter-editors">
        <section className="formatter-pane">
          <div className="formatter-pane-header">
            <strong>{t('pane.input')}</strong>
            <Button type="button" variant="ghost" disabled={!inputText} onClick={() => setInputText('')}>
              {t('action.clear')}
            </Button>
          </div>
          <div className="formatter-editor" data-launcher-scrollable>
            <Suspense fallback={editorLoading}>
              <TextEditor
                {...editorAppearance}
                value={inputText}
                language={language}
                onChange={setInputText}
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
              <Button type="button" variant="ghost" disabled={!hasOutput || pasting} onClick={() => setInputText(outputText)}>
                {t('action.useAsInput')}
              </Button>
              <IconButton type="button" label={t('action.continueProcessing')} disabled={!hasOutput || pasting} onClick={() => host.returnToLauncherWithObject({ kind: 'text', text: outputText })}>
                <CornerDownLeft size={14} />
              </IconButton>
              <IconButton type="button" label={t('action.pasteBack')} disabled={!hasOutput || pasting} onClick={() => void pasteOutput()}>
                <ClipboardPaste size={14} />
              </IconButton>
              <Button type="button" disabled={!hasOutput || pasting} onClick={() => void copyOutput()}>
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
                <span>{t('error.format', { message: result.message })}</span>
              </div>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="formatter-status" aria-live="polite">
        <div>
          <span>{t('meta.characters', { count: inputText.length })}</span>
          <span className={!result.ok ? 'is-error' : ''}>
            {!result.ok ? t('status.error') : hasOutput ? t('status.ready') : t('status.waiting')}
          </span>
        </div>
        <span>{t('meta.characters', { count: outputText.length })}</span>
      </footer>
    </section>
  )
}
