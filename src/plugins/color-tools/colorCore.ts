import Color from 'colorjs.io'

export type ColorFormat = 'rgb' | 'hsl' | 'oklch'

export type ColorAnswer = {
  hex: string
  icon: string
  formats: Array<{ format: ColorFormat; text: string }>
}

function number(value: number, decimals = 6): string {
  return String(Number(value.toFixed(decimals)))
}

/** Only explicit sRGB hex literals trigger suggestions; never parse arbitrary CSS. */
export function colorAnswer(input: string): ColorAnswer | null {
  if (input.length > 64) return null
  const literal = input.trim()
  if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(literal)) return null
  const digits = literal.slice(1).toUpperCase()
  const hex = `#${digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits}`
  const color = new Color(hex)
  const alpha = color.alpha
  const suffix = alpha < 1 ? ` / ${number(alpha)}` : ''
  const rgb = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16))
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
  const formats: ColorAnswer['formats'] = [
    { format: 'rgb', text: `rgb(${rgb.join(' ')}${suffix})` },
    { format: 'hsl', text: `hsl(${number(hslHue, 4)} ${number(s, 4)}% ${number(l, 4)}%${suffix})` },
    { format: 'oklch', text: `oklch(${number(okL * 100)}% ${number(chroma)} ${number(oklchHue, 4)}${suffix})` },
  ]
  // Fixed local SVG, generated only from validated hex bytes/numeric alpha.
  // Checkerboard makes transparent colors visible; no external resources or CSS.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#fff" d="M0 0h24v24H0z"/><path fill="#bbb" d="M0 0h12v12H0zM12 12h12v12H12z"/><path fill="${hex.slice(0, 7)}" fill-opacity="${number(alpha)}" d="M0 0h24v24H0z"/><rect x=".5" y=".5" width="23" height="23" rx="3" fill="none" stroke="#808080"/></svg>`
  return { hex, formats, icon: `data:image/svg+xml,${encodeURIComponent(svg)}` }
}
