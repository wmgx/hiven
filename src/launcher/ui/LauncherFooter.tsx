import type { ReactNode } from 'react'

export function LauncherFooter({ children, className = 'global-launcher-footer l-foot' }: {
  children: ReactNode
  className?: string
}) {
  return <div className={className}>{children}</div>
}

export function HintKey({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="grp">
      <kbd>{keys}</kbd>
      {label}
    </span>
  )
}

export function HintText({ label }: { label: string }) {
  return (
    <span className="grp primary">
      {label}
    </span>
  )
}
