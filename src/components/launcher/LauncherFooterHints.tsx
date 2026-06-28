export function LauncherHintKey({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="grp">
      <kbd>{keys}</kbd>
      {label}
    </span>
  )
}

export function LauncherHintText({ label }: { label: string }) {
  return (
    <span className="grp primary">
      {label}
    </span>
  )
}
