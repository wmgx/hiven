import { ValueChip } from '../../ui/ValueChip'
import type { CollectInputFrame } from '../../workspace/launcher/controller'
import { localized } from '../../store'
import { t, type Locale } from '../../i18n'
import { paramOptions } from './LauncherBranchChoices'

export function LauncherValueChips({ frame, locale, disabled, onChange }: {
  frame: CollectInputFrame
  locale: Locale
  disabled?: boolean
  onChange: (key: string, value: unknown) => boolean | undefined
}) {
  return <div className="launcher-value-chips" data-value-chips>
    {frame.item.params?.map(param => {
      const raw = frame.params?.[param.key] ?? frame.item.defaultParams?.[param.key] ?? param.default ?? ''
      const value = Array.isArray(raw) ? raw.map(String) : String(raw)
      const change = (next: string | string[]) => onChange(param.key, param.type === 'boolean' ? next === 'true' : next)
      return <ValueChip key={param.key} label={localized(param.label, param.labelI18n, locale)} value={value}
        options={paramOptions(param, locale).map(option => ({ ...option, value: String(option.value) }))}
        onChange={change} onPreview={change} disabled={disabled} maxSelect={param.maxSelect}
        custom={param.type === 'text' || param.type === 'number' ? param.type : undefined}
        multiple={param.type === 'multi-select'} emptyLabel={t(locale, 'palette.noResults')} />
    })}
  </div>
}
