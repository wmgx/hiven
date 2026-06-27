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
  {
    key: 'name',
    label: 'Name',
    labelI18n: { zh: '名称' },
    placeholder: 'e.g. Baidu Free',
    placeholderI18n: { zh: '如：百度免费版' },
    kind: 'text',
    wide: true,
    required: true,
  },
  {
    key: 'provider',
    label: 'Provider',
    labelI18n: { zh: '服务商' },
    kind: 'select',
    inline: true,
    options: [
      { label: 'Baidu Translate', labelI18n: { zh: '百度翻译' }, value: 'baidu' },
      { label: 'DeepL', value: 'deepl' },
    ],
  },
  {
    key: 'enabled',
    label: 'Enable',
    labelI18n: { zh: '启用' },
    kind: 'switch',
  },
  {
    key: 'appId',
    label: 'App ID',
    labelI18n: { zh: 'App ID' },
    kind: 'text',
    mono: true,
    visibleWhen: { key: 'provider', equals: 'baidu' },
    requiredWhen: { key: 'provider', equals: 'baidu' },
  },
  {
    key: 'secret',
    label: 'Secret',
    labelI18n: { zh: 'Secret' },
    kind: 'secret',
    mono: true,
    visibleWhen: { key: 'provider', equals: 'baidu' },
    requiredWhen: { key: 'provider', equals: 'baidu' },
  },
  {
    key: 'authKey',
    label: 'Auth Key',
    labelI18n: { zh: 'Auth Key' },
    kind: 'secret',
    mono: true,
    wide: true,
    visibleWhen: { key: 'provider', equals: 'deepl' },
    requiredWhen: { key: 'provider', equals: 'deepl' },
  },
  {
    key: 'monthlyLimitChars',
    label: 'Monthly limit',
    labelI18n: { zh: '月额度' },
    kind: 'preset-number',
    mono: true,
    wide: true,
    presets: [
      { label: 'Unlimited', labelI18n: { zh: '不限额' }, value: 0 },
      { label: '100k', labelI18n: { zh: '10万' }, value: 100000 },
      { label: '500k', labelI18n: { zh: '50万' }, value: 500000 },
    ],
  },
] as const

export default definePlugin<TranslateSettings>({
  settings: {
    title: 'Translate',
    titleI18n: { zh: '翻译' },
    version: 2,
    defaultValue: DEFAULT_TRANSLATE_SETTINGS,
    schema: {
      sections: [
        {
          id: 'defaults',
          title: 'Defaults',
          titleI18n: { zh: '默认设置' },
          fields: [
            {
              kind: 'select',
              key: 'defaultProfileId',
              label: 'Default profile',
              labelI18n: { zh: '默认配置组' },
              options: [],
              optionsFromList: { listKey: 'profiles', valueKey: 'id', labelKey: 'name', fallbackLabelKey: 'id' },
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
          fields: [
            {
              kind: 'object-list',
              display: 'master-detail',
              detailColumns: 2,
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
              summaryFields: [
                { key: 'provider', label: 'Provider', labelI18n: { zh: '服务商' } },
                { key: 'enabled', label: 'Status', labelI18n: { zh: '状态' } },
              ],
              itemDefaults: {
                id: '',
                name: '',
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
