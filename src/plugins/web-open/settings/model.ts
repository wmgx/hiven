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
  entries: WebQuickOpenEntry[]
}

export const DEFAULT_WEB_QUICK_OPEN_SETTINGS: WebQuickOpenSettings = {
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

export function buildWebQuickOpenUrl(template: string, query: string, encode: boolean): string {
  const value = encode ? encodeURIComponent(query) : query
  if (template.includes('{query}')) {
    return template.replace('{query}', value)
  }
  return template
}
