export type SnippetEntry = {
  id: string
  title: string
  body: string
  /** Trigger words for launcher search. */
  aliases: string[]
  /**
   * Optional expansion keyword (product: off by default globally).
   * When keyword expansion is enabled later, typing this expands the body.
   */
  keyword?: string
  enabled?: boolean
}

export type SnippetsSettings = {
  enabled: boolean
  /** Keyword expansion is intentionally off in v1 (no background keystroke matcher). */
  keywordExpansionEnabled: boolean
  snippets: SnippetEntry[]
}

export const DEFAULT_SNIPPETS_SETTINGS: SnippetsSettings = {
  enabled: true,
  keywordExpansionEnabled: false,
  snippets: [
    {
      id: 'sig',
      title: 'Email signature',
      body: 'Best regards,\n{clipboard}',
      aliases: ['sig', 'signature', '签名'],
      enabled: true,
    },
    {
      id: 'meeting-note',
      title: 'Meeting note header',
      body: '# Meeting · {date}\n\n- Attendees:\n- Notes:\n- Actions:\n',
      aliases: ['meeting', '会议纪要', 'mtg'],
      enabled: true,
    },
    {
      id: 'todo',
      title: 'TODO line',
      body: '- [ ] {clipboard}',
      aliases: ['todo', '待办'],
      enabled: true,
    },
  ],
}

export function normalizeSnippetsSettings(raw: unknown): SnippetsSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SNIPPETS_SETTINGS
  const r = raw as Partial<SnippetsSettings>
  const snippets = Array.isArray(r.snippets)
    ? r.snippets
        .filter((s): s is SnippetEntry => Boolean(s && typeof s === 'object' && typeof (s as SnippetEntry).id === 'string'))
        .map((s) => ({
          id: String(s.id),
          title: String(s.title ?? s.id),
          body: String(s.body ?? ''),
          aliases: Array.isArray(s.aliases) ? s.aliases.map(String) : [],
          keyword: s.keyword ? String(s.keyword) : undefined,
          enabled: s.enabled !== false,
        }))
    : DEFAULT_SNIPPETS_SETTINGS.snippets
  return {
    enabled: r.enabled !== false,
    keywordExpansionEnabled: r.keywordExpansionEnabled === true,
    snippets,
  }
}

export function enabledSnippets(settings: SnippetsSettings): SnippetEntry[] {
  if (!settings.enabled) return []
  return settings.snippets.filter((s) => s.enabled !== false && s.body.trim().length > 0)
}
