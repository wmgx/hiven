import { useState } from 'react'
import { Button, Select, TextInput } from '@hiven/plugin-ui'
import type { AiGlossary } from './model'
import { GLOSSARY_LANGUAGES, GLOSSARY_LIMITS, validateAiGlossary } from '../ai/glossary'

type GlossaryDraft = { targetLang: string; entries: Array<{ source: string; target: string }> }

function draftFromSaved(saved?: AiGlossary): GlossaryDraft {
  return {
    targetLang: typeof saved?.targetLang === 'string' ? saved.targetLang : '',
    entries: Array.isArray(saved?.entries) ? saved.entries.map((entry) => ({
      source: typeof entry?.source === 'string' ? entry.source : '',
      target: typeof entry?.target === 'string' ? entry.target : '',
    })) : [],
  }
}

/** Mounted by profile ID so unsaved entries cannot follow a different profile. */
export function AiGlossaryEditor({ saved, onCommit, t }: {
  saved?: AiGlossary
  onCommit: (value: AiGlossary | undefined) => void
  t: (key: string) => string
}) {
  const [draft, setDraft] = useState(() => draftFromSaved(saved))
  const [baseline, setBaseline] = useState(() => ({ saved: JSON.stringify(saved), draft: JSON.stringify(draftFromSaved(saved)) }))
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const savedChanged = JSON.stringify(saved) !== baseline.saved
  const dirty = JSON.stringify(draft) !== baseline.draft
  const savedValidation = validateAiGlossary(saved)

  const edit = (next: GlossaryDraft) => { setDraft(next); setMessage(null) }
  const replaceDraft = (next?: AiGlossary) => {
    const clean = draftFromSaved(next)
    setDraft(clean)
    setBaseline({ saved: JSON.stringify(next), draft: JSON.stringify(clean) })
  }
  const commit = (clear: boolean) => {
    const checked = validateAiGlossary(clear ? undefined : draft)
    if (!checked.ok) {
      setMessage({ kind: 'error', text: t(`ai.glossary.error.${checked.issue.code}`).replace('{row}', String(checked.issue.row ?? '')) })
      return
    }
    try {
      // Host settings are synchronous. Keep the draft if persistence throws.
      onCommit(checked.value)
    } catch {
      setMessage({ kind: 'error', text: t(clear ? 'ai.glossary.clearFailed' : 'ai.glossary.saveFailed') })
      return
    }
    replaceDraft(checked.value)
    setMessage({ kind: 'success', text: t(clear || !checked.value ? 'ai.glossary.cleared' : 'ai.glossary.saved') })
  }

  const languageOptions = [
    { value: '', label: t('ai.glossary.chooseLanguage') },
    ...GLOSSARY_LANGUAGES.map((value) => ({ value, label: t(`language.${value}`) })),
  ]
  if (draft.targetLang && !GLOSSARY_LANGUAGES.some((value) => value === draft.targetLang)) {
    languageOptions.push({ value: draft.targetLang, label: t('ai.savedUnavailable').replace('{value}', draft.targetLang) })
  }

  return (
    <section className="translate-glossary-editor" aria-label={t('ai.glossary.title')}>
      <div className="font-medium">{t('ai.glossary.title')}</div>
      <p>{t('ai.glossary.description')}</p>
      <p>{t('ai.glossary.privacy')}</p>
      <p>{t('ai.glossary.limits')}</p>
      <label className="flex flex-col gap-1.5">
        <span>{t('ai.glossary.targetLanguage')}</span>
        <Select value={draft.targetLang} options={languageOptions} onChange={(event) => edit({ ...draft, targetLang: event.currentTarget.value })} />
      </label>
      <div className="translate-glossary-editor__entries">
        {draft.entries.map((entry, index) => (
          <div key={index} className="translate-glossary-editor__row">
            <label>
              <span>{t('ai.glossary.source').replace('{row}', String(index + 1))}</span>
              <TextInput value={entry.source} onChange={(event) => edit({ ...draft, entries: draft.entries.map((item, row) => row === index ? { ...item, source: event.currentTarget.value } : item) })} />
            </label>
            <label>
              <span>{t('ai.glossary.target').replace('{row}', String(index + 1))}</span>
              <TextInput value={entry.target} onChange={(event) => edit({ ...draft, entries: draft.entries.map((item, row) => row === index ? { ...item, target: event.currentTarget.value } : item) })} />
            </label>
            <Button type="button" aria-label={t('ai.glossary.removeRow').replace('{row}', String(index + 1))} onClick={() => edit({ ...draft, entries: draft.entries.filter((_, row) => row !== index) })}>{t('ai.glossary.remove')}</Button>
          </div>
        ))}
      </div>
      <div className="translate-glossary-editor__actions">
        <Button type="button" disabled={draft.entries.length >= GLOSSARY_LIMITS.entries} onClick={() => edit({ ...draft, entries: [...draft.entries, { source: '', target: '' }] })}>{t('ai.glossary.add')}</Button>
        <Button type="button" variant="primary" disabled={!dirty && !savedChanged} onClick={() => commit(false)}>{t('ai.glossary.save')}</Button>
        <Button type="button" disabled={saved === undefined} onClick={() => commit(true)}>{t('ai.glossary.clear')}</Button>
        <Button type="button" disabled={!dirty && !savedChanged && !message} onClick={() => { replaceDraft(saved); setMessage(null) }}>{t('ai.glossary.cancel')}</Button>
      </div>
      <p>{t('ai.glossary.draftHint')}</p>
      {!savedValidation.ok && <p role="alert">{t('ai.glossary.invalidSaved')}</p>}
      {savedChanged && <p role="status">{t('ai.glossary.changed')}</p>}
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    </section>
  )
}
