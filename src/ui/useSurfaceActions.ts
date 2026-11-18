import { useContext, useLayoutEffect, useRef } from 'react'
import { SurfaceHeaderActionsContext } from './SurfaceHeaderActions'
import type { SurfaceActionDefinition } from './surfaceActions'

export function useSurfaceActions(actions: readonly SurfaceActionDefinition[]) {
  const register = useContext(SurfaceHeaderActionsContext).registerActions
  const owner = useRef<object>({})
  const latest = useRef(actions)
  latest.current = actions
  useLayoutEffect(() => register?.(owner.current, latest), [register])
}
