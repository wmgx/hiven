import type { SaveableParamValue } from '../launcher/types'

const SECRET_KEY = 'hiven:experience-installation-secret:v1'
let memorySecret: Uint8Array | null = null

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/.test(value)) return null
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))
}

function installationSecret(): Uint8Array | null {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) return null
  try {
    const stored = globalThis.localStorage?.getItem(SECRET_KEY)
    const decoded = stored ? hexToBytes(stored) : null
    if (decoded) return decoded
  } catch {
    // Fall back to this webview's memory if storage is unavailable.
  }
  if (!memorySecret) memorySecret = globalThis.crypto.getRandomValues(new Uint8Array(32))
  try {
    globalThis.localStorage?.setItem(SECRET_KEY, bytesToHex(memorySecret))
  } catch {
    // Ephemeral per-webview secret still keeps fingerprints one-way.
  }
  return memorySecret
}

export function canonicalSafeParams(params: Record<string, SaveableParamValue>): string {
  return JSON.stringify(Object.fromEntries(Object.keys(params).sort().map((key) => [key, params[key]])))
}

export function isSecretLikeInput(input: string): boolean {
  const value = input.trim()
  if (!value) return false
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value) ||
    /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*\S+/i.test(value) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(value) ||
    /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/.test(value) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(value) ||
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(value)
}

function inputShape(input: string): string {
  const lines = input.split(/\r\n?|\n/).length
  const lengthBucket = Math.min(20, Math.floor(input.length / 64))
  const lineBucket = Math.min(20, Math.floor((lines - 1) / 4))
  return `text:${lengthBucket}:${lineBucket}`
}

async function hmac(secret: Uint8Array, value: string): Promise<string> {
  const keyBytes = secret.buffer.slice(secret.byteOffset, secret.byteOffset + secret.byteLength) as ArrayBuffer
  const message = new TextEncoder().encode(value)
  const messageBytes = message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength) as ArrayBuffer
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return `h1:${bytesToHex(new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, messageBytes)))}`
}

export async function createMiningFingerprints(
  input: string,
  params: Record<string, SaveableParamValue>,
  secret = installationSecret(),
): Promise<{
  inputFingerprint: string
  paramSignature: string
  safeParamsJson: string
} | null> {
  if (!secret || !input || isSecretLikeInput(input)) return null
  const safeParamsJson = canonicalSafeParams(params)
  return {
    inputFingerprint: await hmac(secret, `${inputShape(input)}\0${input}`),
    paramSignature: await hmac(secret, safeParamsJson),
    safeParamsJson,
  }
}
