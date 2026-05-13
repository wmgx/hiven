import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'lorem',
  title: 'Lorem Ipsum',
  titleI18n: { zh: 'Lorem Ipsum' },
  icon: 'FileText',
  aliases: ['placeholder', 'dummy-text'],
  description: 'Generate placeholder text',
  descriptionI18n: { zh: '生成占位文本' },
  tags: ['generate'],
  params: [],

  run() {
    return {
      text: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\n\nSed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.`
    }
  },
})
