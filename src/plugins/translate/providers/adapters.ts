import type { PluginNetworkApi } from '@hiven/plugin'
import type { LanguageCode, SourceLanguageCode, TranslateProfile } from '../settings/model'

export type TranslateRequest = {
  text: string
  sourceLang: SourceLanguageCode
  targetLang: LanguageCode
}

export type TranslateResult = {
  text: string
  billedChars: number
  providerRequestId?: string
}

type BaiduResponse = {
  trans_result?: Array<{ src: string; dst: string }>
  error_code?: string
  error_msg?: string
}

type DeepLResponse = {
  translations?: Array<{ text: string }>
  message?: string
}

const BAIDU_LANG: Record<SourceLanguageCode | LanguageCode, string> = {
  auto: 'auto',
  zh: 'zh',
  en: 'en',
  ja: 'jp',
  ko: 'kor',
  fr: 'fra',
  de: 'de',
  es: 'spa',
}

const DEEPL_TARGET_LANG: Record<LanguageCode, string> = {
  zh: 'ZH',
  en: 'EN-US',
  ja: 'JA',
  ko: 'KO',
  fr: 'FR',
  de: 'DE',
  es: 'ES',
}

const DEEPL_SOURCE_LANG: Partial<Record<SourceLanguageCode, string>> = {
  zh: 'ZH',
  en: 'EN',
  ja: 'JA',
  ko: 'KO',
  fr: 'FR',
  de: 'DE',
  es: 'ES',
}

const MD5_SHIFT_AMOUNTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

const MD5_TABLE = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0)

export function resolveSmartTargetLang(text: string): LanguageCode {
  const compact = text.replace(/\s+/g, '')
  if (!compact) return 'zh'
  const chinese = compact.match(/[\u3400-\u9fff]/g)?.length ?? 0
  return chinese / compact.length >= 0.22 ? 'en' : 'zh'
}

export function estimateBilledChars(text: string): number {
  return Array.from(text).length
}

function rotateLeft(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0
}

function add32(...values: number[]): number {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0)
}

function md5(value: string): string {
  const input = new TextEncoder().encode(value)
  const bitLength = input.length * 8
  const paddedLength = (((input.length + 8) >> 6) + 1) * 64
  const buffer = new Uint8Array(paddedLength)
  buffer.set(input)
  buffer[input.length] = 0x80
  const view = new DataView(buffer.buffer)
  view.setUint32(paddedLength - 8, bitLength >>> 0, true)
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4, true))
    let a = a0
    let b = b0
    let c = c0
    let d = d0

    for (let i = 0; i < 64; i += 1) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const nextD = c
      c = b
      b = add32(b, rotateLeft(add32(a, f, MD5_TABLE[i], words[g]), MD5_SHIFT_AMOUNTS[i]))
      a = d
      d = nextD
    }

    a0 = add32(a0, a)
    b0 = add32(b0, b)
    c0 = add32(c0, c)
    d0 = add32(d0, d)
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a0, true)
  outView.setUint32(4, b0, true)
  outView.setUint32(8, c0, true)
  outView.setUint32(12, d0, true)
  return Array.from(out).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function translateWithBaidu(req: TranslateRequest, profile: TranslateProfile, network: PluginNetworkApi): Promise<TranslateResult> {
  if (!profile.appId || !profile.secret) {
    throw new Error('Baidu profile requires appId and secret')
  }
  const salt = String(Date.now())
  const sign = md5(`${profile.appId}${req.text}${salt}${profile.secret}`)
  const body = new URLSearchParams({
    q: req.text,
    from: BAIDU_LANG[req.sourceLang],
    to: BAIDU_LANG[req.targetLang],
    appid: profile.appId,
    salt,
    sign,
  })
  const response = await network.request({
    url: profile.endpoint || 'https://fanyi-api.baidu.com/api/trans/vip/translate',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const data = JSON.parse(response.body) as BaiduResponse
  if (response.status < 200 || response.status >= 300 || data.error_code) {
    throw new Error(data.error_msg || `Baidu translate failed (${response.status})`)
  }
  const text = data.trans_result?.map((item) => item.dst).join('\n') ?? ''
  if (!text) throw new Error('Baidu returned an empty translation')
  return { text, billedChars: estimateBilledChars(req.text), providerRequestId: salt }
}

async function translateWithDeepL(req: TranslateRequest, profile: TranslateProfile, network: PluginNetworkApi): Promise<TranslateResult> {
  if (!profile.authKey) {
    throw new Error('DeepL profile requires authKey')
  }
  const body = new URLSearchParams({
    text: req.text,
    target_lang: DEEPL_TARGET_LANG[req.targetLang],
  })
  const sourceLang = req.sourceLang === 'auto' ? undefined : DEEPL_SOURCE_LANG[req.sourceLang]
  if (sourceLang) body.set('source_lang', sourceLang)
  const response = await network.request({
    url: profile.endpoint || 'https://api-free.deepl.com/v2/translate',
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${profile.authKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const data = JSON.parse(response.body) as DeepLResponse
  if (response.status < 200 || response.status >= 300) {
    throw new Error(data.message || `DeepL translate failed (${response.status})`)
  }
  const text = data.translations?.map((item) => item.text).join('\n') ?? ''
  if (!text) throw new Error('DeepL returned an empty translation')
  return { text, billedChars: estimateBilledChars(req.text) }
}

export async function translateText(req: TranslateRequest, profile: TranslateProfile, network: PluginNetworkApi): Promise<TranslateResult> {
  switch (profile.provider) {
    case 'baidu':
      return translateWithBaidu(req, profile, network)
    case 'deepl':
      return translateWithDeepL(req, profile, network)
    default:
      throw new Error(`Unsupported translate provider: ${String(profile.provider)}`)
  }
}
