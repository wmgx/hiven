/**
 * Plugin Source Resolution
 *
 * Resolves the *real* settings source for a plugin: 'builtin' | 'installed' | 'dev'.
 * Do not collapse every non-dev plugin to 'builtin' — installed plugins must read
 * their own persisted settings, not builtin defaults.
 */

import type { ContributionSource } from '../pluginTypes'
import { usePluginStore } from '../pluginStore'

export type PluginSettingsSource = 'builtin' | 'installed' | 'dev'

/**
 * Resolve the settings source for a plugin given the registry contribution
 * source. Dev contributions are always 'dev'. Production contributions are
 * 'installed' if the plugin store records a non-builtin install, otherwise
 * 'builtin'.
 */
export function resolvePluginSettingsSource(
  pluginId: string,
  contributionSource: ContributionSource,
): PluginSettingsSource {
  if (contributionSource === 'dev') return 'dev'
  const installed = usePluginStore.getState().plugins[pluginId]
  if (installed && installed.source !== 'builtin') return 'installed'
  return 'builtin'
}
