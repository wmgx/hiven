/**
 * hiven Workspace Extension - Panel Registry
 * Registry for panel contributions (like Regex Tester, Find Replace).
 */

import type { ComponentType } from 'react'
import type { PanelPlacement, PanelBinding, PaneId } from './types'

export type PanelComponentProps = {
  instanceId: string
  title: string
  placement: PanelPlacement
  bind?: PanelBinding
  props: Record<string, unknown>
  activePaneId: PaneId
  onClose: () => void
}

export type PanelContribution = {
  id: string
  title: string
  defaultPlacement: PanelPlacement
  defaultScope?: 'pane' | 'workspace' | 'presentation'
  component: ComponentType<PanelComponentProps>
}

const registry = new Map<string, PanelContribution>()

export const panelRegistry = {
  register(contribution: PanelContribution): void {
    registry.set(contribution.id, contribution)
  },

  get(id: string): PanelContribution | undefined {
    return registry.get(id)
  },

  getAll(): PanelContribution[] {
    return Array.from(registry.values())
  },

  unregister(id: string): void {
    registry.delete(id)
  },
}
