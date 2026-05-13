import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'xml',
  title: 'XML Formatter',
  titleI18n: { zh: 'XML 格式化' },
  icon: 'Code',
  aliases: ['xml-format', 'xml-minify', 'html-format'],
  description: 'Format or minify XML/HTML',
  descriptionI18n: { zh: '美化或压缩 XML/HTML' },
  tags: ['xml', 'html', 'format'],

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
      return { text: text.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim() }
    }
    // Pretty print XML
    let formatted = ''
    let indent = 0
    const nodes = text.replace(/>\s+</g, '><').trim().split(/(<[^>]+>)/g).filter(Boolean)
    for (const node of nodes) {
      if (node.match(/^<\/\w/)) indent--
      formatted += '  '.repeat(Math.max(indent, 0)) + node.trim() + '\n'
      if (node.match(/^<\w[^>]*[^/]>$/)) indent++
    }
    return { text: formatted.trim() }
  },
})
