import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'css',
  title: 'CSS Formatter',
  titleI18n: { zh: 'CSS 格式化' },
  icon: 'Paintbrush',
  aliases: ['css-format', 'css-minify'],
  description: 'Format or minify CSS',
  descriptionI18n: { zh: '美化或压缩 CSS' },
  tags: ['css', 'format'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'Pretty', value: 'pretty', labelI18n: { zh: '美化' } },
        { label: 'Compact', value: 'compact', labelI18n: { zh: '压缩' } },
      ],
      default: 'pretty',
    },
  ],

  run(ctx) {
    const text = ctx.input.text
    if (ctx.params.mode === 'compact') {
      return {
        text: text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s+/g, ' ')
          .replace(/\s*([{}:;,])\s*/g, '$1')
          .replace(/;}/g, '}')
          .trim()
      }
    }
    // Pretty: expand compressed CSS
    let result = text
      .replace(/\/\*[\s\S]*?\*\//g, m => m) // preserve comments
      .replace(/\s*\{\s*/g, ' {\n  ')
      .replace(/\s*\}\s*/g, '\n}\n')
      .replace(/\s*;\s*/g, ';\n  ')
      .replace(/  \n\}/g, '\n}')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return { text: result }
  },
})
