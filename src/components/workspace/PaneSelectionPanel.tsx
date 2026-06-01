/**
 * FluxText - Pane Selection Panel
 * Shows when diff needs user to select which panes to compare.
 */

import { useState, useEffect } from 'react'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import type { PaneSelectionRequest, PaneSelectionValue } from '../../workspace/paneSelection'

interface Props {
  request: PaneSelectionRequest
}

export function PaneSelectionPanel({ request }: Props) {
  const panes = useWorkspaceStore((s) => s.panes)
  const paneOrder = useWorkspaceStore((s) => s.paneOrder)

  const [selections, setSelections] = useState<Record<string, PaneSelectionValue>>(() => {
    const initial: Record<string, PaneSelectionValue> = {}
    for (const role of request.roles) {
      const defaultId = request.defaultSelection?.[role.key]
      if (defaultId && panes[defaultId]) {
        initial[role.key] = { type: 'pane', paneId: defaultId }
      }
    }
    return initial
  })

  const [diffType, setDiffType] = useState('auto')
  const [clipboardText, setClipboardText] = useState('')

  // Read clipboard on mount
  useEffect(() => {
    if (request.allowClipboard) {
      navigator.clipboard.readText().then(t => setClipboardText(t)).catch(() => {})
    }
  }, [request.allowClipboard])

  const isSinglePane = paneOrder.length === 1

  const handleConfirm = () => {
    // Validate all required roles filled
    const allFilled = request.roles.every(role => {
      if (!role.required) return true
      return !!selections[role.key]
    })
    if (!allFilled) return

    request.onConfirm({
      roles: selections,
      diffType: request.showDiffType ? diffType : undefined,
    })
  }

  const handleCancel = () => {
    request.onCancel()
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleCancel() }}
    >
      <div
        className="rounded-lg shadow-xl p-4 min-w-[340px] max-w-[440px]"
        style={{
          background: 'var(--color-background-primary)',
          border: '1px solid var(--color-border-secondary)',
        }}
      >
        {/* Title */}
        <h3 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
          {request.titleI18n?.zh || request.title}
        </h3>

        {/* Role selections */}
        {request.roles.map((role) => (
          <div key={role.key} className="mb-3">
            <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>
              {role.label} {role.required && <span style={{ color: 'var(--color-error-text)' }}>*</span>}
            </label>

            {isSinglePane && role.key === 'original' ? (
              // Single pane: original is fixed
              <div
                className="text-[12px] px-2 py-1.5 rounded"
                style={{ background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)' }}
              >
                {panes[paneOrder[0]]?.title || paneOrder[0]}
              </div>
            ) : isSinglePane && role.key === 'modified' ? (
              // Single pane: modified needs source selection
              <div className="flex flex-col gap-1.5">
                {request.allowClipboard && clipboardText && (
                  <button
                    className="text-left text-[11px] px-2 py-1.5 rounded flex items-center gap-2"
                    style={{
                      background: selections[role.key]?.type === 'clipboard'
                        ? 'var(--color-accent-bg)'
                        : 'var(--color-background-secondary)',
                      color: selections[role.key]?.type === 'clipboard'
                        ? 'var(--color-accent)'
                        : 'var(--color-text-primary)',
                    }}
                    onClick={() => setSelections({ ...selections, [role.key]: { type: 'clipboard', text: clipboardText } })}
                  >
                    <span>📋</span> Use Clipboard ({clipboardText.length > 30 ? clipboardText.slice(0, 30) + '...' : clipboardText})
                  </button>
                )}
                {request.allowEmptyPane && (
                  <button
                    className="text-left text-[11px] px-2 py-1.5 rounded flex items-center gap-2"
                    style={{
                      background: selections[role.key]?.type === 'empty-pane'
                        ? 'var(--color-accent-bg)'
                        : 'var(--color-background-secondary)',
                      color: selections[role.key]?.type === 'empty-pane'
                        ? 'var(--color-accent)'
                        : 'var(--color-text-primary)',
                    }}
                    onClick={() => setSelections({ ...selections, [role.key]: { type: 'empty-pane' } })}
                  >
                    <span>➕</span> Create Empty Right Pane
                  </button>
                )}
                {request.allowDuplicate && (
                  <button
                    className="text-left text-[11px] px-2 py-1.5 rounded flex items-center gap-2"
                    style={{
                      background: 'var(--color-background-secondary)',
                      color: 'var(--color-text-primary)',
                    }}
                    onClick={() => {
                      const text = panes[paneOrder[0]]?.text || ''
                      setSelections({ ...selections, [role.key]: { type: 'clipboard', text } })
                    }}
                  >
                    <span>📄</span> Duplicate Current Pane
                  </button>
                )}
              </div>
            ) : (
              // Multi-pane: dropdown to select pane
              <select
                className="w-full text-[12px] px-2 py-1.5 rounded"
                style={{
                  background: 'var(--color-background-secondary)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-tertiary)',
                }}
                value={(selections[role.key] as any)?.paneId || ''}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelections({ ...selections, [role.key]: { type: 'pane', paneId: e.target.value } })
                  }
                }}
              >
                <option value="">— Select —</option>
                {paneOrder.map((id) => (
                  <option key={id} value={id}>{panes[id]?.title || id}</option>
                ))}
              </select>
            )}
          </div>
        ))}

        {/* Diff Type */}
        {request.showDiffType && (
          <div className="mb-3">
            <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>
              Diff Type
            </label>
            <select
              className="w-full text-[12px] px-2 py-1.5 rounded"
              style={{
                background: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-tertiary)',
              }}
              value={diffType}
              onChange={(e) => setDiffType(e.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="text-line-diff">Text Line Diff</option>
              <option value="json-object-diff">JSON Object Diff</option>
            </select>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-4">
          <button
            className="text-[11px] px-3 py-1.5 rounded"
            style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button
            className="text-[11px] px-3 py-1.5 rounded font-medium"
            style={{ background: 'var(--color-accent)', color: 'white' }}
            onClick={handleConfirm}
          >
            {isSinglePane ? 'Continue' : 'Start Diff'}
          </button>
        </div>
      </div>
    </div>
  )
}
