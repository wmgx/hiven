import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { getLanguageOptionLabel } from '../../workspace/languageOptions'
import { useAppStore } from '../../store'

export function QuickEditorToolbar() {
  const language = useQuickEditorStore((s) => s.language)
  const locale = useAppStore((s) => s.locale)
  const languageLabel = getLanguageOptionLabel(language, locale)

  return (
    <div
      className="flex items-center justify-between px-3 h-8 shrink-0 select-none"
      style={{
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        background: 'var(--color-background-secondary)',
      }}
      data-no-drag
    >
      <div className="flex items-center gap-2">
        <span
          className="text-[11px] font-medium"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Quick Editor
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {languageLabel}
        </span>
      </div>
    </div>
  )
}
