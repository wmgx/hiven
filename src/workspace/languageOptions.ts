export type LanguageOption = {
  label: string
  value: string
  labelI18n?: { zh?: string; en?: string }
}

export const EDITOR_LANGUAGE_OPTIONS: LanguageOption[] = [
  { label: 'Plain Text', value: 'plaintext', labelI18n: { zh: '纯文本' } },
  { label: 'JSON', value: 'json' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'YAML', value: 'yaml' },
  { label: 'XML', value: 'xml' },
  { label: 'SQL', value: 'sql' },
  { label: 'Python', value: 'python' },
  { label: 'Shell', value: 'shell', labelI18n: { zh: 'Shell' } },
  { label: 'Go', value: 'go' },
  { label: 'Rust', value: 'rust' },
  { label: 'Java', value: 'java' },
  { label: 'C#', value: 'csharp' },
  { label: 'C++', value: 'cpp' },
]

export const LANGUAGE_COMMAND_OPTIONS: LanguageOption[] = [
  { label: 'Auto Detect', value: 'auto', labelI18n: { zh: '自动识别' } },
  ...EDITOR_LANGUAGE_OPTIONS,
]

export function isEditorLanguage(value: unknown): value is string {
  return typeof value === 'string' && EDITOR_LANGUAGE_OPTIONS.some((option) => option.value === value)
}

export function getLanguageOptionLabel(value: string, locale: 'zh' | 'en'): string {
  const option = EDITOR_LANGUAGE_OPTIONS.find((item) => item.value === value)
  if (!option) return value
  return option.labelI18n?.[locale] ?? option.label
}
