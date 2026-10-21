export function formatPluginShortcutLabel(accelerator: string) {
  return accelerator
    .replace(/\bCmdOrCtrl\b/g, '⌘')
    .replace(/\bCommandOrControl\b/g, '⌘')
    .replace(/\bCommand\b/g, '⌘')
    .replace(/\bCmd\b/g, '⌘')
    .replace(/\bCtrl\b/g, 'Ctrl')
    .replace(/\bShift\b/g, '⇧')
    .replace(/\bAlt\b/g, '⌥')
    .replace(/\bOption\b/g, '⌥')
    .replace(/\+/g, '')
}
