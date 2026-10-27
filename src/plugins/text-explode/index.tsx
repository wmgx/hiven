import { definePlugin } from '@hiven/plugin'
import { TextExplodeSurface } from './surfaces/TextExplodeSurface'
import './style.css'

export default definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Text Explode',
        titleI18n: { zh: '大爆炸' },
        icon: 'Bomb',
        aliases: ['explode', 'split text', 'big bang', '大爆炸', '拆词', '拆分', '炸开'],
        textMatch: (text) => text.trim().length > 1,
        component: TextExplodeSurface,
        entry: {
          launcher: { surfaces: ['global-launcher'] },
        },
        // Inline content shrinks to fit, capped at 480px.
        shell: {
          size: 'medium' as const,
          inlineHeight: 480,
          autoHeight: true,
          closeOnBlur: false,
        },
      },
    ],
  },
})
