/**
 * Text the user edited or selected in a text result's preview editor.
 *
 * Keyed by the result choice, so an override never leaks to another result.
 * The controller reads it when the choice is delivered (copy / paste); only
 * host text results honour it (see `rebuildHostTextChoice`).
 */

import type { LauncherResultChoice } from './types'

const overrides = new WeakMap<LauncherResultChoice, string>()

/** `null` clears the override (back to the original text). */
export function setResultTextOverride(choice: LauncherResultChoice, text: string | null): void {
  if (text === null) overrides.delete(choice)
  else overrides.set(choice, text)
}

export function getResultTextOverride(choice: LauncherResultChoice): string | undefined {
  return overrides.get(choice)
}
