export function LauncherHintKey({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="grp">
      {label}
      <kbd>{keys}</kbd>
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
