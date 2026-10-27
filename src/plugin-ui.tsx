import { registerLocalEscapeLayer } from './utils/localEscapeLayer'
import {
  forwardRef,
  lazy,
  useEffect,
  useRef,
  useLayoutEffect,
  type RefObject,
  useState,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { NumberField as BaseNumberField } from '@base-ui/react/number-field'
import { cn } from 'cn'
import { CheckIcon, ChevronDownIcon, CopyIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select as UiSelect, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList } from '@/components/ui/combobox'
import { Switch as UiSwitch } from '@/components/ui/switch'
import { toggleVariants } from '@/components/ui/toggle'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ContextMenu as UiContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Dialog as UiDialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from './utils/imeKeyboard'

export { getFluxMonacoTheme as getEditorTheme } from './utils/monacoTheme'
export { Tooltip } from '@base-ui/react/tooltip'
export { useToolDeliveryFeedback } from './ui/useToolDeliveryFeedback'
export type { ToolDeliveryFeedback, ToolDeliveryFeedbackAttempt, ToolDeliveryFeedbackOwner } from './ui/toolDeliveryFeedback'

// Load the existing editor only when a plugin mounts it; keep Launcher startup light.
export const TextEditor = lazy(async () => {
  const { loadMonacoNls } = await import('./kits/editor/monacoNls')
  await loadMonacoNls()
  const { TextEditorCore } = await import('./kits/editor/TextEditorCore')
  return { default: TextEditorCore }
})

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
  filter?: (option: SelectOption, query: string) => boolean
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
  defaultFocus?: 'confirm' | 'cancel'
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

/** Scoped inline popup ownership. No global key listener or cross-page interception. */
export function useLocalEscapeLayer({ open, triggerRef, popupRef, owner, composingRef, onDismiss }: {
  open: boolean
  triggerRef: RefObject<HTMLElement | null>
  popupRef: RefObject<HTMLElement | null>
  owner?: { isCurrent(): boolean; subscribeInvalidation(listener: () => void): () => void }
  composingRef: RefObject<boolean>
  onDismiss: () => void
}) {
  useLayoutEffect(() => {
    const trigger = triggerRef.current
    const popup = popupRef.current
    if (!open || !trigger || !popup || !owner?.isCurrent()) return
    const unregister = registerLocalEscapeLayer({
      trigger, popup, isCurrent: () => owner.isCurrent(),
      isComposing: () => composingRef.current,
      dismiss: onDismiss,
    })
    const unsubscribe = owner.subscribeInvalidation(unregister)
    return () => { unregister(); unsubscribe() }
  }, [open, triggerRef, popupRef, owner, composingRef, onDismiss])
}

export function useImeKeyboard() {
  const isImeComposingRef = useRef(false)
  const compositionGeneration = useRef(0)

  return {
    isImeComposingRef,
    onCompositionStart: () => {
      compositionGeneration.current += 1
      startImeComposition(isImeComposingRef)
    },
    onCompositionEnd: () => {
      const generation = compositionGeneration.current
      finishImeComposition(isImeComposingRef, (clear) => {
        window.setTimeout(() => {
          if (compositionGeneration.current === generation) clear()
        }, 0)
      })
    },
    onBlur: () => {
      compositionGeneration.current += 1
      isImeComposingRef.current = false
    },
    shouldIgnoreKeyDown: (event: Parameters<typeof shouldIgnoreImeKeyDown>[0]) =>
      shouldIgnoreImeKeyDown(event, isImeComposingRef),
  }
}

const BUTTON_VARIANT = { primary: 'default', secondary: 'outline', ghost: 'ghost', danger: 'destructive' } as const

/** Menu-row text: label plus optional description, shared by dropdown and context menus. */
function MenuItemText({ item }: { item: MenuItemSpec }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      <span className="hiven-ui-menu-item-label min-w-0">{item.label}</span>
      {item.description ? <span className="hiven-ui-menu-item-desc text-sm text-muted-foreground">{item.description}</span> : null}
    </span>
  )
}

const MENU_ITEM = 'hiven-ui-menu-item min-h-8 px-2.5 py-1.5 text-base'
const POPUP = 'hiven-ui-select-menu max-h-80 overflow-y-auto p-1'

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        buttonVariants({ variant: BUTTON_VARIANT[variant], size: 'sm' }),
        // Neutral buttons never inherit a status colour (e.g. a red notice around them).
        (variant === 'secondary' || variant === 'ghost') && 'text-foreground',
        'hiven-ui-button',
        `hiven-ui-button-${variant}`,
        className,
      )}
      {...props}
    />
  )
})

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, label, title, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'hiven-ui-icon-button text-muted-foreground hover:text-foreground', className)}
      aria-label={label ?? title}
      title={title ?? label}
      {...props}
    />
  )
})

/** Field-level copy: the icon turns into ✓ briefly and the surface stays open. */
export function CopyIconButton({ label, copy, disabled, className }: { label: string; copy: () => Promise<void>; disabled?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <IconButton type="button" label={label} disabled={disabled} className={className} onClick={() => {
      void copy().then(() => {
        clearTimeout(timer.current)
        setCopied(true)
        timer.current = setTimeout(() => setCopied(false), 1200)
      }).catch(() => setCopied(false))
    }}>
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </IconButton>
  )
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ButtonProps>(function ToolbarButton(
  { className, variant = 'ghost', ...props },
  ref,
) {
  return <Button ref={ref} className={cn('hiven-ui-toolbar-button', className)} variant={variant} {...props} />
})

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...props },
  ref,
) {
  return <Input ref={ref} className={cn('hiven-ui-input h-7', className)} {...props} />
})

export const SearchField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function SearchField(
  { className, ...props },
  ref,
) {
  return <Input ref={ref} className={cn('hiven-ui-input hiven-ui-search h-7', className)} {...props} type="search" />
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...props },
  ref,
) {
  return <Textarea ref={ref} className={cn('hiven-ui-input hiven-ui-textarea field-sizing-fixed resize-y', className)} {...props} />
})

const TRIGGER = 'hiven-ui-select-trigger h-7 w-full min-w-0 bg-background text-base'

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
    <UiSelect
      value={current}
      onValueChange={(next) => next !== null && commit(next)}
      onOpenChange={setOpen}
      disabled={disabled}
      name={name}
      items={options}
    >
      <div ref={ref} className={cn('hiven-ui-select inline-flex min-w-0', open && 'is-open', disabled && 'is-disabled', className)}>
        <SelectTrigger size="sm" className={TRIGGER} aria-label={ariaLabel} id={id}>
          <span className="hiven-ui-select-label min-w-0 flex-1 truncate text-left">{selected?.label ?? ''}</span>
        </SelectTrigger>
      </div>
      <SelectContent className={POPUP} alignItemWithTrigger={false} sideOffset={6} align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="hiven-ui-select-option text-base">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </UiSelect>
  )
})

export function Combobox({ options, filter, value = '', disabled, className, placeholder, emptyLabel = '', 'aria-label': ariaLabel, onChange }: ComboboxProps) {
  const selected = options.find((option) => option.value === value) ?? null
  const [open, setOpen] = useState(false)
  return (
    <BaseCombobox.Root
      items={options}
      filter={filter}
      value={selected}
      disabled={disabled}
      onValueChange={(option) => onChange(option?.value ?? '')}
      onOpenChange={setOpen}
      isItemEqualToValue={(item, candidate) => item.value === candidate.value}
    >
      <div className={cn('hiven-ui-select inline-flex min-w-0', open && 'is-open', disabled && 'is-disabled', className)}>
        <BaseCombobox.Trigger
          className={cn(
            'flex items-center justify-between gap-1.5 rounded-md border border-input px-2.5 text-base outline-none',
            'focus-visible:border-[var(--field-focus-border)] disabled:opacity-50 dark:bg-input/30',
            TRIGGER,
          )}
          aria-label={ariaLabel}
        >
          <span className="hiven-ui-select-label min-w-0 flex-1 truncate text-left">{selected?.label ?? placeholder ?? emptyLabel ?? ''}</span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </BaseCombobox.Trigger>
      </div>
      <ComboboxContent className="hiven-ui-combobox-menu">
        <BaseCombobox.Input
          className="hiven-ui-combobox-search m-1 h-7 w-[calc(100%-0.5rem)] rounded-md border border-input bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring"
          placeholder={placeholder}
          aria-label={ariaLabel}
        />
        <ComboboxEmpty className="hiven-ui-combobox-empty">{emptyLabel}</ComboboxEmpty>
        <ComboboxList className="hiven-ui-combobox-list">
          {(option: SelectOption) => (
            <ComboboxItem key={option.value} value={option} className="hiven-ui-select-option text-base">
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </BaseCombobox.Root>
  )
}

type NativeCheckProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & LabelHTMLAttributes<HTMLLabelElement>

const CHECK_LABEL = 'inline-flex items-center gap-2 text-sm text-muted-foreground has-disabled:opacity-50'

export function Checkbox({ className, children, ...props }: NativeCheckProps) {
  return (
    <label className={cn('hiven-ui-check', CHECK_LABEL, className)}>
      <input {...props} type="checkbox" className="size-4 shrink-0 accent-primary" />
      <span>{children}</span>
    </label>
  )
}

export function Toggle({ className, children, ...props }: NativeCheckProps) {
  return (
    <label className={cn('hiven-ui-toggle', CHECK_LABEL, className)}>
      <input {...props} type="checkbox" className="peer sr-only" />
      <span
        className={cn(
          'hiven-ui-toggle-track relative h-[18px] w-8 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary',
          'after:absolute after:top-px after:left-px after:size-4 after:rounded-full after:bg-background after:transition-transform peer-checked:after:translate-x-3.5',
          'peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50',
        )}
        aria-hidden="true"
      />
      <span>{children}</span>
    </label>
  )
}

export function SegmentedControl({ options, value, onChange, className, disabled, 'aria-label': ariaLabel }: SegmentedControlProps) {
  return (
    <div className={cn('hiven-ui-segmented inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn(
            toggleVariants({ size: 'sm' }),
            'hiven-ui-segmented-item h-6 rounded-sm px-2.5 text-muted-foreground hover:bg-transparent',
            'aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border',
            option.value === value && 'is-active',
          )}
          aria-pressed={option.value === value}
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
  const compact = className?.split(/\s+/).includes('is-compact')
  return (
    <UiSwitch
      className={cn('hiven-ui-switch', className)}
      size={compact ? 'sm' : 'default'}
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={onCheckedChange}
    />
  )
}

const NUMBER_STEP = 'hiven-ui-number-step flex w-7 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50'

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
      className={cn('hiven-ui-number inline-flex', className)}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === 'number' && Number.isFinite(next)) onChange(next)
      }}
    >
      <BaseNumberField.Group className="hiven-ui-number-group flex h-7 overflow-hidden rounded-md border border-input focus-within:border-ring aria-invalid:border-destructive dark:bg-input/30">
        <BaseNumberField.Decrement className={NUMBER_STEP} aria-label="-">−</BaseNumberField.Decrement>
        <BaseNumberField.Input
          className="hiven-ui-number-input w-14 min-w-0 bg-transparent text-center text-base tabular-nums outline-none"
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          onBlur={onBlur}
        />
        <BaseNumberField.Increment className={NUMBER_STEP} aria-label="+">＋</BaseNumberField.Increment>
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  )
}

export function Menu({ trigger, items, align = 'end', header, className, onOpenChange }: MenuProps) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent className={cn(POPUP, 'hiven-ui-menu min-w-44', className)} sideOffset={6} align={align}>
        {header ? <div className="hiven-ui-menu-header px-2.5 py-1.5 text-sm text-muted-foreground">{header}</div> : null}
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            className={cn(MENU_ITEM, item.danger && 'is-danger')}
            variant={item.danger ? 'destructive' : 'default'}
            disabled={item.disabled}
            closeOnClick={item.closeOnClick}
            onClick={item.onSelect}
          >
            <MenuItemText item={item} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ContextMenu({ trigger, items, disabled, className, onOpenChange }: ContextMenuProps) {
  return (
    <UiContextMenu disabled={disabled} onOpenChange={onOpenChange}>
      <ContextMenuTrigger render={trigger} />
      <ContextMenuContent className={cn(POPUP, 'hiven-ui-menu min-w-44', className)} sideOffset={4}>
        {items.map((item) => (
          <ContextMenuItem
            key={item.key}
            className={cn(MENU_ITEM, item.danger && 'is-danger')}
            variant={item.danger ? 'destructive' : 'default'}
            disabled={item.disabled}
            closeOnClick={item.closeOnClick}
            onClick={item.onSelect}
          >
            <MenuItemText item={item} />
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </UiContextMenu>
  )
}

export const Slider = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Slider(
  props,
  ref,
) {
  return <input ref={ref} type="range" {...props} className={cn('hiven-ui-slider accent-primary', props.className)} />
})

export function SurfaceToolbar({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('hiven-ui-surface-toolbar flex items-center gap-2', className)} {...props} />
}

export function SurfaceList({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('hiven-ui-surface-list min-h-0 overflow-auto', className)} {...props} />
}

export const SurfaceListItem = forwardRef<HTMLButtonElement, SurfaceListItemProps>(function SurfaceListItem(
  { className, selected, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'hiven-ui-surface-list-item w-full rounded-md px-2.5 py-1.5 text-left text-base hover:bg-accent',
        selected && 'is-selected bg-primary-soft hover:bg-primary-soft',
        className,
      )}
      {...props}
    />
  )
})

export function SurfacePreview({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('hiven-ui-surface-preview min-h-0 overflow-auto', className)} {...props} />
}

export function SurfaceEmptyState({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('hiven-ui-surface-empty grid place-items-center p-6 text-center text-sm text-muted-foreground', className)} {...props} />
}

export function SurfaceFooterHints({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('hiven-ui-surface-footer-hints flex items-center gap-2 text-sm text-muted-foreground', className)} {...props} />
}

export function Dialog({ open, onOpenChange, title, children, className }: DialogProps) {
  return (
    <UiDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={cn('hiven-ui-dialog-panel max-h-[calc(100vh-48px)] overflow-auto sm:max-w-lg', className)}>
        {title ? <DialogTitle className="hiven-ui-dialog-title">{title}</DialogTitle> : null}
        {children}
      </DialogContent>
    </UiDialog>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', defaultFocus, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <AlertDialogContent className="hiven-ui-confirm-panel" initialFocus={defaultFocus === 'cancel' ? cancelRef : undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle className="hiven-ui-confirm-title">{title}</AlertDialogTitle>
          {message && <AlertDialogDescription className="hiven-ui-confirm-message">{message}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter className="hiven-ui-confirm-actions">
          <AlertDialogCancel ref={cancelRef}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
