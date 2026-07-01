import type { ContextRequirement, WorkAction, WorkActionProvider, WorkContext } from './workAction'
import type { WorkObject, WorkObjectProvider } from './workObject'
import { launcherPerfNow, logLauncherPerfDuration } from '../workspace/launcher/perf'

const objectProviders: WorkObjectProvider[] = []
const actionProviders: WorkActionProvider[] = []

export function registerWorkObjectProvider(provider: WorkObjectProvider): void {
  const index = objectProviders.findIndex((item) => item.id === provider.id)
  if (index >= 0) objectProviders[index] = provider
  else objectProviders.push(provider)
}

export function registerWorkActionProvider(provider: WorkActionProvider): void {
  const index = actionProviders.findIndex((item) => item.id === provider.id)
  if (index >= 0) actionProviders[index] = provider
  else actionProviders.push(provider)
}

export function getWorkObjectProviders(): readonly WorkObjectProvider[] {
  return objectProviders
}

export function getWorkActionProviders(): readonly WorkActionProvider[] {
  return actionProviders
}

export async function collectWorkObjects(): Promise<WorkObject[]> {
  const groups = await Promise.all(
    objectProviders.map(async (provider) => {
      const startedAt = launcherPerfNow()
      try {
        const objects = await Promise.resolve(provider.collect())
        logLauncherPerfDuration('workflow:object-provider', startedAt, {
          providerId: provider.id,
          objectCount: objects.length,
        })
        return objects
      } catch (error) {
        logLauncherPerfDuration('workflow:object-provider', startedAt, {
          providerId: provider.id,
          failed: true,
          message: error instanceof Error ? error.message : String(error),
        })
        console.warn(`[workflow] object provider "${provider.id}" failed:`, error)
        return []
      }
    }),
  )
  return groups.flat()
}

export async function getWorkActions(input: WorkObject, ctx: WorkContext): Promise<WorkAction[]> {
  const groups = await Promise.all(
    actionProviders.map(async (provider) => {
      try {
        return await Promise.resolve(provider.getActions(input, ctx))
      } catch (error) {
        console.warn(`[workflow] action provider "${provider.id}" failed:`, error)
        return []
      }
    }),
  )
  return filterActionsForContextRequirements(filterActionsForObjectType(groups.flat(), input), ctx)
}

function filterActionsForObjectType(actions: WorkAction[], input: WorkObject): WorkAction[] {
  return actions.filter((action) => action.accepts.includes(input.type))
}

function filterActionsForContextRequirements(actions: WorkAction[], ctx: WorkContext): WorkAction[] {
  return actions.filter(
    (action) =>
      !action.requiresContext ||
      action.requiresContext.every((requirement) => contextRequirementSatisfied(requirement, ctx)),
  )
}

function contextRequirementSatisfied(requirement: ContextRequirement, ctx: WorkContext): boolean {
  switch (requirement.kind) {
    case 'selected-text':
      // [DISABLED] externalSelection check — only editor selection is active now
      return Boolean(ctx.snapshot.editor?.selectedText)
    case 'clipboard':
      return Boolean(ctx.snapshot.clipboard)
    case 'editor-pane':
      return Boolean(ctx.snapshot.editor)
    case 'foreground-app':
      return Boolean(ctx.snapshot.foreground)
  }
}
