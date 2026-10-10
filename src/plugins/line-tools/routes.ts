import type { CaseOperation, LineOperation } from './core'

export type TextToolRoute = {
  surfaceId: string
  titleKey: string
  aliases: string[]
  group: 'lines' | 'case' | 'stats'
  operation?: LineOperation | CaseOperation
}

export const lineOperationRoutes: TextToolRoute[] = [
  { surfaceId: 'line-sort', titleKey: 'sort.title', group: 'lines', operation: 'sort', aliases: ['sort lines', 'order lines', '行排序', '排序', 'hangpaixu'] },
  { surfaceId: 'line-dedup', titleKey: 'dedup.title', group: 'lines', operation: 'dedup', aliases: ['unique lines', 'dedup lines', 'remove duplicate lines', 'remove duplicates', '删除重复行', '行去重', '去重', 'quchong', 'hangquchong'] },
  { surfaceId: 'line-reverse', titleKey: 'reverse.title', group: 'lines', operation: 'reverse', aliases: ['reverse lines', 'flip lines', '行反转', '倒序'] },
  { surfaceId: 'text-reverse', titleKey: 'reverseText.title', group: 'lines', operation: 'reverse-text', aliases: ['reverse text', 'flip text', '文本反转', '字符反转'] },
  { surfaceId: 'line-remove-blank', titleKey: 'removeBlankLines.title', group: 'lines', operation: 'remove-blank-lines', aliases: ['remove blank lines', 'delete empty lines', '删除空行', '去除空行'] },
  { surfaceId: 'line-trim', titleKey: 'trimWhitespace.title', group: 'lines', operation: 'trim-whitespace', aliases: ['trim lines', 'trim whitespace', '去首尾空白', '去除首尾空格'] },
  { surfaceId: 'line-join', titleKey: 'join.title', group: 'lines', operation: 'join', aliases: ['join lines', 'merge lines', '合并行', '拼接'] },
  { surfaceId: 'line-prepend', titleKey: 'prepend.title', group: 'lines', operation: 'prepend', aliases: ['prepend lines', 'add prefix', 'line prefix', '添加行前缀', '前缀'] },
  { surfaceId: 'line-append', titleKey: 'append.title', group: 'lines', operation: 'append', aliases: ['append lines', 'add suffix', 'line suffix', '添加行后缀', '后缀'] },
  { surfaceId: 'line-wrap', titleKey: 'wrap.title', group: 'lines', operation: 'wrap', aliases: ['wrap lines', 'surround lines', 'add quotes', '行包裹', '包裹'] },
  { surfaceId: 'sql-in-string', titleKey: 'sqlin.string.title', group: 'lines', operation: 'sql-string', aliases: ['sql in string', 'lines to sql in', '生成 in 字符串', 'sql字符串'] },
  { surfaceId: 'sql-in-number', titleKey: 'sqlin.number.title', group: 'lines', operation: 'sql-number', aliases: ['sql in number', 'lines to sql numbers', '生成 in 数字', 'sql数字'] },
]

export const caseOperationRoutes: TextToolRoute[] = [
  { surfaceId: 'case-upper', titleKey: 'case.upper.title', group: 'case', operation: 'plain-upper', aliases: ['uppercase', 'upper case', '转大写', '大写'] },
  { surfaceId: 'case-lower', titleKey: 'case.lower.title', group: 'case', operation: 'plain-lower', aliases: ['lowercase', 'lower case', '转小写', '小写'] },
  { surfaceId: 'case-title', titleKey: 'case.title.title', group: 'case', operation: 'plain-title', aliases: ['title case', 'capitalize', '转标题', '首字母大写'] },
  { surfaceId: 'case-camel', titleKey: 'case.camel.title', group: 'case', operation: 'camel', aliases: ['case converter', '命名转换', 'camelCase', 'camel case', '转驼峰', '小驼峰', '驼峰'] },
  { surfaceId: 'case-pascal', titleKey: 'case.pascal.title', group: 'case', operation: 'pascal', aliases: ['PascalCase', 'pascal case', '大驼峰', '帕斯卡'] },
  { surfaceId: 'case-snake', titleKey: 'case.snake.title', group: 'case', operation: 'snake', aliases: ['snake_case', 'snake case', '转下划线', '下划线命名'] },
  { surfaceId: 'case-constant', titleKey: 'case.constant.title', group: 'case', operation: 'constant', aliases: ['CONSTANT_CASE', 'screaming snake case', '常量命名', '全大写下划线'] },
  { surfaceId: 'case-kebab', titleKey: 'case.kebab.title', group: 'case', operation: 'kebab', aliases: ['kebab-case', 'kebab case', '短横线命名', '中划线'] },
  { surfaceId: 'case-train', titleKey: 'case.train.title', group: 'case', operation: 'train', aliases: ['Train-Case', 'HTTP-Header-Case', 'header case', '标题短横'] },
  { surfaceId: 'case-dot', titleKey: 'case.dot.title', group: 'case', operation: 'dot', aliases: ['dot.case', 'dot case', '点分命名', '点分'] },
  { surfaceId: 'case-path', titleKey: 'case.path.title', group: 'case', operation: 'path', aliases: ['path/case', 'path case', '路径命名', '路径'] },
  { surfaceId: 'case-lower-words', titleKey: 'case.lowerWords.title', group: 'case', operation: 'lower', aliases: ['lower case words', '小写空格', '空格小写'] },
  { surfaceId: 'case-upper-words', titleKey: 'case.upperWords.title', group: 'case', operation: 'upper', aliases: ['upper case words', '大写空格', '空格大写'] },
  { surfaceId: 'case-title-words', titleKey: 'case.titleWords.title', group: 'case', operation: 'title', aliases: ['title case words', '标题空格', '单词首字母大写'] },
]

export const statsRoute: TextToolRoute = {
  surfaceId: 'text-statistics',
  titleKey: 'count.title',
  group: 'stats',
  aliases: ['text statistics', 'word count', 'character count', 'stats', 'wc', '文本统计', '字数统计', '统计', '字数', '字符数', '行数'],
}

export const textToolRoutes = [...lineOperationRoutes, ...caseOperationRoutes, statsRoute]
