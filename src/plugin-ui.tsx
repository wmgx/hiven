import { forwardRef, useRef, type ButtonHTMLAttributes, type ComponentPropsWithoutRef, type InputHTMLAttributes, type LabelHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
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

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  options: SelectOption[]
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

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, ...props },
  ref,
) {
  return (
    <span className={cx('hiven-ui-select', className)}>
      <select ref={ref} className="hiven-ui-select-control" {...props}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span className="hiven-ui-select-chevron" aria-hidden="true">⌄</span>
    </span>
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
