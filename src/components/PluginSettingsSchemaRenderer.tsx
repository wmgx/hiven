import { useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  CalendarDays,
  Clipboard,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Folder,
  Globe2,
  Hash,
  History,
  Image,
  Link,
  ListOrdered,
  MousePointerClick,
  Power,
  Tags,
  ToggleLeft,
  Type,
  type LucideIcon,
} from 'lucide-react'
import type {
  PluginSettingsField,
  PluginSettingsModalField,
  PluginSettingsObjectListItemField,
  PluginSettingsSchema,
  PluginPermission,
  PluginPermissionSnapshot,
} from '../workspace/pluginTypes'
import { describePluginPermission } from '../workspace/pluginPermissions'
import { translate, type Locale } from '../i18n'
import { NumberField, Select, Switch } from '../plugin-ui'

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
  History,
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
  if (field.kind !== 'select') return true
  if (field.optionsFrom) return true
  return field.options.length > 1
}

function isRenderableObjectListItemField(field: PluginSettingsObjectListItemField): boolean {
  return field.kind !== 'select' || (field.options?.length ?? 0) > 1
}

function resolveSelectOptions(
  field: { options?: { value: string; label: string; labelI18n?: Partial<Record<Locale, string>> }[]; optionsFrom?: { listKey: string; valueKey?: string; labelKey?: string } },
  record: Record<string, unknown>,
): { value: string; label: string; labelI18n?: Partial<Record<Locale, string>> }[] {
  if (field.optionsFrom) {
    const list = getObjectList(record[field.optionsFrom.listKey])
    const valueKey = field.optionsFrom.valueKey ?? 'id'
    const labelKey = field.optionsFrom.labelKey ?? 'name'
    return list.map((item, index) => ({
      value: String(item[valueKey] ?? index),
      label: String(item[labelKey] ?? item[valueKey] ?? index),
    }))
  }
  return field.options ?? []
}

function isItemFieldVisible(field: PluginSettingsObjectListItemField, item: Record<string, unknown>): boolean {
  if (!field.visibleWhen) return true
  return item[field.visibleWhen.key] === field.visibleWhen.equals
}

function clampNumber(value: number, min?: number, max?: number): number {
  if (Number.isFinite(min) && value < Number(min)) return Number(min)
  if (Number.isFinite(max) && value > Number(max)) return Number(max)
  return value
}

function isEmptySettingsValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

function validateSettingsFieldValue(
  field: {
    required?: boolean
    validate?: (value: unknown, ctx: never) => string | null | undefined
    kind?: string
    min?: number
    max?: number
  },
  raw: unknown,
  ctx: unknown,
  locale: Locale,
): string {
  if (field.required && isEmptySettingsValue(raw)) {
    return translate(locale, 'scripts', 'settingsFieldRequired')
  }
  if (field.kind === 'number' && typeof raw === 'number' && Number.isFinite(raw)) {
    if (Number.isFinite(field.min) && raw < Number(field.min)) {
      return translate(locale, 'scripts', 'settingsFieldOutOfRange', {
        min: String(field.min),
        max: String(field.max ?? field.min),
      })
    }
    if (Number.isFinite(field.max) && raw > Number(field.max)) {
      return translate(locale, 'scripts', 'settingsFieldOutOfRange', {
        min: String(field.min ?? field.max),
        max: String(field.max),
      })
    }
  }
  if (typeof field.validate === 'function') {
    try {
      const message = field.validate(raw, ctx as never)
      if (typeof message === 'string' && message.trim()) return message
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  return ''
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
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({})
  const [visibleSensitiveKeys, setVisibleSensitiveKeys] = useState<Set<string>>(new Set())
  const [touchedKeys, setTouchedKeys] = useState<Set<string>>(() => new Set())
  function setFieldValue(key: string, next: unknown) {
    updateValue({ [key]: next } as Partial<TSettings>)
  }

  function markTouched(key: string) {
    setTouchedKeys((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }

  function renderFieldError(message: string) {
    if (!message) return null
    return (
      <div className="schema-field-error" role="alert">
        {message}
      </div>
    )
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

  function renderSelectControl(
    id: string,
    currentValue: string,
    options: { value: string; label: string; labelI18n?: Partial<Record<Locale, string>> }[],
    onChange: (next: string) => void,
    disabled?: boolean,
  ) {
    return (
      <Select
        id={id}
        className="schema-select-wrap"
        value={currentValue}
        disabled={disabled}
        options={options.map((option) => ({
          value: option.value,
          label: localize(option.label, option.labelI18n, locale),
        }))}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
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

    if (itemField.kind === 'switch') {
      return (
        <div className="schema-object-list-switch wr-field">
          <span className="schema-object-list-switch-copy">{itemLabel}</span>
          <Switch checked={Boolean(value)} onCheckedChange={onChange} aria-label={label} />
        </div>
      )
    }

    if (itemField.kind === 'select') {
      return (
        <div className="schema-object-list-field schema-object-list-field-select wr-field schema-object-list-field-wide">
          <span>{itemLabel}</span>
          {renderSelectControl(controlId, String(value ?? ''), itemField.options ?? [], onChange)}
        </div>
      )
    }

    if (itemField.kind === 'number') {
      const unitLabel = localize(itemField.unit, itemField.unitI18n, locale)
      const numeric = typeof value === 'number' ? value : Number(value)
      return (
        <label className="schema-object-list-field wr-field">
          {itemLabel}
          <span className="plugin-settings-num-field-row">
            <NumberField
              value={Number.isFinite(numeric) ? numeric : 0}
              min={itemField.min}
              max={itemField.max}
              aria-label={label}
              onChange={(next) => onChange(clampNumber(next, itemField.min, itemField.max))}
            />
            {unitLabel && <span className="plugin-settings-num-unit">{unitLabel}</span>}
          </span>
        </label>
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
        </label>
      )
    }

    if (itemField.sensitive) {
      const sensitiveKey = `${controlId}`
      const isVisible = visibleSensitiveKeys.has(sensitiveKey)
      return (
        <label className="schema-object-list-field wr-field">
          {itemLabel}
          <span className="wr-sensitive-wrap">
            <input
              className={`wr-in ${itemField.mono || itemField.key.toLowerCase().includes('url') ? 'wr-mono' : ''}`}
              type={isVisible ? 'text' : 'password'}
              value={String(value ?? '')}
              placeholder={placeholder}
              onChange={(event) => onChange(event.currentTarget.value)}
            />
            <button
              type="button"
              className="wr-sensitive-toggle"
              aria-label={isVisible ? translate(locale, 'scripts', 'settingsSensitiveHide') : translate(locale, 'scripts', 'settingsSensitiveShow')}
              onClick={() => setVisibleSensitiveKeys((prev) => {
                const next = new Set(prev)
                if (next.has(sensitiveKey)) next.delete(sensitiveKey)
                else next.add(sensitiveKey)
                return next
              })}
            >
              {isVisible ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
            </button>
          </span>
        </label>
      )
    }

    return (
      <label className="schema-object-list-field wr-field">
        {itemLabel}
        <input
          className={`wr-in ${itemField.mono || itemField.key.toLowerCase().includes('url') ? 'wr-mono' : ''}`}
          type="text"
          value={String(value ?? '')}
          placeholder={placeholder}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    )
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
        <div className={`schema-row ${disabled ? 'is-disabled' : ''}`}>
          <span className="schema-row-icon"><Icon size={14} strokeWidth={1.8} /></span>
          {commonLabel}
          <span className="schema-row-control">
            <Switch
              checked={Boolean(record[field.key])}
              disabled={disabled}
              aria-label={label}
              onCheckedChange={(next) => setFieldValue(field.key, next)}
            />
          </span>
        </div>
      )
    }

    if (field.kind === 'number') {
      const scale = field.storageScale && field.storageScale > 0 ? field.storageScale : 1
      const rawValue = typeof record[field.key] === 'number' ? Number(record[field.key]) : 0
      const displayValue = scale === 1 ? rawValue : rawValue / scale
      const unitLabel = localize(field.unit, field.unitI18n, locale)
      const commitDisplayValue = (nextDisplayValue: number) => {
        const clamped = clampNumber(nextDisplayValue, field.min, field.max)
        setFieldValue(field.key, scale === 1 ? clamped : Math.round(clamped * scale))
      }
      const errorMessage = touchedKeys.has(field.key)
        ? validateSettingsFieldValue({ ...field, kind: 'number' }, scale === 1 ? rawValue : displayValue, value, locale)
        : ''
      return (
        <label className={`schema-row ${disabled ? 'is-disabled' : ''} ${errorMessage ? 'has-error' : ''}`}>
          <span className="schema-row-icon"><Icon size={14} strokeWidth={1.8} /></span>
          {commonLabel}
          <div className="schema-row-control schema-row-control-number">
            <span className="plugin-settings-num-field">
              <NumberField
                value={Number.isFinite(displayValue) ? displayValue : 0}
                min={field.min}
                max={field.max}
                disabled={disabled}
                aria-label={label}
                aria-invalid={Boolean(errorMessage)}
                onChange={commitDisplayValue}
                onBlur={() => markTouched(field.key)}
              />
            </span>
            {unitLabel && <span className="plugin-settings-num-unit">{unitLabel}</span>}
            {renderFieldError(errorMessage)}
          </div>
        </label>
      )
    }

    if (field.kind === 'select') {
      const options = resolveSelectOptions(field, record)
      return (
        <div className={`schema-row ${disabled ? 'is-disabled' : ''}`}>
          <span className="schema-row-icon"><Icon size={14} strokeWidth={1.8} /></span>
          {commonLabel}
          <div className="schema-row-control">
            {renderSelectControl(`field:${field.key}`, String(record[field.key] ?? ''), options, (next) => setFieldValue(field.key, next), disabled)}
          </div>
        </div>
      )
    }

    if (field.kind === 'text') {
      const errorMessage = touchedKeys.has(field.key)
        ? validateSettingsFieldValue(field, record[field.key], value, locale)
        : ''
      return (
        <label className={`schema-field-block ${disabled ? 'is-disabled' : ''} ${errorMessage ? 'has-error' : ''}`}>
          {commonLabel}
          <input
            className={field.mono ? 'schema-mono' : undefined}
            type="text"
            value={String(record[field.key] ?? '')}
            placeholder={localize(field.placeholder, field.placeholderI18n, locale)}
            disabled={disabled}
            aria-invalid={Boolean(errorMessage)}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setFieldValue(field.key, event.currentTarget.value)}
            onBlur={() => markTouched(field.key)}
          />
          {renderFieldError(errorMessage)}
        </label>
      )
    }

    if (field.kind === 'textarea') {
      const errorMessage = touchedKeys.has(field.key)
        ? validateSettingsFieldValue(field, record[field.key], value, locale)
        : ''
      return (
        <label className={`schema-field-block ${disabled ? 'is-disabled' : ''} ${errorMessage ? 'has-error' : ''}`}>
          {commonLabel}
          <textarea
            className={field.mono ? 'schema-mono' : undefined}
            rows={field.rows ?? 4}
            value={String(record[field.key] ?? '')}
            placeholder={localize(field.placeholder, field.placeholderI18n, locale)}
            disabled={disabled}
            aria-invalid={Boolean(errorMessage)}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setFieldValue(field.key, event.currentTarget.value)}
            onBlur={() => markTouched(field.key)}
          />
          {renderFieldError(errorMessage)}
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
      const selectedCardId = openObjectListCards[field.key]
      const selectedIndex = items.findIndex((item, i) => String(item.id ?? i) === selectedCardId)
      const activeIndex = selectedIndex >= 0 ? selectedIndex : (items.length > 0 ? 0 : -1)
      const activeItem = activeIndex >= 0 ? items[activeIndex] : null
      const activeCardId = activeItem ? String(activeItem.id ?? activeIndex) : ''

      const addItem = () => {
        const nextItem = makeListItem(field.itemDefaults, items)
        const nextCardId = String(nextItem.id ?? items.length)
        setFieldValue(field.key, [...items, nextItem])
        setOpenObjectListCards((current) => ({ ...current, [field.key]: nextCardId }))
      }

      const titleKey = field.itemTitleKey ?? 'title'
      const tagsKey = field.itemTagsKey

      const emptyText = localize(field.emptyText, field.emptyTextI18n, locale)
        || translate(locale, 'scripts', 'settingsEmptyList')
      const emptyHint = translate(locale, 'scripts', 'settingsEmptyListHint')
      const deleteLabel = translate(locale, 'scripts', 'settingsDelete')
      const urlTemplate = activeItem ? String(activeItem.urlTemplate ?? '') : ''
      const previewSampleKey = `${field.key}:preview-sample`
      const previewSample = numberDrafts[previewSampleKey] ?? 'sample'
      const encodeQuery = activeItem?.encodeQuery !== false
      const previewUrl = urlTemplate
        ? urlTemplate.replaceAll('{query}', encodeQuery ? encodeURIComponent(previewSample) : previewSample)
        : ''

      return (
        <div className={`schema-object-list d-rules ${disabled ? 'is-disabled' : ''}`}>
          <div className="schema-object-list-head">
            {commonLabel}
          </div>
          <div className="schema-object-list-master-detail">
            <div className="schema-object-list-master">
              {items.map((item, itemIndex) => {
                const cardId = String(item.id ?? itemIndex)
                const title = String(item[titleKey] ?? '') || `${itemLabel} ${itemIndex + 1}`
                const isActive = itemIndex === activeIndex
                const isEnabled = item.enabled !== false
                const aliases = Array.isArray(item.aliases) ? item.aliases.map(String).filter(Boolean) : []
                const provider = typeof item.provider === 'string' ? item.provider : ''
                const subtitle = aliases.length > 0
                  ? aliases.slice(0, 3).join(' · ')
                  : provider
                    ? provider
                    : ''
                // Tags render verbatim unless the schema supplies a localized
                // label for that value — keeps persisted data language-neutral.
                const tags = tagsKey && Array.isArray(item[tagsKey])
                  ? (item[tagsKey] as unknown[]).map(String).filter(Boolean)
                  : []
                return (
                  <button
                    key={`${cardId}-${itemIndex}`}
                    type="button"
                    className={`schema-object-list-master-item ${isActive ? 'is-active' : ''}`}
                    onClick={() => setOpenObjectListCards((current) => ({ ...current, [field.key]: cardId }))}
                  >
                    <span className="schema-object-list-master-item-top">
                      <span className={`schema-object-list-master-dot ${isEnabled ? 'is-on' : ''}`} />
                      <span className="schema-object-list-master-title">{title}</span>
                      {tags.map((tag) => (
                        <span key={tag} className="schema-object-list-master-tag">
                          {localize(tag, field.itemTagLabelsI18n?.[tag], locale)}
                        </span>
                      ))}
                    </span>
                    {subtitle && <span className="schema-object-list-master-sub">{subtitle}</span>}
                  </button>
                )
              })}
              <button
                type="button"
                className="schema-object-list-add wr-add"
                disabled={disabled}
                onClick={addItem}
              >
                <span>＋</span>{addLabel}
              </button>
            </div>
            <div className="schema-object-list-detail">
              {activeItem ? (
                <>
                  <div className="schema-object-list-detail-head">
                    <span className="schema-object-list-detail-title">
                      {String(activeItem[titleKey] ?? '') || `${itemLabel} ${activeIndex + 1}`}
                    </span>
                    <button
                      type="button"
                      className="schema-object-list-delete"
                      disabled={disabled}
                      onClick={() => {
                        const nextItems = items.filter((_, index) => index !== activeIndex)
                        setFieldValue(field.key, nextItems)
                        if (nextItems.length > 0) {
                          const nextIdx = Math.min(activeIndex, nextItems.length - 1)
                          setOpenObjectListCards((current) => ({ ...current, [field.key]: String(nextItems[nextIdx].id ?? nextIdx) }))
                        } else {
                          setOpenObjectListCards((current) => {
                            const next = { ...current }
                            delete next[field.key]
                            return next
                          })
                        }
                      }}
                    >
                      {deleteLabel}
                    </button>
                  </div>
                  <div className="schema-object-list-grid wr-body">
                    {(() => {
                      const renderableFields = field.fields
                        .filter(isRenderableObjectListItemField)
                        .filter((itemField) => isItemFieldVisible(itemField, activeItem))
                      const groups: { group: string | undefined; fields: typeof renderableFields; advanced: boolean }[] = []
                      for (const itemField of renderableFields) {
                        const g = itemField.group
                        const advanced = Boolean(g && /advanced|高级/i.test(g))
                        const last = groups[groups.length - 1]
                        if (last && last.group === g) last.fields.push(itemField)
                        else groups.push({ group: g, fields: [itemField], advanced })
                      }
                      return groups.map((grp, gi) => {
                        const groupTitle = grp.group
                          ? localize(grp.group, grp.fields[0]?.groupI18n, locale)
                          : ''
                        const body = grp.fields.map((itemField) => (
                          <div key={itemField.key} className={itemField.kind === 'text' || itemField.kind === 'select' || itemField.kind === 'string-list' || itemField.kind === 'textarea' ? 'schema-object-list-span-full' : undefined}>
                            {renderObjectListItemField(itemField, activeItem, `${field.key}:${activeCardId}:${itemField.key}`, (next) => {
                              setFieldValue(field.key, items.map((candidate, index) => (
                                index === activeIndex ? { ...candidate, [itemField.key]: next } : candidate
                              )))
                            })}
                          </div>
                        ))
                        if (grp.advanced) {
                          return (
                            <details key={gi} className="schema-object-list-advanced">
                              <summary className="schema-object-list-advanced-summary">{groupTitle || 'Advanced'}</summary>
                              <div className="schema-object-list-advanced-body">{body}</div>
                            </details>
                          )
                        }
                        return (
                          <div key={gi} className="schema-object-list-group">
                            {groupTitle && (
                              <div className="schema-object-list-group-title">{groupTitle}</div>
                            )}
                            {body}
                          </div>
                        )
                      })
                    })()}
                    {urlTemplate.includes('{query}') && (
                      <div className="schema-object-list-preview">
                        <div className="schema-object-list-preview-row">
                          <span>{translate(locale, 'scripts', 'settingsPreview')}</span>
                          <span className="schema-object-list-preview-sample-label">
                            {translate(locale, 'scripts', 'settingsPreviewSample')}
                          </span>
                          <input
                            className="schema-object-list-preview-sample"
                            type="text"
                            value={previewSample}
                            onChange={(event) => setNumberDrafts((current) => ({
                              ...current,
                              [previewSampleKey]: event.currentTarget.value,
                            }))}
                          />
                        </div>
                        <div className="schema-object-list-preview-url">{previewUrl}</div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="schema-object-list-empty-state">
                  <div className="schema-object-list-empty-title">{emptyText}</div>
                  <div className="schema-object-list-empty-hint">{emptyHint}</div>
                  <button
                    type="button"
                    className="schema-object-list-empty-btn"
                    disabled={disabled}
                    onClick={addItem}
                  >
                    ＋ {addLabel}
                  </button>
                </div>
              )}
            </div>
          </div>
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
