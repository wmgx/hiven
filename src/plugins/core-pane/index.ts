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
  { label: 'JSON', value: 'json' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'YAML', value: 'yaml' },
  { label: 'XML', value: 'xml' },
  { label: 'SQL', value: 'sql' },
  { label: 'Python', value: 'python' },
  { label: 'Shell', value: 'shell' },
  { label: 'Go', value: 'go' },
  { label: 'Rust', value: 'rust' },
  { label: 'Java', value: 'java' },
  { label: 'C#', value: 'csharp' },
  { label: 'C++', value: 'cpp' },
]

const EDITOR_LANGUAGE_VALUES = new Set(LANGUAGE_OPTIONS.map((option) => option.value).filter((value) => value !== 'auto'))

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
            {
              type: 'status.message' as const,
              level: 'info' as const,
              message: stickyScrollEnabled
                ? 'Current pane sticky scroll disabled'
                : 'Current pane sticky scroll enabled',
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
