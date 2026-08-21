import type { PluginNetworkApi } from '@hiven/plugin'
import type { LanguageCode, SourceLanguageCode, TranslateProfile } from '../settings/model'
import type { TranslateRequest, TranslateResult } from './adapters'

export const DEFAULT_TENCENT_ENDPOINT = 'https://tmt.tencentcloudapi.com'
export const DEFAULT_TENCENT_REGION = 'ap-guangzhou'
export const TENCENT_SERVICE = 'tmt'
export const TENCENT_ACTION = 'TextTranslate'
export const TENCENT_API_VERSION = '2018-03-21'

const TENCENT_LANG: Record<SourceLanguageCode | LanguageCode, string> = {
  auto: 'auto',
  zh: 'zh',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
}

type TencentTranslateResponse = {
  Response?: {
    TargetText?: string
    RequestId?: string
    Error?: {
      Code?: string
      Message?: string
    }
  }
}

export function tencentLang(code: SourceLanguageCode | LanguageCode): string {
  return TENCENT_LANG[code]
}

export function parseTencentTranslateResponse(status: number, body: string): { text: string; requestId?: string } {
  let data: TencentTranslateResponse
  try {
    data = JSON.parse(body) as TencentTranslateResponse
  } catch {
    throw new Error(`Tencent translate failed (${status})`)
  }
  const error = data.Response?.Error
  if (status < 200 || status >= 300 || error?.Code || error?.Message) {
    const code = error?.Code ? ` (${error.Code})` : ''
    throw new Error((error?.Message || `Tencent translate failed (${status})`) + code)
  }
  const text = data.Response?.TargetText ?? ''
  if (!text) throw new Error('Tencent returned an empty translation')
  return { text, requestId: data.Response?.RequestId }
}

export function buildTencentTranslatePayload(req: TranslateRequest): string {
  return JSON.stringify({
    SourceText: req.text,
    Source: tencentLang(req.sourceLang),
    Target: tencentLang(req.targetLang),
    ProjectId: 0,
  })
}

export async function buildTencentTranslateRequest(
  req: TranslateRequest,
  profile: Pick<TranslateProfile, 'secretId' | 'secretKey' | 'endpoint' | 'region'>,
  now = new Date(),
): Promise<{ url: string; headers: Record<string, string>; body: string }> {
  if (!profile.secretId || !profile.secretKey) {
    throw new Error('Tencent profile requires secretId and secretKey')
  }
  const url = profile.endpoint || DEFAULT_TENCENT_ENDPOINT
  const host = new URL(url).host
  const region = profile.region || DEFAULT_TENCENT_REGION
  const timestamp = Math.floor(now.getTime() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const body = buildTencentTranslatePayload(req)
  const contentType = 'application/json; charset=utf-8'
  const authorization = await signTc3({
    secretId: profile.secretId,
    secretKey: profile.secretKey,
    service: TENCENT_SERVICE,
    host,
    action: TENCENT_ACTION,
    contentType,
    payload: body,
    timestamp,
    date,
  })
  return {
    url,
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      Host: host,
      'X-TC-Action': TENCENT_ACTION,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': TENCENT_API_VERSION,
      'X-TC-Region': region,
    },
    body,
  }
}

export async function translateWithTencent(
  req: TranslateRequest,
  profile: TranslateProfile,
  network: PluginNetworkApi,
  now = new Date(),
): Promise<TranslateResult> {
  const request = await buildTencentTranslateRequest(req, profile, now)
  const response = await network.request({
    url: request.url,
    method: 'POST',
    headers: request.headers,
    body: request.body,
  })
  const parsed = parseTencentTranslateResponse(response.status, response.body)
  return {
    text: parsed.text,
    billedChars: Array.from(req.text).length,
    providerRequestId: parsed.requestId,
  }
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message))
  return toHex(digest)
}

async function hmac(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
}

async function signTc3(input: {
  secretId: string
  secretKey: string
  service: string
  host: string
  action: string
  contentType: string
  payload: string
  timestamp: number
  date: string
}): Promise<string> {
  const hashedPayload = await sha256Hex(input.payload)
  const canonicalHeaders = [
    `content-type:${input.contentType}`,
    `host:${input.host}`,
    `x-tc-action:${input.action.toLowerCase()}`,
  ].join('\n') + '\n'
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n')
  const credentialScope = `${input.date}/${input.service}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(input.timestamp),
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')
  const secretDate = await hmac(new TextEncoder().encode(`TC3${input.secretKey}`), input.date)
  const secretService = await hmac(secretDate, input.service)
  const secretSigning = await hmac(secretService, 'tc3_request')
  const signature = toHex(await hmac(secretSigning, stringToSign))
  return `TC3-HMAC-SHA256 Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}
