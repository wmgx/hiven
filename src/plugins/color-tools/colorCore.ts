import Color from 'colorjs.io'

export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'oklch'

export type ColorAnswer = {
  hex: string
  icon: string
  /** Bare CSS names (red, tan, gold) are ordinary words too, so they must not outrank other results. */
  direct: boolean
  formats: Array<{ format: ColorFormat; text: string }>
}

type ParsedColor = { rgb: number[]; alpha: number; source: ColorFormat | 'name' }

function number(value: number, decimals = 6): string {
  return String(Number(value.toFixed(decimals)))
}

const NUMBER = /^-?\d+(?:\.\d+)?$/
const BYTE_HEX = (value: number): string => Math.round(value).toString(16).padStart(2, '0').toUpperCase()

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1
  const percent = token.endsWith('%')
  const raw = percent ? token.slice(0, -1) : token
  if (!NUMBER.test(raw)) return null
  const value = Number(raw) / (percent ? 100 : 1)
  return value >= 0 && value <= 1 ? value : null
}

function functionArgs(literal: string, names: string): string[] | null {
  const match = new RegExp(`^(?:${names})\\(([^()]*)\\)$`, 'i').exec(literal)
  if (!match) return null
  const tokens = match[1].trim().split(/\s*[,/]\s*|\s+/).filter(Boolean)
  return tokens.length === 3 || tokens.length === 4 ? tokens : null
}

function parseHex(literal: string): ParsedColor | null {
  const bare = !literal.startsWith('#')
  const digits = bare ? literal : literal.slice(1)
  if (!(bare ? /^(?:[\da-f]{6}|[\da-f]{8})$/i : /^(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i).test(digits)) return null
  // Without '#', plain numbers and 6-letter words (decade, facade) must not turn into colors.
  if (bare && (/^\d+$/.test(digits) ? digits.replace(/0/g, '') !== '' : !/\d/.test(digits) && new Set(digits.toLowerCase()).size > 2)) return null
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits
  const bytes = [0, 2, 4, 6].map((start) => (start < full.length ? parseInt(full.slice(start, start + 2), 16) : 255))
  return { rgb: bytes.slice(0, 3), alpha: bytes[3] / 255, source: 'hex' }
}

function parseRgb(literal: string): ParsedColor | null {
  const args = functionArgs(literal, 'rgba?')
  if (!args) return null
  const channels = args.slice(0, 3)
  if (!channels.every((token) => NUMBER.test(token) && Number(token) >= 0 && Number(token) <= 255)) return null
  const alpha = parseAlpha(args[3])
  return alpha === null ? null : { rgb: channels.map(Number), alpha, source: 'rgb' }
}

function parseHsl(literal: string): ParsedColor | null {
  const args = functionArgs(literal, 'hsla?')
  if (!args) return null
  const hue = args[0].replace(/deg$/i, '')
  const [s, l] = [args[1], args[2]]
  if (!NUMBER.test(hue) || !/^\d+(?:\.\d+)?%$/.test(s) || !/^\d+(?:\.\d+)?%$/.test(l)) return null
  const [sat, light] = [Number(s.slice(0, -1)), Number(l.slice(0, -1))]
  const alpha = parseAlpha(args[3])
  if (sat > 100 || light > 100 || alpha === null) return null
  const coords = new Color('hsl', [((Number(hue) % 360) + 360) % 360, sat, light]).to('srgb').coords
  return { rgb: coords.map((value) => Math.round(Math.min(1, Math.max(0, value ?? 0)) * 255)), alpha, source: 'hsl' }
}

function parseName(literal: string): ParsedColor | null {
  if (!/^[a-z]+$/i.test(literal)) return null
  try {
    const color = new Color(literal.toLowerCase())
    if (color.spaceId !== 'srgb' || color.alpha < 1) return null
    return { rgb: color.coords.map((value) => Math.round((value ?? 0) * 255)), alpha: 1, source: 'name' }
  } catch {
    return null
  }
}

/** Explicit sRGB literals only (hex, rgb(), hsl(), CSS names); never parse arbitrary CSS. */
export function colorAnswer(input: string): ColorAnswer | null {
  if (input.length > 64) return null
  const literal = input.trim()
  const parsed = parseHex(literal) ?? parseRgb(literal) ?? parseHsl(literal) ?? parseName(literal)
  if (!parsed) return null
  const { rgb, alpha } = parsed
  const hex = `#${rgb.map(BYTE_HEX).join('')}${alpha < 1 ? BYTE_HEX(alpha * 255) : ''}`
  const color = new Color('srgb', [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255], alpha)
  const suffix = alpha < 1 ? ` / ${number(alpha)}` : ''
  const [h, s, l] = color.to('hsl').coords
  const [okL, okC, okH] = color.to('oklch').coords
  // Hue is powerless for achromatic colors. Stable zero avoids NaN and tiny
  // conversion residuals; the actual conversion stays entirely in Color.js.
  const gray = rgb[0] === rgb[1] && rgb[1] === rgb[2]
  const hslHue = gray ? 0 : h
  const oklchHue = gray ? 0 : okH
  const chroma = gray ? 0 : okC
  if (hslHue === null || s === null || l === null || okL === null || chroma === null || oklchHue === null
    || ![hslHue, s, l, okL, chroma, oklchHue, alpha].every(Number.isFinite)) return null
  const all: ColorAnswer['formats'] = [
    { format: 'hex', text: hex },
    { format: 'rgb', text: `rgb(${rgb.join(' ')}${suffix})` },
    { format: 'hsl', text: `hsl(${number(hslHue, 4)} ${number(s, 4)}% ${number(l, 4)}%${suffix})` },
    { format: 'oklch', text: `oklch(${number(okL * 100)}% ${number(chroma)} ${number(oklchHue, 4)}${suffix})` },
  ]
  // Offer every other representation; hex input keeps the historical rgb/hsl/oklch trio.
  const formats = all.filter((entry) => entry.format !== parsed.source)
  // Fixed local SVG, generated only from validated hex bytes/numeric alpha.
  // Checkerboard makes transparent colors visible; no external resources or CSS.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#fff" d="M0 0h24v24H0z"/><path fill="#bbb" d="M0 0h12v12H0zM12 12h12v12H12z"/><path fill="${hex.slice(0, 7)}" fill-opacity="${number(alpha)}" d="M0 0h24v24H0z"/><rect x=".5" y=".5" width="23" height="23" rx="3" fill="none" stroke="#808080"/></svg>`
  return { hex, formats, direct: parsed.source !== 'name', icon: `data:image/svg+xml,${encodeURIComponent(svg)}` }
}
