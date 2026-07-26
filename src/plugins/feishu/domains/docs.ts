/**
 * Feishu docs domain: search via lark-cli and map to DesktopTarget-like objects.
 */

import { stripSearchHighlight } from '../cli/parse'
import { runLarkCli, type LarkCliShell } from '../cli/run'

export type FeishuDocsSearchHit = {
  entity_type?: string
  title_highlighted?: string
  title?: string
  result_meta?: {
    token?: string
    url?: string
    owner_name?: string
    owner?: string
  }
  token?: string
  url?: string
}

export type FeishuDocsTarget = {
  id: string
  sourceId: 'feishu.docs'
  kind: 'document'
  title: string
  subtitle?: string
  keywords?: string[]
  meta: { url: string }
  actionClass: 'open'
  icon?: string
}

export async function searchDocs(options: {
  shell: LarkCliShell
  query: string
  binaryPath?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<{ ok: boolean; results: FeishuDocsSearchHit[]; message?: string; code?: string | number }> {
  const query = options.query.trim()
  if (!query) {
    return { ok: true, results: [] }
  }

  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args: ['docs', '+search', '--query', query, '--as', 'user'],
    timeoutMs: options.timeoutMs ?? 8000,
    signal: options.signal,
    risk: 'read',
  })

  if (!result.ok) {
    return {
      ok: false,
      results: [],
      message: result.message,
      code: result.code,
    }
  }

  const results = extractResults(result.data)
  return { ok: true, results }
}

function extractResults(data: unknown): FeishuDocsSearchHit[] {
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  const list =
    (Array.isArray(obj.results) && obj.results) ||
    (Array.isArray(obj.items) && obj.items) ||
    (obj.data && typeof obj.data === 'object' && Array.isArray((obj.data as Record<string, unknown>).results)
      ? ((obj.data as Record<string, unknown>).results as unknown[])
      : null)
  if (!list) return []
  return list.filter((item): item is FeishuDocsSearchHit => item != null && typeof item === 'object') as FeishuDocsSearchHit[]
}

/**
 * Map CLI search hits to DesktopTarget-like document targets.
 * Filters out hits without a usable URL. Strips title highlight tags (&lt;h&gt;…&lt;/h&gt;).
 */
export function mapSearchResultsToTargets(results: FeishuDocsSearchHit[]): FeishuDocsTarget[] {
  const out: FeishuDocsTarget[] = []
  for (const hit of results) {
    const url = hit.result_meta?.url ?? hit.url
    if (!url || typeof url !== 'string') continue

    const token =
      hit.result_meta?.token ??
      hit.token ??
      safeTokenFromUrl(url) ??
      String(out.length)

    const rawTitle = hit.title_highlighted ?? hit.title ?? token
    const title = stripSearchHighlight(String(rawTitle)) || token
    const entity = hit.entity_type ?? 'DOC'
    const owner = hit.result_meta?.owner_name ?? hit.result_meta?.owner
    const subtitle = owner ? `${entity} · ${owner}` : String(entity)

    out.push({
      id: `feishu.docs:document:${token}`,
      sourceId: 'feishu.docs',
      kind: 'document',
      title,
      subtitle,
      keywords: [title, entity, owner ?? '', url].filter(Boolean),
      meta: { url },
      actionClass: 'open',
      icon: 'FileText',
    })
  }
  return out
}

function safeTokenFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    return parts[parts.length - 1]
  } catch {
    return undefined
  }
}
