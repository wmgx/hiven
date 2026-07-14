import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from './utils/imeKeyboard'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string
}

type SelectOption = {
  label: string
  value: string
}

/** Compatible change payload for former native select onChange handlers. */
type SelectChangeEvent = {
  target: { value: string; name?: string }
  currentTarget: { value: string; name?: string }
}

type SelectProps = {
  options: SelectOption[]
  value?: string
  defaultValue?: string
  disabled?: boolean
  className?: string
  name?: string
  id?: string
  'aria-label'?: string
  onChange?: (event: SelectChangeEvent) => void
}

/** Only one shared Select menu open at a time. */
const openSelectClosers = new Set<() => void>()

function closeOtherSelects(except?: () => void) {
  for (const close of openSelectClosers) {
    if (close !== except) close()
  }
}
type ToggleOption = {
  label: string
  value: string
}

type SegmentedControlProps = {
  options: ToggleOption[]
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

type SurfaceListItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean
}

type ConfirmDialogProps = {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

function cx(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function useImeKeyboard() {
  const isImeComposingRef = useRef(false)

  return {
    isImeComposingRef,
    onCompositionStart: () => startImeComposition(isImeComposingRef),
    onCompositionEnd: () => finishImeComposition(isImeComposingRef),
    shouldIgnoreKeyDown: (event: Parameters<typeof shouldIgnoreImeKeyDown>[0]) =>
      shouldIgnoreImeKeyDown(event, isImeComposingRef),
  }
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', ...props },
  ref,
) {
  return <button ref={ref} className={cx('hiven-ui-button', `hiven-ui-button-${variant}`, className)} {...props} />
})

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, label, title, ...props },
  ref,
) {
  return <button ref={ref} className={cx('hiven-ui-icon-button', className)} aria-label={label ?? title} title={title ?? label} {...props} />
})

export const ToolbarButton = forwardRef<HTMLButtonElement, ButtonProps>(function ToolbarButton(
  { className, variant = 'ghost', ...props },
  ref,
) {
  return <Button ref={ref} className={cx('hiven-ui-toolbar-button', className)} variant={variant} {...props} />
})

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cx('hiven-ui-input', className)} {...props} />
})

export const SearchField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function SearchField(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cx('hiven-ui-input hiven-ui-search', className)} {...props} type="search" />
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cx('hiven-ui-input hiven-ui-textarea', className)} {...props} />
})

export const Select = forwardRef<HTMLDivElement, SelectProps>(function Select(
  {
    className,
    options,
    value,
    defaultValue,
    disabled,
    name,
    id,
    'aria-label': ariaLabel,
    onChange,
  },
  ref,
) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? options[0]?.value ?? '')
  const current = value ?? uncontrolled
  const selected = options.find((option) => option.value === current) ?? options[0]
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()

  const close = useCallback(() => setOpen(false), [])

  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  useEffect(() => {
    if (!open) return
    openSelectClosers.add(close)
    closeOtherSelects(close)

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && rootRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      openSelectClosers.delete(close)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [close, open])

  const commit = (next: string) => {
    if (value === undefined) setUncontrolled(next)
    const payload: SelectChangeEvent = {
      target: { value: next, name },
      currentTarget: { value: next, name },
    }
    onChange?.(payload)
    setOpen(false)
  }

  return (
    <div
      ref={setRootRef}
      className={cx('hiven-ui-select', open && 'is-open', disabled && 'is-disabled', className)}
      id={id}
    >
      <button
        type="button"
        className="hiven-ui-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          setOpen((currentOpen) => {
            const next = !currentOpen
            if (next) closeOtherSelects(close)
            return next
          })
        }}
      >
        <span className="hiven-ui-select-label">{selected?.label ?? ''}</span>
        <span className="hiven-ui-select-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && !disabled && (
        <div className="hiven-ui-select-menu" role="listbox" id={listId}>
          {options.map((option) => {
            const isSelected = option.value === current
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={cx('hiven-ui-select-option', isSelected && 'is-selected')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(option.value)}
              >
                <span>{option.label}</span>
                {isSelected ? (
                  <svg className="hiven-ui-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
})

export function Checkbox({ className, children, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cx('hiven-ui-check', className)}>
      <input {...props} type="checkbox" />
      <span>{children}</span>
    </label>
  )
}

export function Toggle({ className, children, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cx('hiven-ui-toggle', className)}>
      <input {...props} type="checkbox" />
      <span className="hiven-ui-toggle-track" aria-hidden="true" />
      <span>{children}</span>
    </label>
  )
}

export function SegmentedControl({ options, value, onChange, className, disabled, 'aria-label': ariaLabel }: SegmentedControlProps) {
  return (
    <div className={cx('hiven-ui-segmented', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx('hiven-ui-segmented-item', option.value === value && 'is-active')}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export const NumberField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function NumberField(
  props,
  ref,
) {
  return <TextInput ref={ref} type="number" {...props} />
})

export const Slider = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Slider(
  props,
  ref,
) {
  return <input ref={ref} className={cx('hiven-ui-slider', props.className)} type="range" {...props} />
})

export function SurfaceToolbar({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx('hiven-ui-surface-toolbar', className)} {...props} />
}

export function SurfaceList({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx('hiven-ui-surface-list', className)} {...props} />
}

export const SurfaceListItem = forwardRef<HTMLButtonElement, SurfaceListItemProps>(function SurfaceListItem(
  { className, selected, ...props },
  ref,
) {
  return <button ref={ref} className={cx('hiven-ui-surface-list-item', selected && 'is-selected', className)} {...props} />
})

export function SurfacePreview({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx('hiven-ui-surface-preview', className)} {...props} />
}

export function SurfaceEmptyState({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx('hiven-ui-surface-empty', className)} {...props} />
}

export function SurfaceFooterHints({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx('hiven-ui-surface-footer-hints', className)} {...props} />
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) return null
  return (
    <div className="hiven-ui-confirm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="hiven-ui-confirm-panel">
        <div className="hiven-ui-confirm-title">{title}</div>
        {message && <div className="hiven-ui-confirm-message">{message}</div>}
        <div className="hiven-ui-confirm-actions">
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
          <Button onClick={onCancel}>{cancelLabel}</Button>
        </div>
      </div>
    </div>
  )
}
