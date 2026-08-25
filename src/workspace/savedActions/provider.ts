import type { LauncherExecutionContext, LauncherItem } from '../launcher/types'
import { selectHostOutputResult } from '../launcher/output'
import { savedActionDisabledReason } from './compatibility'
import { listSavedActions, setSavedActionDisabledReason } from './store'
import type { SavedActionV1 } from './types'
import { translate, type Locale } from '../../i18n'

const disabledText = {
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
  return ctx.input?.text || null
}

export function projectSavedAction(
  artifact: SavedActionV1,
  baseAction: LauncherItem | null,
  inputAvailable?: boolean,
): LauncherItem {
  const disabledReason = savedActionDisabledReason(artifact, baseAction, {
    inputAvailable,
    outputAvailable: artifact.outputIntent === 'copy' ||
      artifact.outputIntent === 'return-to-launcher' ||
      artifact.outputIntent === 'open-quick-editor',
  })
  const subtitle = disabledReason ? disabledText[disabledReason] : ['Saved Action', '已保存工具']
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
    commitVia: 'saved-action',
    savedActionArtifactId: artifact.id,
    disabledReason: disabledReason ? {
      code: disabledReason,
      message: disabledText[disabledReason][0],
      messageI18n: { zh: disabledText[disabledReason][1] },
    } : undefined,
    recordUsage: true,
    execute: async (ctx) => {
      if (disabledReason || !baseAction) return unavailable(disabledReason ?? 'missing-action', ctx.locale)
      const text = boundInput(artifact, ctx)
      if (text == null) return unavailable('input-unavailable', ctx.locale)
      const baseContext = { ...ctx, input: { text } }
      const result = baseAction.executeWithParams
        ? await baseAction.executeWithParams(baseContext, artifact.savedParams)
        : await baseAction.execute(baseContext)
      if (!result.ok) return result
      return selectHostOutputResult(result, artifact.outputIntent) ?? unavailable('output-unavailable', ctx.locale)
    },
  }
}

export function getSavedActionLauncherItems(
  baseItems: LauncherItem[],
  inputAvailability: { selection?: boolean; activeText?: boolean } = {},
): LauncherItem[] {
  const byKey = new Map(baseItems.map((item) => [item.systemKey, item]))
  return listSavedActions().map((artifact) => {
    const baseAction = byKey.get(artifact.baseActionKey) ?? null
    const inputAvailable = artifact.inputBinding === 'prompt'
      ? true
      : inputAvailability[artifact.inputBinding === 'selection' ? 'selection' : 'activeText']
    const disabledReason = savedActionDisabledReason(artifact, baseAction, {
      inputAvailable,
      outputAvailable: artifact.outputIntent === 'copy' ||
        artifact.outputIntent === 'return-to-launcher' ||
        artifact.outputIntent === 'open-quick-editor',
    })
    setSavedActionDisabledReason(artifact.id, disabledReason)
    return projectSavedAction({ ...artifact, disabledReason }, baseAction, inputAvailable)
  })
}
