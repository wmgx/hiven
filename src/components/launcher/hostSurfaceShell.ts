import type { LauncherHostSurfaceTarget } from '../../store'

/**
 * Declarative shell config for host surfaces, mirroring plugin surface
 * `shell` contributions. Every host surface must be explicitly registered.
 */
type HostSurfaceShellConfig = {
  closeOnBlur?: boolean
}

const HOST_SURFACE_SHELL: Record<LauncherHostSurfaceTarget, HostSurfaceShellConfig> = {
  'quick-editor': { closeOnBlur: false },
  'system-settings': { closeOnBlur: false },
  'system-plugins': { closeOnBlur: false },
}

export function getHostSurfaceShell(
  target: LauncherHostSurfaceTarget | null,
): HostSurfaceShellConfig | undefined {
  return target ? HOST_SURFACE_SHELL[target] : undefined
}
