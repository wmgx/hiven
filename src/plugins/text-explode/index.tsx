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
          launcher: true,
        },
        // No defaultWidth: inline 'launcher' presentation, panel should keep
        // the launcher's own natural width. autoHeight makes defaultHeight a
        // max-height ceiling instead of the host default of a forced fixed
        // height, so a short/empty explode doesn't render as an oversized
        // box with empty space below it (see .text-explode-surface / .tx-canvas
        // in style.css, which shrink-wrap content rather than stretch to fill).
        shell: {
          defaultHeight: 480,
          autoHeight: true,
          closeOnBlur: false,
        },
      },
    ],
  },
})
