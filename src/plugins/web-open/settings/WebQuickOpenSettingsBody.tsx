import { useState, type ReactNode } from 'react'
import type { PluginSettingsBodyProps } from '@hiven/plugin'
import {
  buildWebQuickOpenUrl,
  type WebQuickOpenEntry,
  type WebQuickOpenSettings,
} from './model'

export function WebQuickOpenSettingsBody({
  value,
  setValue,
  openExternal,
  t,
}: PluginSettingsBodyProps<WebQuickOpenSettings>) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function addEntry() {
    const newEntry: WebQuickOpenEntry = {
      id: crypto.randomUUID(),
      title: '',
      aliases: [],
      placeholder: '',
      urlTemplate: 'https://',
      encodeQuery: true,
      emptyQueryBehavior: 'block',
    }
    setValue({ entries: [...value.entries, newEntry] })
    setExpandedId(newEntry.id)
  }

  function removeEntry(id: string) {
    setValue({ entries: value.entries.filter((entry) => entry.id !== id) })
    if (expandedId === id) setExpandedId(null)
  }

  function updateEntry(id: string, patch: Partial<WebQuickOpenEntry>) {
    setValue({
      entries: value.entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry),
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {value.entries.map((entry) => {
        const isExpanded = expandedId === entry.id
        return (
          <div
            key={entry.id}
            className="rounded-lg overflow-hidden"
            style={{ border: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}
          >
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-left border-none bg-transparent cursor-pointer"
              style={{ color: 'var(--color-text-primary)' }}
              onClick={() => setExpandedId(isExpanded ? null : entry.id)}
            >
              <span className="flex-1 text-[13px] font-medium truncate">
                {entry.title || t('entryTitle')}
              </span>
              <span className="text-[11px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                {entry.aliases.join(', ') || '-'}
              </span>
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 flex flex-col gap-2" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                <SettingsField label={t('title')}>
                  <input
                    className="settings-input"
                    value={entry.title}
                    onChange={(event) => updateEntry(entry.id, { title: event.target.value })}
                    placeholder={t('defaultBaiduTitle')}
                  />
                </SettingsField>
                <SettingsField label={t('aliases')}>
                  <input
                    className="settings-input"
                    value={entry.aliases.join(', ')}
                    onChange={(event) => updateEntry(entry.id, {
                      aliases: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                    })}
                    placeholder="bd, baidu"
                  />
                </SettingsField>
                <SettingsField label={t('placeholder')}>
                  <input
                    className="settings-input"
                    value={entry.placeholder}
                    onChange={(event) => updateEntry(entry.id, { placeholder: event.target.value })}
                    placeholder={t('defaultBaiduPlaceholder')}
                  />
                </SettingsField>
                <SettingsField label={t('urlTemplate')}>
                  <input
                    className="settings-input"
                    value={entry.urlTemplate}
                    onChange={(event) => updateEntry(entry.id, { urlTemplate: event.target.value })}
                    placeholder="https://www.baidu.com/s?wd={query}"
                  />
                </SettingsField>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={entry.encodeQuery}
                      onChange={(event) => updateEntry(entry.id, { encodeQuery: event.target.checked })}
                    />
                    {t('encodeQuery')}
                  </label>
                  <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={entry.emptyQueryBehavior === 'block'}
                      onChange={(event) => updateEntry(entry.id, { emptyQueryBehavior: event.target.checked ? 'block' : 'open' })}
                    />
                    {t('emptyQueryBlock')}
                  </label>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    className="text-[12px] px-2 py-1 rounded"
                    style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)', border: 'none', cursor: 'pointer' }}
                    onClick={() => {
                      const testUrl = buildWebQuickOpenUrl(entry.urlTemplate, 'test', entry.encodeQuery)
                      void openExternal(testUrl)
                    }}
                  >
                    {t('testOpen')}
                  </button>
                  <button
                    className="text-[12px] px-2 py-1 rounded"
                    style={{ background: 'var(--color-error-light, rgba(255,0,0,0.1))', color: 'var(--color-error)', border: 'none', cursor: 'pointer' }}
                    onClick={() => removeEntry(entry.id)}
                  >
                    {t('removeEntry')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <button
        className="w-full text-[13px] py-2 rounded-lg border-none cursor-pointer"
        style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)' }}
        onClick={addEntry}
      >
        + {t('addEntry')}
      </button>
    </div>
  )
}

function SettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 mt-1">
      <label className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{label}</label>
      {children}
    </div>
  )
}
