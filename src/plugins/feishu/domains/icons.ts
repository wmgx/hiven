/**
 * Icons for Feishu L1/L2 results: document type glyphs, chat avatars, person initials.
 * Host `resolveIcon` accepts lucide names, http(s) URLs, and data:image/* URLs.
 */

/** Map Feishu entity / doc_types to a lucide icon name. */
export function iconForFeishuDoc(options: {
  entityType?: string
  docTypes?: string
  iconInfo?: unknown
}): string {
  const entity = String(options.entityType ?? '').toUpperCase()
  const docTypes = String(options.docTypes ?? '').toUpperCase()
  const fromInfo = parseIconInfoObjType(options.iconInfo)

  const token = docTypes || entity || fromInfo || ''

  if (/SHEET|SPREADSHEET|EXCEL|CSV/.test(token)) return 'Sheet'
  if (/BITABLE|BASE|MULTI/.test(token)) return 'Table2'
  if (/SLIDE|PPT|PRESENTATION/.test(token)) return 'Presentation'
  if (/MIND|MINDMAP|MINDNOTE/.test(token)) return 'GitBranch'
  if (/BOARD|WHITEBOARD|CANVAS/.test(token)) return 'Paintbrush'
  if (/FOLDER/.test(token)) return 'Folder'
  if (/FILE|ATTACHMENT/.test(token)) return 'Paperclip'
  if (/WIKI|KNOWLEDGE/.test(token)) return 'BookOpen'
  if (/DOCX|DOC|DOCUMENT/.test(token)) return 'FileText'
  if (/SHORTCUT/.test(token)) return 'Link2'
  return 'FileText'
}

function parseIconInfoObjType(iconInfo: unknown): string {
  if (!iconInfo) return ''
  let obj: Record<string, unknown> | null = null
  if (typeof iconInfo === 'string') {
    try {
      obj = JSON.parse(iconInfo) as Record<string, unknown>
    } catch {
      return ''
    }
  } else if (typeof iconInfo === 'object') {
    obj = iconInfo as Record<string, unknown>
  }
  if (!obj) return ''
  // Feishu obj_type numbers (common subset)
  const n = Number(obj.obj_type ?? obj.objType ?? NaN)
  switch (n) {
    case 2:
      return 'DOC'
    case 3:
      return 'SHEET'
    case 8:
      return 'BITABLE'
    case 11:
      return 'MINDNOTE'
    case 12:
      return 'FILE'
    case 15:
      return 'SLIDES'
    case 22:
      return 'WIKI'
    default:
      return String(obj.file_type ?? obj.fileType ?? '')
  }
}

export function isHttpIconUrl(url: string | undefined | null): url is string {
  if (!url || typeof url !== 'string') return false
  const t = url.trim()
  return t.startsWith('https://') || t.startsWith('http://') || t.startsWith('data:image/')
}

/** Prefer remote avatar URL; else generate a stable initials SVG avatar. */
export function iconForPerson(options: {
  name: string
  id?: string
  avatarUrl?: string | null
}): string {
  if (isHttpIconUrl(options.avatarUrl)) return options.avatarUrl.trim()
  return initialsAvatarDataUrl(options.name, options.id ?? options.name)
}

export function iconForChat(options: {
  name: string
  id?: string
  avatarUrl?: string | null
}): string {
  if (isHttpIconUrl(options.avatarUrl)) return options.avatarUrl.trim()
  // Same as people: stable colored initials. Lucide MessagesSquare is nearly
  // invisible on the dark launcher charcoal face next to colorful avatars.
  return initialsAvatarDataUrl(options.name, options.id ?? options.name)
}

/** Deterministic pastel SVG circle with 1–2 initials (works offline, no CLI). */
export function initialsAvatarDataUrl(name: string, seed: string): string {
  const initials = pickInitials(name)
  const color = colorFromSeed(seed || name)
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`,
    `<circle cx="32" cy="32" r="32" fill="${color}"/>`,
    `<text x="32" y="34" text-anchor="middle" dominant-baseline="middle" `,
    `font-family="system-ui,-apple-system,sans-serif" font-size="24" font-weight="600" fill="#fff">`,
    escapeXml(initials),
    `</text></svg>`,
  ].join('')
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function pickInitials(name: string): string {
  const cleaned = name.replace(/[\s\-_/·|]+/g, ' ').trim()
  if (!cleaned) return '?'
  // CJK: first 1–2 chars
  if (/[\u4e00-\u9fff]/.test(cleaned)) {
    return cleaned.slice(0, 2)
  }
  const parts = cleaned.split(' ').filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return cleaned.slice(0, 2).toUpperCase()
}

function colorFromSeed(seed: string): string {
  // Pleasant, readable pastels
  const palette = [
    '#5B8FF9',
    '#5AD8A6',
    '#F6BD16',
    '#E8684A',
    '#6DC8EC',
    '#9270CA',
    '#FF9D4D',
    '#269A99',
    '#FF99C3',
    '#BDEFDB',
  ]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
