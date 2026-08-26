import {
  getHostAppLauncherDynamicItems,
  getHostAppLauncherStaticItems,
} from '../appLauncher/hostAppLauncher'
import { getKillProcessHostItem } from '../desktopControl/killProcessCommand'
import { getSwitchWindowHostItem } from '../desktopControl/switchWindowCommand'
import { getHostWindowLauncherDynamicItems } from '../desktopControl/windows'
import { getDesktopBridgeLauncherDynamicItems } from '../desktopTargets/collectBridgeLauncherItems'
import {
  registerDesktopTargetProvider,
} from '../desktopTargets/registry'
import { hostWindowTargetProvider } from '../desktopTargets/windowProvider'
import { registerDefaultWorkflowProviders } from '../../workflow/defaultWorkflowProviders'
import { getTextPipelineLauncherItems } from '../../workflow/pipelineLauncher'
import { registerBuiltinTextPipelines } from '../../workflow/pipeline'
import { getWorkflowObjectLauncherItems } from '../../workflow/workflowLauncherAdapter'
import {
  setHostLauncherDynamicItemsProvider,
  setHostLauncherItemsProvider,
} from './registry'
import { learnedLauncherItems } from '../learning/fire'
import { measureLauncherPerf } from './perf'
import { getHostExperienceJournalItems, getHostPaneControlItems, getHostSavedActionItems, getHostSystemPowerItems } from './hostActions'
import { registerPluginSurfacePanelProvider } from '../pluginSurfacePanelProvider'
import { registerWorkflowOutputShelfPanelProvider } from '../workflowOutputShelfPanelProvider'

export function registerHostLauncherProviders(): void {
  registerPluginSurfacePanelProvider()
  registerWorkflowOutputShelfPanelProvider()
  registerDefaultWorkflowProviders()
  registerBuiltinTextPipelines()
  // Host-owned desktop targets (window). Browser tabs are registered by the
  // first-party Browser plugin (web-open) via desktopTargets.registerProvider.
  registerDesktopTargetProvider(hostWindowTargetProvider)
  setHostLauncherItemsProvider(() => [
    ...getHostPaneControlItems(),
    ...getHostSystemPowerItems(),
    ...getHostExperienceJournalItems(),
    ...getHostSavedActionItems(),
    ...getHostAppLauncherStaticItems(),
    ...getTextPipelineLauncherItems(),
    // Kill Process: first-level command → collect-input second level (suggest list).
    getKillProcessHostItem(),
    // Switch Window: first-level command → collect-input second level (windows only).
    // Individual windows still appear in global mix via getHostWindowLauncherDynamicItems.
    getSwitchWindowHostItem(),
  ])
  setHostLauncherDynamicItemsProvider(async (ctx) => {
    // Process terminate is NOT first-level dynamic. Use getKillProcessHostItem (static).
    // Window focus: both static L2 command and first-level dynamic mix (below).
    // Empty open: apps only (memo top-N) + cached windows if any. No workflow, no waiting.
    // Query present: apps + windows + bridge tabs in parallel.
    // Slow remote document sources (feishu.docs) are NOT collected here — they stream
    // on a separate progressive path in useLauncherSession so typing stays responsive.
    const q = ctx.query.trim()
    return measureLauncherPerf(
      'host-provider:all',
      async () => {
        const appPromise = measureLauncherPerf('host-provider:app-items', () => getHostAppLauncherDynamicItems(ctx), (items) => ({
          queryLength: q.length,
          itemCount: items.length,
        }))
        const windowPromise = measureLauncherPerf('host-provider:window-items', () => getHostWindowLauncherDynamicItems(ctx), (items) => ({
          queryLength: q.length,
          itemCount: items.length,
        }))

        if (!q) {
          // Empty open path: skip workflow + bridge tabs (empty-search tabs = 0).
          const [appItems, windowItems] = await Promise.all([appPromise, windowPromise])
          return [...appItems, ...windowItems]
        }

        const workflowPromise = measureLauncherPerf('host-provider:workflow-items', () => getWorkflowObjectLauncherItems(ctx), (items) => ({
          queryLength: q.length,
          itemCount: items.length,
        })).catch((error) => {
          console.warn('[launcher] workflow dynamic items failed:', error)
          return [] as Awaited<ReturnType<typeof getWorkflowObjectLauncherItems>>
        })

        // D3: Chromium tabs only (never fan-out to all DesktopTarget providers).
        const bridgePromise = measureLauncherPerf(
          'host-provider:bridge-items',
          () => getDesktopBridgeLauncherDynamicItems(ctx),
          (items) => ({ queryLength: q.length, itemCount: items.length }),
        ).catch((error) => {
          console.warn('[launcher] desktop bridge dynamic items failed:', error)
          return [] as Awaited<ReturnType<typeof getDesktopBridgeLauncherDynamicItems>>
        })

        const [appItems, windowItems, workflowItems, bridgeItems] = await Promise.all([
          appPromise,
          windowPromise,
          workflowPromise,
          bridgePromise,
        ])

        // Learned direct answers (reverse fire): a typed id → open the discovered
        // page (D), or a matching input → the collapsed chain result (B). Sync +
        // cached, so it never adds latency to the query path.
        const learnedItems = learnedLauncherItems(q, ctx.locale)

        // Window vs tab de-dupe is soft ranking (title near-dup + capability tier),
        // not a host product filter that knows about browser plugins.
        return [
          ...learnedItems,
          ...workflowItems,
          ...appItems,
          ...windowItems,
          ...bridgeItems,
        ]
      },
      (items) => ({
        queryLength: q.length,
        itemCount: items.length,
        emptyOpen: !q,
      }),
    )
  })
}
