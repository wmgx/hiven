/**
 * First-party Pane Controls plugin.
 *
 * Provides workspace pane operations (split / close) as plugin commands so they
 * appear in the plugin manager alongside other built-in plugins. The commands
 * only emit effects; the effect runner performs the actual workspace mutations.
 */

import { definePlugin, type PaneInput } from '@hiven/plugin'

type SplitDirection = 'left' | 'right' | 'top' | 'bottom'

const LANGUAGE_OPTIONS = [
  { label: 'param.language.option.auto.label', value: 'auto' },
  { label: 'param.language.option.plaintext.label', value: 'plaintext' },
  { label: 'param.language.option.json.label', value: 'json' },
  { label: 'param.language.option.javascript.label', value: 'javascript' },
  { label: 'param.language.option.typescript.label', value: 'typescript' },
  { label: 'param.language.option.html.label', value: 'html' },
  { label: 'param.language.option.css.label', value: 'css' },
  { label: 'param.language.option.markdown.label', value: 'markdown' },
  { label: 'param.language.option.yaml.label', value: 'yaml' },
  { label: 'param.language.option.xml.label', value: 'xml' },
  { label: 'param.language.option.sql.label', value: 'sql' },
  { label: 'param.language.option.python.label', value: 'python' },
  { label: 'param.language.option.shell.label', value: 'shell' },
  { label: 'param.language.option.go.label', value: 'go' },
  { label: 'param.language.option.rust.label', value: 'rust' },
  { label: 'param.language.option.java.label', value: 'java' },
  { label: 'param.language.option.csharp.label', value: 'csharp' },
  { label: 'param.language.option.cpp.label', value: 'cpp' },
]

const EDITOR_LANGUAGE_VALUES = new Set(LANGUAGE_OPTIONS.map((option) => option.value).filter((value) => value !== 'auto'))

function effectResult(result: { errors: string[] }) {
  if (result.errors.length > 0) return { ok: false as const, message: result.errors[0] }
  return { ok: true as const }
}

export const corePanePlugin = definePlugin({
  launcher: {
    items: [
      {
        id: 'show-main-panel',
        display: {
          title: 'command.showMainPanel.title',
          subtitle: 'command.showMainPanel.description',
          icon: 'PanelTopOpen',
          aliases: ['main', 'home', 'editor', 'main-panel', '主面板'],
        },
        surfaces: ['global-launcher'],
        pinnable: false,
        async execute(ctx) {
          await ctx.api.showMainPanel()
          return { ok: true }
        },
      },
      {
        id: 'core-pane.split',
        display: {
          title: 'command.split.title',
          subtitle: 'command.split.description',
          icon: 'columns',
          aliases: ['split', 'split-pane'],
        },
        surfaces: ['command-palette'],
        pinnable: false,
        params: [
          {
            key: 'direction',
            label: 'param.direction.label',
            type: 'single-select',
            options: [
              { label: 'param.direction.option.right.label', value: 'right' },
              { label: 'param.direction.option.left.label', value: 'left' },
              { label: 'param.direction.option.down.label', value: 'bottom' },
              { label: 'param.direction.option.up.label', value: 'top' },
            ],
            default: 'right',
          },
        ],
        execute(ctx) {
          const snapshot = ctx.api.getPaneSnapshot()
          return effectResult(ctx.api.dispatchEffects([{
            type: 'pane.create' as const,
            pane: { text: '', language: snapshot.panes[snapshot.activePaneId]?.language || 'plaintext' },
            focus: true,
            direction: 'right' as const,
          }]))
        },
        executeWithParams(ctx, params) {
          const direction = (params.direction as SplitDirection) ?? 'right'
          const snapshot = ctx.api.getPaneSnapshot()
          return effectResult(ctx.api.dispatchEffects([{
            type: 'pane.create' as const,
            pane: { text: '', language: snapshot.panes[snapshot.activePaneId]?.language || 'plaintext' },
            focus: true,
            direction,
          }]))
        },
      },
      {
        id: 'core-pane.close',
        display: {
          title: 'command.close.title',
          subtitle: 'command.close.description',
          icon: 'x',
          aliases: ['close-pane', 'close'],
        },
        surfaces: ['command-palette'],
        pinnable: false,
        execute(ctx) {
          return effectResult(ctx.api.dispatchEffects([{ type: 'pane.close' as const }]))
        },
      },
      {
        id: 'core-pane.toggle-sticky-scroll',
        display: {
          title: 'command.toggleStickyScroll.title',
          subtitle: 'command.toggleStickyScroll.description',
          icon: 'panel-top',
          aliases: ['sticky-scroll', 'toggle-sticky-scroll'],
        },
        surfaces: ['command-palette'],
        pinnable: false,
        execute(ctx) {
          const snapshot = ctx.api.getPaneSnapshot()
          const stickyScrollEnabled = snapshot.panes[snapshot.activePaneId]?.stickyScroll === true
          return effectResult(ctx.api.dispatchEffects([
            {
              type: 'pane.update' as const,
              paneId: snapshot.activePaneId,
              patch: { stickyScroll: !stickyScrollEnabled },
            },
            {
              type: 'status.message' as const,
              level: 'info' as const,
              message: stickyScrollEnabled
                ? ctx.t('message.stickyScroll.disabled')
                : ctx.t('message.stickyScroll.enabled'),
            },
          ]))
        },
      },
      {
        id: 'core-pane.set-language',
        display: {
          title: 'command.setLanguage.title',
          subtitle: 'command.setLanguage.description',
          icon: 'code-2',
          aliases: ['language', 'set-language'],
        },
        surfaces: ['command-palette'],
        pinnable: false,
        params: [
          {
            key: 'language',
            label: 'param.language.label',
            type: 'single-select',
            options: LANGUAGE_OPTIONS,
            default: 'auto',
            required: true,
          },
        ],
        execute(ctx) {
          const snapshot = ctx.api.getPaneSnapshot()
          return effectResult(ctx.api.dispatchEffects([{
            type: 'pane.update' as const,
            paneId: snapshot.activePaneId,
            patch: { detectedLanguage: undefined, languageSource: 'auto' as const },
          }]))
        },
        executeWithParams(ctx, params) {
          const snapshot = ctx.api.getPaneSnapshot()
          const requested = String(params.language ?? 'auto')
          if (requested === 'auto') {
            return effectResult(ctx.api.dispatchEffects([{
              type: 'pane.update' as const,
              paneId: snapshot.activePaneId,
              patch: { detectedLanguage: undefined, languageSource: 'auto' as const },
            }]))
          }
          const language = EDITOR_LANGUAGE_VALUES.has(requested) ? requested : 'plaintext'
          return effectResult(ctx.api.dispatchEffects([{
            type: 'pane.update' as const,
            paneId: snapshot.activePaneId,
            patch: { language, languageSource: 'manual' as const },
          }]))
        },
      },
    ],
  },
  commands: [
    {
      id: 'core-pane.show-main-panel',
      title: 'command.showMainPanel.title',
      description: 'command.showMainPanel.description',
      icon: 'PanelTopOpen',
      aliases: ['main', 'home', 'editor', 'main-panel', '主面板'],
      live: { pinnable: false },
      run() {
        return {
          effects: [{ type: 'app.showMainPanel' as const }],
        }
      },
    },
    {
      id: 'core-pane.split',
      title: 'command.split.title',
      description: 'command.split.description',
      icon: 'columns',
      aliases: ['split', 'split-pane'],
      live: { pinnable: false },
      inputs: [
        { key: 'source', label: 'input.source.label', kind: 'pane', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      params: [
        {
          key: 'direction',
          label: 'param.direction.label',
          type: 'single-select',
          options: [
            { label: 'param.direction.option.right.label', value: 'right' },
            { label: 'param.direction.option.left.label', value: 'left' },
            { label: 'param.direction.option.down.label', value: 'bottom' },
            { label: 'param.direction.option.up.label', value: 'top' },
          ],
          default: 'right',
        },
      ],
      run(ctx) {
        const source = ctx.inputs.source as PaneInput | undefined
        const direction = (ctx.params.direction as SplitDirection) ?? 'right'
        return {
          effects: [{
            type: 'pane.create' as const,
            pane: { text: '', language: source?.language || 'plaintext' },
            focus: true,
            direction,
          }],
        }
      },
    },
    {
      id: 'core-pane.close',
      title: 'command.close.title',
      description: 'command.close.description',
      icon: 'x',
      aliases: ['close-pane', 'close'],
      live: { pinnable: false },
      run() {
        return {
          effects: [{ type: 'pane.close' as const }],
        }
      },
    },
    {
      id: 'core-pane.toggle-sticky-scroll',
      title: 'command.toggleStickyScroll.title',
      description: 'command.toggleStickyScroll.description',
      icon: 'panel-top',
      aliases: ['sticky-scroll', 'toggle-sticky-scroll'],
      live: { pinnable: false },
      inputs: [
        { key: 'target', label: 'input.target.label', kind: 'pane', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const target = ctx.inputs.target as PaneInput | undefined
        if (!target?.paneId) return { effects: [] }
        const stickyScrollEnabled = target.stickyScroll === true
        return {
          effects: [
            {
              type: 'pane.update' as const,
              paneId: target.paneId,
              patch: { stickyScroll: !stickyScrollEnabled },
            },
          ],
        }
      },
    },
    {
      id: 'core-pane.set-language',
      title: 'command.setLanguage.title',
      description: 'command.setLanguage.description',
      icon: 'code-2',
      aliases: ['language', 'set-language'],
      live: { pinnable: false },
      inputs: [
        { key: 'target', label: 'input.target.label', kind: 'pane', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      params: [
        {
          key: 'language',
          label: 'param.language.label',
          type: 'single-select',
          options: LANGUAGE_OPTIONS,
          default: 'auto',
          required: true,
        },
      ],
      run(ctx) {
        const target = ctx.inputs.target as PaneInput | undefined
        if (!target?.paneId) return { effects: [] }
        const requested = String(ctx.params.language ?? 'auto')
        if (requested === 'auto') {
          return {
            effects: [{
              type: 'pane.update' as const,
              paneId: target.paneId,
              patch: { detectedLanguage: undefined, languageSource: 'auto' as const },
            }],
          }
        }
        const language = EDITOR_LANGUAGE_VALUES.has(requested) ? requested : 'plaintext'
        return {
          effects: [{
            type: 'pane.update' as const,
            paneId: target.paneId,
            patch: { language, languageSource: 'manual' as const },
          }],
        }
      },
    },
  ],
  toolbar: [
    {
      id: 'core-pane.split-button',
      title: 'toolbar.split.title',
      icon: 'Plus',
      commandId: 'core-pane.split',
      placement: 'editor-top-right',
      order: 0,
    },
  ],
})

export default corePanePlugin
