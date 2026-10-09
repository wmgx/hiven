import type { LauncherObjectBlock } from './objectBlock'
import { canEditMaterialText } from './currentMaterial'

export type CurrentTextDeliveryAction =
  | 'copy-current-text' | 'paste-current-text'
  | 'copy-history-text' | 'paste-history-text'

export function isCurrentTextDeliveryAction(id: string): id is CurrentTextDeliveryAction {
  return id === 'copy-current-text' || id === 'paste-current-text' ||
    id === 'copy-history-text' || id === 'paste-history-text'
}

/** Delivery never reads the clipboard, a history record, a file path, or a UI preview. */
export function getCurrentTextPayload(block: LauncherObjectBlock | null): string | null {
  return canEditMaterialText(block) && block!.payloadText!.length > 0 ? block!.payloadText! : null
}

type RootController = {
  getState: () => { busy: boolean; frames: readonly { kind: string }[] }
}

/** A row belongs to the material and root session that produced it. */
export function captureCurrentTextDeliveryScope(params: {
  block: LauncherObjectBlock
  getMaterialGeneration: () => number | undefined
  hasMaterial: (block: LauncherObjectBlock) => boolean
  getController: () => RootController | null
  isOpen: () => boolean
  isRootVisible: () => boolean
}): { isCurrent: () => boolean; isClosingCurrent: () => boolean } {
  const generation = params.getMaterialGeneration()
  const controller = params.getController()
  const state = controller?.getState()
  const ownsSession = () => generation !== undefined && params.getMaterialGeneration() === generation &&
    params.hasMaterial(params.block) && params.isRootVisible() && Boolean(controller && state &&
      !state.busy && state.frames.length === 1 && state.frames[0].kind === 'list' &&
      params.getController() === controller && controller.getState() === state)
  return {
    isCurrent: () => params.isOpen() && ownsSession(),
    // Only the host's verified open -> closed store transition may use this.
    // Native paste closes the store before its async outcome arrives.
    isClosingCurrent: ownsSession,
  }
}

type DeliveryResult = { ok: true } | { ok: false; message: string }

/** One host delivery at a time; late completion never owns a newer material/session. */
export function createCurrentTextDelivery(onBusyChange: (busy: boolean) => void = () => {}) {
  let busy = false
  return async (params: {
    block: LauncherObjectBlock
    action: CurrentTextDeliveryAction
    isCurrent: () => boolean
    copyText: (text: string) => Promise<void>
    pasteText: (text: string, isCurrent: () => boolean) => Promise<DeliveryResult>
  }): Promise<DeliveryResult | null> => {
    const text = getCurrentTextPayload(params.block)
    if (busy || text === null || !params.isCurrent()) return null
    busy = true
    onBusyChange(true)
    try {
      let result: DeliveryResult
      if (params.action === 'paste-current-text' || params.action === 'paste-history-text') {
        result = await params.pasteText(text, params.isCurrent)
      } else {
        await params.copyText(text)
        result = { ok: true }
      }
      return params.isCurrent() ? result : null
    } catch (error) {
      return params.isCurrent() ? { ok: false, message: error instanceof Error ? error.message : String(error) } : null
    } finally {
      busy = false
      onBusyChange(false)
    }
  }
}
