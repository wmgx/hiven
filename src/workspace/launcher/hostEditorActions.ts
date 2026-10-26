import { useQuickEditorStore } from '../quickEditor/quickEditorStore'
import { detectEditorLanguage } from '../languageDetector'
import type { LauncherItem, LauncherParamOption } from './types'

const LANGUAGE_OPTIONS: LauncherParamOption[] = [
  { label: 'Auto Detect', value: 'auto', labelI18n: { zh: '自动检测' } },
  { label: 'Plain Text', value: 'plaintext', labelI18n: { zh: '纯文本' } },
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

const EDITOR_LANGUAGE_VALUES = new Set(
  LANGUAGE_OPTIONS
    .map((option) => typeof option === 'string' ? option : option.value)
    .filter((value) => value !== 'auto'),
)

function setQuickEditorLanguage(requested: unknown): void {
  const language = String(requested ?? 'auto')
  const store = useQuickEditorStore.getState()
  if (language === 'auto') {
    store.setDetectedLanguage(detectEditorLanguage(store.text, { allowShortStrongSignals: true }))
    return
  }
  const normalized = EDITOR_LANGUAGE_VALUES.has(language) ? language : 'plaintext'
  store.setLanguage(normalized)
}

export function getHostEditorActionItems(): LauncherItem[] {
  return [
    {
      systemKey: 'host:pane:split-right',
      kind: 'host',
      display: {
        title: 'Split Pane Right',
        titleI18n: { zh: '向右分栏' },
        subtitle: 'Open an empty pane to the right',
        subtitleI18n: { zh: '在右侧打开一个空白面板' },
        icon: 'PanelRight',
        aliases: ['split', 'split right', 'pane right', '右侧分栏', '分栏'],
      },
      behavior: { type: 'perform' },
      surfaces: ['quick-editor-command'],
      requiredCapabilities: ['pane-actions'],
      execute: async () => {
        useQuickEditorStore.getState().createPane({ direction: 'right' })
        return { ok: true }
      },
    },
    {
      systemKey: 'host:pane:split-down',
      kind: 'host',
      display: {
        title: 'Split Pane Down',
        titleI18n: { zh: '向下分栏' },
        subtitle: 'Open an empty pane below',
        subtitleI18n: { zh: '在下方打开一个空白面板' },
        icon: 'PanelBottom',
        aliases: ['split', 'split down', 'pane down', '向下分栏', '分栏'],
      },
      behavior: { type: 'perform' },
      surfaces: ['quick-editor-command'],
      requiredCapabilities: ['pane-actions'],
      execute: async () => {
        useQuickEditorStore.getState().createPane({ direction: 'bottom' })
        return { ok: true }
      },
    },
    {
      systemKey: 'host:pane:set-language',
      kind: 'host',
      display: {
        title: 'Set Language',
        titleI18n: { zh: '设置语言' },
        subtitle: 'Change the active pane language mode',
        subtitleI18n: { zh: '修改当前面板的语言模式' },
        icon: 'Languages',
        aliases: ['language', 'set-language', '语言'],
      },
      behavior: { type: 'perform' },
      surfaces: ['quick-editor-command'],
      requiredCapabilities: ['pane-actions', 'parameter-customization'],
      legacyUsageKeys: ['core-pane.set-language'],
      params: [
        {
          key: 'language',
          label: 'Language',
          labelI18n: { zh: '语言' },
          type: 'single-select',
          options: LANGUAGE_OPTIONS,
          default: 'auto',
          required: true,
        },
      ],
      requireParamSelection: true,
      execute: async () => {
        setQuickEditorLanguage('auto')
        return { ok: true }
      },
      executeWithParams: async (_ctx, params) => {
        setQuickEditorLanguage(params.language)
        return { ok: true }
      },
    },
  ]
}
