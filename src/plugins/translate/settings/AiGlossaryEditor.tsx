import { useEffect, useState } from 'react'
import { Button, Select, TextInput, SurfaceError, SurfaceStatus } from '@hiven/plugin-ui'
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
  const [message, setMessage] = useState('')
  const [undo, setUndo] = useState<GlossaryDraft | null>(null)
  useEffect(() => { if (!undo) return; const timer = window.setTimeout(() => setUndo(null), 5000); return () => window.clearTimeout(timer) }, [undo])
  const edit = (next: GlossaryDraft) => {
    setDraft(next)
    const checked = validateAiGlossary(next.entries.length ? next : undefined)
    if (!checked.ok) { setMessage(t(`ai.glossary.error.${checked.issue.code}`).replace('{row}', String(checked.issue.row ?? ''))); return }
    try { onCommit(checked.value); setMessage('') } catch { setMessage(t('ai.glossary.saveFailed')) }
  }
  const remove = (index: number) => { setUndo(draft); edit({ ...draft, entries: draft.entries.filter((_, row) => row !== index) }) }
  const languageOptions = [
    { value: '', label: t('ai.glossary.chooseLanguage') },
    ...GLOSSARY_LANGUAGES.map((value) => ({ value, label: t(`language.${value}`) })),
  ]
  if (draft.targetLang && !GLOSSARY_LANGUAGES.some((value) => value === draft.targetLang)) {
    languageOptions.push({ value: draft.targetLang, label: t('ai.savedUnavailable').replace('{value}', draft.targetLang) })
  }

  return (
    <section className="translate-glossary-editor" aria-label={t('ai.glossary.title')} onKeyDown={event => {
      if (event.nativeEvent.isComposing || !(event.metaKey || event.ctrlKey) || event.key !== 'Backspace') return
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-glossary-row]')
      if (row) { event.preventDefault(); event.stopPropagation(); remove(Number(row.dataset.glossaryRow)) }
    }}>
      <SurfaceError>{message}</SurfaceError>
      {undo && <SurfaceStatus>{t('ai.glossary.deleted')} · <button onClick={() => { edit(undo); setUndo(null) }}>{t('ai.glossary.undo')}</button></SurfaceStatus>}
      <div className="font-medium">{t('ai.glossary.title')}</div>
      <p>{t('ai.glossary.privacy')}</p>
      <label className="flex flex-col gap-1.5">
        <span>{t('ai.glossary.targetLanguage')}</span>
        <Select value={draft.targetLang} options={languageOptions} onChange={(event) => edit({ ...draft, targetLang: event.currentTarget.value })} />
      </label>
      <div className="translate-glossary-editor__entries">
        {draft.entries.map((entry, index) => (
          <div key={index} className="translate-glossary-editor__row" data-glossary-row={index}>
            <label>
              <span>{t('ai.glossary.source').replace('{row}', String(index + 1))}</span>
              <TextInput value={entry.source} onChange={(event) => edit({ ...draft, entries: draft.entries.map((item, row) => row === index ? { ...item, source: event.currentTarget.value } : item) })} />
            </label>
            <label>
              <span>{t('ai.glossary.target').replace('{row}', String(index + 1))}</span>
              <TextInput value={entry.target} onChange={(event) => edit({ ...draft, entries: draft.entries.map((item, row) => row === index ? { ...item, target: event.currentTarget.value } : item) })} />
            </label>
            <Button type="button" aria-label={t('ai.glossary.removeRow').replace('{row}', String(index + 1))} onClick={() => remove(index)}>{t('ai.glossary.remove')}</Button>
          </div>
        ))}
      </div>
      <div className="translate-glossary-editor__actions">
        <Button type="button" disabled={draft.entries.length >= GLOSSARY_LIMITS.entries} onClick={() => edit({ ...draft, entries: [...draft.entries, { source: '', target: '' }] })}>{t('ai.glossary.add')}</Button>
        <Button type="button" disabled={!draft.entries.length} onClick={() => { setUndo(draft); edit({ targetLang: draft.targetLang, entries: [] }) }}>{t('ai.glossary.clear')}</Button>
      </div>
    </section>
  )
}
