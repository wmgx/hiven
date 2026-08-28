/**
 * Self-learning · local store (P1, generic — no product semantics).
 *
 * Runtime-readable IndexedDB for the passive-observation timeline: shape-only
 * events (never raw text) and verified pairs. Separate from the write-only
 * telemetry NDJSON. Every op is fail-soft — it must never throw into the
 * background clipboard poll / observer.
 *
 * Privacy: events store {featureSig, detectedType, saltedHash, ts, context}.
 * Raw clipboard text is never persisted; the salt is per-device, local-only.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §12.2.
 */

import { isForgettable } from './frecency'
import type { NavigationRecord } from './urlTemplate'

export interface ObservationContext {
  foregroundApp?: string
  browserUrlShape?: string
}

export interface ObservationEvent {
  id?: number
  ts: number
  featureSig: string
  detectedType: string
  /** Salted, non-reversible hash for de-dup only — not the raw text. */
  saltedHash: string
  context?: ObservationContext
}

export interface LearnedPair {
  id?: number
  ts: number
  kind: 'transform' | 'chain' | 'content-url'
  /** Feature signature of the input (C0). */
  inSig: string
  toolId?: string
  toolIds?: string[]
  template?: string
  captureKind?: string
  /**
   * Salted, non-reversible hash of the input (not raw text). Lets clustering
   * count *distinct* inputs so one blob transformed repeatedly isn't mistaken
   * for independent evidence. Optional: pairs written before P2 lack it.
   */
  inHash?: string
}

/**
 * A structured, locale-agnostic description of a rule (parsed back from the
 * feature signature) — the UI renders it via i18n so a persisted rule reads
 * correctly in any locale. We never persist a rendered human string.
 */
/** How a learned rule decides an input matches it. */
export type RuleMatcher =
  | { kind: 'feature-sig'; sig: string }
  /**
   * Scenario D reverse-fire: match any token of this kind (e.g. any number →
   * open MR page). `sourceHost`, when present, narrows this to scenario L1/L2:
   * fire only when the token's own copy-time site matches — see fire.ts's
   * sourceHostForQuery.
   */
  | { kind: 'token'; tokenKind: string; sourceHost?: string }

/** What a learned rule does once it matches. */
export type RuleTransform =
  | { kind: 'tool'; toolId: string }
  | { kind: 'chain'; toolIds: string[] }
  | { kind: 'url-template'; template: string; slotKind: string }

export interface RuleDescriptor {
  charset: string
  lenBucket: string
  flags: string[]
  transform: RuleTransform
}

/** A user-confirmed learned rule (P2 output; consumed by P3 direct-answer fire). */
export interface LearnedRule {
  id?: number
  /** Links back to the originating cluster (dedup + suppression). */
  clusterKey: string
  /** Denormalized matcher sig for the fire-path index. */
  matcherSig: string
  matcher: RuleMatcher
  transform: RuleTransform
  descriptor: RuleDescriptor
  /** frecency weight, adjusted by P3 feedback. */
  strength: number
  origin: 'learned'
  /**
   * Learned passively without the user confirming (the default path since the
   * proposal card was removed). Drives the "newly learned" badge and the lower
   * initial strength — see proposals.ts.
   */
  autoLearned?: boolean
  createdAt: number
  lastUsedAt?: number
  sampleCount: number
  /**
   * How many times this rule actually fired. Drives the "newly learned" badge:
   * a silently-learned rule stays visibly marked (and one-key undoable) for its
   * first few hits, then blends in. Absent on rules created before this existed.
   */
  fireCount?: number
}

/** A cluster the user rejected — never propose it again. */
export interface Suppression {
  clusterKey: string
  ts: number
}

const DB_NAME = 'hiven-learning'
const DB_VERSION = 5
const STORE_EVENTS = 'events'
const STORE_PAIRS = 'pairs'
const STORE_RULES = 'rules'
const STORE_SUPPRESSIONS = 'suppressions'
const STORE_NAV = 'navigations'
const STORE_PATHS = 'paths'
const SALT_KEY = 'hiven:learning:salt'
const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const NAV_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const PAIR_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          const store = db.createObjectStore(STORE_EVENTS, { keyPath: 'id', autoIncrement: true })
          store.createIndex('featureSig', 'featureSig', { unique: false })
          store.createIndex('ts', 'ts', { unique: false })
        }
        if (!db.objectStoreNames.contains(STORE_PAIRS)) {
          const store = db.createObjectStore(STORE_PAIRS, { keyPath: 'id', autoIncrement: true })
          store.createIndex('inSig', 'inSig', { unique: false })
          store.createIndex('kind', 'kind', { unique: false })
          store.createIndex('ts', 'ts', { unique: false })
        } else if (request.transaction) {
          // v5: pairs never had a TTL — the set only ever grew, so periodic
          // clustering re-scanned an unbounded table. Add the `ts` index (data
          // already has the field) so pruneOldPairs can sweep it like the
          // other timelines.
          const store = request.transaction.objectStore(STORE_PAIRS)
          if (!store.indexNames.contains('ts')) {
            store.createIndex('ts', 'ts', { unique: false })
          }
        }
        // v2: user-confirmed rules + rejected-cluster suppressions.
        if (!db.objectStoreNames.contains(STORE_RULES)) {
          const store = db.createObjectStore(STORE_RULES, { keyPath: 'id', autoIncrement: true })
          store.createIndex('clusterKey', 'clusterKey', { unique: true })
          store.createIndex('matcherSig', 'matcherSig', { unique: false })
        }
        if (!db.objectStoreNames.contains(STORE_SUPPRESSIONS)) {
          db.createObjectStore(STORE_SUPPRESSIONS, { keyPath: 'clusterKey' })
        }
        // v3: passively observed navigations (scenario D — template discovery).
        if (!db.objectStoreNames.contains(STORE_NAV)) {
          const store = db.createObjectStore(STORE_NAV, { keyPath: 'id', autoIncrement: true })
          store.createIndex('template', 'template', { unique: false })
          store.createIndex('ts', 'ts', { unique: false })
        }
        // v4: per-segment path hashes for position-variance induction — finds
        // TEXT variables that no single-URL shape heuristic can recognize.
        // Hashes only; distinct-counting needs equality, not the values.
        if (!db.objectStoreNames.contains(STORE_PATHS)) {
          const store = db.createObjectStore(STORE_PATHS, { keyPath: 'id', autoIncrement: true })
          store.createIndex('host', 'host', { unique: false })
          store.createIndex('ts', 'ts', { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function objectStore(db: IDBDatabase, store: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store)
}

function awaitRequest(request: IDBRequest): Promise<void> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
  })
}

// ─── salt / hash ──────────────────────────────────────────────────────────────

function getSalt(): string {
  try {
    let salt = localStorage.getItem(SALT_KEY)
    if (!salt) {
      salt = Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem(SALT_KEY, salt)
    }
    return salt
  } catch {
    return 'ephemeral-salt'
  }
}

function djb2Hex(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
  }
  return (hash >>> 0).toString(16)
}

/** Non-reversible, salted content hash (de-dup / privacy — not cryptographic). */
export function saltedHash(text: string): string {
  return djb2Hex(`${getSalt()}\u0000${text}`)
}

// ─── writes / reads (all fail-soft) ───────────────────────────────────────────

export async function putEvent(event: ObservationEvent): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await awaitRequest(objectStore(db, STORE_EVENTS, 'readwrite').add(event))
  } catch {
    // fail-soft
  }
}

export async function putPair(pair: LearnedPair): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await awaitRequest(objectStore(db, STORE_PAIRS, 'readwrite').add(pair))
  } catch {
    // fail-soft
  }
}

export async function queryPairsByInSig(inSig: string): Promise<LearnedPair[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const request = objectStore(db, STORE_PAIRS, 'readonly').index('inSig').getAll(inSig)
      request.onsuccess = () => resolve((request.result as LearnedPair[]) ?? [])
      request.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

/** All verified pairs — clustering (P2) reads the whole set to find candidates. */
export async function queryAllPairs(): Promise<LearnedPair[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const request = objectStore(db, STORE_PAIRS, 'readonly').getAll()
      request.onsuccess = () => resolve((request.result as LearnedPair[]) ?? [])
      request.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

/**
 * Count recent observation events per featureSig — the denominator for the
 * over-broad matcher check (a sig that appears constantly but rarely pairs would
 * over-fire, so its rule must be rejected). Bounded to the newest `limit` events.
 */
export async function countEventSigs(limit = 500): Promise<Record<string, number>> {
  const db = await openDb()
  if (!db) return {}
  return new Promise((resolve) => {
    const counts: Record<string, number> = {}
    try {
      // Walk newest-first via the ts index; stop after `limit` events.
      const request = objectStore(db, STORE_EVENTS, 'readonly')
        .index('ts')
        .openCursor(null, 'prev')
      let seen = 0
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor && seen < limit) {
          const sig = (cursor.value as ObservationEvent).featureSig
          if (sig) counts[sig] = (counts[sig] ?? 0) + 1
          seen += 1
          cursor.continue()
        } else {
          resolve(counts)
        }
      }
      request.onerror = () => resolve(counts)
    } catch {
      resolve(counts)
    }
  })
}

export async function pruneOldEvents(now: number = Date.now()): Promise<void> {
  const db = await openDb()
  if (!db) return
  const cutoff = now - EVENT_TTL_MS
  try {
    const request = objectStore(db, STORE_EVENTS, 'readwrite')
      .index('ts')
      .openCursor(IDBKeyRange.upperBound(cutoff))
    await new Promise<void>((resolve) => {
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }
      request.onerror = () => resolve()
    })
  } catch {
    // fail-soft
  }
}

// ─── rules (P2 output) ─────────────────────────────────────────────────────────

/** Persist a user-confirmed rule. `clusterKey` is unique — a re-accept updates. */
export async function putRule(rule: LearnedRule): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await awaitRequest(objectStore(db, STORE_RULES, 'readwrite').put(rule))
  } catch {
    // fail-soft
  }
}

export async function queryAllRules(): Promise<LearnedRule[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const request = objectStore(db, STORE_RULES, 'readonly').getAll()
      request.onsuccess = () => resolve((request.result as LearnedRule[]) ?? [])
      request.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

export async function deleteRule(id: number): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await awaitRequest(objectStore(db, STORE_RULES, 'readwrite').delete(id))
  } catch {
    // fail-soft
  }
}

/** Frecency feedback: a rule fired → bump its strength + last-used time. */
export async function bumpRuleStrength(
  clusterKey: string,
  delta: number,
  now: number = Date.now(),
): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    const store = objectStore(db, STORE_RULES, 'readwrite')
    await new Promise<void>((resolve) => {
      const request = store.index('clusterKey').get(clusterKey)
      request.onsuccess = () => {
        const rule = request.result as LearnedRule | undefined
        if (!rule) {
          resolve()
          return
        }
        rule.strength = Math.max(0, rule.strength + delta)
        rule.lastUsedAt = now
        rule.fireCount = (rule.fireCount ?? 0) + 1
        const put = store.put(rule)
        put.onsuccess = () => resolve()
        put.onerror = () => resolve()
      }
      request.onerror = () => resolve()
    })
  } catch {
    // fail-soft
  }
}

/** Forget rules that have decayed below the floor (unused long enough). */
export async function pruneForgottenRules(now: number = Date.now()): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    const store = objectStore(db, STORE_RULES, 'readwrite')
    await new Promise<void>((resolve) => {
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          const rule = cursor.value as LearnedRule
          if (isForgettable(rule, now)) cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }
      request.onerror = () => resolve()
    })
  } catch {
    // fail-soft
  }
}

// ─── suppressions (rejected clusters) ──────────────────────────────────────────

/** Record that the user rejected a cluster — never propose it again. Idempotent. */
export async function addSuppression(clusterKey: string, now: number = Date.now()): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await awaitRequest(
      objectStore(db, STORE_SUPPRESSIONS, 'readwrite').put({ clusterKey, ts: now } as Suppression),
    )
  } catch {
    // fail-soft
  }
}

export async function queryAllSuppressions(): Promise<Suppression[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const request = objectStore(db, STORE_SUPPRESSIONS, 'readonly').getAll()
      request.onsuccess = () => resolve((request.result as Suppression[]) ?? [])
      request.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

/** Lift a suppression so its cluster can be proposed again. */
export async function removeSuppression(clusterKey: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await awaitRequest(objectStore(db, STORE_SUPPRESSIONS, 'readwrite').delete(clusterKey))
  } catch {
    // fail-soft
  }
}

// ─── navigations (scenario D — template discovery) ─────────────────────────────

/** Record a passively observed navigation (template + salted slot hash, no raw URL). */
export async function putNavigation(nav: NavigationRecord): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await awaitRequest(objectStore(db, STORE_NAV, 'readwrite').add(nav))
  } catch {
    // fail-soft
  }
}

export async function queryNavigations(): Promise<NavigationRecord[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const request = objectStore(db, STORE_NAV, 'readonly').getAll()
      request.onsuccess = () => resolve((request.result as NavigationRecord[]) ?? [])
      request.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

// ─── path observations (position-variance induction) ──────────────────────────

/** One visited path reduced to per-segment salted hashes. Never raw segments. */
export interface PathObservationRecord {
  host: string
  segmentHashes: string[]
  ts: number
}

export async function putPathObservation(observation: PathObservationRecord): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await awaitRequest(objectStore(db, STORE_PATHS, 'readwrite').add(observation))
  } catch {
    // fail-soft
  }
}

export async function queryPathObservations(): Promise<PathObservationRecord[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const request = objectStore(db, STORE_PATHS, 'readonly').getAll()
      request.onsuccess = () => resolve((request.result as PathObservationRecord[]) ?? [])
      request.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

/** Both navigation stores share the same retention window. */
async function pruneStoreByTs(storeName: string, cutoff: number): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    const request = objectStore(db, storeName, 'readwrite')
      .index('ts')
      .openCursor(IDBKeyRange.upperBound(cutoff))
    await new Promise<void>((resolve) => {
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }
      request.onerror = () => resolve()
    })
  } catch {
    // fail-soft
  }
}

export async function pruneOldNavigations(now: number = Date.now()): Promise<void> {
  const cutoff = now - NAV_TTL_MS
  await pruneStoreByTs(STORE_NAV, cutoff)
  await pruneStoreByTs(STORE_PATHS, cutoff)
}

/**
 * Bound the verified-pairs timeline. Without this, `queryAllPairs` (read by
 * every periodic auto-learn pass) grows for as long as the app is installed —
 * the full-table scan and clustering over it get slower release over release.
 */
export async function pruneOldPairs(now: number = Date.now()): Promise<void> {
  const cutoff = now - PAIR_TTL_MS
  await pruneStoreByTs(STORE_PAIRS, cutoff)
}

// ─── one-time cleanup: stale number-slot ("n") learning history ───────────────

/**
 * Pure digits are no longer classified as an identifier slot (see
 * urlTemplate.classifyPathSegment) — a page number, a quantity and an MR
 * number are indistinguishable strings, and in practice this was the noisiest
 * matcher. This purges what was already learned under the old, more permissive
 * classifier: url-template rules and navigation evidence keyed on slot kind
 * `'n'`. Runs once (localStorage-gated); string-shaped rules (hex/uuid/id/slug)
 * are untouched.
 */
const NUMBER_SLOT_PURGE_FLAG = 'hiven:learning:purged-number-slot-v1'

function isNumberSlotRule(rule: LearnedRule): boolean {
  if (rule.matcher.kind === 'token' && rule.matcher.tokenKind === 'n') return true
  if (rule.transform.kind === 'url-template' && rule.transform.slotKind === 'n') return true
  return false
}

async function purgeMatchingCursor<T>(
  db: IDBDatabase,
  storeName: string,
  isStale: (value: T) => boolean,
): Promise<void> {
  try {
    const store = objectStore(db, storeName, 'readwrite')
    await new Promise<void>((resolve) => {
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          if (isStale(cursor.value as T)) cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }
      request.onerror = () => resolve()
    })
  } catch {
    // fail-soft
  }
}

export async function purgeNumberSlotHistoryOnce(): Promise<void> {
  try {
    if (localStorage.getItem(NUMBER_SLOT_PURGE_FLAG)) return
  } catch {
    return
  }
  const db = await openDb()
  if (!db) return
  await purgeMatchingCursor<LearnedRule>(db, STORE_RULES, isNumberSlotRule)
  await purgeMatchingCursor<NavigationRecord>(db, STORE_NAV, (nav) => (nav.slotKind as string | undefined) === 'n')
  try {
    localStorage.setItem(NUMBER_SLOT_PURGE_FLAG, String(Date.now()))
  } catch {
    // fail-soft
  }
}
