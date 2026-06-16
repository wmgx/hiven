import type { Locale } from '../i18n/registry'
import { translate } from '../i18n/registry'
import type { GlobalPinnedLauncherDoubleModifier, GlobalPinnedLauncherShortcut } from '../store'

type HotkeyPlatformLabels = {
  isMac: boolean
  command: string
  option: string
}

export function formatGlobalPinnedLauncherShortcutLabel(
  shortcut: GlobalPinnedLauncherShortcut,
  locale: Locale,
): string {
  const platformLabels = getHotkeyPlatformLabels()
  if (shortcut.kind === 'accelerator') return formatAcceleratorLabel(shortcut.accelerator, platformLabels)
  if (shortcut.kind === 'double-modifier') return doubleModifierLabel(shortcut.modifier, locale, platformLabels)
  return translate(locale, 'settings', 'hotkeyDisabled')
}

function getHotkeyPlatformLabels(): HotkeyPlatformLabels {
  const isMac = isMacPlatform()
  return {
    isMac,
    command: isMac ? 'Cmd' : 'Ctrl',
    option: isMac ? 'Option' : 'Alt',
  }
}

function isMacPlatform(): boolean {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const platform = nav?.platform || ''
  const userAgent = nav?.userAgent || ''
  const userAgentDataPlatform = (nav as Navigator & { userAgentData?: { platform?: string } } | undefined)?.userAgentData?.platform || ''
  return /Mac|iPhone|iPad|iPod/i.test(`${platform} ${userAgentDataPlatform} ${userAgent}`)
}

function doubleModifierLabel(
  modifier: GlobalPinnedLauncherDoubleModifier,
  locale: Locale,
  platformLabels: HotkeyPlatformLabels,
): string {
  return translate(locale, 'settings', 'hotkeyDoubleModifier', {
    modifier: modifierLabel(modifier, platformLabels),
  })
}

function modifierLabel(modifier: GlobalPinnedLauncherDoubleModifier, platformLabels: HotkeyPlatformLabels): string {
  if (modifier === 'Shift') return 'Shift'
  if (modifier === 'Option') return platformLabels.option
  return platformLabels.command
}

function formatAcceleratorLabel(accelerator: string, platformLabels: HotkeyPlatformLabels): string {
  // Always map internal names (Cmd/Alt) to platform-friendly labels.
  // This makes Option+Space show as "Option+Space" on macOS instead of "Alt+Space".
  return accelerator
    .replace(/\bCmd\b/g, platformLabels.command)
    .replace(/\bAlt\b/g, platformLabels.option)
}
