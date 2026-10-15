import { cleanLineList, processLines, findDuplicateLines, duplicateLineReport, type DuplicateLineGroup, type LineOperation, type LineOptions } from './core'
import { lineOperationRoutes } from './routes'
import { escapeRegexPattern } from './escapeRegexPattern'
import { extractTextList } from './extractTextList'
import { cleanAgentText } from './cleanAgentText'
import { cleanInvisibleCharacters, type InvisibleCharacterCleanup } from './cleanInvisibleCharacters'

export type WorkbenchCategory = 'text' | 'json' | 'url'
export type WorkbenchOperation =
  | Exclude<LineOperation, 'trim-whitespace' | 'remove-blank-lines'>
  | 'trim'
  | 'remove-blank'
  | 'clean-list'
  | 'clean-invisible-characters'
  | 'clean-agent-text'
  | 'markdown-plain-text'
  | 'json-format'
  | 'json-compact'
  | 'url-encode'
  | 'url-decode'
  | 'regex-escape'
  | 'extract-urls'
  | 'find-duplicates'

export type WorkbenchOptions = LineOptions & {
  indent: number
  trim: boolean
  removeBlank: boolean
  dedup: boolean
  duplicateIgnoreCase: boolean
  duplicateTrim: boolean
  cleanAgentAscii?: boolean
}

export type WorkbenchResult =
  | { status: 'idle' }
  | { status: 'processing' }
  | { status: 'ready'; text: string; duplicates?: DuplicateLineGroup[]; invisibleCleanup?: Omit<InvisibleCharacterCleanup, 'text'> }
  | { status: 'error'; messageKey: string }

export type WorkbenchTextTransforms = {
  formatJson(text: string, indent: number): string
  compactJson(text: string): string
  urlEncode(text: string): string
  urlDecode(text: string): string
}

export const WORKBENCH_OPERATIONS: readonly {
  value: WorkbenchOperation
  category: WorkbenchCategory
  label: string
}[] = [
  { value: 'trim', category: 'text', label: 'trimWhitespace.title' },
  { value: 'remove-blank', category: 'text', label: 'removeBlankLines.title' },
  { value: 'dedup', category: 'text', label: 'dedup.title' },
  { value: 'find-duplicates', category: 'text', label: 'duplicates.title' },
  { value: 'clean-invisible-characters', category: 'text', label: 'invisibleCharacters.title' },
  { value: 'markdown-plain-text', category: 'text', label: 'markdownPlain.title' },
  { value: 'clean-agent-text', category: 'text', label: 'cleanAgent.title' },
  { value: 'clean-list', category: 'text', label: 'cleanList.title' },
  { value: 'sort', category: 'text', label: 'sort.title' },
  { value: 'reverse', category: 'text', label: 'reverse.title' },
  { value: 'reverse-text', category: 'text', label: 'reverseText.title' },
  { value: 'join', category: 'text', label: 'join.title' },
  { value: 'prepend', category: 'text', label: 'prepend.title' },
  { value: 'append', category: 'text', label: 'append.title' },
  { value: 'wrap', category: 'text', label: 'wrap.title' },
  { value: 'sql-string', category: 'text', label: 'sqlin.string.title' },
  { value: 'sql-number', category: 'text', label: 'sqlin.number.title' },
  { value: 'regex-escape', category: 'text', label: 'regexEscape.title' },
  { value: 'json-format', category: 'json', label: 'workbench.operation.jsonFormat' },
  { value: 'json-compact', category: 'json', label: 'workbench.operation.jsonCompact' },
  { value: 'url-encode', category: 'url', label: 'workbench.operation.urlEncode' },
  { value: 'url-decode', category: 'url', label: 'workbench.operation.urlDecode' },
  { value: 'extract-urls', category: 'url', label: 'extractUrls.title' },
]

// Keep these aligned with existing tool parameters so opening a route preserves
// its historical behavior. Combined cleanup deliberately removes only blank rows
// until the user also opts into trimming or deduplication.
export const DEFAULT_WORKBENCH_OPTIONS: Readonly<WorkbenchOptions> = {
  direction: 'asc',
  ignoreCase: false,
  separator: ',',
  prefix: '- ',
  suffix: ',',
  left: '"',
  right: '"',
  indent: 2,
  trim: false,
  removeBlank: true,
  dedup: false,
  duplicateIgnoreCase: false,
  duplicateTrim: false,
}

export function getWorkbenchOperation(surfaceId?: string): WorkbenchOperation {
  if (surfaceId === 'clean-invisible-characters') return 'clean-invisible-characters'
  if (surfaceId === 'markdown-plain-text') return 'markdown-plain-text'
  if (surfaceId === 'clean-agent-text' || surfaceId === 'clean-agent-clipboard') return 'clean-agent-text'
  if (surfaceId === 'regex-escape') return 'regex-escape'
  if (surfaceId === 'find-duplicates') return 'find-duplicates'
  const operation = lineOperationRoutes.find((route) => route.surfaceId === surfaceId)?.operation
  if (operation === 'trim-whitespace') return 'trim'
  if (operation === 'remove-blank-lines') return 'remove-blank'
  return operation ?? 'trim'
}

export function evaluateWorkbench(
  inputText: string,
  operation: WorkbenchOperation,
  options: WorkbenchOptions,
  textTransforms: WorkbenchTextTransforms,
): WorkbenchResult {
  if (inputText.length === 0) return { status: 'idle' }
  try {
    let text: string
    switch (operation) {
      case 'find-duplicates': {
        const duplicates = findDuplicateLines(inputText, { ignoreCase: options.duplicateIgnoreCase, trim: options.duplicateTrim })
        return { status: 'ready', text: duplicateLineReport(duplicates), duplicates }
      }
      case 'markdown-plain-text': return { status: 'processing' } // Isolated worker owns this operation.
      case 'clean-invisible-characters': {
        const cleaned = cleanInvisibleCharacters(inputText)
        return {
          status: 'ready',
          text: cleaned.text,
          invisibleCleanup: {
            normalizedSpaces: cleaned.normalizedSpaces,
            removedCharacters: cleaned.removedCharacters,
          },
        }
      }
      case 'clean-agent-text': text = cleanAgentText(inputText, options.cleanAgentAscii === true); break
      case 'clean-list': text = cleanLineList(inputText, options); break
      case 'trim': text = processLines('trim-whitespace', inputText, options); break
      case 'remove-blank': text = processLines('remove-blank-lines', inputText, options); break
      case 'json-format': text = inputText.trim() ? textTransforms.formatJson(inputText, options.indent) : ''; break
      case 'json-compact': text = inputText.trim() ? textTransforms.compactJson(inputText) : ''; break
      case 'url-encode': text = textTransforms.urlEncode(inputText); break
      case 'url-decode': text = textTransforms.urlDecode(inputText); break
      case 'regex-escape': text = escapeRegexPattern(inputText); break
      case 'extract-urls': {
        const urls = extractTextList(inputText, 'urls', false)
        if (!urls.length) return { status: 'error', messageKey: 'extractList.noUrls' }
        text = urls.join('\n')
        break
      }
      default: text = processLines(operation, inputText, options)
    }
    return { status: 'ready', text }
  } catch {
    const category = WORKBENCH_OPERATIONS.find((item) => item.value === operation)!.category
    return { status: 'error', messageKey: `workbench.error.${category}` }
  }
}
