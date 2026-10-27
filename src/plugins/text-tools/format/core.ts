import { format as sqlFormat } from 'sql-formatter'
import { compactSql, CssFormatterError, layoutCss } from './lexical.ts'
import { formatXml, XmlFormatterError, type XmlFormatterErrorCode } from './xml.ts'

export type FormatterLanguage = 'sql' | 'css' | 'xml'
export type FormatterOperation = 'format' | 'compact'

export type FormatterResult =
  | { ok: true; output: string }
  | { ok: false; message: string; code?: XmlFormatterErrorCode | 'invalidCss' }


/** MySQL first (`#` comments, backticks), then PostgreSQL (`::`, `->>`, `$1`), then standard SQL. */
const SQL_DIALECTS = ['mysql', 'postgresql', 'sql'] as const

function formatSql(text: string): string {
  let lastError: unknown
  for (const language of SQL_DIALECTS) {
    try { return sqlFormat(text, { language }) } catch (error) { lastError = error }
  }
  throw lastError
}

export function formatText(language: FormatterLanguage, operation: FormatterOperation, text: string): string {
  if (language === 'sql') return operation === 'format' ? formatSql(text) : compactSql(text)
  if (language === 'css') return layoutCss(text, operation === 'compact')
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
    if (error instanceof XmlFormatterError || error instanceof CssFormatterError) return { ok: false, message: error.message, code: error.code }
    return { ok: false, message: formatterErrorMessage(error) }
  }
}
