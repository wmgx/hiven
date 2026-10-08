import { definePlugin, type PluginToolContext, type PluginToolSurfaces } from '@hiven/plugin'
import { TextToolsSurface } from './TextToolsSurface'
import {
  appendLines,
  cleanLineList,
  convertText,
  dedupLines,
  getTextStats,
  joinLines,
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
import { textToolRoutes } from './routes'
import './style.css'

const LEARNABLE_PURE = { effect: 'pure', learnable: true } as const
const EDITOR_TOOL_SURFACES: PluginToolSurfaces = {
  launcher: { surfaces: ['editor-command-bar', 'quick-editor-command'] },
  panel: true,
}
const WORKSPACE_SHELL = {
  defaultWidth: 900,
  defaultHeight: 660,
  minWidth: 680,
  minHeight: 460,
  closeOnBlur: false,
  resizable: true,
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

export const lineToolsPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Text Tools',
        titleI18n: { zh: '文本整理' },
        icon: 'Type',
        aliases: ['text tools', 'line tools', 'case converter', 'text statistics', '文本整理', '行工具', '命名转换', '文本统计'],
        component: TextToolsSurface,
        entry: {
          launcher: { surfaces: ['global-launcher', 'editor-command-bar', 'quick-editor-command'] },
          shortcutBindable: true,
        },
        shell: WORKSPACE_SHELL,
      },
      ...textToolRoutes.map((route) => ({
        id: route.surfaceId,
        kind: 'custom-view' as const,
        title: 'Text Tools',
        titleI18n: { zh: '文本整理' },
        component: TextToolsSurface,
        entry: { launcher: false as const },
        shell: WORKSPACE_SHELL,
      })),
    ],
  },
  launcher: {
    items: textToolRoutes.map((route) => ({
      id: `open-${route.surfaceId}`,
      display: {
        title: route.surfaceId === 'line-remove-blank' ? 'route.removeBlankLinesWorkbench' : route.titleKey,
        subtitle: 'route.open',
        icon: route.group === 'case' ? 'CaseSensitive' : route.group === 'stats' ? 'ChartBar' : 'ArrowUpDown',
        aliases: route.aliases,
      },
      behavior: { type: 'perform' as const },
      surfaces: ['global-launcher' as const],
      execute(execution) {
        execution.api.openSurface(route.surfaceId, { initialText: execution.input?.text })
        return { ok: true as const, keepOpen: true }
      },
    })),
  },
  tools: [
    {
      id: 'line-tools.clean-list', title: 'cleanList.title', subtitle: 'cleanList.description', icon: 'RemoveFormatting',
      aliases: ['clean line list', 'clean list', 'list cleanup', '清理行列表', '清理名单', '整理列表'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, requireParamSelection: true,
      params: [
        { key: 'trim', label: 'param.cleanList.trim', hint: 'param.cleanList.trimHint', type: 'boolean', default: false, saveable: true },
        { key: 'removeBlank', label: 'param.cleanList.removeBlank', hint: 'param.cleanList.removeBlankHint', type: 'boolean', default: true, saveable: true },
        { key: 'dedup', label: 'param.cleanList.dedup', hint: 'param.cleanList.dedupHint', type: 'boolean', default: false, saveable: true },
      ],
      explicitTextPreview: { run: (ctx) => ({ ok: true, text: cleanListText(ctx.input.text, ctx.params) }) },
      run(ctx) { return ctx.output.text(cleanListText(ctx.input.text, ctx.params)) },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'line-tools.sort', title: 'sort.title', subtitle: 'sort.description', icon: 'ArrowUpDown',
      aliases: ['sort lines', 'order', '行排序', '排序'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      params: [
        { key: 'direction', label: 'param.direction.label', type: 'single-select', options: [{ label: 'param.direction.asc', value: 'asc' }, { label: 'param.direction.desc', value: 'desc' }], default: 'asc', saveable: true },
        { key: 'ignoreCase', label: 'param.ignoreCase', type: 'boolean', default: false, saveable: true },
      ],
      run(ctx) { return ctx.output.text(sortLines(ctx.input.text, ctx.params.direction as 'asc' | 'desc', ctx.params.ignoreCase as boolean)) },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'line-tools.dedup', title: 'dedup.title', subtitle: 'dedup.description', icon: 'Copy',
      aliases: ['unique', 'distinct', '行去重', 'dedup', 'remove duplicate lines', '去重'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      params: [{ key: 'ignoreCase', label: 'param.ignoreCase', type: 'boolean', default: false, saveable: true }],
      run(ctx) { return ctx.output.text(dedupLines(ctx.input.text, ctx.params.ignoreCase as boolean)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'line-tools.reverse', title: 'reverse.title', subtitle: 'reverse.description', icon: 'ArrowDownUp',
      aliases: ['flip lines', 'reverse lines', '行反转', '倒序', '反转'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      run(ctx) { return ctx.output.text(reverseLines(ctx.input.text)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'line-tools.reverse-text', title: 'reverseText.title', subtitle: 'reverseText.description', icon: 'ArrowDownUp',
      aliases: ['reverse text', 'flip text', '文本反转', '字符反转'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      run(ctx) { return ctx.output.text(reverseText(ctx.input.text)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'line-tools.remove-blank-lines', title: 'removeBlankLines.title', subtitle: 'removeBlankLines.description', icon: 'RemoveFormatting',
      aliases: ['remove empty lines', '删除空行', 'remove blank lines', '去除空行'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      explicitTextPreview: { run: (ctx) => ({ ok: true, text: removeBlankLines(ctx.input.text) }) },
      run(ctx) { return ctx.output.text(removeBlankLines(ctx.input.text)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'line-tools.trim-whitespace', title: 'trimWhitespace.title', subtitle: 'trimWhitespace.description', icon: 'Type',
      aliases: ['strip', 'clean', '去空白', 'trim whitespace', '去首尾空白'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      run(ctx) { return ctx.output.text(trimLineWhitespace(ctx.input.text)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'line-tools.join', title: 'join.title', subtitle: 'join.description', icon: 'Merge',
      aliases: ['merge lines', 'concat lines', '合并行', 'join lines', '拼接'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      params: [{ key: 'separator', label: 'param.separator', type: 'text', default: ',', saveable: true, saveableMaxLength: 256 }],
      run(ctx) { return ctx.output.text(joinLines(ctx.input.text, (ctx.params.separator ?? ',') as string)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'line-affix.prepend', title: 'prepend.title', subtitle: 'prepend.description', icon: 'ArrowLeftToLine',
      aliases: ['prepend lines', 'prefix', '添加行前缀', 'add prefix', '前缀'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      params: [{ key: 'prefix', label: 'param.prefix', type: 'text', default: '- ', saveable: true, saveableMaxLength: 256 }],
      run(ctx) { return ctx.output.text(prependLines(ctx.input.text, (ctx.params.prefix ?? '- ') as string)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'line-affix.append', title: 'append.title', subtitle: 'append.description', icon: 'ArrowRightToLine',
      aliases: ['append lines', 'suffix', '添加行后缀', 'add suffix', '后缀'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      params: [{ key: 'suffix', label: 'param.suffix', type: 'text', default: ',', saveable: true, saveableMaxLength: 256 }],
      run(ctx) { return ctx.output.text(appendLines(ctx.input.text, (ctx.params.suffix ?? ',') as string)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'line-affix.wrap', title: 'wrap.title', subtitle: 'wrap.description', icon: 'TextWrap',
      aliases: ['wrap lines', 'surround', '行包裹', '包裹', '添加引号'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      params: [
        { key: 'left', label: 'param.left', type: 'text', default: '"', saveable: true, saveableMaxLength: 256 },
        { key: 'right', label: 'param.right', type: 'text', default: '"', saveable: true, saveableMaxLength: 256 },
      ],
      run(ctx) { return ctx.output.text(wrapLines(ctx.input.text, (ctx.params.left ?? '"') as string, (ctx.params.right ?? '"') as string)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'sqlin.string', title: 'sqlin.string.title', subtitle: 'sqlin.string.description', icon: 'Database',
      aliases: ['sql in string', 'sql-in', 'lines to sql', '生成IN字符串'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      run(ctx) { return ctx.output.text(sqlInString(ctx.input.text)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'sqlin.number', title: 'sqlin.number.title', subtitle: 'sqlin.number.description', icon: 'Database',
      aliases: ['sql in number', 'sql-in-num', '生成IN数字'], inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      run(ctx) { return ctx.output.text(sqlInNumber(ctx.input.text)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.upper', title: 'case.upper.title', subtitle: 'case.upper.description', icon: 'CaseSensitive', aliases: ['uppercase', 'upper case', '转大写', '大写'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('plain-upper'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.lower', title: 'case.lower.title', subtitle: 'case.lower.description', icon: 'CaseSensitive', aliases: ['lowercase', 'lower case', '转小写', '小写'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('plain-lower'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.title', title: 'case.title.title', subtitle: 'case.title.description', icon: 'CaseSensitive', aliases: ['titlecase', 'capitalize', 'title case', '首字母大写'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('plain-title'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.camel', title: 'case.camel.title', subtitle: 'case.camel.description', icon: 'CaseSensitive', aliases: ['camelCase', 'camel case', '转驼峰', '小驼峰'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('camel'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.pascal', title: 'case.pascal.title', subtitle: 'case.pascal.description', icon: 'CaseSensitive', aliases: ['PascalCase', 'pascal case', '大驼峰', '帕斯卡'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('pascal'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.snake', title: 'case.snake.title', subtitle: 'case.snake.description', icon: 'CaseSensitive', aliases: ['snake_case', 'snake case', '转下划线', '下划线命名'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('snake'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.constant', title: 'case.constant.title', subtitle: 'case.constant.description', icon: 'CaseSensitive', aliases: ['CONSTANT_CASE', 'SCREAMING_SNAKE_CASE', '常量命名'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('constant'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.kebab', title: 'case.kebab.title', subtitle: 'case.kebab.description', icon: 'CaseSensitive', aliases: ['kebab-case', 'kebab case', '短横线命名'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('kebab'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.train', title: 'case.train.title', subtitle: 'case.train.description', icon: 'CaseSensitive', aliases: ['Train-Case', 'HTTP-Header-Case', 'header case'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('train'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.dot', title: 'case.dot.title', subtitle: 'case.dot.description', icon: 'CaseSensitive', aliases: ['dot.case', 'dot case', '点分命名'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('dot'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.path', title: 'case.path.title', subtitle: 'case.path.description', icon: 'CaseSensitive', aliases: ['path/case', 'path case', '路径命名'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('path'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.lower-words', title: 'case.lowerWords.title', subtitle: 'case.lowerWords.description', icon: 'CaseSensitive', aliases: ['lower case words', '小写空格'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('lower'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.upper-words', title: 'case.upperWords.title', subtitle: 'case.upperWords.description', icon: 'CaseSensitive', aliases: ['upper case words', '大写空格'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('upper'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'case.title-words', title: 'case.titleWords.title', subtitle: 'case.titleWords.description', icon: 'CaseSensitive', aliases: ['title case words', '标题空格'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE, run: caseRun('title'), surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'count.run', title: 'count.title', subtitle: 'count.description', icon: 'ChartBar',
      aliases: ['stats', 'wc', '文本统计', '字数统计', 'count', 'word count', '统计', '字数', '字符数', '行数'],
      inputPolicy: { mode: 'auto' }, policy: LEARNABLE_PURE,
      run(ctx) { return ctx.output.text(formatStats(ctx)) }, surfaces: EDITOR_TOOL_SURFACES,
    },
  ],
})

export default lineToolsPlugin
