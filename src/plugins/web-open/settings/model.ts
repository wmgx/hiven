export type WebQuickOpenEntry = {
  id: string
  title: string
  aliases: string[]
  placeholder: string
  urlTemplate: string
  encodeQuery: boolean
  emptyQueryBehavior: 'block' | 'open'
}

export type WebQuickOpenSettings = {
  enabled: boolean
  entries: WebQuickOpenEntry[]
}

export const DEFAULT_WEB_QUICK_OPEN_SETTINGS: WebQuickOpenSettings = {
  enabled: true,
  entries: [
    {
      id: 'google',
      title: 'Google 搜索',
      aliases: ['g', 'google'],
      placeholder: '输入搜索关键词',
      urlTemplate: 'https://www.google.com/search?q={query}',
      encodeQuery: true,
      emptyQueryBehavior: 'block',
    },
    {
      id: 'github',
      title: 'GitHub 仓库',
      aliases: ['gh', 'github'],
      placeholder: 'owner/repo 或关键词',
      urlTemplate: 'https://github.com/search?q={query}',
      encodeQuery: true,
      emptyQueryBehavior: 'block',
    },
    {
      id: 'mdn',
      title: 'MDN 文档',
      aliases: ['mdn'],
      placeholder: '输入 Web API 或 CSS 关键词',
      urlTemplate: 'https://developer.mozilla.org/search?q={query}',
      encodeQuery: true,
      emptyQueryBehavior: 'block',
    },
  ],
}

export function buildWebQuickOpenUrl(template: string, query: string, encode: boolean): string {
  const value = encode ? encodeURIComponent(query) : query
  if (template.includes('{query}')) {
    return template.replace('{query}', value)
  }
  return template
}
