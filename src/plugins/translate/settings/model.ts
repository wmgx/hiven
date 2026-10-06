export type TranslateProvider = 'ai' | 'baidu' | 'deepl' | 'tencent'

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
  secretId?: string
  secretKey?: string
  region?: string
  aiProviderId?: string
  aiAgentId?: string
  aiEffort?: 'inherit' | 'low' | 'medium' | 'high' | 'xhigh'
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

export const TENCENT_DEFAULT_PROFILE: TranslateProfile = {
  id: 'tencent-default',
  name: '腾讯云翻译',
  provider: 'tencent',
  enabled: false,
  endpoint: 'https://tmt.tencentcloudapi.com',
  secretId: '',
  secretKey: '',
  region: 'ap-guangzhou',
  defaultSourceLang: 'auto',
  defaultTargetLang: 'smart',
  monthlyLimitChars: 5000000,
  usedCharsMonth: '',
  usedChars: 0,
}

export const AI_DEFAULT_PROFILE: TranslateProfile = {
  id: 'ai-default',
  name: 'AI',
  provider: 'ai',
  enabled: true,
  aiProviderId: '',
  aiAgentId: '',
  aiEffort: 'inherit',
  defaultSourceLang: 'auto',
  defaultTargetLang: 'smart',
  monthlyLimitChars: 0,
  usedCharsMonth: '',
  usedChars: 0,
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
    TENCENT_DEFAULT_PROFILE,
    AI_DEFAULT_PROFILE,
  ],
}

export function migrateTranslateSettings(stored: unknown, _fromVersion: number): TranslateSettings {
  const value = stored && typeof stored === 'object' ? stored as Partial<TranslateSettings> : {}
  const profiles = Array.isArray(value.profiles) ? value.profiles.filter((profile): profile is TranslateProfile => Boolean(profile && typeof profile === 'object')) : []
  const nextProfiles = profiles.length > 0 ? [...profiles] : [...DEFAULT_TRANSLATE_SETTINGS.profiles]
  if (!nextProfiles.some((profile) => profile.provider === 'tencent')) nextProfiles.push(TENCENT_DEFAULT_PROFILE)
  if (!nextProfiles.some((profile) => profile.provider === 'ai')) nextProfiles.push(AI_DEFAULT_PROFILE)
  return {
    defaultProfileId: value.defaultProfileId || DEFAULT_TRANSLATE_SETTINGS.defaultProfileId,
    defaultTargetLang: value.defaultTargetLang || DEFAULT_TRANSLATE_SETTINGS.defaultTargetLang,
    profiles: nextProfiles,
  }
}

export function currentUsageMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
