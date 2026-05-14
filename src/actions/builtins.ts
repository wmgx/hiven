import type { ActionDef } from '../store'

export const builtinActions: ActionDef[] = [
  {
    name: 'dedup',
    title: 'Remove Duplicate Lines',
    titleI18n: { zh: '去除重复行' },
    icon: 'Copy',
    aliases: ['unique', 'distinct'],
    description: 'Remove duplicate lines from text',
    descriptionI18n: { zh: '移除文本中的重复行' },
    tags: ['text', 'cleanup'],
    builtin: true,
    params: [],
    run(ctx) {
      const lines = ctx.input.text.split('\n')
      const seen = new Set<string>()
      const result: string[] = []
      for (const line of lines) {
        if (!seen.has(line)) {
          seen.add(line)
          result.push(line)
        }
      }
      return { text: result.join('\n') }
    },
  },
  {
    name: 'sort',
    title: 'Sort Lines',
    titleI18n: { zh: '行排序' },
    icon: 'ArrowUpDown',
    aliases: ['order'],
    description: 'Sort lines alphabetically',
    descriptionI18n: { zh: '按字母顺序排列行' },
    tags: ['text'],
    builtin: true,
    params: [
      {
        key: 'direction',
        label: 'Direction',
        labelI18n: { zh: '方向' },
        type: 'single-select',
        options: [
          { label: 'Ascending', value: 'asc', labelI18n: { zh: '升序' } },
          { label: 'Descending', value: 'desc', labelI18n: { zh: '降序' } },
        ],
        default: 'asc',
      },
    ],
    run(ctx) {
      const lines = ctx.input.text.split('\n')
      lines.sort((a, b) => {
        return ctx.params.direction === 'desc' ? b.localeCompare(a) : a.localeCompare(b)
      })
      return { text: lines.join('\n') }
    },
  },
  {
    name: 'trim',
    title: 'Trim Whitespace',
    titleI18n: { zh: '去除空白' },
    icon: 'Type',
    aliases: ['strip', 'clean'],
    description: 'Strip leading/trailing whitespace from each line',
    descriptionI18n: { zh: '去除每行首尾空白字符' },
    tags: ['text', 'cleanup'],
    builtin: true,
    params: [],
    run(ctx) {
      const lines = ctx.input.text.split('\n').map(l => l.trim())
      return { text: lines.join('\n') }
    },
  },
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
    name: 'extract',
    title: 'Extract Patterns',
    titleI18n: { zh: '提取模式' },
    icon: 'Regex',
    aliases: ['grep', 'filter'],
    description: 'Extract lines or patterns matching regex',
    descriptionI18n: { zh: '提取匹配正则的行或内容' },
    tags: ['text', 'extract'],
    builtin: true,
    params: [
      {
        key: 'pattern',
        label: 'Regex Pattern',
        labelI18n: { zh: '正则表达式' },
        type: 'text',
        default: '',
        required: true,
      },
      {
        key: 'matchOnly',
        label: 'Extract Matches Only',
        labelI18n: { zh: '仅提取匹配内容' },
        type: 'boolean',
        default: false,
      },
    ],
    run(ctx) {
      const { pattern, matchOnly } = ctx.params
      if (!pattern) return { text: ctx.input.text }
      try {
        const re = new RegExp(pattern, 'gim')
        if (matchOnly) {
          const matches = ctx.input.text.match(re) || []
          return { text: matches.join('\n') }
        }
        const lines = ctx.input.text.split('\n').filter(l => re.test(l))
        return { text: lines.join('\n') }
      } catch (e: any) {
        return { text: `Error: ${e.message}` }
      }
    },
  },
  {
    name: 'case',
    title: 'Case Convert',
    titleI18n: { zh: '大小写转换' },
    icon: 'CaseSensitive',
    aliases: ['uppercase', 'lowercase', 'titlecase'],
    description: 'Convert text case',
    descriptionI18n: { zh: '转换文本大小写' },
    tags: ['text', 'transform'],
    builtin: true,
    params: [
      {
        key: 'mode',
        label: 'Convert To',
        labelI18n: { zh: '转换为' },
        type: 'single-select',
        options: [
          { label: 'UPPERCASE', value: 'upper', labelI18n: { zh: '大写' } },
          { label: 'lowercase', value: 'lower', labelI18n: { zh: '小写' } },
          { label: 'Title Case', value: 'title', labelI18n: { zh: '首字母大写' } },
          { label: 'camelCase', value: 'camel' },
          { label: 'snake_case', value: 'snake' },
        ],
        default: 'upper',
      },
    ],
    run(ctx) {
      const text = ctx.input.text
      switch (ctx.params.mode) {
        case 'upper': return { text: text.toUpperCase() }
        case 'lower': return { text: text.toLowerCase() }
        case 'title': return { text: text.replace(/\b\w/g, c => c.toUpperCase()) }
        case 'camel': return { text: text.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '') }
        case 'snake': return { text: text.replace(/[\s-]+/g, '_').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() }
        default: return { text }
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
    name: 'csv',
    title: 'CSV / TSV Convert',
    titleI18n: { zh: 'CSV / TSV 转换' },
    icon: 'Table',
    aliases: ['csv-json', 'tsv-json'],
    description: 'Convert between CSV/TSV and JSON',
    descriptionI18n: { zh: 'CSV/TSV 与 JSON 互转' },
    tags: ['csv', 'tsv', 'json', 'convert'],
    builtin: true,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'CSV → JSON', value: 'csv2json', labelI18n: { zh: 'CSV → JSON' } },
          { label: 'JSON → CSV', value: 'json2csv', labelI18n: { zh: 'JSON → CSV' } },
          { label: 'TSV → JSON', value: 'tsv2json', labelI18n: { zh: 'TSV → JSON' } },
          { label: 'JSON → TSV', value: 'json2tsv', labelI18n: { zh: 'JSON → TSV' } },
        ],
        default: 'csv2json',
      },
    ],
    run(ctx) {
      const mode = ctx.params.mode
      try {
        if (mode === 'csv2json' || mode === 'tsv2json') {
          const sep = mode === 'tsv2json' ? '\t' : ','
          const lines = ctx.input.text.trim().split('\n')
          if (lines.length < 2) return { text: '[]' }
          const headers = lines[0].split(sep).map((h: string) => h.trim())
          const result = lines.slice(1).map(line => {
            const vals = line.split(sep)
            const obj: Record<string, string> = {}
            headers.forEach((h: string, i: number) => { obj[h] = (vals[i] || '').trim() })
            return obj
          })
          return { text: JSON.stringify(result, null, 2) }
        } else {
          const sep = mode === 'json2tsv' ? '\t' : ','
          const arr = JSON.parse(ctx.input.text)
          if (!Array.isArray(arr) || arr.length === 0) return { text: '' }
          const headers = Object.keys(arr[0])
          const lines = [headers.join(sep)]
          for (const row of arr) {
            lines.push(headers.map((h: string) => String(row[h] ?? '')).join(sep))
          }
          return { text: lines.join('\n') }
        }
      } catch (e: any) {
        return { text: `Error: ${e.message}` }
      }
    },
  },
  {
    name: 'css',
    title: 'CSS Formatter',
    titleI18n: { zh: 'CSS 格式化' },
    icon: 'Paintbrush',
    aliases: ['css-format', 'css-minify'],
    description: 'Format or minify CSS',
    descriptionI18n: { zh: '美化或压缩 CSS' },
    tags: ['css', 'format'],
    builtin: true,
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
      const text = ctx.input.text
      if (ctx.params.mode === 'compact') {
        return {
          text: text
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\s+/g, ' ')
            .replace(/\s*([{}:;,])\s*/g, '$1')
            .replace(/;}/g, '}')
            .trim()
        }
      }
      let result = text
        .replace(/\s*\{\s*/g, ' {\n  ')
        .replace(/\s*\}\s*/g, '\n}\n')
        .replace(/\s*;\s*/g, ';\n  ')
        .replace(/  \n\}/g, '\n}')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      return { text: result }
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
    name: 'xml',
    title: 'XML Formatter',
    titleI18n: { zh: 'XML 格式化' },
    icon: 'Code',
    aliases: ['xml-format', 'xml-minify', 'html-format'],
    description: 'Format or minify XML/HTML',
    descriptionI18n: { zh: '美化或压缩 XML/HTML' },
    tags: ['xml', 'html', 'format'],
    builtin: true,
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
      const text = ctx.input.text
      if (ctx.params.mode === 'compact') {
        return { text: text.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim() }
      }
      let formatted = ''
      let indent = 0
      const nodes = text.replace(/>\s+</g, '><').trim().split(/(<[^>]+>)/g).filter(Boolean)
      for (const node of nodes) {
        if (node.match(/^<\/\w/)) indent--
        formatted += '  '.repeat(Math.max(indent, 0)) + node.trim() + '\n'
        if (node.match(/^<\w[^>]*[^/]>$/)) indent++
      }
      return { text: formatted.trim() }
    },
  },
  {
    name: 'html',
    title: 'HTML Encode/Decode',
    titleI18n: { zh: 'HTML 编解码' },
    icon: 'FileCode',
    aliases: ['html-entities', 'html-escape'],
    description: 'HTML entity encode or decode',
    descriptionI18n: { zh: 'HTML 实体编码或解码' },
    tags: ['html', 'encode', 'decode'],
    builtin: true,
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
      if (ctx.params.mode === 'encode') {
        return {
          text: ctx.input.text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
        }
      }
      return {
        text: ctx.input.text
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&')
      }
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
    name: 'jwt',
    title: 'JWT Decode',
    titleI18n: { zh: 'JWT 解码' },
    icon: 'Key',
    aliases: ['jwt-decode', 'json-web-token'],
    description: 'Decode JWT token',
    descriptionI18n: { zh: '解码 JWT 令牌' },
    tags: ['jwt', 'decode', 'auth'],
    builtin: true,
    params: [],
    run(ctx) {
      try {
        const parts = ctx.input.text.trim().split('.')
        if (parts.length !== 3) return { text: 'Error: Invalid JWT (expected 3 parts)' }
        const decode = (s: string) => {
          const pad = s + '='.repeat((4 - s.length % 4) % 4)
          return JSON.parse(decodeURIComponent(escape(atob(pad.replace(/-/g, '+').replace(/_/g, '/')))))
        }
        const header = decode(parts[0])
        const payload = decode(parts[1])
        return { text: `// Header\n${JSON.stringify(header, null, 2)}\n\n// Payload\n${JSON.stringify(payload, null, 2)}` }
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
    name: 'hex',
    title: 'Number Base Convert',
    titleI18n: { zh: '进制转换' },
    icon: 'Calculator',
    aliases: ['decimal', 'binary', 'octal', 'hex-convert'],
    description: 'Convert between number bases',
    descriptionI18n: { zh: '数字进制互转' },
    tags: ['number', 'convert'],
    builtin: true,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'Dec → Hex', value: 'dec2hex' },
          { label: 'Hex → Dec', value: 'hex2dec' },
          { label: 'Dec → Bin', value: 'dec2bin' },
          { label: 'Bin → Dec', value: 'bin2dec' },
        ],
        default: 'dec2hex',
      },
    ],
    run(ctx) {
      try {
        const lines = ctx.input.text.trim().split('\n')
        const result = lines.map(line => {
          const v = line.trim()
          switch (ctx.params.mode) {
            case 'dec2hex': return parseInt(v, 10).toString(16).toUpperCase()
            case 'hex2dec': return parseInt(v, 16).toString(10)
            case 'dec2bin': return parseInt(v, 10).toString(2)
            case 'bin2dec': return parseInt(v, 2).toString(10)
            default: return v
          }
        })
        return { text: result.join('\n') }
      } catch (e: any) {
        return { text: `Error: ${e.message}` }
      }
    },
  },
  {
    name: 'slashes',
    title: 'Add/Remove Slashes',
    titleI18n: { zh: '转义/反转义' },
    icon: 'Quote',
    aliases: ['escape', 'unescape', 'addslashes', 'stripslashes'],
    description: 'Escape or unescape special characters',
    descriptionI18n: { zh: '转义或反转义特殊字符' },
    tags: ['text', 'escape'],
    builtin: true,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'Escape', value: 'escape', labelI18n: { zh: '转义' } },
          { label: 'Unescape', value: 'unescape', labelI18n: { zh: '反转义' } },
        ],
        default: 'escape',
      },
    ],
    run(ctx) {
      if (ctx.params.mode === 'escape') {
        return {
          text: ctx.input.text
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t')
        }
      }
      return {
        text: ctx.input.text
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r')
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'")
          .replace(/\\\\/g, '\\')
      }
    },
  },
  {
    name: 'reverse',
    title: 'Reverse Lines',
    titleI18n: { zh: '反转行' },
    icon: 'ArrowDownUp',
    aliases: ['flip-lines'],
    description: 'Reverse the order of lines',
    descriptionI18n: { zh: '反转行顺序' },
    tags: ['text'],
    builtin: true,
    params: [],
    run(ctx) {
      return { text: ctx.input.text.split('\n').reverse().join('\n') }
    },
  },
  {
    name: 'join',
    title: 'Join Lines',
    titleI18n: { zh: '合并行' },
    icon: 'Merge',
    aliases: ['merge-lines', 'concat-lines'],
    description: 'Join lines with a separator',
    descriptionI18n: { zh: '用分隔符合并行' },
    tags: ['text'],
    builtin: true,
    params: [
      {
        key: 'separator',
        label: 'Separator',
        labelI18n: { zh: '分隔符' },
        type: 'text',
        default: ',',
      },
    ],
    run(ctx) {
      const sep = (ctx.params.separator ?? ',')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
      return { text: ctx.input.text.split('\n').join(sep) }
    },
  },
  {
    name: 'querystring',
    title: 'JSON ↔ Query String',
    titleI18n: { zh: 'JSON ↔ 查询字符串' },
    icon: 'Search',
    aliases: ['query-json', 'json-query', 'qs'],
    description: 'Convert between JSON and URL query string',
    descriptionI18n: { zh: 'JSON 与 URL 查询字符串互转' },
    tags: ['json', 'url', 'convert'],
    builtin: true,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'JSON → Query', value: 'json2qs', labelI18n: { zh: 'JSON → 查询字符串' } },
          { label: 'Query → JSON', value: 'qs2json', labelI18n: { zh: '查询字符串 → JSON' } },
        ],
        default: 'json2qs',
      },
    ],
    run(ctx) {
      try {
        if (ctx.params.mode === 'json2qs') {
          const obj = JSON.parse(ctx.input.text)
          const params = new URLSearchParams()
          for (const [k, v] of Object.entries(obj)) {
            params.set(k, String(v))
          }
          return { text: params.toString() }
        }
        let qs = ctx.input.text.trim()
        if (qs.startsWith('?')) qs = qs.slice(1)
        const params = new URLSearchParams(qs)
        const obj: Record<string, string> = {}
        params.forEach((v, k) => { obj[k] = v })
        return { text: JSON.stringify(obj, null, 2) }
      } catch (e: any) {
        return { text: `Error: ${e.message}` }
      }
    },
  },
  {
    name: 'sortjson',
    title: 'Sort JSON Keys',
    titleI18n: { zh: 'JSON Key 排序' },
    icon: 'ArrowUpNarrowWide',
    aliases: ['json-sort', 'sort-json-keys'],
    description: 'Sort JSON object keys alphabetically',
    descriptionI18n: { zh: '按字母顺序排列 JSON 对象的 key' },
    tags: ['json', 'sort'],
    builtin: true,
    params: [],
    run(ctx) {
      try {
        const sortKeys = (obj: any): any => {
          if (Array.isArray(obj)) return obj.map(sortKeys)
          if (obj && typeof obj === 'object') {
            return Object.keys(obj).sort().reduce((acc: any, key: string) => {
              acc[key] = sortKeys(obj[key])
              return acc
            }, {})
          }
          return obj
        }
        return { text: JSON.stringify(sortKeys(JSON.parse(ctx.input.text)), null, 2) }
      } catch (e: any) {
        return { text: `Error: ${e.message}` }
      }
    },
  },
  {
    name: 'lorem',
    title: 'Lorem Ipsum',
    titleI18n: { zh: 'Lorem Ipsum' },
    icon: 'FileText',
    aliases: ['placeholder', 'dummy-text'],
    description: 'Generate placeholder text',
    descriptionI18n: { zh: '生成占位文本' },
    tags: ['generate'],
    builtin: true,
    params: [],
    run() {
      return {
        text: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\n\nSed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.`
      }
    },
  },
  {
    name: 'mdquote',
    title: 'Markdown Quote',
    titleI18n: { zh: 'Markdown 引用' },
    icon: 'MessageSquareQuote',
    aliases: ['blockquote', 'quote'],
    description: 'Add or remove Markdown quote prefix',
    descriptionI18n: { zh: '添加或移除 Markdown 引用前缀' },
    tags: ['markdown', 'text'],
    builtin: true,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'Add', value: 'add', labelI18n: { zh: '添加' } },
          { label: 'Remove', value: 'remove', labelI18n: { zh: '移除' } },
        ],
        default: 'add',
      },
    ],
    run(ctx) {
      const lines = ctx.input.text.split('\n')
      if (ctx.params.mode === 'remove') {
        return { text: lines.map(l => l.replace(/^>\s?/, '')).join('\n') }
      }
      return { text: lines.map(l => '> ' + l).join('\n') }
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
    name: 'append',
    title: 'Append to Lines',
    titleI18n: { zh: '追加到每行' },
    icon: 'ArrowRightToLine',
    aliases: ['append-lines', 'suffix'],
    description: 'Append a suffix to the end of each line',
    descriptionI18n: { zh: '在每行末尾追加指定文本' },
    tags: ['text', 'lines'],
    builtin: true,
    params: [
      {
        key: 'suffix',
        label: 'Suffix',
        labelI18n: { zh: '后缀' },
        type: 'text',
        default: ',',
      },
    ],
    run(ctx) {
      const suffix = ctx.params.suffix ?? ','
      const lines = ctx.input.text.split('\n').map(l => l + suffix)
      return { text: lines.join('\n') }
    },
  },
  {
    name: 'prepend',
    title: 'Prepend to Lines',
    titleI18n: { zh: '前缀插入每行' },
    icon: 'ArrowLeftToLine',
    aliases: ['prepend-lines', 'prefix'],
    description: 'Prepend a prefix to the beginning of each line',
    descriptionI18n: { zh: '在每行开头插入指定文本' },
    tags: ['text', 'lines'],
    builtin: true,
    params: [
      {
        key: 'prefix',
        label: 'Prefix',
        labelI18n: { zh: '前缀' },
        type: 'text',
        default: '- ',
      },
    ],
    run(ctx) {
      const prefix = ctx.params.prefix ?? '- '
      const lines = ctx.input.text.split('\n').map(l => prefix + l)
      return { text: lines.join('\n') }
    },
  },
  {
    name: 'wrap',
    title: 'Wrap Lines',
    titleI18n: { zh: '包裹每行' },
    icon: 'WrapText',
    aliases: ['wrap-lines', 'surround'],
    description: 'Wrap each line with prefix and suffix',
    descriptionI18n: { zh: '在每行两端添加指定文本' },
    tags: ['text', 'lines'],
    builtin: true,
    params: [
      {
        key: 'left',
        label: 'Left',
        labelI18n: { zh: '左侧' },
        type: 'text',
        default: '"',
      },
      {
        key: 'right',
        label: 'Right',
        labelI18n: { zh: '右侧' },
        type: 'text',
        default: '"',
      },
    ],
    run(ctx) {
      const left = ctx.params.left ?? '"'
      const right = ctx.params.right ?? '"'
      const lines = ctx.input.text.split('\n').map(l => left + l + right)
      return { text: lines.join('\n') }
    },
  },
  {
    name: 'sum',
    title: 'Sum Lines',
    titleI18n: { zh: '逐行求和' },
    icon: 'Calculator',
    aliases: ['add', 'total'],
    description: 'Sum numbers on each line (BigNumber precision)',
    descriptionI18n: { zh: '对每行数字求和（BigNumber 高精度）' },
    tags: ['math', 'number'],
    source: '// @deps bignumber https://esm.sh/bignumber.js@9?bundle',
    builtin: true,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'Sum per line', value: 'per-line', labelI18n: { zh: '逐行求和' } },
          { label: 'Grand total', value: 'total', labelI18n: { zh: '全部求和' } },
        ],
        default: 'per-line',
      },
      {
        key: 'separator',
        label: 'Number separator',
        labelI18n: { zh: '数字分隔符' },
        type: 'single-select',
        options: [
          { label: 'Auto (whitespace/comma)', value: 'auto', labelI18n: { zh: '自动（空白/逗号）' } },
          { label: 'Whitespace', value: 'space', labelI18n: { zh: '空白字符' } },
          { label: 'Comma', value: 'comma', labelI18n: { zh: '逗号' } },
          { label: 'Tab', value: 'tab', labelI18n: { zh: '制表符' } },
        ],
        default: 'auto',
      },
    ],
    async run(ctx) {
      const BigNumber = ctx.deps.bignumber.default || ctx.deps.bignumber
      const sepRegex: Record<string, RegExp> = {
        auto: /[\s,]+/,
        space: /\s+/,
        comma: /,\s*/,
        tab: /\t+/,
      }
      const re = sepRegex[ctx.params.separator as string] || sepRegex.auto
      const lines = ctx.input.text.split('\n')

      function sumLine(line: string): string {
        const tokens = line.trim().split(re).filter(Boolean)
        const nums = tokens.filter((t: string) => !new BigNumber(t).isNaN())
        if (nums.length === 0) return ''
        return nums.reduce((acc: any, n: string) => acc.plus(n), new BigNumber(0)).toFixed()
      }

      if (ctx.params.mode === 'total') {
        const all = lines.flatMap((line: string) => {
          const tokens = line.trim().split(re).filter(Boolean)
          return tokens.filter((t: string) => !new BigNumber(t).isNaN())
        })
        if (all.length === 0) return { text: '0' }
        const total = all.reduce((acc: any, n: string) => acc.plus(n), new BigNumber(0))
        return { text: total.toFixed() }
      }

      const results = lines.map((line: string) => {
        const s = sumLine(line)
        return s === '' ? line : s
      })
      return { text: results.join('\n') }
    },
  },
  {
    name: 'sqlin',
    title: 'Lines to SQL IN',
    titleI18n: { zh: '行转 SQL IN' },
    icon: 'Database',
    aliases: ['sql-in', 'lines-to-sql'],
    description: 'Convert lines to SQL IN clause',
    descriptionI18n: { zh: '将多行文本转为 SQL IN 子句' },
    tags: ['sql', 'convert'],
    builtin: true,
    params: [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { zh: '模式' },
        type: 'single-select',
        options: [
          { label: 'String', value: 'string', labelI18n: { zh: '字符串' } },
          { label: 'Number', value: 'number', labelI18n: { zh: '数字' } },
        ],
        default: 'string',
      },
    ],
    run(ctx) {
      const lines = ctx.input.text.split('\n').filter(l => l.trim() !== '')
      if (ctx.params.mode === 'number') {
        const values = lines.map(l => l.trim())
        return { text: '(' + values.join(',') + ')' }
      }
      const values = lines.map(l => "'" + l.trim().replace(/'/g, "''") + "'")
      return { text: '(' + values.join(',') + ')' }
    },
  },
]
