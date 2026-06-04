import type { ActionDef } from '../store'

/**
 * Legacy hardcoded builtin actions.
 *
 * All first-party capabilities have been migrated to plugin packages under
 * `src/plugins/*` (auto-discovered by the bundled plugin loader). This list is
 * intentionally empty and kept only so the store can keep a stable import while
 * extensions register their own actions at runtime.
 */
export const builtinActions: ActionDef[] = []
