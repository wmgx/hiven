/**
 * First-party Variable Case plugin.
 *
 * Converts identifiers / variable names across common casings.
 * Each target case is an independent tool. Multi-line input is converted
 * line by line so lists of names work out of the box.
 */

import { definePlugin, type PluginToolContext } from '@hiven/plugin'

export type CaseStyle =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'constant'
  | 'kebab'
  | 'train'
  | 'dot'
  | 'path'
  | 'lower'
  | 'upper'
  | 'title'

/** Split an identifier into lowercased word tokens. */
export function splitWords(input: string): string[] {
  const normalized = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-./\\]+/g, ' ')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .trim()

  if (!normalized) return []

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}

function capitalize(word: string): string {
  if (!word) return word
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export function joinWords(words: string[], style: CaseStyle): string {
  if (words.length === 0) return ''

  switch (style) {
    case 'camel':
      return words[0] + words.slice(1).map(capitalize).join('')
    case 'pascal':
      return words.map(capitalize).join('')
    case 'snake':
      return words.join('_')
    case 'constant':
      return words.map((w) => w.toUpperCase()).join('_')
    case 'kebab':
      return words.join('-')
    case 'train':
      return words.map(capitalize).join('-')
    case 'dot':
      return words.join('.')
    case 'path':
      return words.join('/')
    case 'lower':
      return words.join(' ')
    case 'upper':
      return words.map((w) => w.toUpperCase()).join(' ')
    case 'title':
      return words.map(capitalize).join(' ')
    default:
      return words.join('_')
  }
}

/** Convert a single identifier (preserves leading/trailing whitespace of the line). */
export function convertIdentifier(text: string, style: CaseStyle): string {
  const leading = text.match(/^\s*/)?.[0] ?? ''
  const trailing = text.match(/\s*$/)?.[0] ?? ''
  const core = text.slice(leading.length, text.length - trailing.length)
  if (!core) return text
  const words = splitWords(core)
  if (words.length === 0) return text
  return leading + joinWords(words, style) + trailing
}

/** Convert multi-line text; empty lines are preserved. */
export function convertText(text: string, style: CaseStyle): string {
  if (!text) return text
  return text.split('\n').map((line) => {
    if (line.trim() === '') return line
    return convertIdentifier(line, style)
  }).join('\n')
}

function toolRun(style: CaseStyle) {
  return (ctx: PluginToolContext) => {
    try {
      return ctx.output.text(convertText(ctx.input.text, style))
    } catch (e: any) {
      return ctx.output.error(ctx.t('error.convert', { message: e.message }))
    }
  }
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const variableCasePlugin = definePlugin({
  tools: [
    {
      id: 'case.camel',
      title: 'camel.title',
      subtitle: 'camel.description',
      icon: 'CaseSensitive',
      aliases: ['camelCase', 'camel case', '转驼峰', '小驼峰', 'to camel'],
      inputPolicy: { mode: 'auto' },
      run: toolRun('camel'),
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.pascal',
      title: 'pascal.title',
      subtitle: 'pascal.description',
      icon: 'CaseSensitive',
      aliases: ['PascalCase', 'pascal case', '大驼峰', '帕斯卡', 'to pascal'],
      inputPolicy: { mode: 'auto' },
      run: toolRun('pascal'),
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.snake',
      title: 'snake.title',
      subtitle: 'snake.description',
      icon: 'CaseSensitive',
      aliases: ['snake_case', 'snake case', '转下划线', '下划线命名', 'to snake'],
      inputPolicy: { mode: 'auto' },
      run: toolRun('snake'),
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.constant',
      title: 'constant.title',
      subtitle: 'constant.description',
      icon: 'CaseSensitive',
      aliases: ['CONSTANT_CASE', 'SCREAMING_SNAKE_CASE', '常量命名', '全大写下划线', 'to constant'],
      inputPolicy: { mode: 'auto' },
      run: toolRun('constant'),
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.kebab',
      title: 'kebab.title',
      subtitle: 'kebab.description',
      icon: 'CaseSensitive',
      aliases: ['kebab-case', 'kebab case', '短横线命名', '中划线', 'to kebab'],
      inputPolicy: { mode: 'auto' },
      run: toolRun('kebab'),
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.train',
      title: 'train.title',
      subtitle: 'train.description',
      icon: 'CaseSensitive',
      aliases: ['Train-Case', 'HTTP-Header-Case', 'header case', '标题短横'],
      inputPolicy: { mode: 'auto' },
      run: toolRun('train'),
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.dot',
      title: 'dot.title',
      subtitle: 'dot.description',
      icon: 'CaseSensitive',
      aliases: ['dot.case', 'dot case', '点分命名', 'to dot'],
      inputPolicy: { mode: 'auto' },
      run: toolRun('dot'),
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.path',
      title: 'path.title',
      subtitle: 'path.description',
      icon: 'CaseSensitive',
      aliases: ['path/case', 'path case', '路径命名', 'to path'],
      inputPolicy: { mode: 'auto' },
      run: toolRun('path'),
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.lower-words',
      title: 'lower.title',
      subtitle: 'lower.description',
      icon: 'CaseSensitive',
      aliases: ['lower case words', '小写空格', '空格小写'],
      inputPolicy: { mode: 'auto' },
      run: toolRun('lower'),
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.upper-words',
      title: 'upper.title',
      subtitle: 'upper.description',
      icon: 'CaseSensitive',
      aliases: ['UPPER CASE words', '大写空格', '空格大写'],
      inputPolicy: { mode: 'auto' },
      run: toolRun('upper'),
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.title-words',
      title: 'title.title',
      subtitle: 'title.description',
      icon: 'CaseSensitive',
      aliases: ['Title Case', 'title case words', '标题空格', '单词首字母大写'],
      inputPolicy: { mode: 'auto' },
      run: toolRun('title'),
      surfaces: { launcher: true, panel: true },
    },
  ],
})

export default variableCasePlugin
