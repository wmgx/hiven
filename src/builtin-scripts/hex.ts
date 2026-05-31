import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'hex',
  title: 'Number Base Convert',
  titleI18n: { zh: '进制转换' },
  icon: 'Calculator',
  aliases: ['decimal', 'binary', 'octal', 'hex-convert'],
  description: 'Convert between number bases (dec/hex/bin)',
  descriptionI18n: { zh: '数字进制互转（十进制/十六进制/二进制）' },
  tags: ['number', 'convert'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'Dec → Hex', value: 'dec2hex' },
        { label: 'Hex → Dec', value: 'hex2dec' },
        { label: 'Dec → Bin', value: 'dec2bin' },
        { label: 'Bin → Dec', value: 'bin2dec' },
      ],
      default: 'dec2hex',
    },
  ],

  run(ctx) {
    try {
      const lines = ctx.input.text.trim().split('\n')
      const result = lines.map(line => {
        const v = line.trim()
        switch (ctx.params.mode) {
          case 'dec2hex': return parseInt(v, 10).toString(16).toUpperCase()
          case 'hex2dec': return parseInt(v, 16).toString(10)
          case 'dec2bin': return parseInt(v, 10).toString(2)
          case 'bin2dec': return parseInt(v, 2).toString(10)
          default: return v
        }
      })
      return { text: result.join('\n') }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
