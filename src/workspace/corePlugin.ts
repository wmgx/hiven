/**
 * FluxText Core Plugin
 * Registers framework-owned core capabilities into the production plugin
 * registry using the standard plugin system.
 *
 * Product tools such as adaptive text/JSON diff are first-party plugins under
 * src/plugins, not framework core.
 *
 * Imported at app startup (App.tsx) to ensure registration happens before
 * any user interaction.
 */
import { pluginRegistry } from './pluginRegistry'
import { definePlugin } from './definePlugin'
import { CoreRegexPanel } from '../panels/CoreRegexPanel'
import type { PaneInput } from './pluginTypes'
import { LANGUAGE_COMMAND_OPTIONS, isEditorLanguage } from './languageOptions'
import { detectEditorLanguage } from './languageDetector'
import { useAppStore } from '../store'
import { useWorkspaceStore } from './workspaceStore'
import { runtimeRegistry } from './runtimeRegistry'

const corePlugin = definePlugin({
  commands: [
    {
      id: 'core.toggle-sticky-scroll',
      title: 'Toggle Sticky Scroll',
      titleI18n: { zh: '切换层级吸顶' },
      description: 'Enable or disable sticky scroll in editors',
      descriptionI18n: { zh: '开启或关闭编辑器的层级吸顶' },
      icon: 'panel-top',
      inputs: [
        { key: 'target', label: 'Pane', labelI18n: { zh: '面板' }, kind: 'pane', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const target = ctx.inputs.target as PaneInput | undefined
        const stickyScrollEnabled = target?.stickyScroll === true
        const locale = useAppStore.getState().locale
        if (!target?.paneId) return { effects: [] }
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
              message: locale === 'zh'
                ? `当前面板层级吸顶已${stickyScrollEnabled ? '关闭' : '开启'}`
                : `Current pane sticky scroll ${stickyScrollEnabled ? 'disabled' : 'enabled'}`,
            },
          ],
        }
      },
    },
    {
      id: 'core.set-language',
      title: 'Set Language',
      titleI18n: { zh: '设置语言' },
      description: 'Set syntax language for the active pane',
      descriptionI18n: { zh: '设置当前面板的语法语言' },
      icon: 'code-2',
      inputs: [
        { key: 'target', label: 'Pane', labelI18n: { zh: '面板' }, kind: 'pane', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      params: [
        {
          key: 'language',
          label: 'Language',
          labelI18n: { zh: '语言' },
          type: 'single-select',
          options: LANGUAGE_COMMAND_OPTIONS,
          default: 'auto',
          required: true,
        },
      ],
      run(ctx) {
        const target = ctx.inputs.target as PaneInput | undefined
        if (!target?.paneId) return { effects: [] }
        if (ctx.params.language === 'auto') {
          const detectedLanguage = detectEditorLanguage(target.text, { allowShortStrongSignals: true })
          return {
            effects: [{
              type: 'pane.update' as const,
              paneId: target.paneId,
              patch: { detectedLanguage, languageSource: 'auto' as const },
            }],
          }
        }
        const language = isEditorLanguage(ctx.params.language) ? ctx.params.language : 'plaintext'
        return {
          effects: [{
            type: 'pane.update' as const,
            paneId: target.paneId,
            patch: { language, languageSource: 'manual' as const },
          }],
        }
      },
    },
    {
      id: 'core.split',
      title: 'Split',
      titleI18n: { zh: '分栏' },
      description: 'Split the workspace into a new pane',
      descriptionI18n: { zh: '将工作区分栏为新面板' },
      icon: 'columns',
      params: [
        {
          key: 'direction',
          label: 'Direction',
          labelI18n: { zh: '方向' },
          type: 'single-select',
          options: ['right', 'left', 'down', 'up'],
          default: 'right',
        },
      ],
      run(ctx) {
        const ws = useWorkspaceStore.getState()
        const activePane = ws.panes[ws.activePaneId]
        const dirParam = ctx.params?.direction || 'right'
        const direction: 'left' | 'right' | 'top' | 'bottom' =
          dirParam === 'down' ? 'bottom' : dirParam === 'up' ? 'top' : dirParam === 'left' ? 'left' : 'right'
        ws.createPane({
          text: '',
          language: activePane?.language || 'plaintext',
          focus: true,
          direction,
        })
        return { effects: [] }
      },
    },
    {
      id: 'core.close-pane',
      title: 'Close Pane',
      titleI18n: { zh: '关闭当前面板' },
      description: 'Close the active pane',
      descriptionI18n: { zh: '关闭当前面板' },
      icon: 'x',
      run() {
        const ws = useWorkspaceStore.getState()
        ws.closeActiveSurfaceOrPane()
        const newActivePaneId = useWorkspaceStore.getState().activePaneId
        const editor = runtimeRegistry.getCodeEditor(newActivePaneId)
        if (editor) {
          useAppStore.getState().setEditorInstance(editor)
        }
        return { effects: [] }
      },
    },
    {
      id: 'core.regex-tester',
      title: 'Regex Tester',
      titleI18n: { zh: '正则测试器' },
      description: 'Open regex tester panel',
      descriptionI18n: { zh: '打开正则测试面板' },
      icon: 'regex',
      run() {
        return {
          effects: [{
            type: 'panel.openV2' as const,
            panelId: 'core.regex-tester',
            placement: 'bottom' as const,
            ownerPluginId: 'core',
          }],
        }
      },
    },
  ],

  panels: [
    {
      id: 'core.regex-tester',
      title: 'Regex Tester',
      titleI18n: { zh: '正则测试器' },
      defaultPlacement: 'bottom',
      component: CoreRegexPanel,
    },
  ],
})

// Register to production registry at module load time
pluginRegistry.registerProductionPlugin(
  'core',
  corePlugin.commands ?? [],
  corePlugin.renderers ?? [],
  corePlugin.panels ?? []
)

export { corePlugin }
