import { type PluginToolContribution, type PluginToolContext, type PluginToolSurfaces } from '@hiven/plugin'
import {
  appendLines,
  cleanLineList,
  convertText,
  dedupLines,
  getTextStats,
  joinLines,
  LineToolsError,
  prependLines,
  removeBlankLines,
  reverseLines,
  reverseText,
  sortLines,
  sqlInNumber,
  sqlInString,
  trimLineWhitespace,
  wrapLines,
  type CaseOperation,
} from './core'
import { extractTextList } from './extractTextList'
import { escapeRegexPattern } from './escapeRegexPattern'

const PURE_ACTION_POLICY = { effect: 'pure' } as const
const TEXT_TOOL_SURFACES: PluginToolSurfaces = {
  launcher: { surfaces: ['global-launcher', 'quick-editor-command'] },
  panel: true,
}

function caseRun(operation: CaseOperation) {
  return (ctx: PluginToolContext) => {
    try { return ctx.output.text(convertText(ctx.input.text, operation)) }
    catch (error) { return ctx.output.error(ctx.t('error.convert', { message: error instanceof Error ? error.message : String(error) })) }
  }
}

function formatStats(ctx: PluginToolContext): string {
  const stats = getTextStats(ctx.input.text)
  return [
    ctx.t('count.lines', { count: stats.lines }),
    ctx.t('count.words', { count: stats.words }),
    ctx.t('count.characters', { count: stats.characters }),
    ctx.t('count.charactersNoSpace', { count: stats.charactersNoSpace }),
  ].join('\n')
}

function cleanListText(text: string, params: Record<string, unknown>): string {
  return cleanLineList(text, {
    trim: params.trim === true,
    removeBlank: params.removeBlank !== false,
    dedup: params.dedup === true,
  })
}

type TextResult = { ok: true; text: string } | { ok: false; message: string }

function extractListText(ctx: PluginToolContext): TextResult {
  const kind = ctx.params.kind ?? 'urls'
  if (kind !== 'urls' && kind !== 'emails') return { ok: false, message: ctx.t('extractList.invalidKind') }
  const matches = extractTextList(ctx.input.text, kind, ctx.params.dedup === true)
  return matches.length > 0
    ? { ok: true, text: matches.join('\n') }
    : { ok: false, message: ctx.t(kind === 'urls' ? 'extractList.noUrls' : 'extractList.noEmails') }
}

export const lineTools: PluginToolContribution[] = [
    {
      id: 'line-tools.regex-escape', title: 'regexEscape.title', subtitle: 'regexEscape.description', icon: 'Regex',
      aliases: ['escape regex', 'regex escape', '正则转义', '正则字面量'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      run(ctx) { return ctx.input.text.length ? ctx.output.text(escapeRegexPattern(ctx.input.text)) : ctx.output.error(ctx.t('regexEscape.empty')) },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'line-tools.extract-list', title: 'extractList.title', icon: 'ListFilter',
      aliases: ['extract links', 'extract urls', 'extract emails', 'extract email addresses', '提取链接', '提取网址', '提取邮箱', '提取邮件地址'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, requireParamSelection: true,
      params: [
        { key: 'kind', label: 'param.extractList.kind', type: 'single-select', options: [{ label: 'param.extractList.urls', value: 'urls' }, { label: 'param.extractList.emails', value: 'emails' }], default: 'urls' },
        { key: 'dedup', label: 'param.extractList.dedup', type: 'boolean', default: false },
      ],
      run(ctx) {
        const result = extractListText(ctx)
        return result.ok ? ctx.output.text(result.text) : ctx.output.error(result.message)
      },
      surfaces: { launcher: { surfaces: ['global-launcher', 'quick-editor-command'] }, panel: true },
    },
    {
      id: 'line-tools.clean-list', title: 'cleanList.title', icon: 'RemoveFormatting',
      aliases: ['clean line list', 'clean list', 'list cleanup', '清理行列表', '清理名单', '整理列表'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, requireParamSelection: true,
      params: [
        { key: 'trim', label: 'param.cleanList.trim', type: 'boolean', default: false },
        { key: 'removeBlank', label: 'param.cleanList.removeBlank', type: 'boolean', default: true },
        { key: 'dedup', label: 'param.cleanList.dedup', type: 'boolean', default: false },
      ],
      run(ctx) { return ctx.output.text(cleanListText(ctx.input.text, ctx.params)) },
      surfaces: { launcher: { surfaces: ['global-launcher', 'quick-editor-command'] }, panel: true },
    },
    {
      id: 'line-tools.sort', title: 'sort.title', icon: 'ArrowUpDown',
      aliases: ['sort lines', 'order', '行排序', '排序'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      params: [
        { key: 'direction', label: 'param.direction.label', type: 'single-select', options: [{ label: 'param.direction.asc', value: 'asc' }, { label: 'param.direction.desc', value: 'desc' }], default: 'asc' },
        { key: 'ignoreCase', label: 'param.ignoreCase', type: 'boolean', default: false },
      ],
      run(ctx) { return ctx.output.text(sortLines(ctx.input.text, ctx.params.direction as 'asc' | 'desc', ctx.params.ignoreCase as boolean)) },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'line-tools.dedup', title: 'dedup.title', icon: 'Copy',
      aliases: ['unique', 'distinct', '行去重', 'dedup', 'remove duplicate lines', 'remove duplicates', '删除重复行', '去重'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      params: [{ key: 'ignoreCase', label: 'param.ignoreCase', type: 'boolean', default: false }],
      run(ctx) { return ctx.output.text(dedupLines(ctx.input.text, ctx.params.ignoreCase as boolean)) }, surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'line-tools.reverse', title: 'reverse.title', icon: 'ArrowDownUp',
      aliases: ['flip lines', 'reverse lines', '行反转', '倒序', '反转'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      run(ctx) { return ctx.output.text(reverseLines(ctx.input.text)) }, surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'line-tools.reverse-text', title: 'reverseText.title', icon: 'ArrowDownUp',
      aliases: ['reverse text', 'flip text', '文本反转', '字符反转'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      run(ctx) { return ctx.output.text(reverseText(ctx.input.text)) }, surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'line-tools.remove-blank-lines', title: 'removeBlankLines.title', icon: 'RemoveFormatting',
      aliases: ['remove empty lines', '删除空行', 'remove blank lines', '去除空行'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      run(ctx) { return ctx.output.text(removeBlankLines(ctx.input.text)) }, surfaces: { launcher: { surfaces: ['global-launcher', 'quick-editor-command'] }, panel: true },
    },
    {
      id: 'line-tools.trim-whitespace', title: 'trimWhitespace.title', icon: 'Type',
      aliases: ['strip', 'clean', '去空白', 'trim whitespace', '去首尾空白'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      run(ctx) { return ctx.output.text(trimLineWhitespace(ctx.input.text)) }, surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'line-tools.join', title: 'join.title', icon: 'Merge',
      aliases: ['merge lines', 'concat lines', '合并行', 'join lines', '拼接'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      params: [{ key: 'separator', label: 'param.separator', type: 'text', default: ',' }],
      run(ctx) { return ctx.output.text(joinLines(ctx.input.text, (ctx.params.separator ?? ',') as string)) }, surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'line-affix.prepend', title: 'prepend.title', icon: 'ArrowLeftToLine',
      aliases: ['prepend lines', 'prefix', '添加行前缀', 'add prefix', '前缀'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      params: [{ key: 'prefix', label: 'param.prefix', type: 'text', default: '- ' }],
      run(ctx) { return ctx.output.text(prependLines(ctx.input.text, (ctx.params.prefix ?? '- ') as string)) }, surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'line-affix.append', title: 'append.title', icon: 'ArrowRightToLine',
      aliases: ['append lines', 'suffix', '添加行后缀', 'add suffix', '后缀'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      params: [{ key: 'suffix', label: 'param.suffix', type: 'text', default: ',' }],
      run(ctx) { return ctx.output.text(appendLines(ctx.input.text, (ctx.params.suffix ?? ',') as string)) }, surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'line-affix.wrap', title: 'wrap.title', icon: 'TextWrap',
      aliases: ['wrap lines', 'surround', '行包裹', '包裹', '添加引号'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      params: [
        { key: 'left', label: 'param.left', type: 'text', default: '"' },
        { key: 'right', label: 'param.right', type: 'text', default: '"' },
      ],
      run(ctx) { return ctx.output.text(wrapLines(ctx.input.text, (ctx.params.left ?? '"') as string, (ctx.params.right ?? '"') as string)) }, surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'sqlin.string', title: 'sqlin.string.title', icon: 'Database',
      aliases: ['sql in string', 'sql-in', 'lines to sql', '生成IN字符串'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      run(ctx) { return ctx.output.text(sqlInString(ctx.input.text)) }, surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'sqlin.number', title: 'sqlin.number.title', icon: 'Database',
      aliases: ['sql in number', 'sql-in-num', '生成IN数字'], inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      run(ctx) {
        try { return ctx.output.text(sqlInNumber(ctx.input.text)) }
        catch (error) {
          if (error instanceof LineToolsError) return ctx.output.error(ctx.t('error.sqlNumber', { value: error.value }))
          throw error
        }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.upper', title: 'case.upper.title', icon: 'CaseSensitive', aliases: ['uppercase', 'upper case', '转大写', '大写'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('plain-upper'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.lower', title: 'case.lower.title', icon: 'CaseSensitive', aliases: ['lowercase', 'lower case', '转小写', '小写'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('plain-lower'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.title', title: 'case.title.title', icon: 'CaseSensitive', aliases: ['titlecase', 'capitalize', 'title case', '首字母大写'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('plain-title'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.camel', title: 'case.camel.title', icon: 'CaseSensitive', aliases: ['camelCase', 'camel case', '转驼峰', '小驼峰'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('camel'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.pascal', title: 'case.pascal.title', icon: 'CaseSensitive', aliases: ['PascalCase', 'pascal case', '大驼峰', '帕斯卡'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('pascal'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.snake', title: 'case.snake.title', icon: 'CaseSensitive', aliases: ['snake_case', 'snake case', '转下划线', '下划线命名'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('snake'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.constant', title: 'case.constant.title', icon: 'CaseSensitive', aliases: ['CONSTANT_CASE', 'SCREAMING_SNAKE_CASE', '常量命名'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('constant'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.kebab', title: 'case.kebab.title', icon: 'CaseSensitive', aliases: ['kebab-case', 'kebab case', '短横线命名'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('kebab'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.train', title: 'case.train.title', icon: 'CaseSensitive', aliases: ['Train-Case', 'HTTP-Header-Case', 'header case'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('train'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.dot', title: 'case.dot.title', icon: 'CaseSensitive', aliases: ['dot.case', 'dot case', '点分命名'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('dot'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.path', title: 'case.path.title', icon: 'CaseSensitive', aliases: ['path/case', 'path case', '路径命名'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('path'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.lower-words', title: 'case.lowerWords.title', icon: 'CaseSensitive', aliases: ['lower case words', '小写空格'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('lower'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.upper-words', title: 'case.upperWords.title', icon: 'CaseSensitive', aliases: ['upper case words', '大写空格'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('upper'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'case.title-words', title: 'case.titleWords.title', icon: 'CaseSensitive', aliases: ['title case words', '标题空格'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY, run: caseRun('title'), surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'count.run', title: 'count.title', icon: 'ChartBar',
      aliases: ['stats', 'wc', '文本统计', '字数统计', 'count', 'word count', '统计', '字数', '字符数', '行数'],
      inputPolicy: { mode: 'auto' }, policy: PURE_ACTION_POLICY,
      run(ctx) { return ctx.output.text(formatStats(ctx)) }, surfaces: TEXT_TOOL_SURFACES,
    },
  ]
