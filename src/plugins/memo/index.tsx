import type { LauncherDynamicContext, LauncherItemContribution, PluginDefinition } from '@hiven/plugin'
import { hitCopy, label, members, search, secondary, visibleKind, type MemoDb, type MemoResult } from './model'
import { loadMemo, requestOpen } from './store'
import { MemoSurface, kindTitle } from './MemoSurface'
import './style.css'

const ROOT_LIMIT = 3

function subtitle(db: MemoDb, result: MemoResult, t: LauncherDynamicContext['t']): string {
  if (result.type === 'kind') return t('kind.count', { count: members(db, result.kind).length })
  const { record, hit } = result
  if (record.type === 'text') {
    const line = hit.kind === 'line' && hit.index > 0 ? record.text.split('\n')[hit.index] : record.text.split('\n').filter(item => item.trim())[1] ?? ''
    return line.trim()
  }
  if (hit.kind === 'field') {
    const field = record.fields[hit.index]
    return [`${field.name} ${field.value.split('\n')[0]}`, secondary(db, record, field)].filter(Boolean).join(' · ')
  }
  if (hit.kind === 'tag') return [`${t(hit.own ? 'tag.own' : 'tag.shared')} ${hit.tag}`, secondary(db, record)].filter(Boolean).join(' · ')
  return secondary(db, record)
}

/** Terms the host may rank on, so a hit on a hidden field still counts as a match. */
function terms(db: MemoDb, result: MemoResult): string[] {
  if (result.type === 'kind') return [result.kind.name, ...result.kind.tags].filter(Boolean)
  const { record } = result
  const kindTags = record.type === 'data' ? visibleKind(db, record)?.tags ?? [] : []
  const values = record.type === 'text' ? record.text.split('\n') : record.fields.map(field => field.value)
  return [...values, ...record.tags, ...kindTags].map(value => value.trim()).filter(Boolean).slice(0, 40)
}

function rootItem(db: MemoDb, result: MemoResult, query: string, ctx: LauncherDynamicContext): LauncherItemContribution {
  const t = ctx.t
  const open = (opened: Parameters<typeof requestOpen>[0]) => (run: { api: LauncherDynamicContext['api'] }) => {
    requestOpen(opened)
    run.api.openSurface('main')
    return { ok: true as const, keepOpen: true }
  }
  if (result.type === 'kind') {
    return {
      id: `memo-kind.${result.kind.id}`,
      display: { title: kindTitle(db, result.kind.id, t), subtitle: subtitle(db, result, t), icon: 'Table2', aliases: terms(db, result), kindLabel: t('launcher.kind', { kind: t('kind.sameKind') }) },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      execute: open({ type: 'kind', id: result.kind.id, query }),
    }
  }
  const { record, hit } = result
  const copied = hitCopy(db, record, hit)
  const kind = record.type === 'data' ? visibleKind(db, record) : undefined
  return {
    id: `memo.${record.id}`,
    display: {
      title: label(db, record) || t('type.emptyData'),
      subtitle: subtitle(db, result, t),
      icon: record.type === 'text' ? 'FileText' : 'IdCard',
      aliases: terms(db, result),
      kindLabel: t('launcher.kind', { kind: record.type === 'text' ? t('type.text') : kind ? kindTitle(db, kind.id, t) : t('type.data') }),
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    // ↵ copies what matched; ⇥ opens the full record.
    async execute(run) {
      await run.api.copyText(copied.text)
      return { ok: true }
    },
    executeWithParams: open({ type: 'record', id: record.id, query }),
  }
}

const definition: PluginDefinition = {
  ui: {
    surfaces: [{
      id: 'main',
      kind: 'custom-view',
      title: 'Memo',
      titleI18n: { zh: '备忘录', en: 'Memo' },
      icon: 'StickyNote',
      aliases: ['memo', 'note', 'notes', '备忘', '备忘录', 'bw', 'bwl'],
      component: MemoSurface,
      entry: { launcher: { surfaces: ['global-launcher'] }, shortcutBindable: true },
      // Stays open while the user copies things from other apps.
      shell: { size: 'large' as const, inlineHeight: 640, closeOnBlur: false, resizable: false },
    }],
  },
  launcher: {
    async dynamicItems(ctx: LauncherDynamicContext): Promise<LauncherItemContribution[]> {
      const query = ctx.query.trim()
      if (query.length < 2 || query.includes('\n')) return []
      const db = await loadMemo(ctx.storage).catch(() => null)
      if (!db || ctx.signal?.aborted) return []
      const results = search(db, query)
      const items = results.slice(0, ROOT_LIMIT).map(result => rootItem(db, result, query, ctx))
      if (results.length > ROOT_LIMIT) {
        items.push({
          id: 'memo-more',
          display: { title: ctx.t('launcher.more', { count: results.length }), icon: 'StickyNote', aliases: [query], kindLabel: ctx.t('launcher.kind', { kind: ctx.t('surface.title') }) },
          behavior: { type: 'perform' },
          surfaces: ['global-launcher'],
          execute(run) {
            requestOpen({ type: 'search', query })
            run.api.openSurface('main')
            return { ok: true, keepOpen: true }
          },
        })
      }
      return items
    },
  },
}

export default definition
