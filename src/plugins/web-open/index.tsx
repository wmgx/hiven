/**
 * Web Quick Open Plugin
 * Allows users to configure URL templates and quickly open web pages
 * via the GlobalLauncher secondary input mode.
 */

import { useState } from 'react'
import { definePlugin } from '../../workspace/definePlugin'
import { useAppStore } from '../../store'
import { makePluginT } from '../../i18n/pluginI18nRegistry'
import type {
  PluginSettingsBodyProps,
  LauncherQuickEntry,
  PluginCommandResult,
} from '../../workspace/pluginTypes'

// ─── Settings Types ──────────────────────────────────────────────────────────

type WebQuickOpenEntry = {
  id: string
  title: string
  aliases: string[]
  placeholder: string
  urlTemplate: string
  encodeQuery: boolean
  emptyQueryBehavior: 'block' | 'open'
}

type WebQuickOpenSettings = {
  entries: WebQuickOpenEntry[]
}

// ─── Default Settings ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: WebQuickOpenSettings = {
  entries: [
    {
      id: 'baidu',
      title: '百度搜索',
      aliases: ['bd', 'baidu'],
      placeholder: '输入搜索关键词',
      urlTemplate: 'https://www.baidu.com/s?wd={query}',
      encodeQuery: true,
      emptyQueryBehavior: 'block',
    },
  ],
}

// ─── URL Template Processing ─────────────────────────────────────────────────

function buildUrl(template: string, query: string, encode: boolean): string {
  const value = encode ? encodeURIComponent(query) : query
  if (template.includes('{query}')) {
    return template.replace('{query}', value)
  }
  // No {query} in template — treat as fixed link
  return template
}

// ─── Settings Body Component ─────────────────────────────────────────────────

function WebQuickOpenSettingsBody({
  pluginId,
  value,
  setValue,
  openExternal,
}: PluginSettingsBodyProps<WebQuickOpenSettings>) {
  const locale = useAppStore((s) => s.locale)
  const pt = makePluginT(pluginId, locale)
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
    setValue({ entries: value.entries.filter((e) => e.id !== id) })
    if (expandedId === id) setExpandedId(null)
  }

  function updateEntry(id: string, patch: Partial<WebQuickOpenEntry>) {
    setValue({
      entries: value.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
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
            {/* Collapsed header */}
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-left border-none bg-transparent cursor-pointer"
              style={{ color: 'var(--color-text-primary)' }}
              onClick={() => setExpandedId(isExpanded ? null : entry.id)}
            >
              <span className="flex-1 text-[13px] font-medium truncate">
                {entry.title || pt('entryTitle')}
              </span>
              <span className="text-[11px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                {entry.aliases.join(', ') || '—'}
              </span>
            </button>

            {/* Expanded editor */}
            {isExpanded && (
              <div className="px-3 pb-3 flex flex-col gap-2" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                <SettingsField label={pt('title')}>
                  <input
                    className="settings-input"
                    value={entry.title}
                    onChange={(e) => updateEntry(entry.id, { title: e.target.value })}
                    placeholder={pt('defaultBaiduTitle')}
                  />
                </SettingsField>
                <SettingsField label={pt('aliases')}>
                  <input
                    className="settings-input"
                    value={entry.aliases.join(', ')}
                    onChange={(e) => updateEntry(entry.id, {
                      aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })}
                    placeholder="bd, baidu"
                  />
                </SettingsField>
                <SettingsField label={pt('placeholder')}>
                  <input
                    className="settings-input"
                    value={entry.placeholder}
                    onChange={(e) => updateEntry(entry.id, { placeholder: e.target.value })}
                    placeholder={pt('defaultBaiduPlaceholder')}
                  />
                </SettingsField>
                <SettingsField label={pt('urlTemplate')}>
                  <input
                    className="settings-input"
                    value={entry.urlTemplate}
                    onChange={(e) => updateEntry(entry.id, { urlTemplate: e.target.value })}
                    placeholder="https://www.baidu.com/s?wd={query}"
                  />
                </SettingsField>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={entry.encodeQuery}
                      onChange={(e) => updateEntry(entry.id, { encodeQuery: e.target.checked })}
                    />
                    {pt('encodeQuery')}
                  </label>
                  <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={entry.emptyQueryBehavior === 'block'}
                      onChange={(e) => updateEntry(entry.id, { emptyQueryBehavior: e.target.checked ? 'block' : 'open' })}
                    />
                    {pt('emptyQueryBlock')}
                  </label>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    className="text-[12px] px-2 py-1 rounded"
                    style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)', border: 'none', cursor: 'pointer' }}
                    onClick={() => {
                      const testUrl = buildUrl(entry.urlTemplate, 'test', entry.encodeQuery)
                      void openExternal(testUrl)
                    }}
                  >
                    {pt('testOpen')}
                  </button>
                  <button
                    className="text-[12px] px-2 py-1 rounded"
                    style={{ background: 'var(--color-error-light, rgba(255,0,0,0.1))', color: 'var(--color-error)', border: 'none', cursor: 'pointer' }}
                    onClick={() => removeEntry(entry.id)}
                  >
                    {pt('removeEntry')}
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
        + {pt('addEntry')}
      </button>
    </div>
  )
}

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 mt-1">
      <label className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{label}</label>
      {children}
    </div>
  )
}

// ─── Plugin Definition ───────────────────────────────────────────────────────

export default definePlugin<WebQuickOpenSettings>({
  settings: {
    title: 'Web Quick Open',
    titleI18n: { zh: '网页快开' },
    version: 1,
    defaultValue: DEFAULT_SETTINGS,
    component: WebQuickOpenSettingsBody,
  },

  launcherQuickEntries: {
    getEntries(ctx): LauncherQuickEntry[] {
      const settings = ctx.settings as WebQuickOpenSettings | undefined
      const entries = settings?.entries ?? DEFAULT_SETTINGS.entries

      return entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        aliases: entry.aliases,
        placeholder: entry.placeholder,
        allowEmptyInput: entry.emptyQueryBehavior !== 'block',
        emptyInputMessage: entry.emptyQueryBehavior === 'block' ? '请输入内容' : undefined,
        emptyInputMessageI18n: entry.emptyQueryBehavior === 'block' ? { zh: '请输入内容', en: 'Please enter content' } : undefined,
        run(input: string): PluginCommandResult {
          const url = buildUrl(entry.urlTemplate, input, entry.encodeQuery)
          return {
            effects: [{ type: 'app.openExternal', url }],
          }
        },
      }))
    },
  },
})
