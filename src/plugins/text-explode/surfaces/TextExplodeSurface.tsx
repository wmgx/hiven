import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, useImeKeyboard } from '@hiven/plugin-ui'
import { CloseIcon } from '@hiven/plugin-ui/icons'
import { Bomb } from 'lucide-react'
import { assembleFromSelection, isSelectableToken, tokenize, type ExplodeToken } from '../tokenize'

/** Matches the launcher's own query_change debounce so the explode replay doesn't fire per keystroke. */
const COMMIT_DEBOUNCE_MS = 280

type ChipAnim = { dx: number; dy: number; rot: number; delay: number }

type DragState = {
  startX: number
  startY: number
  originLeft: number
  originTop: number
  moved: boolean
  downIdx: number | null
  downGroupId: string | null
}

function buildAnims(tokens: ExplodeToken[]): ChipAnim[] {
  return tokens.map((_, idx) => {
    const angle = Math.random() * Math.PI * 2
    const radius = 55 + Math.random() * 95
    return {
      dx: Math.cos(angle) * radius,
      dy: Math.sin(angle) * radius,
      rot: Math.random() * 70 - 35,
      delay: Math.min(idx * 6, 260) + Math.random() * 40,
    }
  })
}

export function TextExplodeSurface(props: PluginSurfaceProps) {
  const { t, host } = props
  const initial = props.initialText?.trim() ?? ''
  const [inputValue, setInputValue] = useState(initial)
  const [committedText, setCommittedText] = useState(initial)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [exploded, setExploded] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const ime = useImeKeyboard()

  // Live typing feel: input reacts every keystroke, explode/re-tokenize settles
  // after a short pause so the canvas doesn't re-burst on every character.
  useEffect(() => {
    const timer = window.setTimeout(() => setCommittedText(inputValue.trim()), COMMIT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [inputValue])

  const tokens = useMemo(() => (committedText ? tokenize(committedText) : []), [committedText])
  const anims = useMemo(() => buildAnims(tokens), [tokens])

  const groups = useMemo(() => {
    const map = new Map<string, number[]>()
    tokens.forEach((token, idx) => {
      if (!token.group) return
      const list = map.get(token.group) ?? []
      list.push(idx)
      map.set(token.group, list)
    })
    return map
  }, [tokens])

  const chipAnimCleanup = useRef<(() => void) | null>(null)
  useEffect(() => {
    setSelected(new Set())
    setExploded(false)
    if (!tokens.length) return
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setExploded(true))
      chipAnimCleanup.current = () => cancelAnimationFrame(raf2)
    })
    return () => {
      cancelAnimationFrame(raf1)
      chipAnimCleanup.current?.()
    }
  }, [tokens])

  const canvasRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef<Map<number, HTMLSpanElement>>(new Map())
  const groupRefs = useRef<Map<string, HTMLSpanElement>>(new Map())
  const dragRef = useRef<DragState | null>(null)
  const [rubberBox, setRubberBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [rubberPreview, setRubberPreview] = useState<Set<number>>(new Set())
  // Plain drag adds to the selection; Shift+drag toggles (matches Illustrator/
  // Figma's marquee convention) — read live off the pointer event so the
  // preview always matches what release will actually do.
  const [dragShiftMode, setDragShiftMode] = useState(false)

  const assembled = useMemo(() => assembleFromSelection(tokens, selected), [tokens, selected])

  const toggleChip = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const toggleGroup = useCallback((groupId: string) => {
    const idxs = groups.get(groupId)
    if (!idxs?.length) return
    setSelected((prev) => {
      const allSelected = idxs.every((i) => prev.has(i))
      const next = new Set(prev)
      idxs.forEach((i) => (allSelected ? next.delete(i) : next.add(i)))
      return next
    })
  }, [groups])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !canvasRef.current) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const chipEl = (event.target as HTMLElement).closest<HTMLElement>('[data-chip-idx]')
    const groupEl = !chipEl ? (event.target as HTMLElement).closest<HTMLElement>('[data-group-id]') : null
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      // Expressed in canvas content-space (adds scrollTop/scrollLeft) rather
      // than viewport-space, so the marquee stays anchored to the dragged
      // area — not the visible viewport — if .tx-canvas scrolls mid-drag.
      originLeft: event.clientX - rect.left + canvas.scrollLeft,
      originTop: event.clientY - rect.top + canvas.scrollTop,
      moved: false,
      downIdx: chipEl ? Number(chipEl.dataset.chipIdx) : null,
      downGroupId: groupEl ? (groupEl.dataset.groupId ?? null) : null,
    }
    canvas.setPointerCapture(event.pointerId)
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || !canvasRef.current) return
    const canvas = canvasRef.current
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true
    if (!drag.moved) return

    const rect = canvas.getBoundingClientRect()
    const curLeft = event.clientX - rect.left + canvas.scrollLeft
    const curTop = event.clientY - rect.top + canvas.scrollTop
    const x = Math.min(drag.originLeft, curLeft)
    const y = Math.min(drag.originTop, curTop)
    const w = Math.abs(curLeft - drag.originLeft)
    const h = Math.abs(curTop - drag.originTop)
    setRubberBox({ x, y, w, h })

    const preview = new Set<number>()
    chipRefs.current.forEach((el, idx) => {
      const r = el.getBoundingClientRect()
      const left = r.left - rect.left + canvas.scrollLeft
      const top = r.top - rect.top + canvas.scrollTop
      const intersects = left < x + w && left + r.width > x && top < y + h && top + r.height > y
      if (intersects) preview.add(idx)
    })
    setRubberPreview(preview)
    setDragShiftMode(event.shiftKey)
  }, [])

  const handlePointerUp = useCallback((event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.moved) {
      const toggleMode = event.shiftKey
      setSelected((prev) => {
        const next = new Set(prev)
        rubberPreview.forEach((idx) => {
          if (toggleMode && next.has(idx)) next.delete(idx)
          else next.add(idx)
        })
        return next
      })
      setRubberPreview(new Set())
      setDragShiftMode(false)
    } else if (drag.downIdx !== null) {
      toggleChip(drag.downIdx)
    } else if (drag.downGroupId) {
      toggleGroup(drag.downGroupId)
    }
    setRubberBox(null)
    dragRef.current = null
  }, [rubberPreview, toggleChip, toggleGroup])

  useEffect(() => {
    window.addEventListener('pointerup', handlePointerUp)
    return () => window.removeEventListener('pointerup', handlePointerUp)
  }, [handlePointerUp])

  const confirmPaste = useCallback(async () => {
    if (!assembled) return
    try {
      const result = await host.paste.pasteText(assembled)
      if (!result.ok) host.showMessage(result.message, 'info')
      host.close()
    } catch {
      host.showMessage(t('error.pasteFailed'), 'error')
    }
  }, [assembled, host, t])

  const copySelection = useCallback(async () => {
    if (!assembled) return
    try {
      await host.clipboard.writeText(assembled)
      setCopyFeedback({ text: assembled, error: false })
    } catch {
      setCopyFeedback({ text: assembled, error: true })
    }
  }, [assembled, host, t])

  const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      if (ime.shouldIgnoreKeyDown(event)) return
      event.preventDefault()
      void confirmPaste()
      return
    }
    // Token-input convention: ⌫ on an empty field removes the command token (= back).
    if (event.key === 'Backspace' && inputValue === '') {
      event.preventDefault()
      host.requestBack()
    }
  }, [confirmPaste, host, ime, inputValue])

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      host.requestBack()
    }
  }, [host])

  const hasTokens = tokens.length > 0

  return (
    <div className="text-explode-surface" onKeyDown={handleKeyDown}>
      <div className="l-search tx-search-row">
        <span className="tx-token" data-no-select>
          <Bomb size={13} aria-hidden="true" />
          {t('token.label')}
          <button
            type="button"
            className="tx-token-remove"
            aria-label={t('token.remove')}
            onClick={() => host.requestBack()}
          >
            <CloseIcon size={11} />
          </button>
        </span>
        <input
          autoFocus
          value={inputValue}
          name="text-explode-query"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t('input.placeholder')}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleInputKeyDown}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
        />
        {inputValue && (
          <IconButton label={t('input.clear')} className="tx-chrome-btn" onClick={() => setInputValue('')}>
            <CloseIcon size={14} />
          </IconButton>
        )}
        <IconButton label={t('action.close')} className="tx-chrome-btn" onClick={() => host.close()}>
          <CloseIcon size={15} />
        </IconButton>
      </div>

      {hasTokens ? (
        <div
          ref={canvasRef}
          data-no-select
          role="group"
          aria-label={t('canvas.label')}
          className={`tx-canvas${exploded ? ' is-exploded' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
        >
          {rubberBox && (
            <div
              className="tx-rubber"
              style={{ left: rubberBox.x, top: rubberBox.y, width: rubberBox.w, height: rubberBox.h }}
            />
          )}
          {renderTokens({
            tokens,
            anims,
            selected,
            rubberPreview,
            dragShiftMode,
            groups,
            chipRefs,
            groupRefs,
            toggleChip,
            groupLabel: t('canvas.linkGroup'),
          })}
        </div>
      ) : (
        <div className="tx-empty">
          <Bomb size={22} aria-hidden="true" />
          <span>{t('empty.hint')}</span>
        </div>
      )}

      <div className="tx-preview">
        <div className="tx-preview-head">
          <span>{t('preview.title')}</span>
          <span>{t('preview.count', { count: selected.size })}</span>
        </div>
        <div className="tx-preview-body">
          {assembled || <span className="tx-preview-empty">{t('preview.empty')}</span>}
        </div>
      </div>

      <div className="tx-footer">
        <Button variant="ghost" disabled={!selected.size} onClick={() => setSelected(new Set())}>
          {t('action.clear')}
        </Button>
        <span className="tx-footer-hint">{t('footer.hint')}</span>
        <Button disabled={!assembled} onClick={() => void copySelection()}>
          {copyFeedback?.text === assembled
            ? t(copyFeedback.error ? 'error.copyFailed' : 'message.copied')
            : t('action.copy')}
        </Button>
        <Button variant="primary" disabled={!assembled} onClick={() => void confirmPaste()}>
          {t('action.confirm')}
        </Button>
      </div>
    </div>
  )
}

function renderTokens(params: {
  tokens: ExplodeToken[]
  anims: ChipAnim[]
  selected: Set<number>
  rubberPreview: Set<number>
  dragShiftMode: boolean
  groups: Map<string, number[]>
  chipRefs: React.MutableRefObject<Map<number, HTMLSpanElement>>
  groupRefs: React.MutableRefObject<Map<string, HTMLSpanElement>>
  toggleChip: (idx: number) => void
  groupLabel: string
}) {
  const { tokens, anims, selected, rubberPreview, dragShiftMode, groups, chipRefs, groupRefs, toggleChip, groupLabel } = params
  const nodes: React.ReactNode[] = []
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]

    if (!isSelectableToken(token.type)) {
      nodes.push(
        <span key={i} className={token.type === 'space' ? 'tx-gap' : 'tx-brk'} />,
      )
      i += 1
      continue
    }

    if (token.group) {
      const groupId = token.group
      const memberIdxs = groups.get(groupId) ?? []
      const allSelected = memberIdxs.length > 0 && memberIdxs.every((idx) => selected.has(idx))
      const chips: React.ReactNode[] = []
      while (i < tokens.length && tokens[i].group === groupId) {
        chips.push(renderChip(i, tokens[i], anims[i], selected, rubberPreview, dragShiftMode, chipRefs, toggleChip))
        i += 1
      }
      nodes.push(
        <span
          key={`group-${groupId}`}
          data-group-id={groupId}
          ref={(el) => {
            if (el) groupRefs.current.set(groupId, el)
            else groupRefs.current.delete(groupId)
          }}
          className={`tx-url-group${allSelected ? ' is-all-selected' : ''}`}
          role="group"
          aria-label={groupLabel}
        >
          {chips}
        </span>,
      )
      continue
    }

    nodes.push(renderChip(i, token, anims[i], selected, rubberPreview, dragShiftMode, chipRefs, toggleChip))
    i += 1
  }

  return nodes
}

function renderChip(
  idx: number,
  token: ExplodeToken,
  anim: ChipAnim,
  selected: Set<number>,
  rubberPreview: Set<number>,
  dragShiftMode: boolean,
  chipRefs: React.MutableRefObject<Map<number, HTMLSpanElement>>,
  toggleChip: (idx: number) => void,
) {
  const committed = selected.has(idx)
  const inPreview = rubberPreview.has(idx)
  // Shift+drag toggles: a chip already selected shows as "about to be
  // removed" instead of staying highlighted, matching what release will do.
  const pendingRemove = inPreview && dragShiftMode && committed
  const isSelected = !pendingRemove && (committed || inPreview)
  return (
    <span
      key={idx}
      data-chip-idx={idx}
      role="button"
      tabIndex={0}
      aria-pressed={committed}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        toggleChip(idx)
      }}
      ref={(el) => {
        if (el) chipRefs.current.set(idx, el)
        else chipRefs.current.delete(idx)
      }}
      className={`tx-chip tx-chip-${token.type}${isSelected ? ' is-selected' : ''}${pendingRemove ? ' is-pending-remove' : ''}`}
      style={{
        // @ts-expect-error custom properties
        '--dx': `${anim.dx}px`,
        '--dy': `${anim.dy}px`,
        '--rot': `${anim.rot}deg`,
        transitionDelay: `${anim.delay}ms`,
      }}
    >
      {token.text}
    </span>
  )
}
