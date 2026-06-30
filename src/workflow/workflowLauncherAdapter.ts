import { searchableFieldsMatch, type SearchableFields } from '../workspace/searchRanking'
import { t, type Locale } from '../i18n'
import type { LauncherItem, LauncherResultChoice } from '../workspace/launcher/types'
import { resolveIconForWorkObject } from './workObjectDisplay'
import { createDefaultWorkContextSnapshot } from '../launcher/context/contextBroker'
import { collectWorkObjects, getWorkActions } from './workflowRegistry'
import type { WorkAction, WorkContext } from './workAction'
import type { WorkObject } from './workObject'

const MAX_OBJECT_ITEMS = 12

export async function getWorkflowObjectLauncherItems({
  query,
  locale,
}: {
  query: string
  locale: Locale
}): Promise<LauncherItem[]> {
  const normalizedQuery = query.trim()
  const allObjects = await collectWorkObjects()
  const visibleObjects = allObjects
    .filter((object) => normalizedQuery ? objectMatchesQuery(object, normalizedQuery, locale) : isDefaultContextObject(object))
    .slice(0, MAX_OBJECT_ITEMS)

  return visibleObjects.map((object) => workObjectToLauncherItem(object, locale))
}

function workObjectToLauncherItem(object: WorkObject, locale: Locale): LauncherItem {
  return {
    systemKey: `workflow:object:${object.id}`,
    kind: 'dynamic',
    display: {
      title: object.title,
      subtitle: object.subtitle,
      icon: resolveIconForWorkObject(object),
      aliases: aliasesForObject(object),
      kindLabel: kindLabelForObject(object, locale),
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    pinnable: false,
    metadata: {
      kind: 'workflow-object',
      objectId: object.id,
      objectType: object.type,
    },
    execute: async () => {
      const ctx: WorkContext = {
        snapshot: await createDefaultWorkContextSnapshot('global-hotkey'),
      }
      const actions = await getWorkActions(object, ctx)
      // When only one action is available, execute it directly without a secondary selection step
      if (actions.length === 1) {
        const result = await actions[0].run(object, ctx)
        return { ok: result?.ok !== false }
      }
      return {
        ok: true,
        output: {
          choices: actions.map((action) => actionToChoice(action, object, ctx)),
        },
        keepOpen: true,
      }
    },
  }
}

function actionToChoice(action: WorkAction, object: WorkObject, ctx: WorkContext): LauncherResultChoice {
  return {
    id: `${object.id}:${action.id}`,
    title: action.title,
    subtitle: actionChoiceSubtitle(action, object),
    metadata: {
      kind: 'workflow-action',
      objectId: object.id,
      actionId: action.id,
      outputTarget: action.defaultOutputTarget,
    },
    primaryAction: async () => action.run(object, ctx),
  }
}

function actionChoiceSubtitle(action: WorkAction, object: WorkObject): string {
  const output = action.defaultOutputTarget ? ` · Output: ${action.defaultOutputTarget}` : ''
  return `${object.title}${output}`
}

function objectMatchesQuery(object: WorkObject, query: string, locale: Locale): boolean {
  return searchableFieldsMatch(searchFieldsForObject(object), query.toLowerCase(), locale)
}

function searchFieldsForObject(object: WorkObject): SearchableFields {
  return {
    id: object.id,
    title: object.title,
    aliases: aliasesForObject(object),
  }
}

function aliasesForObject(object: WorkObject): string[] {
  const aliases = [object.subtitle, object.source, object.type]
  if (object.type === 'text') aliases.push(object.text)
  if (object.type === 'clipboard') aliases.push(object.preview, 'clipboard', 'paste', '剪贴板', '粘贴')
  if (object.type === 'app') aliases.push(object.bundleId, object.executablePath, 'app', 'application', '应用')
  if (object.type === 'editor-document') aliases.push(object.paneId, object.language, 'editor', '编辑器')
  if (object.type === 'url') aliases.push(object.url)
  return aliases.filter((value): value is string => Boolean(value))
}

function kindLabelForObject(object: WorkObject, locale: Locale): string | undefined {
  if (object.type === 'window' && object.id.startsWith('editor')) return t(locale, 'palette.kindEditor')
  return undefined
}

function isDefaultContextObject(object: WorkObject): boolean {
  return object.source.startsWith('context.')
}
