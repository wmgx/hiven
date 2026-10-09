import { format as sqlFormat } from 'sql-formatter'
import { formatXml, XmlFormatterError, type XmlFormatterErrorCode } from './xml.ts'

export type FormatterLanguage = 'sql' | 'css' | 'xml'
export type FormatterOperation = 'format' | 'compact'
export type FormatterRouteId = `${FormatterLanguage}-${FormatterOperation}`

export type FormatterResult =
  | { ok: true; output: string }
  | { ok: false; message: string; code?: XmlFormatterErrorCode }

export const formatterRoutes: {
  id: FormatterRouteId
  language: FormatterLanguage
  operation: FormatterOperation
  titleKey: string
  aliases: string[]
}[] = [
  { id: 'sql-format', language: 'sql', operation: 'format', titleKey: 'sql.prettify.title', aliases: ['sql format', 'format sql', 'sql pretty', 'pretty sql', 'sql-format', 'sql格式化', 'sql 格式化', 'sql geshihua', 'sql gsh'] },
  { id: 'sql-compact', language: 'sql', operation: 'compact', titleKey: 'sql.compact.title', aliases: ['sql compact', 'sql minify', 'compact sql', 'minify sql', 'sql压缩', 'sql 压缩', 'sql yasuo', 'sql ys'] },
  { id: 'css-format', language: 'css', operation: 'format', titleKey: 'css.prettify.title', aliases: ['css format', 'format css', 'css pretty', 'pretty css', 'css-format', 'css格式化', 'css 格式化', 'css geshihua', 'css gsh'] },
  { id: 'css-compact', language: 'css', operation: 'compact', titleKey: 'css.compact.title', aliases: ['css compact', 'css minify', 'compact css', 'minify css', 'css压缩', 'css 压缩', 'css yasuo', 'css ys'] },
  { id: 'xml-format', language: 'xml', operation: 'format', titleKey: 'xml.prettify.title', aliases: ['xml format', 'format xml', 'xml pretty', 'pretty xml', 'xml-format', 'xml格式化', 'xml 格式化', 'xml geshihua', 'xml gsh'] },
  { id: 'xml-compact', language: 'xml', operation: 'compact', titleKey: 'xml.compact.title', aliases: ['xml compact', 'xml minify', 'compact xml', 'minify xml', 'xml压缩', 'xml 压缩', 'xml yasuo', 'xml ys'] },
]

function cssPrettify(text: string): string {
  return text
    .replace(/\s*\{\s*/g, ' {\n  ')
    .replace(/\s*\}\s*/g, '\n}\n')
    .replace(/\s*;\s*/g, ';\n  ')
    .replace(/ {2}\n\}/g, '\n}')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function cssCompact(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()
}

function sqlCompact(text: string): string {
  return text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
}

export function formatText(language: FormatterLanguage, operation: FormatterOperation, text: string): string {
  if (language === 'sql') return operation === 'format' ? sqlFormat(text) : sqlCompact(text)
  if (language === 'css') return operation === 'format' ? cssPrettify(text) : cssCompact(text)
  return formatXml(text, operation)
}

export function formatterErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n', 1)[0]
}

export function processFormatter(language: FormatterLanguage, operation: FormatterOperation, text: string): FormatterResult {
  if (!text.trim()) return { ok: true, output: '' }
  try {
    return { ok: true, output: formatText(language, operation, text) }
  } catch (error) {
    if (error instanceof XmlFormatterError) return { ok: false, message: error.message, code: error.code }
    return { ok: false, message: formatterErrorMessage(error) }
  }
}
