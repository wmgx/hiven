import { useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type {
  PluginSettingsField,
  PluginSettingsModalField,
  PluginSettingsObjectListItemField,
  PluginSettingsSchema,
} from '../workspace/pluginTypes'
import type { Locale } from '../i18n'

type PluginSettingsSchemaRendererProps<TSettings = unknown> = {
  schema: PluginSettingsSchema<TSettings>
  locale: Locale
  value: TSettings
  updateValue: (patch: Partial<TSettings>) => void
  onOpenModal: (field: PluginSettingsModalField<TSettings>) => void
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

function fieldIcon(kind: PluginSettingsField['kind'] | PluginSettingsObjectListItemField['kind']): string {
  if (kind === 'switch') return '◐'
  if (kind === 'number') return '#'
  if (kind === 'select') return '▾'
  if (kind === 'object-list') return '▤'
  if (kind === 'textarea' || kind === 'string-list' || kind === 'list') return '¶'
  if (kind === 'modal') return '↗'
  return 'T'
}

export function PluginSettingsSchemaRenderer<TSettings = unknown>({
  schema,
  locale,
  value,
  updateValue,
  onOpenModal,
}: PluginSettingsSchemaRendererProps<TSettings>) {
  const record = getSettingsRecord(value)
  const [openObjectListCards, setOpenObjectListCards] = useState<Record<string, string>>({})
  const [openSelectId, setOpenSelectId] = useState<string | null>(null)

  function setFieldValue(key: string, next: unknown) {
    updateValue({ [key]: next } as Partial<TSettings>)
  }

  function renderFieldTitle(label: string, description: string) {
    return (
      <div className="schema-row-main">
        <div className="schema-row-name">{label}</div>
        {description && <div className="schema-row-desc">{description}</div>}
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
          <span className="schema-select-chevron">⌄</span>
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
                  {localize(option.label, option.labelI18n, locale)}
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
        <label className="schema-object-list-switch wr-field">
          <span className="schema-object-list-switch-copy">{itemLabel}</span>
          <input className="schema-native-hidden" type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.currentTarget.checked)} />
          <span className={`sw schema-switch ${Boolean(value) ? 'on' : ''}`} />
        </label>
      )
    }

    if (itemField.kind === 'select') {
      return (
        <div className="schema-object-list-field schema-object-list-field-select wr-field">
          <span>{itemLabel}</span>
          {renderSelectControl(controlId, String(value ?? ''), itemField.options ?? [], onChange)}
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
    const commonLabel = renderFieldTitle(label, description)

    if (field.kind === 'switch') {
      return (
        <label className="schema-row">
          <span className="schema-row-icon">{fieldIcon(field.kind)}</span>
          {commonLabel}
          <span className="schema-row-control">
            <input
              className="schema-native-hidden"
              type="checkbox"
              checked={Boolean(record[field.key])}
              disabled={field.disabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setFieldValue(field.key, event.currentTarget.checked)}
            />
            <span className={`sw schema-switch ${Boolean(record[field.key]) ? 'on' : ''}`} />
          </span>
        </label>
      )
    }

    if (field.kind === 'number') {
      const scale = field.storageScale && field.storageScale > 0 ? field.storageScale : 1
      const rawValue = typeof record[field.key] === 'number' ? Number(record[field.key]) : 0
      const displayValue = scale === 1 ? rawValue : rawValue / scale
      return (
        <label className="schema-row">
          <span className="schema-row-icon">{fieldIcon(field.kind)}</span>
          {commonLabel}
          <div className="schema-row-control plugin-settings-number-row">
            <input
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              value={Number.isFinite(displayValue) ? displayValue : ''}
              disabled={field.disabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setFieldValue(field.key, Math.round(Number(event.currentTarget.value) * scale))}
            />
            {field.unit && <span>{field.unit}</span>}
          </div>
        </label>
      )
    }

    if (field.kind === 'select') {
      return (
        <div className="schema-row">
          <span className="schema-row-icon">{fieldIcon(field.kind)}</span>
          {commonLabel}
          <div className="schema-row-control">
            {renderSelectControl(`field:${field.key}`, String(record[field.key] ?? ''), field.options, (next) => setFieldValue(field.key, next), field.disabled)}
          </div>
        </div>
      )
    }

    if (field.kind === 'text') {
      return (
        <label className="schema-field-block">
          {commonLabel}
          <input
            className={field.mono ? 'schema-mono' : undefined}
            type="text"
            value={String(record[field.key] ?? '')}
            placeholder={localize(field.placeholder, field.placeholderI18n, locale)}
            disabled={field.disabled}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setFieldValue(field.key, event.currentTarget.value)}
          />
        </label>
      )
    }

    if (field.kind === 'textarea') {
      return (
        <label className="schema-field-block">
          {commonLabel}
          <textarea
            className={field.mono ? 'schema-mono' : undefined}
            rows={field.rows ?? 4}
            value={String(record[field.key] ?? '')}
            placeholder={localize(field.placeholder, field.placeholderI18n, locale)}
            disabled={field.disabled}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setFieldValue(field.key, event.currentTarget.value)}
          />
        </label>
      )
    }

    if (field.kind === 'list') {
      return (
        <label className="schema-field-block">
          {commonLabel}
          <textarea
            className="schema-mono"
            rows={8}
            defaultValue={stringifyJson(record[field.key])}
            disabled={field.disabled}
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
      return (
        <div className="schema-object-list d-rules">
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
                const title = String(item.title ?? '') || `${itemLabel} ${itemIndex + 1}`
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
                      {Array.isArray(item.aliases) && item.aliases.length > 0 && (
                        <span className="schema-object-list-tag wr-kwtag">
                          {String(item.aliases[0])}{item.aliases.length > 1 ? ` +${item.aliases.length - 1}` : ''}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="wr-del"
                      disabled={field.disabled}
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
                    {field.fields.map((itemField) => (
                      <div key={itemField.key}>
                        {renderObjectListItemField(itemField, item, `${field.key}:${cardId}:${itemField.key}`, (next) => {
                          setFieldValue(field.key, items.map((candidate, index) => (
                            index === itemIndex ? { ...candidate, [itemField.key]: next } : candidate
                          )))
                        })}
                      </div>
                    ))}
                  </div>
                </details>
                )
              })}
            </div>
          )}
          <button
            type="button"
            className="schema-object-list-add wr-add"
            disabled={field.disabled}
            onClick={addItem}
          >
            <span>＋</span>{addLabel}
          </button>
        </div>
      )
    }

    if (field.kind === 'modal') {
      return (
        <div className="schema-row">
          <span className="schema-row-icon">{fieldIcon(field.kind)}</span>
          {commonLabel}
          <button
            type="button"
            className="schema-row-control schema-button"
            disabled={field.disabled}
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
      {schema.sections.map((section) => (
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
            {section.fields.map((field) => (
              <div key={field.kind === 'modal' ? field.id : field.key} className={`schema-field schema-field-${field.kind}`}>
                {renderField(field)}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
