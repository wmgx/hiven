/**
 * First-party JSON Tools Expression panel.
 * Provides a compact pane-bottom bar for evaluating JSON expressions against pane content.
 * The bar is per-pane and toggled via the command.
 */
/* eslint-disable react-refresh/only-export-components */

import { lazy, Suspense } from 'react'
import { definePlugin, type PaneInput, type PanelPropsV2 } from '@hiven/plugin'

const PANEL_ID = 'js-filter.panel'
const JsFilterPanel = lazy(() => import('./JsFilterPanel'))

function LazyJsFilterPanel(props: PanelPropsV2) {
  return (
    <Suspense fallback={null}>
      <JsFilterPanel {...props} />
    </Suspense>
  )
}

export const jsFilterPlugin = definePlugin({
  launcher: {
    items: [
      {
        id: 'js-filter.toggle',
        display: {
          title: 'command.open.title',
          subtitle: 'command.open.description',
          icon: 'Code',
          aliases: ['json-expression', 'jq', 'json-filter', 'expression'],
        },
        surfaces: ['editor-command-bar', 'quick-editor-command'],
        execute(ctx) {
          const paneId = ctx.api.getPaneSnapshot().activePaneId
          const result = ctx.api.dispatchEffects(ctx.api.isPanePanelOpen(PANEL_ID)
            ? [{ type: 'panel.closeV2' as const, panelId: PANEL_ID }]
            : [{
                type: 'panel.openV2' as const,
                panelId: PANEL_ID,
                placement: 'pane-bottom' as const,
                scope: { type: 'pane' as const, paneId },
              }])
          if (result.errors.length > 0) return { ok: false, message: result.errors[0] }
          return { ok: true }
        },
      },
    ],
  },
  commands: [
    {
      id: 'js-filter.toggle',
      title: 'command.open.title',
      description: 'command.open.description',
      icon: 'Code',
      aliases: ['json-expression', 'jq', 'json-filter', 'expression'],
      inputs: [{ key: 'input', label: 'Input', kind: 'pane' as const, required: true }],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const paneId = (ctx.inputs.input as PaneInput).paneId
        return {
          effects: [{
            type: 'panel.openV2' as const,
            panelId: PANEL_ID,
            placement: 'pane-bottom' as const,
            scope: { type: 'pane' as const, paneId },
          }],
        }
      },
    },
  ],

  panels: [
    {
      id: PANEL_ID,
      title: 'JSON Tools · Expression',
      titleI18n: { zh: 'JSON Tools · 表达式', en: 'JSON Tools · Expression' },
      defaultPlacement: 'pane-bottom',
      height: 'auto',
      component: LazyJsFilterPanel,
    },
  ],
})

export default jsFilterPlugin
