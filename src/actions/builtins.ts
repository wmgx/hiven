import type { ActionDef } from '../store'

const liveOnInput: NonNullable<ActionDef['live']> = {
  live: {
    enabled: true,
    trigger: 'on-input',
    sideEffects: 'none',
    debounceMs: 250,
  },
}

export const builtinActions: ActionDef[] = [
  {
    name: 'json',
    title: 'JSON Formatter',
    titleI18n: { zh: 'JSON 格式化' },
    icon: 'Braces',
    aliases: ['json-format', 'pretty-json'],
    description: 'Pretty-print or compact JSON',
    descriptionI18n: { zh: '美化或压缩 JSON' },
    tags: ['json', 'format'],
    builtin: true,
    live: liveOnInput,
    optionalParams: true,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'Pretty', value: 'pretty', labelI18n: { zh: '美化' } },
          { label: 'Compact', value: 'compact', labelI18n: { zh: '压缩' } },
        ],
        default: 'pretty',
      },
    ],
    run(ctx) {
      try {
        const obj = JSON.parse(ctx.input.text)
        if (ctx.params.mode === 'compact') {
          return { text: JSON.stringify(obj) }
        }
        return { text: JSON.stringify(obj, null, 2) }
      } catch (e: any) {
        return { text: `Error: ${e.message}` }
      }
    },
  },

  {
    name: 'base64',
    title: 'Base64 Encode/Decode',
    titleI18n: { zh: 'Base64 编解码' },
    icon: 'Binary',
    aliases: ['encode', 'decode'],
    description: 'Base64 encode or decode text',
    descriptionI18n: { zh: 'Base64 编码或解码文本' },
    tags: ['encode', 'decode'],
    builtin: true,
    live: liveOnInput,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'Encode', value: 'encode', labelI18n: { zh: '编码' } },
          { label: 'Decode', value: 'decode', labelI18n: { zh: '解码' } },
        ],
        default: 'encode',
      },
    ],
    run(ctx) {
      try {
        if (ctx.params.mode === 'encode') {
          return { text: btoa(unescape(encodeURIComponent(ctx.input.text))) }
        }
        return { text: decodeURIComponent(escape(atob(ctx.input.text.trim()))) }
      } catch (e: any) {
        return { text: `Error: ${e.message}` }
      }
    },
  },
  {
    name: 'url',
    title: 'URL Encode/Decode',
    titleI18n: { zh: 'URL 编解码' },
    icon: 'Link',
    aliases: ['urlencode', 'urldecode'],
    description: 'URL encode or decode text',
    descriptionI18n: { zh: 'URL 编码或解码文本' },
    tags: ['encode', 'decode', 'url'],
    builtin: true,
    live: liveOnInput,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'Encode', value: 'encode', labelI18n: { zh: '编码' } },
          { label: 'Decode', value: 'decode', labelI18n: { zh: '解码' } },
        ],
        default: 'encode',
      },
    ],
    run(ctx) {
      try {
        if (ctx.params.mode === 'encode') {
          return { text: encodeURIComponent(ctx.input.text) }
        }
        return { text: decodeURIComponent(ctx.input.text.trim()) }
      } catch (e: any) {
        return { text: `Error: ${e.message}` }
      }
    },
  },
  {
    name: 'count',
    title: 'Text Statistics',
    titleI18n: { zh: '文本统计' },
    icon: 'BarChart',
    aliases: ['stats', 'wc'],
    description: 'Count lines, words, and characters',
    descriptionI18n: { zh: '统计行数、词数和字符数' },
    tags: ['text', 'stats'],
    builtin: true,
    live: liveOnInput,
    params: [],
    run(ctx) {
      const text = ctx.input.text
      const lines = text.split('\n').length
      const words = text.split(/\s+/).filter(w => w.length > 0).length
      const chars = text.length
      const charsNoSpace = text.replace(/\s/g, '').length
      return {
        text: `Lines: ${lines}\nWords: ${words}\nCharacters: ${chars}\nCharacters (no spaces): ${charsNoSpace}`
      }
    },
  },
  {
    name: 'sql',
    title: 'SQL Formatter',
    titleI18n: { zh: 'SQL 格式化' },
    icon: 'Database',
    aliases: ['sql-format', 'sql-minify'],
    description: 'Format or minify SQL',
    descriptionI18n: { zh: '美化或压缩 SQL' },
    tags: ['sql', 'format'],
    source: '// @deps sql-formatter https://esm.sh/sql-formatter@15?bundle',
    builtin: true,
    optionalParams: true,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'Pretty', value: 'pretty', labelI18n: { zh: '美化' } },
          { label: 'Compact', value: 'compact', labelI18n: { zh: '压缩' } },
        ],
        default: 'pretty',
      },
    ],
    async run(ctx) {
      const text = ctx.input.text
      if (ctx.params.mode === 'compact') {
        return { text: text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim() }
      }
      const { format } = ctx.deps['sql-formatter']
      return { text: format(text) }
    },
  },
  {
    name: 'hash',
    title: 'Hash',
    titleI18n: { zh: '哈希计算' },
    icon: 'Hash',
    aliases: ['md5', 'sha1', 'sha256', 'sha512'],
    description: 'Calculate hash digest',
    descriptionI18n: { zh: '计算哈希摘要' },
    tags: ['hash', 'crypto'],
    builtin: true,
    live: liveOnInput,
    optionalParams: true,
    params: [
      {
        key: 'algorithm',
        label: 'Algorithm',
        labelI18n: { zh: '算法' },
        type: 'single-select',
        options: [
          { label: 'SHA-256', value: 'SHA-256' },
          { label: 'SHA-1', value: 'SHA-1' },
          { label: 'SHA-512', value: 'SHA-512' },
        ],
        default: 'SHA-256',
      },
    ],
    async run(ctx) {
      try {
        const data = new TextEncoder().encode(ctx.input.text)
        const hashBuffer = await crypto.subtle.digest(ctx.params.algorithm, data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        return { text: hashArray.map(b => b.toString(16).padStart(2, '0')).join('') }
      } catch (e: any) {
        return { text: `Error: ${e.message}` }
      }
    },
  },
  {
    name: 'timestamp',
    title: 'Timestamp Convert',
    titleI18n: { zh: '时间戳转换' },
    icon: 'Clock',
    aliases: ['unix-time', 'epoch', 'date-convert'],
    description: 'Convert between timestamp and date',
    descriptionI18n: { zh: '时间戳与日期互转' },
    tags: ['time', 'convert'],
    builtin: true,
    live: liveOnInput,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'Timestamp → Date', value: 'to-date', labelI18n: { zh: '时间戳 → 日期' } },
          { label: 'Date → Timestamp', value: 'to-ts', labelI18n: { zh: '日期 → 时间戳' } },
          { label: 'Now', value: 'now', labelI18n: { zh: '当前时间' } },
        ],
        default: 'to-date',
      },
    ],
    run(ctx) {
      try {
        if (ctx.params.mode === 'now') {
          const now = Date.now()
          return { text: `${Math.floor(now / 1000)} (seconds)\n${now} (milliseconds)\n${new Date(now).toISOString()}` }
        }
        if (ctx.params.mode === 'to-date') {
          let ts = Number(ctx.input.text.trim())
          if (ts < 1e12) ts *= 1000
          return { text: new Date(ts).toISOString() }
        }
        const d = new Date(ctx.input.text.trim())
        if (isNaN(d.getTime())) return { text: 'Error: Invalid date' }
        return { text: `${Math.floor(d.getTime() / 1000)} (seconds)\n${d.getTime()} (milliseconds)` }
      } catch (e: any) {
        return { text: `Error: ${e.message}` }
      }
    },
  },
  {
    name: 'yaml',
    title: 'JSON ↔ YAML',
    titleI18n: { zh: 'JSON ↔ YAML' },
    icon: 'FileJson',
    aliases: ['json-yaml', 'yaml-json'],
    description: 'Convert between JSON and YAML',
    descriptionI18n: { zh: 'JSON 与 YAML 互转' },
    tags: ['json', 'yaml', 'convert'],
    source: '// @deps yaml https://esm.sh/js-yaml@4?bundle',
    builtin: true,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'JSON → YAML', value: 'json2yaml', labelI18n: { zh: 'JSON → YAML' } },
          { label: 'YAML → JSON', value: 'yaml2json', labelI18n: { zh: 'YAML → JSON' } },
        ],
        default: 'json2yaml',
      },
    ],
    async run(ctx) {
      const jsYaml = ctx.deps.yaml
      if (ctx.params.mode === 'json2yaml') {
        const obj = JSON.parse(ctx.input.text)
        return { text: jsYaml.dump(obj) }
      }
      const obj = jsYaml.load(ctx.input.text)
      return { text: JSON.stringify(obj, null, 2) }
    },
  },
  {
    name: 'sum',
    title: 'Sum',
    titleI18n: { zh: '求和' },
    icon: 'Calculator',
    aliases: ['add', 'total'],
    description: 'Sum all numbers across all lines (BigNumber precision)',
    descriptionI18n: { zh: '对所有数字求和（BigNumber 高精度）' },
    tags: ['math', 'number'],
    source: '// @deps bignumber https://esm.sh/bignumber.js@9?bundle',
    builtin: true,
    params: [],
    async run(ctx) {
      const BigNumber = ctx.deps.bignumber.default || ctx.deps.bignumber
      const re = /[\s,]+/
      const nums = ctx.input.text.split('\n')
        .flatMap((line: string) => line.trim().split(re).filter(Boolean))
        .filter((t: string) => !new BigNumber(t).isNaN())
      if (nums.length === 0) return { text: '0' }
      const total = nums.reduce((acc: any, n: string) => acc.plus(n), new BigNumber(0))
      return { text: total.toFixed() }
    },
  },
]
