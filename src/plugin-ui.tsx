import {
  forwardRef,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { Menu as BaseMenu } from '@base-ui/react/menu'
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'
import { NumberField as BaseNumberField } from '@base-ui/react/number-field'
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import { Select as BaseSelect } from '@base-ui/react/select'
import { Switch as BaseSwitch } from '@base-ui/react/switch'
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

type ComboboxProps = {
  options: SelectOption[]
  value?: string
  disabled?: boolean
  className?: string
  placeholder?: string
  emptyLabel?: string
  'aria-label'?: string
  onChange: (value: string) => void
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

type SwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

type NumberFieldControlProps = {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  className?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  onBlur?: () => void
}

export type MenuItemSpec = {
  key: string
  label: ReactNode
  description?: string
  danger?: boolean
  disabled?: boolean
  closeOnClick?: boolean
  onSelect: () => void
}

type MenuProps = {
  trigger: ReactElement
  items: MenuItemSpec[]
  align?: 'start' | 'end'
  header?: ReactNode
  className?: string
  onOpenChange?: (open: boolean) => void
}

type ContextMenuProps = {
  trigger: ReactElement
  items: MenuItemSpec[]
  disabled?: boolean
  className?: string
  onOpenChange?: (open: boolean) => void
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

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: ReactNode
  children: ReactNode
  className?: string
}

function cx(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function MenuScroller({ children }: { children: ReactNode }) {
  return (
    <BaseScrollArea.Root className="hiven-ui-menu-scroll-area">
      <BaseScrollArea.Viewport className="hiven-ui-menu-scroll-viewport">
        {children}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar className="hiven-ui-menu-scrollbar">
        <BaseScrollArea.Thumb className="hiven-ui-menu-scroll-thumb" />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="hiven-ui-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
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

  const commit = (next: string) => {
    if (value === undefined) setUncontrolled(next)
    const payload: SelectChangeEvent = {
      target: { value: next, name },
      currentTarget: { value: next, name },
    }
    onChange?.(payload)
  }

  return (
    <BaseSelect.Root
      value={current}
      onValueChange={(next) => next !== null && commit(next)}
      onOpenChange={setOpen}
      disabled={disabled}
      name={name}
      items={options}
    >
      <div ref={ref} className={cx('hiven-ui-select', open && 'is-open', disabled && 'is-disabled', className)}>
        <BaseSelect.Trigger className="hiven-ui-select-trigger" aria-label={ariaLabel} id={id}>
          <span className="hiven-ui-select-label">{selected?.label ?? ''}</span>
          <BaseSelect.Icon className="hiven-ui-select-chevron">
            <ChevronIcon />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="hiven-ui-select-positioner" data-launcher-scrollable sideOffset={6} alignItemWithTrigger={false}>
          <BaseSelect.Popup className="hiven-ui-select-menu">
            <MenuScroller>
              <BaseSelect.List>
                {options.map((option) => (
                  <BaseSelect.Item key={option.value} value={option.value} className="hiven-ui-select-option">
                    <BaseSelect.ItemText className="hiven-ui-select-option-label">{option.label}</BaseSelect.ItemText>
                    <BaseSelect.ItemIndicator className="hiven-ui-select-option-indicator">
                      <CheckIcon />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </MenuScroller>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
})

export function Combobox({ options, value = '', disabled, className, placeholder, emptyLabel = '', 'aria-label': ariaLabel, onChange }: ComboboxProps) {
  const selected = options.find((option) => option.value === value) ?? null
  const [open, setOpen] = useState(false)
  return (
    <BaseCombobox.Root
      items={options}
      value={selected}
      disabled={disabled}
      onValueChange={(option) => onChange(option?.value ?? '')}
      onOpenChange={setOpen}
      isItemEqualToValue={(item, candidate) => item.value === candidate.value}
    >
      <div className={cx('hiven-ui-select', open && 'is-open', disabled && 'is-disabled', className)}>
        <BaseCombobox.Trigger className="hiven-ui-select-trigger" aria-label={ariaLabel}>
          <span className="hiven-ui-select-label">{selected?.label ?? placeholder ?? emptyLabel ?? ''}</span>
          <BaseCombobox.Icon className="hiven-ui-select-chevron">
            <ChevronIcon />
          </BaseCombobox.Icon>
        </BaseCombobox.Trigger>
      </div>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner className="hiven-ui-select-positioner" data-launcher-scrollable sideOffset={6} align="start">
          <BaseCombobox.Popup className="hiven-ui-combobox-menu">
            <BaseCombobox.Input className="hiven-ui-combobox-search" placeholder={placeholder} aria-label={ariaLabel} />
            <MenuScroller>
              <BaseCombobox.Empty className="hiven-ui-combobox-empty">{emptyLabel}</BaseCombobox.Empty>
              <BaseCombobox.List className="hiven-ui-combobox-list">
                {(option: SelectOption) => (
                  <BaseCombobox.Item key={option.value} value={option} className="hiven-ui-select-option">
                    <span className="hiven-ui-select-option-label">{option.label}</span>
                    <BaseCombobox.ItemIndicator className="hiven-ui-select-option-indicator">
                      <CheckIcon />
                    </BaseCombobox.ItemIndicator>
                  </BaseCombobox.Item>
                )}
              </BaseCombobox.List>
            </MenuScroller>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  )
}

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

export function Switch({ checked, onCheckedChange, disabled, className, 'aria-label': ariaLabel }: SwitchProps) {
  return (
    <BaseSwitch.Root
      className={cx('hiven-ui-switch', className)}
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={onCheckedChange}
    >
      <BaseSwitch.Thumb className="hiven-ui-switch-thumb" />
    </BaseSwitch.Root>
  )
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  className,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  onBlur,
}: NumberFieldControlProps) {
  return (
    <BaseNumberField.Root
      className={cx('hiven-ui-number', className)}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === 'number' && Number.isFinite(next)) onChange(next)
      }}
    >
      <BaseNumberField.Group className="hiven-ui-number-group">
        <BaseNumberField.Decrement className="hiven-ui-number-step" aria-label="-">−</BaseNumberField.Decrement>
        <BaseNumberField.Input
          className="hiven-ui-number-input"
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          onBlur={onBlur}
        />
        <BaseNumberField.Increment className="hiven-ui-number-step" aria-label="+">＋</BaseNumberField.Increment>
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  )
}

export function Menu({ trigger, items, align = 'end', header, className, onOpenChange }: MenuProps) {
  return (
    <BaseMenu.Root onOpenChange={onOpenChange}>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="hiven-ui-select-positioner" data-launcher-scrollable sideOffset={6} align={align}>
          <BaseMenu.Popup className={cx('hiven-ui-select-menu', 'hiven-ui-menu', className)}>
            {header ? <div className="hiven-ui-menu-header">{header}</div> : null}
            <MenuScroller>
              {items.map((item) => (
                <BaseMenu.Item
                  key={item.key}
                  className={cx('hiven-ui-menu-item', item.danger && 'is-danger')}
                  disabled={item.disabled}
                  closeOnClick={item.closeOnClick}
                  onClick={item.onSelect}
                >
                  <span className="hiven-ui-menu-item-label">{item.label}</span>
                  {item.description ? <span className="hiven-ui-menu-item-desc">{item.description}</span> : null}
                </BaseMenu.Item>
              ))}
            </MenuScroller>
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}

export function ContextMenu({ trigger, items, disabled, className, onOpenChange }: ContextMenuProps) {
  return (
    <BaseContextMenu.Root disabled={disabled} onOpenChange={onOpenChange}>
      <BaseContextMenu.Trigger render={trigger} />
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner className="hiven-ui-select-positioner" data-launcher-scrollable sideOffset={4}>
          <BaseContextMenu.Popup className={cx('hiven-ui-select-menu', 'hiven-ui-menu', className)}>
            <MenuScroller>
              {items.map((item) => (
                <BaseContextMenu.Item
                  key={item.key}
                  className={cx('hiven-ui-menu-item', item.danger && 'is-danger')}
                  disabled={item.disabled}
                  closeOnClick={item.closeOnClick}
                  onClick={item.onSelect}
                >
                  <span className="hiven-ui-menu-item-label">{item.label}</span>
                  {item.description ? <span className="hiven-ui-menu-item-desc">{item.description}</span> : null}
                </BaseContextMenu.Item>
              ))}
            </MenuScroller>
          </BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  )
}

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

export function Dialog({ open, onOpenChange, title, children, className }: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="hiven-ui-dialog" />
        <BaseDialog.Popup className={cx('hiven-ui-dialog-panel', className)}>
          {title ? <BaseDialog.Title className="hiven-ui-dialog-title">{title}</BaseDialog.Title> : null}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="hiven-ui-confirm" />
        <BaseDialog.Popup className="hiven-ui-confirm-panel">
          <BaseDialog.Title className="hiven-ui-confirm-title">{title}</BaseDialog.Title>
          {message && <BaseDialog.Description className="hiven-ui-confirm-message">{message}</BaseDialog.Description>}
          <div className="hiven-ui-confirm-actions">
            <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
            <BaseDialog.Close render={<Button />}>{cancelLabel}</BaseDialog.Close>
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
