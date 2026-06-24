import { definePlugin } from '@hiven/plugin'
import type { TranslateSettings } from './settings/model'
import { DEFAULT_TRANSLATE_SETTINGS } from './settings/model'
import { TranslateSurface } from './surfaces/TranslateSurface'
import './style.css'

const PROFILE_FIELDS = [
  { key: 'id', label: 'profile.field.id', kind: 'text', mono: true },
  { key: 'name', label: 'profile.field.name', kind: 'text' },
  {
    key: 'provider',
    label: 'profile.field.provider',
    kind: 'select',
    options: [
      { label: 'profile.provider.baidu', value: 'baidu' },
      { label: 'profile.provider.deepl', value: 'deepl' },
    ],
  },
  { key: 'enabled', label: 'profile.field.enabled', kind: 'switch' },
  { key: 'endpoint', label: 'profile.field.endpoint', kind: 'text', mono: true },
  { key: 'appId', label: 'profile.field.appId', kind: 'text', mono: true },
  { key: 'secret', label: 'profile.field.secret', kind: 'text', mono: true },
  { key: 'authKey', label: 'profile.field.authKey', kind: 'text', mono: true },
  {
    key: 'defaultTargetLang',
    label: 'profile.field.defaultTargetLang',
    kind: 'select',
    options: [
      { label: 'language.smart', value: 'smart' },
      { label: 'language.zh', value: 'zh' },
      { label: 'language.en', value: 'en' },
      { label: 'language.ja', value: 'ja' },
      { label: 'language.ko', value: 'ko' },
      { label: 'language.fr', value: 'fr' },
      { label: 'language.de', value: 'de' },
      { label: 'language.es', value: 'es' },
    ],
  },
  { key: 'monthlyLimitChars', label: 'profile.field.monthlyLimitChars', kind: 'text', mono: true },
]

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
          fields: [
            { kind: 'text', key: 'defaultProfileId', label: 'settings.defaultProfileId', mono: true },
            {
              kind: 'select',
              key: 'defaultTargetLang',
              label: 'settings.defaultTargetLang',
              options: [
                { label: 'language.smart', value: 'smart' },
                { label: 'language.zh', value: 'zh' },
                { label: 'language.en', value: 'en' },
                { label: 'language.ja', value: 'ja' },
                { label: 'language.ko', value: 'ko' },
                { label: 'language.fr', value: 'fr' },
                { label: 'language.de', value: 'de' },
                { label: 'language.es', value: 'es' },
              ],
            },
          ],
        },
        {
          id: 'profiles',
          title: 'API Profiles',
          titleI18n: { zh: 'API 配置组' },
          description: 'Secrets are stored locally with plugin settings in this first version.',
          descriptionI18n: { zh: '第一版会把密钥随插件设置保存在本地。' },
          fields: [
            {
              kind: 'object-list',
              key: 'profiles',
              label: 'settings.profiles',
              itemLabel: 'Profile',
              itemLabelI18n: { zh: '配置组' },
              itemTitleKey: 'name',
              addLabel: 'Add profile',
              addLabelI18n: { zh: '添加配置组' },
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
