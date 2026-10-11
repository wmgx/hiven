export type PermissionGroup = { read: boolean; write: boolean; execute: boolean; symbolic: string }
export type PermissionValue = {
  octal: string
  symbolic: string
  owner: PermissionGroup
  group: PermissionGroup
  others: PermissionGroup
  setuid: boolean
  setgid: boolean
  sticky: boolean
}
export type PermissionAnswer = { ok: true; value: PermissionValue } | { ok: false; error: 'syntax' | 'octal' | 'symbolic' }

export function decodePermissions(mode: number): PermissionValue {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) throw new RangeError('permission-mode')
  const setuid = Boolean(mode & 0o4000), setgid = Boolean(mode & 0o2000), sticky = Boolean(mode & 0o1000)
  const part = (bits: number, special: boolean, marker: 's' | 't'): PermissionGroup => {
    const read = Boolean(bits & 4), write = Boolean(bits & 2), execute = Boolean(bits & 1)
    const symbolic = (read ? 'r' : '-') + (write ? 'w' : '-') + (special ? (execute ? marker : marker.toUpperCase()) : execute ? 'x' : '-')
    return { read, write, execute, symbolic }
  }
  const owner = part(mode >> 6 & 7, setuid, 's'), group = part(mode >> 3 & 7, setgid, 's'), others = part(mode & 7, sticky, 't')
  return { octal: mode.toString(8).padStart(4, '0'), symbolic: owner.symbolic + group.symbolic + others.symbolic, owner, group, others, setuid, setgid, sticky }
}

export function parsePermissionQuery(query: string): PermissionAnswer | null {
  const trimmed = query.trim()
  const prefix = /^(?:chmod\b|(?:unix\s+)?permissions?(?:\s+(?:parser|parse|explain))?(?=\s|\d|$)|(?:unix\s*)?权限(?:解析)?(?=\s|\d|$))\s*/i.exec(trimmed)
  if (!prefix && !/^[rwxstST-]{9}$/.test(trimmed)) return null
  const input = prefix ? trimmed.slice(prefix[0].length) : trimmed
  if (/^\d+$/.test(input)) {
    if (!/^[0-7]{3,4}$/.test(input)) return { ok: false, error: 'octal' }
    return { ok: true, value: decodePermissions(Number.parseInt(input, 8)) }
  }
  if (input.length === 9 && /^[rwxstST-]+$/.test(input)) {
    if (!/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(input)) return { ok: false, error: 'symbolic' }
    let mode = 0
    for (let index = 0; index < 3; index++) {
      const part = input.slice(index * 3, index * 3 + 3)
      const bits = (part[0] === 'r' ? 4 : 0) | (part[1] === 'w' ? 2 : 0) | (/[xst]/.test(part[2]) ? 1 : 0)
      mode |= bits << (6 - index * 3)
      if (/[sStT]/.test(part[2])) mode |= [0o4000, 0o2000, 0o1000][index]
    }
    return { ok: true, value: decodePermissions(mode) }
  }
  return { ok: false, error: 'syntax' }
}
