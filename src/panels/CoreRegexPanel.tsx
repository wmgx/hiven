/**
 * FluxText Core - Core Regex Tester Panel
 * Wraps RegexTesterPanel for the new PanelPropsV2 interface.
 * Registered as 'core.regex-tester' in the production plugin registry.
 */
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { useAppStore } from '../store'
import { RegexTesterPanel } from './RegexTesterPanel'
import type { PanelPropsV2 } from '../workspace/pluginTypes'
import { t } from '../i18n'

export function CoreRegexPanel({ panelId, host }: PanelPropsV2<unknown>) {
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const locale = useAppStore((s) => s.locale)
  return (
    <RegexTesterPanel
      instanceId={panelId}
      title={t(locale, 'core.regexTester.title')}
      placement="bottom"
      props={{}}
      activePaneId={activePaneId}
      onClose={host.close}
    />
  )
}
