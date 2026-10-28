import type { ReactNode } from 'react'
import './RowList.css'

export function EmptyState({ title, hint, action, className, testId = 'launcher-empty-well' }: {
  title: string
  hint?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
  testId?: string
}) {
  return <div className={`hiven-empty-state ${className ?? ''}`} data-testid={testId} data-no-drag role="status">
    <p>{title}</p>{hint && <small>{hint}</small>}{action}
  </div>
}
