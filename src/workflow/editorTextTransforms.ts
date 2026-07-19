export function rewriteTextPolitely(text: string): string {
  const normalized = normalizeEditorActionText(text)
  return [
    'Thanks for the context.',
    '',
    normalized,
    '',
    'I will follow up after checking the details.',
  ].join('\n')
}

export function compressTextToThreeSentences(text: string): string {
  const normalized = normalizeEditorActionText(text)
  const sentences = normalized
    .split(/(?<=[.!?。！？])\s+|[\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  return sentences.slice(0, 3).join(' ') || normalized
}

export function formatTextAsBullets(text: string): string {
  return text
    .split(/\r?\n|[。；;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join('\n')
}

export function quoteTextAsCodeBlock(text: string): string {
  return ['```', text.trim(), '```'].join('\n')
}

export function minifyJsonText(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return null
  }
}

export function convertJsonTextToYaml(text: string): string | null {
  try {
    return jsonToYaml(JSON.parse(text))
  } catch {
    return null
  }
}

export function extractJsonFieldPaths(text: string): string[] | null {
  try {
    return collectJsonFields(JSON.parse(text))
  } catch {
    return null
  }
}

function normalizeEditorActionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function jsonToYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value.map((item) => `${pad}- ${formatYamlValue(item, indent + 1)}`).join('\n')
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return entries.map(([key, item]) => {
      if (item && typeof item === 'object') return `${pad}${key}:\n${jsonToYaml(item, indent + 1)}`
      return `${pad}${key}: ${formatYamlScalar(item)}`
    }).join('\n')
  }
  return `${pad}${formatYamlScalar(value)}`
}

function formatYamlValue(value: unknown, indent: number): string {
  if (value && typeof value === 'object') return `\n${jsonToYaml(value, indent)}`
  return formatYamlScalar(value)
}

function formatYamlScalar(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  return String(value)
}

function collectJsonFields(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectJsonFields(item, `${prefix}[${index}]`))
  }
  if (!value || typeof value !== 'object') return prefix ? [prefix] : []
  const keys = Object.keys(value as Record<string, unknown>)
  if (keys.length === 0 && prefix) return [prefix]
  return keys.flatMap((key) => {
    const path = prefix ? `${prefix}.${key}` : key
    const child = (value as Record<string, unknown>)[key]
    return child && typeof child === 'object' ? collectJsonFields(child, path) : [path]
  })
}
