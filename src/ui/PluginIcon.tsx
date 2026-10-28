import { resolveIcon } from '../utils/resolveIcon'
import './PluginIcon.css'

export function PluginIcon({ icon, title, small = false }: { icon?: string; title?: string; small?: boolean }) {
  return <span className={`plugin-icon${small ? ' plugin-icon--small' : ''}`} data-icon={icon} aria-hidden>
    {resolveIcon(icon, small ? 11 : 15, title)}
  </span>
}
