/**
 * LauncherEmptyWell — V5 empty / preview empty surface (inset well material).
 * Shared by search no-results, collect empty, param empty filter, live-preview empty.
 */

import type { ReactNode } from 'react'
import { SearchX } from 'lucide-react'

export function LauncherEmptyWell({
  title,
  hint,
  icon,
  action,
  className,
  testId = 'launcher-empty-well',
}: {
  title: string
  hint?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <div
      className={['launcher-empty-well', className].filter(Boolean).join(' ')}
      data-testid={testId}
      role="status"
    >
      <div className="launcher-empty-well-icon" aria-hidden>
        {icon ?? <SearchX size={24} strokeWidth={1.75} />}
      </div>
      <div className="launcher-empty-well-title">{title}</div>
      {hint ? <div className="launcher-empty-well-hint">{hint}</div> : null}
      {action ? <div className="launcher-empty-well-action">{action}</div> : null}
    </div>
  )
}
