import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, EmptyState, PluginIcon, SearchField, SurfaceHeaderActions, SurfaceHeaderField, useShortcuts } from '@hiven/plugin-ui'
import { hitCopy, kindById, label, members, recent, search, secondary, tokens, visibleKind, type MemoDb, type MemoResult } from './model'
import { loadMemo, memoSnapshot, saveMemo, subscribeMemo, takePendingOpen } from './store'
import { CopyButton, Footer, Hl, useBackLayer, useCopy, type Host, type T } from './MemoParts'
import { DetailView, KindView, TextView } from './MemoViews'
import { DataEditor, TextEditor } from './MemoEditors'

export type Frame =
  | { v: 'home'; q: string; sel: number }
  | { v: 'detail'; id: string; q: string; sel: number }
  | { v: 'text'; id: string; q: string }
  | { v: 'kind'; kid: string; q: string; sel: number }
  | { v: 'edit'; mode: 'new' | 'sibling' | 'edit' | 'convert'; id?: string; source?: string }
  | { v: 'textEdit'; id?: string }

export type Nav = {
  push(frame: Frame): void
  back(): void
  replace(frame: Frame): void
  set(patch: Partial<Frame>): void
  /** After saving a sibling: show the kind table with the new record selected. */
  showKind(kindId: string, recordId: string): void
  open(result: MemoResult, query: string): void
}

export type ViewProps<F extends Frame = Frame> = {
  frame: F; nav: Nav; db: MemoDb; host: Host; t: T
  copy: (text: string, scope: string) => Promise<void>
  /** Persist a new db; false (with a toast) when storage refused it. */
  commit: (next: MemoDb) => Promise<boolean>
}

export function MemoSurface({ host, t }: PluginSurfaceProps) {
  const db = useSyncExternalStore(subscribeMemo, memoSnapshot)
  const [ready, setReady] = useState(false)
  const [stack, setStack] = useState<Frame[]>([{ v: 'home', q: '', sel: 0 }])
  const copy = useCopy(host, t)

  useEffect(() => {
    let live = true
    void loadMemo(host.storage).then(loaded => {
      if (!live) return
      setReady(true)
      // Opened from a root search result: land on that entry, query kept for highlighting.
      const pending = takePendingOpen()
      if (!pending) return
      if (pending.type === 'search') return setStack([{ v: 'home', q: pending.query, sel: 0 }])
      if (pending.type === 'kind') return void (kindById(loaded, pending.id) && setStack(current => [...current, { v: 'kind', kid: pending.id, q: '', sel: 0 }]))
      const record = loaded.records.find(item => item.id === pending.id)
      if (record) setStack(current => [...current, record.type === 'text' ? { v: 'text', id: record.id, q: pending.query } : { v: 'detail', id: record.id, q: pending.query, sel: 0 }])
    }).catch(() => { if (live) { setReady(true); host.showToast(t('error.load'), 'error') } })
    return () => { live = false }
  }, [host, t])

  const nav: Nav = {
    push: frame => setStack(current => [...current, frame]),
    back: () => setStack(current => current.length > 1 ? current.slice(0, -1) : (host.requestBack(), current)),
    replace: frame => setStack(current => [...current.slice(0, -1), frame]),
    set: patch => setStack(current => [...current.slice(0, -1), { ...current[current.length - 1], ...patch } as Frame]),
    showKind: (kindId, recordId) => setStack(current => {
      let next = current.slice(0, -1)
      if (next[next.length - 1]?.v === 'detail') next = next.slice(0, -1)
      const sel = Math.max(0, members(memoSnapshot(), kindById(memoSnapshot(), kindId)!).findIndex(record => record.id === recordId))
      const last = next[next.length - 1]
      return last?.v === 'kind' && last.kid === kindId ? [...next.slice(0, -1), { ...last, q: '', sel }] : [...next, { v: 'kind', kid: kindId, q: '', sel }]
    }),
    open: (result, q) => {
      if (result.type === 'kind') return nav.push({ v: 'kind', kid: result.kind.id, q: '', sel: 0 })
      const { record, hit } = result
      nav.push(record.type === 'text' ? { v: 'text', id: record.id, q } : { v: 'detail', id: record.id, q, sel: hit.kind === 'field' ? hit.index : 0 })
    },
  }
  const commit = (next: MemoDb) => saveMemo(host.storage, next).then(() => true, () => { host.showToast(t('error.save'), 'error'); return false })

  if (!ready) return <div className="memo-surface" />
  const frame = stack[stack.length - 1]
  const props = { nav, db, host, t, copy, commit }
  // A record deleted elsewhere: fall back to the previous page.
  const missing = (frame.v === 'detail' || frame.v === 'text') && !db.records.some(record => record.id === frame.id)
  if (missing) { queueMicrotask(nav.back); return <div className="memo-surface" /> }
  if (frame.v === 'kind') {
    const kind = kindById(db, frame.kid)
    const left = kind ? members(db, kind) : []
    // Back to one record: the table goes away, the kind's name and tags stay stored.
    if (left.length < 2) {
      queueMicrotask(() => left[0] ? nav.replace({ v: 'detail', id: left[0].id, q: '', sel: 0 }) : nav.back())
      return <div className="memo-surface" />
    }
  }
  const key = stack.length
  switch (frame.v) {
    case 'home': return <HomeView key={key} frame={frame} {...props} />
    case 'detail': return <DetailView key={key} frame={frame} {...props} />
    case 'text': return <TextView key={key} frame={frame} {...props} />
    case 'kind': return <KindView key={key} frame={frame} {...props} />
    case 'edit': return <DataEditor key={key} frame={frame} {...props} />
    case 'textEdit': return <TextEditor key={key} frame={frame} {...props} />
  }
}

export function resultSubtitle(db: MemoDb, result: MemoResult, words: string[], t: T) {
  if (result.type === 'kind') {
    const count = members(db, result.kind).length
    return <>{t('kind.count', { count })}{result.kind.tags.length > 0 && <> · <Hl text={result.kind.tags.join('、')} words={words} /></>}</>
  }
  const { record, hit } = result
  if (record.type === 'text') {
    const lines = record.text.split('\n').filter(line => line.trim())
    const line = hit.kind === 'line' && hit.index > 0 ? record.text.split('\n')[hit.index] : lines[1] ?? ''
    return <Hl text={line.length > 90 ? `${line.slice(0, 90)}…` : line} words={words} />
  }
  if (hit.kind === 'field') {
    const field = record.fields[hit.index]
    const rest = secondary(db, record, field)
    return <>{field.name} <Hl text={field.value.split('\n')[0]} words={words} />{rest && ` · ${rest}`}</>
  }
  if (hit.kind === 'tag') return <>{t(hit.own ? 'tag.own' : 'tag.shared')} <Hl text={hit.tag} words={words} /> · {secondary(db, record)}</>
  if (hit.kind === 'note') return <>{t('field.note')} <Hl text={record.note?.split('\n')[0] ?? ''} words={words} /></>
  return <>{secondary(db, record) || record.tags.join('、')}</>
}

export function resultKind(db: MemoDb, result: MemoResult, t: T): string {
  if (result.type === 'kind') return t('kind.sameKind')
  if (result.record.type === 'text') return t('type.text')
  const kind = visibleKind(db, result.record)
  return kind ? kindTitle(db, kind.id, t) : t('type.data')
}

export function kindTitle(db: MemoDb, kindId: string, t: T): string {
  const kind = kindById(db, kindId)!
  const list = members(db, kind)
  return kind.name || t('kind.unnamed', { first: list[0] ? label(db, list[0]) : '', count: list.length })
}

export const copyScope = (scope: string | null, t: T) => scope ?? t('scope.matchedLine')

function HomeView({ frame, nav, db, host, t, copy }: ViewProps<Extract<Frame, { v: 'home' }>>) {
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const words = tokens(frame.q)
  const items = words.length ? search(db, frame.q) : recent(db)
  const sel = Math.min(frame.sel, Math.max(0, items.length - 1))
  const current = items[sel]
  const currentCopy = current?.type === 'record' ? hitCopy(db, current.record, current.hit) : null
  const newText = () => nav.push({ v: 'textEdit' })
  const newData = () => nav.push({ v: 'edit', mode: 'new' })
  const copyCurrent = () => { if (current?.type === 'record' && currentCopy) void copy(currentCopy.text, copyScope(currentCopy.scope, t)) }

  const move = (step: number) => nav.set({ sel: Math.max(0, Math.min(items.length - 1, sel + step)) })
  const keys = useShortcuts({
    arrowdown: () => move(1),
    arrowup: () => move(-1),
    enter: () => { if (current) nav.open(current, frame.q) },
    'mod+c': copyCurrent,
    'mod+n': newText,
    'mod+shift+n': newData,
    'mod+k': () => menuRef.current?.click(),
  })
  useBackLayer(host, [root, input], keys.composingRef, frame.q !== '', () => nav.set({ q: '', sel: 0 }))

  return <div ref={root} className="memo-surface" tabIndex={-1} {...keys.handlers}>
    <SurfaceHeaderField>
      <SearchField ref={input} autoFocus data-plugin-surface-autofocus value={frame.q} placeholder={t('search.placeholder')}
        onChange={event => nav.set({ q: event.target.value, sel: 0 })} />
    </SurfaceHeaderField>
    <SurfaceHeaderActions>
      <Button variant="ghost" onMouseDown={event => event.preventDefault()} onClick={newText}>{t('action.newText')}<kbd>⌘</kbd><kbd>N</kbd></Button>
      <Button variant="ghost" onMouseDown={event => event.preventDefault()} onClick={newData}>{t('action.newData')}<kbd>⌘</kbd><kbd>⇧</kbd><kbd>N</kbd></Button>
    </SurfaceHeaderActions>
    <div className="memo-body" role="listbox" aria-label={t('surface.title')}>
      {!db.records.length && <EmptyState title={t('empty.title')} hint={t('empty.hint')} />}
      {db.records.length > 0 && !items.length && <EmptyState title={t('empty.noMatch', { query: frame.q })} hint={t('empty.searchHint')} />}
      {items.length > 0 && <div className="memo-list">
        <div className="hiven-row-group">{words.length ? t('list.results', { count: items.length }) : t('list.recent')}</div>
        {items.map((item, index) => {
          const itemCopy = item.type === 'record' ? hitCopy(db, item.record, item.hit) : null
          const title = item.type === 'kind' ? kindTitle(db, item.kind.id, t) : label(db, item.record) || t('type.emptyData')
          const icon = item.type === 'kind' ? 'Table2' : item.record.type === 'text' ? 'FileText' : 'IdCard'
          return <div key={item.type === 'kind' ? item.kind.id : item.record.id} role="option" aria-selected={index === sel}
            className={`hiven-row memo-row${index === sel ? ' is-selected' : ''}`}
            ref={element => { if (index === sel) element?.scrollIntoView({ block: 'nearest' }) }}
            onPointerMove={event => { if ((event.movementX || event.movementY) && index !== sel) nav.set({ sel: index }) }}
            onClick={() => nav.open(item, frame.q)}>
            <PluginIcon icon={icon} />
            <span className="hiven-row-text"><span><Hl text={title} words={words} /></span><small>{resultSubtitle(db, item, words, t)}</small></span>
            <span className="memo-row-kind">{resultKind(db, item, t)}</span>
            {itemCopy && <span onClick={event => event.stopPropagation()}>
              <CopyButton label={t('action.copyScope', { scope: copyScope(itemCopy.scope, t) })} copy={() => copy(itemCopy.text, copyScope(itemCopy.scope, t))} />
            </span>}
          </div>
        })}
      </div>}
    </div>
    <Footer t={t} menuRef={menuRef}
      actions={current ? [
        { label: t('action.open'), keys: '↵', run: () => nav.open(current, frame.q) },
        ...(currentCopy ? [{ label: t('action.copyScope', { scope: copyScope(currentCopy.scope, t) }), keys: '⌘ C', run: copyCurrent }] : []),
      ] : []}
      menu={[
        { key: 'text', label: t('action.newText'), onSelect: newText },
        { key: 'data', label: t('action.newData'), onSelect: newData },
      ]} />
  </div>
}
