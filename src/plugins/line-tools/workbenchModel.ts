import { cleanLineList, processLines, findDuplicateLines, duplicateLineReport, LineToolsError, type DuplicateLineGroup, type LineOperation, type LineOptions } from './core'
import { lineOperationRoutes } from './routes'
import { escapeRegexPattern } from './escapeRegexPattern'
import { extractTextList } from './extractTextList'
import { cleanAgentText } from './cleanAgentText'
import { cleanInvisibleCharacters, type InvisibleCharacterCleanup } from './cleanInvisibleCharacters'

export type WorkbenchOperation =
  | Exclude<LineOperation, 'trim-whitespace' | 'remove-blank-lines'>
  | 'trim'
  | 'remove-blank'
  | 'clean-list'
  | 'clean-invisible-characters'
  | 'clean-agent-text'
  | 'markdown-plain-text'
  | 'regex-escape'
  | 'extract-urls'
  | 'find-duplicates'

export type WorkbenchOptions = LineOptions & {
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

export const WORKBENCH_OPERATIONS: readonly {
  value: WorkbenchOperation
  label: string
}[] = [
  { value: 'trim', label: 'trimWhitespace.title' },
  { value: 'remove-blank', label: 'removeBlankLines.title' },
  { value: 'dedup', label: 'dedup.title' },
  { value: 'find-duplicates', label: 'duplicates.title' },
  { value: 'clean-invisible-characters', label: 'invisibleCharacters.title' },
  { value: 'markdown-plain-text', label: 'markdownPlain.title' },
  { value: 'clean-agent-text', label: 'cleanAgent.title' },
  { value: 'clean-list', label: 'cleanList.title' },
  { value: 'sort', label: 'sort.title' },
  { value: 'reverse', label: 'reverse.title' },
  { value: 'reverse-text', label: 'reverseText.title' },
  { value: 'join', label: 'join.title' },
  { value: 'prepend', label: 'prepend.title' },
  { value: 'append', label: 'append.title' },
  { value: 'wrap', label: 'wrap.title' },
  { value: 'sql-string', label: 'sqlin.string.title' },
  { value: 'sql-number', label: 'sqlin.number.title' },
  { value: 'regex-escape', label: 'regexEscape.title' },
  { value: 'extract-urls', label: 'extractUrls.title' },
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
  } catch (error) {
    return { status: 'error', messageKey: error instanceof LineToolsError ? `workbench.error.${error.code}` : 'workbench.error.text' }
  }
}
