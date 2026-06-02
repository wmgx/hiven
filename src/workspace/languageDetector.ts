import { isEditorLanguage } from './languageOptions.ts'

const MIN_DETECTION_LINES = 3

export type LanguageDetectionOptions = {
  allowShortStrongSignals?: boolean
}

export function detectEditorLanguage(
  text: string,
  options: LanguageDetectionOptions = {}
): string {
  const trimmed = text.trim()
  if (!trimmed) return 'plaintext'
  const isShortContent = trimmed.split(/\r?\n/).length < MIN_DETECTION_LINES

  const firstToken = trimmed.match(/^\S+/)?.[0]?.toLowerCase() ?? ''

  if (isShortContent && !options.allowShortStrongSignals) return 'plaintext'
  if ((firstToken.startsWith('{') || firstToken.startsWith('[')) && isValidJson(trimmed)) return 'json'
  if (/^<!doctype\s+html\b/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return 'html'
  if (/^<\?xml\b/i.test(trimmed)) return 'xml'
  if (/^(select|insert|update|delete|create|alter|drop|with)\b/i.test(trimmed) && /\b(from|into|table|where|set|values|as)\b/i.test(trimmed)) return 'sql'
  if (looksLikeYaml(trimmed)) return 'yaml'
  if (looksLikeMarkdown(trimmed)) return 'markdown'
  if (looksLikeCss(trimmed)) return 'css'
  if (looksLikePython(trimmed)) return 'python'
  if (looksLikeTypeScript(trimmed)) return 'typescript'
  if (looksLikeJavaScript(trimmed)) return 'javascript'

  return 'plaintext'
}

export function normalizeEditorLanguage(value: unknown): string {
  return isEditorLanguage(value) ? value : 'plaintext'
}

export function detectExternalEditorLanguage(texts: string[], languages: Array<string | undefined> = []): string {
  const existingLanguage = languages.find((language) => (
    language && language !== 'plaintext' && isEditorLanguage(language)
  ))
  if (existingLanguage) return existingLanguage

  const detectedLanguage = texts
    .map((text) => detectEditorLanguage(text, { allowShortStrongSignals: true }))
    .find((language) => language !== 'plaintext')

  return detectedLanguage ?? 'plaintext'
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function looksLikeYaml(text: string): boolean {
  if (/^---\s*$/m.test(text)) return true
  if (/[;{}]/.test(text)) return false
  const keyLines = text.split(/\r?\n/).filter((line) => /^[A-Za-z_][\w-]*:\s+\S/.test(line.trim()))
  return keyLines.length >= 2
}

function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/)
  const markerLines = lines.filter((line) => /^(#{1,6}\s+\S|[-*]\s+\S|\d+\.\s+\S|>\s+\S)/.test(line.trim()))
  return markerLines.length >= 2
}

function looksLikeCss(text: string): boolean {
  return /[.#]?[A-Za-z][\w-]*\s*\{[^}]*[A-Za-z-]+\s*:/.test(text) && !/\b(function|const|let|var)\b/.test(text)
}

function looksLikePython(text: string): boolean {
  return /^(def|class)\s+[A-Za-z_]\w*[(:]/m.test(text) || /^from\s+\S+\s+import\s+\S+/m.test(text)
}

function looksLikeTypeScript(text: string): boolean {
  return /\b(interface|type)\s+[A-Za-z_]\w*\b/.test(text) || /\b(const|let|var)\s+\w+\s*:\s*[^=;,\n]+/.test(text)
}

function looksLikeJavaScript(text: string): boolean {
  return /\b(const|let|var)\s+\w+\s*=/.test(text) && /=>|\bfunction\b/.test(text)
}
