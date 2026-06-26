import { useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  Clipboard,
  Database,
  ExternalLink,
  FileText,
  Folder,
  Globe2,
  Hash,
  Image,
  Link,
  ListOrdered,
  Minus,
  MousePointerClick,
  Plus,
  Power,
  Tags,
  ToggleLeft,
  Type,
  type LucideIcon,
} from 'lucide-react'
import type {
  PluginSettingsCondition,
  PluginSettingsField,
  PluginSettingsModalField,
  PluginSettingsObjectListField,
  PluginSettingsObjectListGroup,
  PluginSettingsObjectListItemField,
  PluginSettingsSchema,
  PluginPermission,
  PluginPermissionSnapshot,
} from '../workspace/pluginTypes'
import { describePluginPermission } from '../workspace/pluginPermissions'
import { translate, type Locale } from '../i18n'

type PluginSettingsSchemaRendererProps<TSettings = unknown> = {
  schema: PluginSettingsSchema<TSettings>
  locale: Locale
  value: TSettings
  updateValue: (patch: Partial<TSettings>) => void
  onOpenModal: (field: PluginSettingsModalField<TSettings>) => void
  permissions?: PluginPermissionSnapshot
}

function localize(
  text: string | undefined,
  textI18n: Partial<Record<Locale, string>> | undefined,
  locale: Locale,
): string {
  return textI18n?.[locale] ?? text ?? ''
}

function getSettingsRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return ''
  }
}

function getObjectList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
}

function makeListItem(defaults: Record<string, unknown> | undefined, existing: Record<string, unknown>[]): Record<string, unknown> {
  const item = { ...(defaults ?? {}) }
  if (typeof item.id === 'string') {
    const base = item.id.trim() || 'item'
    let index = existing.length + 1
    let id = `${base}-${index}`
    const used = new Set(existing.map((entry) => String(entry.id ?? '')))
    while (used.has(id)) {
      index += 1
      id = `${base}-${index}`
    }
    item.id = id
  }
  return item
}

const iconByName: Record<string, LucideIcon> = {
  CalendarDays,
  Clipboard,
  Database,
  ExternalLink,
  FileText,
  Folder,
  Globe: Globe2,
  Globe2,
  Hash,
  Image,
  Link,
  ListOrdered,
  MousePointerClick,
  Power,
  Tags,
  ToggleLeft,
  Type,
}

function fieldIconComponent(
  kind: PluginSettingsField['kind'] | PluginSettingsObjectListItemField['kind'],
  icon?: string,
): LucideIcon {
  if (icon && iconByName[icon]) return iconByName[icon]
  if (kind === 'switch') return ToggleLeft
  if (kind === 'number') return Hash
  if (kind === 'select') return ListOrdered
  if (kind === 'object-list') return Link
  if (kind === 'textarea' || kind === 'string-list' || kind === 'list') return FileText
  if (kind === 'modal') return MousePointerClick
  return Type
}

function permissionReason(permissions: PluginPermissionSnapshot | undefined, required: PluginPermission[] | undefined, locale: Locale): string {
  if (!permissions || !required?.length) return ''
  const missing = required.filter((permission) => !permissions[permission]?.granted)
  if (missing.length === 0) return ''
  const labels = missing.map((permission) => describePluginPermission(permission, locale)).join(' · ')
  return translate(locale, 'scripts', 'settingsPermissionRequired', { permissions: labels })
}

function isRenderableField<TSettings>(field: PluginSettingsField<TSettings>): boolean {
  return field.kind !== 'select' || field.options.length > 1 || Boolean(field.optionsFromList)
}

function hasEnoughOptions(field: PluginSettingsObjectListItemField): boolean {
  return field.kind !== 'select' || (field.options?.length ?? 0) > 1
}

function clampNumber(value: number, min?: number, max?: number): number {
  if (Number.isFinite(min) && value < Number(min)) return Number(min)
  if (Number.isFinite(max) && value > Number(max)) return Number(max)
  return value
}

function formatNumberInputValue(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(4)))
}

function matchesCondition(record: Record<string, unknown>, condition: PluginSettingsCondition | undefined): boolean {
  if (!condition) return true
  const value = record[condition.key]
  if ('equals' in condition && value !== condition.equals) return false
  if ('notEquals' in condition && value === condition.notEquals) return false
  if (condition.in && !condition.in.includes(value)) return false
  if (condition.truthy !== undefined && Boolean(value) !== condition.truthy) return false
  return true
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (value <= 0) return '∞'
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}m`
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`
  return value.toLocaleString()
}

export function PluginSettingsSchemaRenderer<TSettings = unknown>({
  schema,
  locale,
  value,
  updateValue,
  onOpenModal,
  permissions,
}: PluginSettingsSchemaRendererProps<TSettings>) {
  const record = getSettingsRecord(value)
  const [openObjectListCards, setOpenObjectListCards] = useState<Record<string, string>>({})
  const [openSelectId, setOpenSelectId] = useState<string | null>(null)
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({})

  function setFieldValue(key: string, next: unknown) {
    updateValue({ [key]: next } as Partial<TSettings>)
  }

  function getSelectOptions(field: Extract<PluginSettingsField<TSettings>, { kind: 'select' }>) {
    const source = field.optionsFromList
    if (!source) return field.options
    const items = getObjectList(record[source.listKey])
    const options = items.map((item, index) => {
      const value = String(item[source.valueKey] ?? '')
      const labelValue = item[source.labelKey ?? source.valueKey] ?? item[source.fallbackLabelKey ?? source.valueKey] ?? value
      const label = String(labelValue || `${index + 1}`)
      return { value, label }
    }).filter((option) => option.value)
    return options.length > 0 ? options : field.options
  }

  function formatObjectListSummaryValue(field: PluginSettingsObjectListField<TSettings>, item: Record<string, unknown>, key: string): string {
    const value = item[key]
    if (typeof value === 'boolean') return value ? translate(locale, 'scripts', 'status.enabled') : translate(locale, 'scripts', 'status.disabled')
    const itemField = field.fields.find((candidate) => candidate.key === key)
    if (itemField?.kind === 'select') {
      const option = itemField.options?.find((candidate) => candidate.value === String(value))
      if (option) return localize(option.label, option.labelI18n, locale)
    }
    if (typeof value === 'number' && (itemField?.kind === 'preset-number' || itemField?.kind === 'number')) {
      const preset = itemField.presets?.find((p) => p.value === value)
      if (preset) return localize(preset.label, preset.labelI18n, locale)
      return compactNumber(value)
    }
    if (typeof value === 'number') return compactNumber(value)
    return String(value ?? '')
  }

  function renderObjectListSummary(field: PluginSettingsObjectListField<TSettings>, item: Record<string, unknown>) {
    const summaries = field.summaryFields ?? []
    if (summaries.length === 0) return null
    const chips = summaries.map((summary) => {
      const value = formatObjectListSummaryValue(field, item, summary.key)
      const text = value || localize(summary.emptyText, summary.emptyTextI18n, locale)
      if (!text) return null
      const label = localize(summary.label, summary.labelI18n, locale)
      return { key: summary.key, label, text }
    }).filter((chip): chip is { key: string; label: string; text: string } => Boolean(chip))
    if (chips.length === 0) return null
    return (
      <span className="schema-object-list-summary wr-summary">
        {chips.map((chip) => (
          <span className="schema-object-list-summary-chip wr-summary-chip" key={chip.key}>
            {chip.label && <span className="wr-summary-label">{chip.label}</span>}
            <span>{chip.text}</span>
          </span>
        ))}
      </span>
    )
  }


  function objectListItemTitle(field: PluginSettingsObjectListField<TSettings>, item: Record<string, unknown>, itemIndex: number, itemLabel: string): string {
    const titleKey = field.itemTitleKey ?? 'title'
    return String(item[titleKey] ?? '') || `${itemLabel} ${itemIndex + 1}`
  }

  function objectListItemTone(item: Record<string, unknown>): string {
    const enabled = item.enabled
    if (typeof enabled === 'boolean') return enabled ? 'enabled' : 'disabled'
    return 'neutral'
  }

  function renderFieldTitle(label: string, description: string, reason = '') {
    return (
      <div className="schema-row-main">
        <div className="schema-row-name">{label}</div>
        {(reason || description) && (
          <div className={`schema-row-desc ${reason ? 'schema-row-desc-reason' : ''}`}>
            {reason || description}
          </div>
        )}
      </div>
    )
  }

  function renderControlLabel(label: string, description: string) {
    return (
      <>
        <span>{label}</span>
        {description && <small>{description}</small>}
      </>
    )
  }

  function isVisibleObjectListItemField(field: PluginSettingsObjectListItemField, item: Record<string, unknown>): boolean {
    return hasEnoughOptions(field) && matchesCondition(item, field.visibleWhen)
  }

  function isRequiredObjectListItemField(field: PluginSettingsObjectListItemField, item: Record<string, unknown>): boolean {
    return Boolean(field.required || matchesCondition(item, field.requiredWhen))
  }

  function isEmptyValue(value: unknown): boolean {
    return value === undefined || value === null || value === ''
  }

  function validationMessage(field: PluginSettingsObjectListItemField, item: Record<string, unknown>): string {
    if (!isRequiredObjectListItemField(field, item) || !isEmptyValue(item[field.key])) return ''
    return translate(locale, 'scripts', 'settingsRequired')
  }

  function renderSelectControl(
    id: string,
    currentValue: string,
    options: { value: string; label: string; labelI18n?: Partial<Record<Locale, string>> }[],
    onChange: (next: string) => void,
    disabled?: boolean,
  ) {
    const selected = options.find((option) => option.value === currentValue) ?? options[0]
    const isOpen = openSelectId === id
    return (
      <div
        className={`schema-select-wrap ${isOpen ? 'is-open' : ''}`}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setOpenSelectId((current) => (current === id ? null : current))
          }
        }}
      >
        <button
          type="button"
          className="schema-select-trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setOpenSelectId((current) => (current === id ? null : id))}
        >
          <span>{selected ? localize(selected.label, selected.labelI18n, locale) : ''}</span>
          <ChevronDown className="schema-select-chevron" size={14} strokeWidth={1.8} />
        </button>
        {isOpen && (
          <div className="schema-select-menu" role="listbox">
            {options.map((option) => {
              const selectedOption = option.value === currentValue
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedOption}
                  className={`schema-select-option ${selectedOption ? 'is-selected' : ''}`}
                  key={option.value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option.value)
                    setOpenSelectId(null)
                  }}
                >
                  <span>{localize(option.label, option.labelI18n, locale)}</span>
                  {selectedOption && <Check className="schema-select-check" size={13} strokeWidth={2} />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  function renderObjectListItemField(
    itemField: PluginSettingsObjectListItemField,
    item: Record<string, unknown>,
    controlId: string,
    onChange: (next: unknown) => void,
  ) {
    const label = localize(itemField.label, itemField.labelI18n, locale)
    const description = localize(itemField.description, itemField.descriptionI18n, locale)
    const placeholder = localize(itemField.placeholder, itemField.placeholderI18n, locale)
    const value = item[itemField.key]
    const itemLabel = renderControlLabel(label, description)
    const error = validationMessage(itemField, item)

    function commitAliasInput(event: KeyboardEvent<HTMLInputElement>) {
      const input = event.currentTarget
      if (event.key === 'Backspace' && input.value === '') {
        const current = Array.isArray(value) ? value.map(String) : []
        if (current.length > 0) {
          event.preventDefault()
          onChange(current.slice(0, -1))
        }
        return
      }
      if (event.key !== 'Enter') return
      event.preventDefault()
      const nextAlias = input.value.trim()
      if (!nextAlias) return
      const current = Array.isArray(value) ? value.map(String) : []
      if (!current.includes(nextAlias)) onChange([...current, nextAlias])
      input.value = ''
    }

    if (itemField.kind === 'callout') {
      return (
        <div className={`schema-object-list-callout wr-callout wr-callout-${itemField.tone ?? 'info'}`}>
          <span className="wr-callout-title">{label}</span>
          {description && <span className="wr-callout-copy">{description}</span>}
        </div>
      )
    }

    if (itemField.kind === 'switch') {
      return (
        <label className="schema-object-list-switch wr-field">
          <span className="schema-object-list-switch-copy">{itemLabel}</span>
          <input className="schema-native-hidden" type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.currentTarget.checked)} />
          <span className={`sw schema-switch ${value ? 'on' : ''}`} />
        </label>
      )
    }

    if (itemField.kind === 'select') {
      return (
        <div className="schema-object-list-field schema-object-list-field-select wr-field">
          <span>{itemLabel}</span>
          {renderSelectControl(controlId, String(value ?? ''), itemField.options ?? [], onChange)}
          {error && <small className="wr-error">{error}</small>}
        </div>
      )
    }

    if (itemField.kind === 'string-list') {
      const aliases = Array.isArray(value) ? value.map(String) : []
      return (
        <label className="schema-object-list-field schema-object-list-field-wide wr-field">
          {itemLabel}
          <div className="schema-alias-box wr-aliases">
            {aliases.map((alias) => (
              <span className="schema-alias-chip wr-chip" key={alias}>
                {alias}
                <button
                  type="button"
                  className="wr-chip-x"
                  onClick={() => onChange(aliases.filter((candidate) => candidate !== alias))}
                  aria-label={`${label}: ${alias}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input className="wr-alias-in" type="text" placeholder={placeholder} onKeyDown={commitAliasInput} />
          </div>
        </label>
      )
    }

    if (itemField.kind === 'number' || itemField.kind === 'preset-number') {
      const numericValue = typeof value === 'number' ? value : Number(value) || 0
      return (
        <label className="schema-object-list-field wr-field">
          {itemLabel}
          {itemField.kind === 'preset-number' && itemField.presets?.length ? (
            <span className="wr-preset-row">
              {itemField.presets.map((preset) => (
                <button
                  type="button"
                  className={`wr-preset ${numericValue === preset.value ? 'is-active' : ''}`}
                  key={preset.value}
                  onClick={() => onChange(preset.value)}
                >
                  {localize(preset.label, preset.labelI18n, locale)}
                </button>
              ))}
            </span>
          ) : null}
          <input
            className="wr-in wr-mono"
            type="text"
            value={numericValue}
            placeholder={placeholder}
            onChange={(event) => onChange(Number(event.currentTarget.value) || 0)}
          />
          {error && <small className="wr-error">{error}</small>}
        </label>
      )
    }

    if (itemField.kind === 'textarea') {
      return (
        <label className="schema-object-list-field schema-object-list-field-wide wr-field">
          {itemLabel}
          <textarea
            className={`wr-in ${itemField.mono || itemField.key.toLowerCase().includes('url') ? 'wr-mono' : ''}`}
            rows={itemField.rows ?? 4}
            value={String(value ?? '')}
            placeholder={placeholder}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
          {error && <small className="wr-error">{error}</small>}
        </label>
      )
    }

    return (
      <label className="schema-object-list-field wr-field">
        {itemLabel}
        <input
          className={`wr-in ${itemField.mono || itemField.key.toLowerCase().includes('url') ? 'wr-mono' : ''}`}
          type={itemField.sensitive || itemField.kind === 'secret' ? 'password' : 'text'}
          value={String(value ?? '')}
          placeholder={placeholder}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        {itemField.kind === 'secret' && !isEmptyValue(value) && <small className="wr-secret-state">{translate(locale, 'scripts', 'settingsSecretSaved')}</small>}
        {error && <small className="wr-error">{error}</small>}
      </label>
    )
  }

  function renderObjectListItemGroups(
    field: PluginSettingsObjectListField<TSettings>,
    item: Record<string, unknown>,
    cardId: string,
    itemIndex: number,
    items: Record<string, unknown>[],
  ) {
    const visibleFields = field.fields.filter((itemField) => isVisibleObjectListItemField(itemField, item))
    const groups = field.groups ?? []
    const fallbackGroup: PluginSettingsObjectListGroup = { id: '', title: '' }
    const renderFields = (groupFields: PluginSettingsObjectListItemField[]) => groupFields.map((itemField) => (
      <div key={itemField.key} className={`wr-field-shell wr-kind-${itemField.kind}${itemField.wide ? ' wr-wide' : ''}${itemField.inline ? ' wr-inline' : ''}`}>
        {renderObjectListItemField(itemField, item, `${field.key}:${cardId}:${itemField.key}`, (next) => {
          setFieldValue(field.key, items.map((candidate, index) => (
            index === itemIndex ? { ...candidate, [itemField.key]: next } : candidate
          )))
        })}
      </div>
    ))
    const grouped = groups.length > 0 ? [...groups, fallbackGroup] : [fallbackGroup]
    return grouped.map((group) => {
      const groupFields = visibleFields.filter((itemField) => (itemField.groupId ?? '') === group.id)
      if (groupFields.length === 0) return null
      if (!group.id) return renderFields(groupFields)
      return (
        <div className="wr-group" key={group.id}>
          <div className="wr-group-head">
            <span>
              <strong>{localize(group.title, group.titleI18n, locale)}</strong>
              {localize(group.description, group.descriptionI18n, locale) && <small>{localize(group.description, group.descriptionI18n, locale)}</small>}
            </span>
          </div>
          <div className="wr-group-body">{renderFields(groupFields)}</div>
        </div>
      )
    })
  }

  function renderField(field: PluginSettingsField<TSettings>) {
    const label = localize(field.label, field.labelI18n, locale)
    const description = localize(field.description, field.descriptionI18n, locale)
    const reason = permissionReason(permissions, field.requires, locale)
    const disabled = Boolean(field.disabled || reason)
    const commonLabel = renderFieldTitle(label, description, reason)
    const Icon = fieldIconComponent(field.kind, field.icon)

    if (field.kind === 'switch') {
      return (
        <label className={`schema-row ${disabled ? 'is-disabled' : ''}`}>
          <span className="schema-row-icon"><Icon size={14} strokeWidth={1.8} /></span>
          {commonLabel}
          <span className="schema-row-control">
            <input
              className="schema-native-hidden"
              type="checkbox"
              checked={Boolean(record[field.key])}
              disabled={disabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setFieldValue(field.key, event.currentTarget.checked)}
            />
            <span className={`sw schema-switch ${record[field.key] ? 'on' : ''}`} />
          </span>
        </label>
      )
    }

    if (field.kind === 'number') {
      const scale = field.storageScale && field.storageScale > 0 ? field.storageScale : 1
      const rawValue = typeof record[field.key] === 'number' ? Number(record[field.key]) : 0
      const displayValue = scale === 1 ? rawValue : rawValue / scale
      const displayText = numberDrafts[field.key] ?? formatNumberInputValue(displayValue)
      const unitLabel = localize(field.unit, field.unitI18n, locale)
      const parsedDisplayValue = Number.parseFloat(displayText)
      const isAtMin = Number.isFinite(field.min) && Number.isFinite(displayValue) && displayValue <= Number(field.min)
      const isAtMax = Number.isFinite(field.max) && Number.isFinite(displayValue) && displayValue >= Number(field.max)
      const commitDisplayValue = (nextDisplayValue: number) => {
        const clamped = clampNumber(nextDisplayValue, field.min, field.max)
        setFieldValue(field.key, scale === 1 ? clamped : Math.round(clamped * scale))
      }
      const commitDraft = () => {
        const draft = numberDrafts[field.key]
        if (draft === undefined) return
        const next = Number.parseFloat(draft)
        if (Number.isFinite(next)) {
          commitDisplayValue(next)
        }
        setNumberDrafts((current) => {
          const { [field.key]: _removed, ...rest } = current
          return rest
        })
      }
      const stepValue = (direction: -1 | 1) => {
        const base = Number.isFinite(parsedDisplayValue) ? parsedDisplayValue : displayValue
        const step = Number.isFinite(field.step) && Number(field.step) > 0 ? Number(field.step) : 1
        commitDisplayValue(base + direction * step)
        setNumberDrafts((current) => {
          const { [field.key]: _removed, ...rest } = current
          return rest
        })
      }
      return (
        <label className={`schema-row ${disabled ? 'is-disabled' : ''}`}>
          <span className="schema-row-icon"><Icon size={14} strokeWidth={1.8} /></span>
          {commonLabel}
          <div className="schema-row-control">
            <span className="plugin-settings-stepper" data-disabled={disabled ? 'true' : undefined}>
              <button
                type="button"
                className="plugin-settings-stepper-btn"
                disabled={disabled || isAtMin}
                aria-label={`${label} -`}
                onClick={() => stepValue(-1)}
              >
                <Minus size={13} strokeWidth={2} />
              </button>
              <input
                className="plugin-settings-stepper-input"
                type="text"
                inputMode="decimal"
                value={displayText}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const next = event.currentTarget.value.trim()
                  setNumberDrafts((current) => ({ ...current, [field.key]: next }))
                  const numericValue = Number.parseFloat(next)
                  if (Number.isFinite(numericValue)) commitDisplayValue(numericValue)
                }}
                onBlur={commitDraft}
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    stepValue(1)
                    return
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    stepValue(-1)
                  }
                }}
              />
              <button
                type="button"
                className="plugin-settings-stepper-btn"
                disabled={disabled || isAtMax}
                aria-label={`${label} +`}
                onClick={() => stepValue(1)}
              >
                <Plus size={13} strokeWidth={2} />
              </button>
              {unitLabel && <span className="plugin-settings-stepper-unit">{unitLabel}</span>}
            </span>
          </div>
        </label>
      )
    }

    if (field.kind === 'select') {
      return (
        <div className={`schema-row ${disabled ? 'is-disabled' : ''}`}>
          <span className="schema-row-icon"><Icon size={14} strokeWidth={1.8} /></span>
          {commonLabel}
          <div className="schema-row-control">
            {renderSelectControl(`field:${field.key}`, String(record[field.key] ?? ''), getSelectOptions(field), (next) => setFieldValue(field.key, next), disabled)}
          </div>
        </div>
      )
    }

    if (field.kind === 'text') {
      return (
        <label className={`schema-field-block ${disabled ? 'is-disabled' : ''}`}>
          {commonLabel}
          <input
            className={field.mono ? 'schema-mono' : undefined}
            type="text"
            value={String(record[field.key] ?? '')}
            placeholder={localize(field.placeholder, field.placeholderI18n, locale)}
            disabled={disabled}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setFieldValue(field.key, event.currentTarget.value)}
          />
        </label>
      )
    }

    if (field.kind === 'textarea') {
      return (
        <label className={`schema-field-block ${disabled ? 'is-disabled' : ''}`}>
          {commonLabel}
          <textarea
            className={field.mono ? 'schema-mono' : undefined}
            rows={field.rows ?? 4}
            value={String(record[field.key] ?? '')}
            placeholder={localize(field.placeholder, field.placeholderI18n, locale)}
            disabled={disabled}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setFieldValue(field.key, event.currentTarget.value)}
          />
        </label>
      )
    }

    if (field.kind === 'list') {
      return (
        <label className={`schema-field-block ${disabled ? 'is-disabled' : ''}`}>
          {commonLabel}
          <textarea
            className="schema-mono"
            rows={8}
            defaultValue={stringifyJson(record[field.key])}
            disabled={disabled}
            onBlur={(event: ChangeEvent<HTMLTextAreaElement>) => {
              try {
                setFieldValue(field.key, JSON.parse(event.currentTarget.value))
              } catch {
                event.currentTarget.value = stringifyJson(record[field.key])
              }
            }}
          />
        </label>
      )
    }

    if (field.kind === 'object-list') {
      const items = getObjectList(record[field.key])
      const itemLabel = localize(field.itemLabel, field.itemLabelI18n, locale) || label
      const addLabel = localize(field.addLabel, field.addLabelI18n, locale) || '+'
      const addItem = () => {
        const nextItem = makeListItem(field.itemDefaults, items)
        const nextCardId = String(nextItem.id ?? items.length)
        setFieldValue(field.key, [...items, nextItem])
        setOpenObjectListCards((current) => ({ ...current, [field.key]: nextCardId }))
      }
      const activeCardId = openObjectListCards[field.key] ?? String(items[0]?.id ?? 0)
      const activeItemIndex = Math.max(0, items.findIndex((item, index) => String(item.id ?? index) === activeCardId))
      const activeItem = items[activeItemIndex]
      if (field.display === 'master-detail') {
        return (
          <div className={`schema-object-list d-rules schema-object-list-master-detail ${disabled ? 'is-disabled' : ''}`}>
            <div className="schema-object-list-head">
              {commonLabel}
            </div>
            {items.length === 0 || !activeItem ? (
              <div className="schema-object-list-empty">
                {localize(field.emptyText, field.emptyTextI18n, locale)}
              </div>
            ) : (
              <div className="schema-object-list-md">
                <div className="schema-object-list-md-list" role="listbox" aria-label={label}>
                  {items.map((item, itemIndex) => {
                    const cardId = String(item.id ?? itemIndex)
                    const title = objectListItemTitle(field, item, itemIndex, itemLabel)
                    const isSelected = itemIndex === activeItemIndex
                    return (
                      <div
                        className={`schema-object-list-md-row is-${objectListItemTone(item)} ${isSelected ? 'is-selected' : ''}`}
                        key={`${cardId}-${itemIndex}`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <button
                          type="button"
                          className="schema-object-list-md-row-btn"
                          disabled={disabled}
                          onClick={() => setOpenObjectListCards((current) => ({ ...current, [field.key]: cardId }))}
                        >
                          <span className="schema-object-list-md-avatar">{title.slice(0, 1).toUpperCase()}</span>
                          <span className="schema-object-list-md-copy">
                            <span className="schema-object-list-md-title">{title}</span>
                            {renderObjectListSummary(field, item)}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="schema-object-list-md-row-x"
                          disabled={disabled}
                          aria-label="Delete"
                          onClick={(e) => {
                            e.stopPropagation()
                            const nextItems = items.filter((_, index) => index !== itemIndex)
                            const nextActive = nextItems[Math.min(itemIndex, nextItems.length - 1)]
                            setFieldValue(field.key, nextItems)
                            setOpenObjectListCards((current) => ({ ...current, [field.key]: nextActive ? String(nextActive.id ?? Math.min(itemIndex, nextItems.length - 1)) : '' }))
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                  <button
                    type="button"
                    className="schema-object-list-md-add"
                    disabled={disabled}
                    onClick={addItem}
                  >
                    <span>＋</span>{addLabel}
                  </button>
                </div>
                <div className={`schema-object-list-md-detail is-${objectListItemTone(activeItem)}`}>
                  <div className={`schema-object-list-grid wr-body wr-cols-${field.detailColumns ?? 1}`}>
                    {renderObjectListItemGroups(field, activeItem, String(activeItem.id ?? activeItemIndex), activeItemIndex, items)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      }
      return (
        <div className={`schema-object-list d-rules ${disabled ? 'is-disabled' : ''}`}>
          <div className="schema-object-list-head">
            {commonLabel}
          </div>
          {items.length === 0 ? (
            <div className="schema-object-list-empty">
              {localize(field.emptyText, field.emptyTextI18n, locale)}
            </div>
          ) : (
            <div className="schema-object-list-items">
              {items.map((item, itemIndex) => {
                const cardId = String(item.id ?? itemIndex)
                const openCardId = openObjectListCards[field.key]
                const isOpen = openCardId ? openCardId === cardId : itemIndex === 0
                const title = objectListItemTitle(field, item, itemIndex, itemLabel)
                return (
                <details
                  className={`schema-object-list-card wr-card ${isOpen ? 'open' : ''}`}
                  key={`${cardId}-${itemIndex}`}
                  open={isOpen}
                  onToggle={(event) => {
                    const nextOpen = event.currentTarget.open
                    setOpenObjectListCards((current) => {
                      if (nextOpen) return { ...current, [field.key]: cardId }
                      if (current[field.key] !== cardId) return current
                      const { [field.key]: _removed, ...rest } = current
                      return rest
                    })
                  }}
                >
                  <summary className="schema-object-list-card-head wr-head">
                    <span className="schema-object-list-caret wr-caret">›</span>
                    <span className="wr-htext">
                      <span className="schema-object-list-title wr-title">{title}</span>
                      {renderObjectListSummary(field, item)}
                      {Array.isArray(item.aliases) && item.aliases.length > 0 && (
                        <span className="schema-object-list-tag wr-kwtag">
                          {String(item.aliases[0])}{item.aliases.length > 1 ? ` +${item.aliases.length - 1}` : ''}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="wr-del"
                      disabled={disabled}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setFieldValue(field.key, items.filter((_, index) => index !== itemIndex))
                      }}
                    >
                      ×
                    </button>
                  </summary>
                  <div className="schema-object-list-grid wr-body">
                    {renderObjectListItemGroups(field, item, cardId, itemIndex, items)}
                  </div>
                </details>
                )
              })}
            </div>
          )}
          <button
            type="button"
            className="schema-object-list-add wr-add"
            disabled={disabled}
            onClick={addItem}
          >
            <span>＋</span>{addLabel}
          </button>
        </div>
      )
    }

    if (field.kind === 'modal') {
      return (
        <div className={`schema-row ${disabled ? 'is-disabled' : ''}`}>
          <span className="schema-row-icon"><Icon size={14} strokeWidth={1.8} /></span>
          {commonLabel}
          <button
            type="button"
            className="schema-row-control schema-button"
            disabled={disabled}
            onClick={() => onOpenModal(field)}
          >
            {localize(field.buttonLabel, field.buttonLabelI18n, locale) || label}
          </button>
        </div>
      )
    }

    return null
  }

  return (
    <div className="schema-settings">
      {schema.sections.map((section) => {
        const fields = section.fields.filter(isRenderableField)
        if (fields.length === 0) return null
        return (
          <section key={section.id} className="schema-section">
            {(section.title || section.titleI18n || section.description || section.descriptionI18n) && (
              <header className="schema-section-header">
                {localize(section.title, section.titleI18n, locale) && (
                  <h3>{localize(section.title, section.titleI18n, locale)}</h3>
                )}
                {localize(section.description, section.descriptionI18n, locale) && (
                  <p>{localize(section.description, section.descriptionI18n, locale)}</p>
                )}
              </header>
            )}
            <div className="schema-section-body">
              {fields.map((field) => (
                <div key={field.kind === 'modal' ? field.id : field.key} className={`schema-field schema-field-${field.kind}`}>
                  {renderField(field)}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
