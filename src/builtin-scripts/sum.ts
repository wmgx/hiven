import { defineAction } from 'fluxtext'
// @deps bignumber https://esm.sh/bignumber.js@9?bundle

export default defineAction({
  name: 'sum',
  title: 'Sum Lines',
  titleI18n: { zh: '逐行求和' },
  icon: 'Calculator',
  aliases: ['add', 'total'],
  description: 'Sum numbers on each line (BigNumber precision)',
  descriptionI18n: { zh: '对每行数字求和（BigNumber 高精度）' },
  tags: ['math', 'number'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'Sum per line', value: 'per-line', labelI18n: { zh: '逐行求和' } },
        { label: 'Grand total', value: 'total', labelI18n: { zh: '全部求和' } },
      ],
      default: 'per-line',
    },
    {
      key: 'separator',
      label: 'Number separator',
      labelI18n: { zh: '数字分隔符' },
      type: 'single-select',
      options: [
        { label: 'Auto (whitespace/comma)', value: 'auto', labelI18n: { zh: '自动（空白/逗号）' } },
        { label: 'Whitespace', value: 'space', labelI18n: { zh: '空白字符' } },
        { label: 'Comma', value: 'comma', labelI18n: { zh: '逗号' } },
        { label: 'Tab', value: 'tab', labelI18n: { zh: '制表符' } },
      ],
      default: 'auto',
    },
  ],

  async run(ctx) {
    const BigNumber = ctx.deps.bignumber.default || ctx.deps.bignumber

    const sepRegex: Record<string, RegExp> = {
      auto: /[\s,]+/,
      space: /\s+/,
      comma: /,\s*/,
      tab: /\t+/,
    }
    const re = sepRegex[ctx.params.separator as string] || sepRegex.auto

    const lines = ctx.input.text.split('\n')

    function sumLine(line: string): string {
      const tokens = line.trim().split(re).filter(Boolean)
      const nums = tokens.filter(t => !new BigNumber(t).isNaN())
      if (nums.length === 0) return ''
      return nums.reduce((acc, n) => acc.plus(n), new BigNumber(0)).toFixed()
    }

    if (ctx.params.mode === 'total') {
      const all = lines.flatMap(line => {
        const tokens = line.trim().split(re).filter(Boolean)
        return tokens.filter(t => !new BigNumber(t).isNaN())
      })
      if (all.length === 0) return { text: '0' }
      const total = all.reduce((acc, n) => acc.plus(n), new BigNumber(0))
      return { text: total.toFixed() }
    }

    // per-line mode
    const results = lines.map(line => {
      const s = sumLine(line)
      return s === '' ? line : s
    })
    return { text: results.join('\n') }
  },
})
