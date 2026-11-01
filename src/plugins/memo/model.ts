// Memo data model. Pure functions only: the surface, the launcher items and the
// tests all go through here, so "a kind exists only with two members" lives in one place.

export type MemoField = { id: string; name: string; value: string }
export type MemoText = { id: string; type: 'text'; text: string; tags: string[]; updated: number }
export type MemoData = {
  id: string
  type: 'data'
  fields: MemoField[]
  tags: string[]
  note: string | null
  /** Set once a second record of the same kind was saved; kept when members drop back to one. */
  kindId?: string
  /** Field name used to identify this record while it stands alone. */
  idField?: string
  updated: number
}
export type MemoRecord = MemoText | MemoData
export type MemoKind = { id: string; name: string; tags: string[]; order: string[]; idField: string }
export type MemoDb = { records: MemoRecord[]; kinds: MemoKind[] }

export type MemoHit =
  | { kind: 'field'; index: number; score: number }
  | { kind: 'line'; index: number; score: number }
  | { kind: 'tag'; tag: string; own: boolean; score: number }
  | { kind: 'note'; score: number }
  | { kind: 'none'; score: number }
export type MemoResult = { type: 'record'; record: MemoRecord; hit: MemoHit } | { type: 'kind'; kind: MemoKind }

export const EMPTY_DB: MemoDb = { records: [], kinds: [] }

export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

const isString = (value: unknown): value is string => typeof value === 'string'
const strings = (value: unknown) => Array.isArray(value) ? value.filter(isString) : []

/** Accept whatever storage returned; drop malformed entries instead of failing the whole plugin. */
export function readDb(value: unknown): MemoDb {
  if (!value || typeof value !== 'object') return EMPTY_DB
  const raw = value as { records?: unknown; kinds?: unknown }
  const records = (Array.isArray(raw.records) ? raw.records : []).flatMap((item): MemoRecord[] => {
    if (!item || typeof item !== 'object' || !isString(item.id)) return []
    const updated = typeof item.updated === 'number' ? item.updated : 0
    if (item.type === 'text' && isString(item.text)) return [{ id: item.id, type: 'text', text: item.text, tags: strings(item.tags), updated }]
    if (item.type !== 'data' || !Array.isArray(item.fields)) return []
    const fields = item.fields.filter((field: unknown): field is MemoField => !!field && typeof field === 'object'
      && isString((field as MemoField).id) && isString((field as MemoField).name) && isString((field as MemoField).value))
      .map(({ id, name, value }: MemoField) => ({ id, name, value }))
    return [{
      id: item.id, type: 'data', fields, tags: strings(item.tags), note: isString(item.note) ? item.note : null, updated,
      ...(isString(item.kindId) ? { kindId: item.kindId } : {}), ...(isString(item.idField) ? { idField: item.idField } : {}),
    }]
  })
  const kinds = (Array.isArray(raw.kinds) ? raw.kinds : []).flatMap((item): MemoKind[] => !item || typeof item !== 'object' || !isString(item.id) ? [] : [{
    id: item.id, name: isString(item.name) ? item.name : '', tags: strings(item.tags), order: strings(item.order), idField: isString(item.idField) ? item.idField : '',
  }])
  return { records, kinds }
}

// ─── Identity ────────────────────────────────────────────────────────────────

export const kindById = (db: MemoDb, id?: string) => id ? db.kinds.find(kind => kind.id === id) : undefined
export const members = (db: MemoDb, kind: MemoKind) => db.records.filter((record): record is MemoData => record.type === 'data' && record.kindId === kind.id)
/** The kind the user can see: only when it really has two or more records. */
export function visibleKind(db: MemoDb, record: MemoRecord): MemoKind | undefined {
  if (record.type !== 'data') return undefined
  const kind = kindById(db, record.kindId)
  return kind && members(db, kind).length >= 2 ? kind : undefined
}

const isShort = (value: string) => !!value && !value.includes('\n') && value.length <= 40
// Names that rarely identify a record: notes and secrets.
const WEAK_NAME = /备注|密码|说明|note|password|secret/i

export function identField(db: MemoDb, record: MemoData): MemoField | undefined {
  const kind = visibleKind(db, record)
  const preferred = (kind && kind.idField) || record.idField
  return (preferred ? record.fields.find(field => field.name === preferred && field.value) : undefined)
    ?? record.fields.find(field => isShort(field.value) && !WEAK_NAME.test(field.name))
    ?? record.fields.find(field => field.value)
}

/** First non-empty line, joined with the second when it is too short to recognise. */
export function summary(text: string, max = 60): string {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  let line = lines[0] ?? ''
  if (line.length < 4 && lines[1]) line = `${line} ${lines[1]}`
  return line.length > max ? `${line.slice(0, max)}…` : line
}

export function label(db: MemoDb, record: MemoRecord): string {
  if (record.type === 'text') return summary(record.text)
  const field = identField(db, record)
  return field ? summary(field.value) : ''
}

/** Two short values beside the identity, so same-named records can be told apart. */
export function secondary(db: MemoDb, record: MemoData, skip?: MemoField): string {
  const id = identField(db, record)
  return record.fields.filter(field => field !== id && field !== skip && isShort(field.value) && !WEAK_NAME.test(field.name))
    .slice(0, 2).map(field => field.value).join(' · ')
}

/** Columns for the kind table: identity plus up to three short common fields. */
export function kindColumns(db: MemoDb, kind: MemoKind): string[] {
  const list = members(db, kind)
  const first = list[0]
  const idName = kind.idField || (first && identField(db, first)?.name) || kind.order[0] || ''
  const rest = kind.order.filter(name => name !== idName && !WEAK_NAME.test(name)
    && list.every(record => { const value = record.fields.find(field => field.name === name)?.value ?? ''; return !value || isShort(value) }))
  return [idName, ...rest.slice(0, 3)].filter(Boolean)
}

// ─── Search ──────────────────────────────────────────────────────────────────

export const tokens = (query: string) => query.trim().toLowerCase().split(/\s+/).filter(Boolean)
const recordText = (record: MemoRecord) => (record.type === 'text'
  ? [record.text, ...record.tags]
  : [...record.fields.flatMap(field => [field.name, field.value]), ...record.tags, record.note ?? '']).join('\n').toLowerCase()
const kindText = (kind?: MemoKind) => kind ? [kind.name, ...kind.tags].join('\n').toLowerCase() : ''

export function hitOf(db: MemoDb, record: MemoRecord, words: string[]): MemoHit {
  if (record.type === 'text') {
    const index = record.text.split('\n').findIndex(line => words.some(word => line.toLowerCase().includes(word)))
    return index >= 0 ? { kind: 'line', index, score: 1 } : { kind: 'none', score: 0 }
  }
  let index = -1
  let score = 0
  record.fields.forEach((field, i) => {
    const value = field.value.toLowerCase()
    for (const word of words) {
      const next = value === word ? 3 : value.startsWith(word) ? 2 : value.includes(word) ? 1 : 0
      if (next > score) { score = next; index = i }
    }
  })
  if (index >= 0) return { kind: 'field', index, score }
  const kindTags = kindById(db, record.kindId)?.tags ?? []
  const tag = [...record.tags, ...kindTags].find(item => words.some(word => item.toLowerCase().includes(word)))
  if (tag) return { kind: 'tag', tag, own: record.tags.includes(tag), score: 1 }
  if (record.note && words.some(word => record.note!.toLowerCase().includes(word))) return { kind: 'note', score: 1 }
  return { kind: 'none', score: 0 }
}

/**
 * Every word must match inside one record (its kind's name and tags count as its
 * context). A query answered by the kind alone returns the kind once.
 */
export function search(db: MemoDb, query: string): MemoResult[] {
  const words = tokens(query)
  if (!words.length) return []
  const kinds = new Set<string>()
  const records: Array<{ type: 'record'; record: MemoRecord; hit: MemoHit }> = []
  for (const record of db.records) {
    const own = recordText(record)
    const context = record.type === 'data' ? kindText(kindById(db, record.kindId)) : ''
    if (!words.every(word => own.includes(word) || context.includes(word))) continue
    const kind = visibleKind(db, record)
    if (kind && words.every(word => context.includes(word))) { kinds.add(kind.id); continue }
    records.push({ type: 'record', record, hit: hitOf(db, record, words) })
  }
  records.sort((a, b) => b.hit.score - a.hit.score || b.record.updated - a.record.updated)
  return [...[...kinds].map(id => ({ type: 'kind' as const, kind: kindById(db, id)! })), ...records]
}

/** Recent list: a visible kind shows once, where its newest member would be. */
export function recent(db: MemoDb): MemoResult[] {
  const seen = new Set<string>()
  return [...db.records].sort((a, b) => b.updated - a.updated).flatMap((record): MemoResult[] => {
    const kind = visibleKind(db, record)
    if (!kind) return [{ type: 'record', record, hit: { kind: 'none', score: 0 } }]
    if (seen.has(kind.id)) return []
    seen.add(kind.id)
    return [{ type: 'kind', kind }]
  })
}

/** What Enter / the row copy button copies for a search result, and its scope. */
export function hitCopy(db: MemoDb, record: MemoRecord, hit: MemoHit): { text: string; scope: string | null } {
  if (record.type === 'text') return hit.kind === 'line' ? { text: record.text.split('\n')[hit.index], scope: null } : { text: record.text, scope: null }
  const field = hit.kind === 'field' ? record.fields[hit.index] : identField(db, record)
  return { text: field?.value ?? '', scope: field?.name ?? null }
}

/** "name: value" per line, then the note and every tag in effect. */
export function wholeText(db: MemoDb, record: MemoRecord, tagLabel: string, noteLabel: string): string {
  if (record.type === 'text') return record.text
  const lines = record.fields.filter(field => field.value).map(field => `${field.name}: ${field.value.replace(/\n/g, '\n  ')}`)
  if (record.note) lines.push(`${noteLabel}:\n${record.note}`)
  const tags = [...new Set([...(visibleKind(db, record)?.tags ?? []), ...record.tags])]
  if (tags.length) lines.push(`${tagLabel}: ${tags.join(', ')}`)
  return lines.join('\n')
}

// ─── Writes (each returns a new db) ──────────────────────────────────────────

export type DataDraft = { fields: Array<MemoField & { original?: string }>; tags: string[]; note: string | null }
export type DraftError = 'empty' | 'missingName'

export function validateDraft(draft: DataDraft): DraftError | null {
  if (!draft.fields.some(field => field.value.trim()) && !draft.note?.trim()) return 'empty'
  if (draft.fields.some(field => field.value.trim() && !field.name.trim())) return 'missingName'
  return null
}

const cleanFields = (draft: DataDraft): MemoField[] => draft.fields
  .filter(field => field.name.trim() || field.value.trim())
  .map(({ id, name, value }) => ({ id, name: name.trim(), value }))
const cleanNote = (note: string | null) => note?.trim() ? note : null

export const replaceRecord = (db: MemoDb, record: MemoRecord): MemoDb =>
  ({ ...db, records: db.records.map(item => item.id === record.id ? record : item) })
export const updateKind = (db: MemoDb, id: string, patch: (kind: MemoKind) => MemoKind): MemoDb =>
  ({ ...db, kinds: db.kinds.map(kind => kind.id === id ? patch(kind) : kind) })

export function addData(db: MemoDb, draft: DataDraft, now = Date.now()): { db: MemoDb; id: string } {
  const id = newId('d')
  return { db: { ...db, records: [...db.records, { id, type: 'data', fields: cleanFields(draft), tags: draft.tags, note: cleanNote(draft.note), updated: now }] }, id }
}

/**
 * Save the next record of the same kind. The kind is created here, at save time,
 * so a cancelled or failed draft never leaves a visible group behind.
 */
export function addSibling(db: MemoDb, sourceId: string, draft: DataDraft, now = Date.now()): { db: MemoDb; id: string; kindId: string } {
  const source = db.records.find(record => record.id === sourceId)
  if (!source || source.type !== 'data') throw new Error('memo source missing')
  let next = db
  let kindId = source.kindId
  if (!kindId || !kindById(db, kindId)) {
    kindId = newId('k')
    next = {
      kinds: [...db.kinds, { id: kindId, name: '', tags: [], order: source.fields.map(field => field.name), idField: source.idField ?? '' }],
      records: db.records.map(record => record.id === source.id ? { ...source, kindId } : record),
    }
  }
  const added = addData(next, draft, now)
  return { db: { ...added.db, records: added.db.records.map(record => record.id === added.id ? { ...record, kindId } as MemoData : record) }, id: added.id, kindId }
}

/** Renaming a shared field renames it for every member, so no value goes missing. */
export function editData(db: MemoDb, id: string, draft: DataDraft, now = Date.now()): { db: MemoDb; renamed: number } {
  const record = db.records.find(item => item.id === id)
  if (!record || record.type !== 'data') throw new Error('memo record missing')
  const kind = visibleKind(db, record)
  const renames = new Map(kind ? draft.fields.filter(field => field.original && field.name.trim() && field.original !== field.name.trim() && kind.order.includes(field.original))
    .map(field => [field.original!, field.name.trim()]) : [])
  let next = replaceRecord(db, { ...record, fields: cleanFields(draft), tags: draft.tags, note: cleanNote(draft.note), updated: now })
  if (kind && renames.size) {
    next = updateKind(next, kind.id, item => ({ ...item, order: item.order.map(name => renames.get(name) ?? name), idField: renames.get(item.idField) ?? item.idField }))
    next = { ...next, records: next.records.map(item => item.type === 'data' && item.kindId === kind.id && item.id !== id
      ? { ...item, fields: item.fields.map(field => renames.has(field.name) ? { ...field, name: renames.get(field.name)! } : field) } : item) }
  }
  return { db: next, renamed: kind && renames.size ? members(next, kind).length : 0 }
}

/** Make a field only one member has into a shared one; the others get it empty. */
export function shareField(db: MemoDb, kindId: string, name: string): MemoDb {
  const next = updateKind(db, kindId, kind => kind.order.includes(name) ? kind : { ...kind, order: [...kind.order, name] })
  return { ...next, records: next.records.map(record => record.type === 'data' && record.kindId === kindId && !record.fields.some(field => field.name === name)
    ? { ...record, fields: [...record.fields, { id: newId('f'), name, value: '' }] } : record) }
}

export const removeRecord = (db: MemoDb, id: string): MemoDb => ({ ...db, records: db.records.filter(record => record.id !== id) })
