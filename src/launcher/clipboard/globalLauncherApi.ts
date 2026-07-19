/**
 * Global Launcher's PluginLauncherApi override.
 *
 * Wraps the shared base api (src/workspace/launcher/pluginApi.ts) and gives
 * returnToLauncher its real, product-specific meaning for this one surface:
 * turn the text into a tool-result Object Block and deliver it through the
 * existing pending-object-block bridge (already used by clipboard-history's
 * "return to launcher" flow — see doc/2026-07-19-clipboard-history-return-to-launcher-design.md).
 *
 * Wired in via useLauncherSession's `makeApi` option, same pattern as Quick
 * Editor's command bar (src/workspace/quickEditor/quickEditorActions.ts
 * createQuickEditorLauncherApi).
 */

import { createToolResultObjectBlock } from './objectBlock'
import { setPendingObjectBlock } from './pendingObjectBlock'
import type { PluginLauncherApi } from '../../workspace/launcher/types'

export function createGlobalLauncherPluginApi(baseApi: PluginLauncherApi): PluginLauncherApi {
  return {
    ...baseApi,
    returnToLauncher: async (text: string) => {
      setPendingObjectBlock(createToolResultObjectBlock(text))
    },
  }
}
