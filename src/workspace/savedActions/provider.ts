import type { LauncherExecutionContext, LauncherItem } from '../launcher/types'
import { selectHostOutputResult } from '../launcher/output'
import { isGlobalLauncherSavedActionOutput, savedActionDisabledReason } from './compatibility'
import { listSavedActions, setSavedActionDisabledReason } from './store'
import type { SavedActionDisabledReason, SavedActionV1 } from './types'
import { translate, type Locale } from '../../i18n'

const disabledText = {
  'ambiguous-action': ['Multiple sources provide the original action', '多个来源提供了同一个原动作', 'savedActionAmbiguous'],
  'missing-action': ['Original action is missing', '原动作不存在', 'savedActionMissing'],
  'contract-changed': ['Action contract changed', '动作契约已变化', 'savedActionContractChanged'],
  'policy-changed': ['Action policy changed', '动作策略已变化', 'savedActionPolicyChanged'],
  'saveability-changed': ['Saved parameters are no longer allowed', '已保存参数不再允许固化', 'savedActionSaveabilityChanged'],
  'input-unavailable': ['Required input is unavailable', '所需输入当前不可用', 'savedActionInputUnavailable'],
  'output-unavailable': ['Saved output is unavailable', '保存的输出方式当前不可用', 'savedActionOutputUnavailable'],
} as const

function unavailable(reason: keyof typeof disabledText, locale: Locale) {
  return { ok: false as const, message: translate(locale, 'palette', disabledText[reason][2]) }
}

function boundInput(artifact: SavedActionV1, ctx: LauncherExecutionContext): string | null {
  if (artifact.inputBinding === 'selection') return ctx.api.getSelectionText() || null
  if (artifact.inputBinding === 'active-text') return ctx.api.getActiveText() || null
  return ctx.input?.text ?? null
}

export function projectSavedAction(
  artifact: SavedActionV1,
  baseAction: LauncherItem | null,
  inputAvailable?: boolean,
  sourceAmbiguous = false,
  resolveBaseItems?: () => LauncherItem[],
): LauncherItem {
  const disabledReason = sourceAmbiguous ? 'ambiguous-action' : savedActionDisabledReason(artifact, baseAction, {
    inputAvailable,
    outputAvailable: isGlobalLauncherSavedActionOutput(artifact.outputIntent),
  })
  const subtitle = disabledReason ? disabledText[disabledReason] : ['Saved Action', '已保存工具']
  const projectedSource = baseAction?.source
  const projectedExecutionMode = baseAction?.executionMode
  // Frames can outlive a registry update. Never replay their captured source
  // without checking every current source before and after the pure run.
  const currentBase = (): { action: LauncherItem | null; reason?: SavedActionDisabledReason } => {
    const candidates = resolveBaseItems
      ? resolveBaseItems().filter((item) => item.systemKey === artifact.baseActionKey)
      : baseAction ? [baseAction] : []
    if (candidates.length > 1) return { action: null, reason: 'ambiguous-action' }
    const action = candidates[0] ?? null
    if (action && baseAction && (
      action.source !== projectedSource || action.executionMode !== projectedExecutionMode
    )) return { action: null, reason: 'contract-changed' }
    return { action, reason: disabledReason ?? savedActionDisabledReason(artifact, action) }
  }
  return {
    systemKey: `host:saved-action:${artifact.id}`,
    kind: 'host',
    pluginId: baseAction?.pluginId,
    source: baseAction?.source,
    display: {
      title: artifact.name,
      subtitle: subtitle[0],
      subtitleI18n: { zh: subtitle[1] },
      icon: disabledReason ? 'CircleSlash2' : 'Bookmark',
      aliases: artifact.aliases,
    },
    behavior: artifact.inputBinding === 'prompt'
      ? {
          type: 'collect-input',
          input: {
            placeholder: 'Enter text to process',
            placeholderI18n: { zh: '输入要处理的文本' },
            emptyInputMessage: 'Input is required',
            emptyInputMessageI18n: { zh: '请输入内容' },
          },
        }
      : { type: 'perform' },
    surfaces: ['global-launcher'],
    executionMode: baseAction?.executionMode,
    commitVia: 'saved-action',
    savedActionArtifactId: artifact.id,
    disabledReason: disabledReason ? {
      code: disabledReason,
      message: disabledText[disabledReason][0],
      messageI18n: { zh: disabledText[disabledReason][1] },
    } : undefined,
    recordUsage: true,
    execute: async (ctx) => {
      const current = currentBase()
      if (current.reason || !current.action) return unavailable(current.reason ?? 'missing-action', ctx.locale)
      const text = boundInput(artifact, ctx)
      if (text == null) return unavailable('input-unavailable', ctx.locale)
      const baseContext = { ...ctx, input: { text } }
      const result = current.action.executeWithParams
        ? await current.action.executeWithParams(baseContext, artifact.savedParams)
        : await current.action.execute(baseContext)
      const afterRun = currentBase()
      if (afterRun.reason || !afterRun.action) return unavailable(afterRun.reason ?? 'missing-action', ctx.locale)
      if (!result.ok) return result
      return selectHostOutputResult(result, artifact.outputIntent) ?? unavailable('output-unavailable', ctx.locale)
    },
  }
}

export function getSavedActionLauncherItems(
  baseItems: LauncherItem[],
  inputAvailability: { selection?: boolean; activeText?: boolean } = {},
  resolveBaseItems: () => LauncherItem[] = () => baseItems,
): LauncherItem[] {
  const byKey = new Map<string, LauncherItem[]>()
  for (const item of baseItems) byKey.set(item.systemKey, [...(byKey.get(item.systemKey) ?? []), item])
  return listSavedActions().map((artifact) => {
    const candidates = byKey.get(artifact.baseActionKey) ?? []
    const sourceAmbiguous = candidates.length > 1
    const baseAction = candidates.length === 1 ? candidates[0] : null
    const inputAvailable = artifact.inputBinding === 'prompt'
      ? true
      : inputAvailability[artifact.inputBinding === 'selection' ? 'selection' : 'activeText']
    const disabledReason = sourceAmbiguous ? 'ambiguous-action' : savedActionDisabledReason(artifact, baseAction, {
      inputAvailable,
      outputAvailable: isGlobalLauncherSavedActionOutput(artifact.outputIntent),
    })
    try {
      setSavedActionDisabledReason(artifact.id, disabledReason)
    } catch (error) {
      console.warn('[hiven] Failed to persist Saved Action availability:', error)
    }
    return projectSavedAction({ ...artifact, disabledReason }, baseAction, inputAvailable, sourceAmbiguous, resolveBaseItems)
  })
}
