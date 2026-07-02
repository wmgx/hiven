import type { LauncherHostSurfaceTarget } from '../../store'

/**
 * Declarative shell config for host surfaces, mirroring plugin surface
 * `shell` contributions. Targets without an entry use launcher defaults
 * (close on blur, standard host surface geometry).
 */
type HostSurfaceShellConfig = {
  closeOnBlur?: boolean
}

const HOST_SURFACE_SHELL: Partial<Record<LauncherHostSurfaceTarget, HostSurfaceShellConfig>> = {
  'quick-editor': { closeOnBlur: false },
}

export function getHostSurfaceShell(
  target: LauncherHostSurfaceTarget | null,
): HostSurfaceShellConfig | undefined {
  return target ? HOST_SURFACE_SHELL[target] : undefined
}
