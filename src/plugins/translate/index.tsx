import { definePlugin } from '@hiven/plugin'
import type { TranslateSettings } from './settings/model'
import { DEFAULT_TRANSLATE_SETTINGS } from './settings/model'
import { TranslateSurface } from './surfaces/TranslateSurface'
import './style.css'

const LANGUAGE_OPTIONS = [
  { label: 'Smart', labelI18n: { zh: '智能' }, value: 'smart' },
  { label: 'Chinese', labelI18n: { zh: '中文' }, value: 'zh' },
  { label: 'English', labelI18n: { zh: '英文' }, value: 'en' },
  { label: 'Japanese', labelI18n: { zh: '日文' }, value: 'ja' },
  { label: 'Korean', labelI18n: { zh: '韩文' }, value: 'ko' },
  { label: 'French', labelI18n: { zh: '法文' }, value: 'fr' },
  { label: 'German', labelI18n: { zh: '德文' }, value: 'de' },
  { label: 'Spanish', labelI18n: { zh: '西班牙文' }, value: 'es' },
]

const PROFILE_FIELDS = [
  { key: 'id', label: 'ID', kind: 'text', mono: true },
  { key: 'name', label: 'Name', labelI18n: { zh: '名称' }, kind: 'text' },
  {
    key: 'provider',
    label: 'Provider',
    labelI18n: { zh: '服务商' },
    kind: 'select',
    options: [
      { label: 'Baidu Translate', labelI18n: { zh: '百度翻译' }, value: 'baidu' },
      { label: 'DeepL', value: 'deepl' },
    ],
  },
  { key: 'enabled', label: 'Enabled', labelI18n: { zh: '启用' }, kind: 'switch' },
  { key: 'endpoint', label: 'Endpoint', kind: 'text', mono: true },
  { key: 'appId', label: 'App ID', kind: 'text', mono: true },
  { key: 'secret', label: 'Secret', kind: 'text', mono: true },
  { key: 'authKey', label: 'Auth Key', kind: 'text', mono: true },
  {
    key: 'defaultTargetLang',
    label: 'Default target language',
    labelI18n: { zh: '默认目标语种' },
    kind: 'select',
    options: LANGUAGE_OPTIONS,
  },
  { key: 'monthlyLimitChars', label: 'Monthly character limit', labelI18n: { zh: '月度字符上限' }, kind: 'text', mono: true },
] as const

export default definePlugin<TranslateSettings>({
  settings: {
    title: 'Translate',
    titleI18n: { zh: '翻译' },
    version: 1,
    defaultValue: DEFAULT_TRANSLATE_SETTINGS,
    schema: {
      sections: [
        {
          id: 'defaults',
          title: 'Defaults',
          titleI18n: { zh: '默认设置' },
          description: 'Choose the profile and target language used when the translate surface opens.',
          descriptionI18n: { zh: '设置翻译浮层打开时使用的默认配置组和目标语种。' },
          fields: [
            {
              kind: 'text',
              key: 'defaultProfileId',
              label: 'Default profile ID',
              labelI18n: { zh: '默认配置组 ID' },
              mono: true,
            },
            {
              kind: 'select',
              key: 'defaultTargetLang',
              label: 'Default target language',
              labelI18n: { zh: '默认目标语种' },
              options: LANGUAGE_OPTIONS,
            },
          ],
        },
        {
          id: 'profiles',
          title: 'API profiles',
          titleI18n: { zh: 'API 配置组' },
          description: 'Configure translation provider credentials and character limits.',
          descriptionI18n: { zh: '配置翻译服务商凭据和字符额度。' },
          fields: [
            {
              kind: 'object-list',
              key: 'profiles',
              label: 'API profiles',
              labelI18n: { zh: 'API 配置组' },
              itemLabel: 'Profile',
              itemLabelI18n: { zh: '配置组' },
              itemTitleKey: 'name',
              addLabel: 'Add profile',
              addLabelI18n: { zh: '添加配置组' },
              emptyText: 'No API profiles',
              emptyTextI18n: { zh: '暂无 API 配置组' },
              itemDefaults: {
                id: 'custom-profile',
                name: 'Custom Profile',
                provider: 'baidu',
                enabled: true,
                endpoint: '',
                appId: '',
                secret: '',
                authKey: '',
                defaultSourceLang: 'auto',
                defaultTargetLang: 'smart',
                monthlyLimitChars: 100000,
                usedCharsMonth: '',
                usedChars: 0,
              },
              fields: PROFILE_FIELDS,
            },
          ],
        },
      ],
    },
  },
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Translate',
        titleI18n: { zh: '翻译' },
        icon: 'Languages',
        aliases: ['translate', 'translation', '翻译', 'fanyi'],
        component: TranslateSurface,
        entry: {
          launcher: true,
          shortcutBindable: true,
          recommendedShortcut: 'CmdOrCtrl+Shift+T',
        },
        shell: {
          defaultWidth: 960,
          defaultHeight: 620,
          minWidth: 760,
          minHeight: 420,
          closeOnBlur: false,
          resizable: true,
        },
      },
    ],
  },
})
