import type { ComponentType } from 'react'
import type { PresentationSession } from './types'

export type PresentationRendererProps = {
  session: PresentationSession
  onClose: () => void
  onUpdate: (options: Record<string, unknown>) => void
}

export type PresentationRendererDef = {
  id: string
  title: string
  supportedInputCounts: number[] | 'many'
  supportedRoles: string[]
  supportedModes: string[]
  component: ComponentType<PresentationRendererProps>
}

const registry = new Map<string, PresentationRendererDef>()

export const presentationRegistry = {
  register(def: PresentationRendererDef): void {
    registry.set(def.id, def)
  },

  get(id: string): PresentationRendererDef | undefined {
    return registry.get(id)
  },

  getAll(): PresentationRendererDef[] {
    return Array.from(registry.values())
  },

  unregister(id: string): void {
    registry.delete(id)
  },
}
