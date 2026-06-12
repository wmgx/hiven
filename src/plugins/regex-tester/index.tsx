/**
 * First-party Regex Tester plugin.
 *
 * Provides the regex tester command and panel, migrated from the internal
 * corePlugin to a standalone first-party plugin package.
 */

import { definePlugin, useT, type PanelPropsV2 } from '@hiven/plugin'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { RegexTesterPanel } from '../../panels/RegexTesterPanel'

function RegexTesterPluginPanel({ panelId, host }: PanelPropsV2<unknown>) {
  const activePaneId = useWorkspaceStore((state) => state.activePaneId)
  const t = useT('regex-tester')
  return (
    <RegexTesterPanel
      instanceId={panelId}
      title={t('panel.main.title')}
      placement="bottom"
      props={{}}
      activePaneId={activePaneId}
      onClose={host.close}
    />
  )
}

export const regexTesterPlugin = definePlugin({
  commands: [
    {
      id: 'regex-tester.open',
      title: 'command.open.title',
      description: 'command.open.description',
      icon: 'regex',
      aliases: ['regex', 'regexp', '正则'],
      live: { pinnable: false },
      run() {
        return {
          effects: [{
            type: 'panel.openV2' as const,
            panelId: 'regex-tester.panel',
            placement: 'bottom' as const,
            ownerPluginId: 'regex-tester',
          }],
        }
      },
    },
  ],
  panels: [
    {
      id: 'regex-tester.panel',
      title: 'panel.main.title',
      defaultPlacement: 'bottom',
      component: RegexTesterPluginPanel,
    },
  ],
})

export default regexTesterPlugin
