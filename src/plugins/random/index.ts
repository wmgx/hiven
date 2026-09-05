/**
 * First-party Random plugin.
 *
 * Independent tools for common random generation: integer, float, string,
 * UUID, password, hex, color, boolean. Params use explicit defaults so
 * launcher can quick-run; users can still customize via param flow.
 */

import { definePlugin } from '@hiven/plugin'

// ─── Crypto helpers ───────────────────────────────────────────────────────────

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/** Inclusive integer in [min, max]. */
export function randomInt(min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('Invalid range')
  const lo = Math.ceil(Math.min(min, max))
  const hi = Math.floor(Math.max(min, max))
  if (hi < lo) throw new Error('Invalid range')
  const span = hi - lo + 1
  // Rejection sampling to avoid modulo bias for large spans
  const maxUnbiased = Math.floor(0x100000000 / span) * span
  let x = 0
  do {
    const buf = randomBytes(4)
    x = ((buf[0]! << 24) | (buf[1]! << 16) | (buf[2]! << 8) | buf[3]!) >>> 0
  } while (x >= maxUnbiased)
  return lo + (x % span)
}

export function randomFloat(min: number, max: number, decimals: number): string {
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('Invalid range')
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  const buf = randomBytes(4)
  const unit = (((buf[0]! << 24) | (buf[1]! << 16) | (buf[2]! << 8) | buf[3]!) >>> 0) / 0x100000000
  const value = lo + unit * (hi - lo)
  const places = Math.max(0, Math.min(12, Math.floor(decimals)))
  return value.toFixed(places)
}

const CHARSETS: Record<string, string> = {
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  numeric: '0123456789',
  hex: '0123456789abcdef',
  base64url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  symbols: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*_-+=?',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
}

export function randomString(length: number, charsetKey: string): string {
  const charset = CHARSETS[charsetKey] ?? CHARSETS.alphanumeric!
  if (length < 1 || length > 1024) throw new Error('Invalid length')
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += charset[bytes[i]! % charset.length]
  }
  return out
}

export function randomUuid(): string {
  // RFC 4122 v4 via Web Crypto when available
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = randomBytes(16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function randomPassword(length: number): string {
  // Ensure at least one of each class when length >= 4
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const digits = '0123456789'
  const symbols = '!@#$%^&*_-+=?'
  const all = lower + upper + digits + symbols
  if (length < 1 || length > 1024) throw new Error('Invalid length')

  const picks: string[] = []
  if (length >= 4) {
    picks.push(lower[randomInt(0, lower.length - 1)]!)
    picks.push(upper[randomInt(0, upper.length - 1)]!)
    picks.push(digits[randomInt(0, digits.length - 1)]!)
    picks.push(symbols[randomInt(0, symbols.length - 1)]!)
  }
  while (picks.length < length) {
    picks.push(all[randomInt(0, all.length - 1)]!)
  }
  // Fisher–Yates shuffle
  for (let i = picks.length - 1; i > 0; i--) {
    const j = randomInt(0, i)
    ;[picks[i], picks[j]] = [picks[j]!, picks[i]!]
  }
  return picks.join('')
}

export function randomHex(byteCount: number): string {
  if (byteCount < 1 || byteCount > 1024) throw new Error('Invalid bytes')
  return Array.from(randomBytes(byteCount), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomColor(): string {
  return `#${randomHex(3)}`
}

export function randomBoolean(): string {
  return randomInt(0, 1) === 1 ? 'true' : 'false'
}

// ─── Param helpers ────────────────────────────────────────────────────────────

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function asInt(value: unknown, fallback: number): number {
  return Math.trunc(asNumber(value, fallback))
}

function parseCount(value: unknown): number {
  const n = asInt(value, 1)
  if (n < 1 || n > 100) throw new Error('COUNT')
  return n
}

function multi(count: number, gen: () => string): string {
  if (count === 1) return gen()
  const lines: string[] = []
  for (let i = 0; i < count; i++) lines.push(gen())
  return lines.join('\n')
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const randomPlugin = definePlugin({
  tools: [
    {
      id: 'random.integer',
      title: 'integer.title',
      subtitle: 'integer.description',
      icon: 'Dices',
      aliases: ['random int', 'rand int', '随机整数', '随机数'],
      params: [
        { key: 'min', label: 'param.min', type: 'number', default: 0 },
        { key: 'max', label: 'param.max', type: 'number', default: 100 },
        { key: 'count', label: 'param.count', type: 'number', default: 1 },
      ],
      run(ctx) {
        try {
          const min = asInt(ctx.params.min, 0)
          const max = asInt(ctx.params.max, 100)
          if (max < min) return ctx.output.error(ctx.t('error.range'))
          const count = parseCount(ctx.params.count)
          return ctx.output.text(multi(count, () => String(randomInt(min, max))))
        } catch (e: any) {
          if (e?.message === 'COUNT') return ctx.output.error(ctx.t('error.count'))
          return ctx.output.error(ctx.t('error.generate', { message: e.message }))
        }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'random.float',
      title: 'float.title',
      subtitle: 'float.description',
      icon: 'Dices',
      aliases: ['random float', 'random decimal', '随机小数', '随机浮点'],
      params: [
        { key: 'min', label: 'param.min', type: 'number', default: 0 },
        { key: 'max', label: 'param.max', type: 'number', default: 1 },
        { key: 'decimals', label: 'param.decimals', type: 'number', default: 2 },
        { key: 'count', label: 'param.count', type: 'number', default: 1 },
      ],
      run(ctx) {
        try {
          const min = asNumber(ctx.params.min, 0)
          const max = asNumber(ctx.params.max, 1)
          if (max < min) return ctx.output.error(ctx.t('error.range'))
          const decimals = asInt(ctx.params.decimals, 2)
          const count = parseCount(ctx.params.count)
          return ctx.output.text(multi(count, () => randomFloat(min, max, decimals)))
        } catch (e: any) {
          if (e?.message === 'COUNT') return ctx.output.error(ctx.t('error.count'))
          return ctx.output.error(ctx.t('error.generate', { message: e.message }))
        }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'random.string',
      title: 'string.title',
      subtitle: 'string.description',
      icon: 'Dices',
      aliases: ['random string', 'rand str', '随机字符串', '随机串'],
      params: [
        { key: 'length', label: 'param.length', type: 'number', default: 16 },
        {
          key: 'charset',
          label: 'param.charset',
          type: 'single-select',
          options: [
            { label: 'param.charset.alphanumeric', value: 'alphanumeric' },
            { label: 'param.charset.alpha', value: 'alpha' },
            { label: 'param.charset.numeric', value: 'numeric' },
            { label: 'param.charset.hex', value: 'hex' },
            { label: 'param.charset.base64url', value: 'base64url' },
            { label: 'param.charset.symbols', value: 'symbols' },
            { label: 'param.charset.lower', value: 'lower' },
            { label: 'param.charset.upper', value: 'upper' },
          ],
          default: 'alphanumeric',
        },
        { key: 'count', label: 'param.count', type: 'number', default: 1 },
      ],
      run(ctx) {
        try {
          const length = asInt(ctx.params.length, 16)
          if (length < 1 || length > 1024) return ctx.output.error(ctx.t('error.length'))
          const charset = String(ctx.params.charset ?? 'alphanumeric')
          const count = parseCount(ctx.params.count)
          return ctx.output.text(multi(count, () => randomString(length, charset)))
        } catch (e: any) {
          if (e?.message === 'COUNT') return ctx.output.error(ctx.t('error.count'))
          return ctx.output.error(ctx.t('error.generate', { message: e.message }))
        }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'random.uuid',
      title: 'uuid.title',
      subtitle: 'uuid.description',
      icon: 'Hash',
      aliases: ['uuid', 'guid', 'uuidv4', '随机uuid', '生成uuid'],
      params: [
        { key: 'count', label: 'param.count', type: 'number', default: 1 },
      ],
      run(ctx) {
        try {
          const count = parseCount(ctx.params.count)
          return ctx.output.text(multi(count, () => randomUuid()))
        } catch (e: any) {
          if (e?.message === 'COUNT') return ctx.output.error(ctx.t('error.count'))
          return ctx.output.error(ctx.t('error.generate', { message: e.message }))
        }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'random.password',
      title: 'password.title',
      subtitle: 'password.description',
      icon: 'KeyRound',
      aliases: ['password', 'passwd', '随机密码', '生成密码'],
      params: [
        { key: 'length', label: 'param.length', type: 'number', default: 16 },
        { key: 'count', label: 'param.count', type: 'number', default: 1 },
      ],
      run(ctx) {
        try {
          const length = asInt(ctx.params.length, 16)
          if (length < 1 || length > 1024) return ctx.output.error(ctx.t('error.length'))
          const count = parseCount(ctx.params.count)
          return ctx.output.text(multi(count, () => randomPassword(length)))
        } catch (e: any) {
          if (e?.message === 'COUNT') return ctx.output.error(ctx.t('error.count'))
          return ctx.output.error(ctx.t('error.generate', { message: e.message }))
        }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'random.hex',
      title: 'hex.title',
      subtitle: 'hex.description',
      icon: 'Binary',
      aliases: ['random hex', 'random bytes', '随机hex', '随机字节'],
      params: [
        { key: 'bytes', label: 'param.bytes', type: 'number', default: 16 },
        { key: 'count', label: 'param.count', type: 'number', default: 1 },
      ],
      run(ctx) {
        try {
          const bytes = asInt(ctx.params.bytes, 16)
          if (bytes < 1 || bytes > 1024) return ctx.output.error(ctx.t('error.bytes'))
          const count = parseCount(ctx.params.count)
          return ctx.output.text(multi(count, () => randomHex(bytes)))
        } catch (e: any) {
          if (e?.message === 'COUNT') return ctx.output.error(ctx.t('error.count'))
          return ctx.output.error(ctx.t('error.generate', { message: e.message }))
        }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'random.color',
      title: 'color.title',
      subtitle: 'color.description',
      icon: 'Palette',
      aliases: ['random color', 'random hex color', '随机颜色', '随机色值'],
      params: [
        { key: 'count', label: 'param.count', type: 'number', default: 1 },
      ],
      run(ctx) {
        try {
          const count = parseCount(ctx.params.count)
          return ctx.output.text(multi(count, () => randomColor()))
        } catch (e: any) {
          if (e?.message === 'COUNT') return ctx.output.error(ctx.t('error.count'))
          return ctx.output.error(ctx.t('error.generate', { message: e.message }))
        }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'random.boolean',
      title: 'boolean.title',
      subtitle: 'boolean.description',
      icon: 'ToggleLeft',
      aliases: ['random bool', 'random true false', '随机布尔', '随机真假'],
      params: [
        { key: 'count', label: 'param.count', type: 'number', default: 1 },
      ],
      run(ctx) {
        try {
          const count = parseCount(ctx.params.count)
          return ctx.output.text(multi(count, () => randomBoolean()))
        } catch (e: any) {
          if (e?.message === 'COUNT') return ctx.output.error(ctx.t('error.count'))
          return ctx.output.error(ctx.t('error.generate', { message: e.message }))
        }
      },
      surfaces: { launcher: true, panel: true },
    },
  ],
})

export default randomPlugin
