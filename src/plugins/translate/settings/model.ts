export type TranslateProvider = 'baidu' | 'deepl'

export type LanguageCode = 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es'
export type SourceLanguageCode = 'auto' | LanguageCode
export type TargetLanguageCode = 'smart' | LanguageCode

export type TranslateProfile = {
  id: string
  name: string
  provider: TranslateProvider
  enabled: boolean
  endpoint?: string
  appId?: string
  apiKey?: string
  secret?: string
  authKey?: string
  defaultSourceLang: SourceLanguageCode
  defaultTargetLang: TargetLanguageCode
  monthlyLimitChars: number
  usedCharsMonth: string
  usedChars: number
}

export type TranslateSettings = {
  defaultProfileId: string
  defaultTargetLang: TargetLanguageCode
  profiles: TranslateProfile[]
}

export const DEFAULT_TRANSLATE_SETTINGS: TranslateSettings = {
  defaultProfileId: 'baidu-default',
  defaultTargetLang: 'smart',
  profiles: [
    {
      id: 'baidu-default',
      name: '百度中文',
      provider: 'baidu',
      enabled: true,
      endpoint: 'https://fanyi-api.baidu.com/api/trans/vip/translate',
      appId: '',
      secret: '',
      defaultSourceLang: 'auto',
      defaultTargetLang: 'smart',
      monthlyLimitChars: 100000,
      usedCharsMonth: '',
      usedChars: 0,
    },
    {
      id: 'deepl-default',
      name: 'DeepL',
      provider: 'deepl',
      enabled: false,
      endpoint: 'https://api-free.deepl.com/v2/translate',
      authKey: '',
      defaultSourceLang: 'auto',
      defaultTargetLang: 'en',
      monthlyLimitChars: 500000,
      usedCharsMonth: '',
      usedChars: 0,
    },
  ],
}

export function currentUsageMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
