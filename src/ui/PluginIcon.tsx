import { resolveIcon } from '../utils/resolveIcon'
import './PluginIcon.css'

const TONES = 6

/** A stable tone per icon name, so rows read apart without the host knowing any plugin. */
function toneOf(icon = ''): number {
  let hash = 0
  for (const char of icon) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % TONES
}

export function PluginIcon({ icon, title, small = false }: { icon?: string; title?: string; small?: boolean }) {
  return <span className={`plugin-icon${small ? ' plugin-icon--small' : ''}`} data-icon={icon} data-tone={toneOf(icon)} aria-hidden>
    {resolveIcon(icon, small ? 11 : 15, title)}
  </span>
}
