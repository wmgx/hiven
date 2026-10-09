type RootController = {
  getState: () => { busy: boolean; frames: readonly { kind: string }[] }
}

/** A later return to the same root cannot revive work started before navigation. */
export function captureRootFileTextSession(params: {
  getController: () => RootController | null
  isRootVisible: () => boolean
}): (() => boolean) | null {
  const controller = params.getController()
  const state = controller?.getState()
  if (!params.isRootVisible() || !controller || !state || state.busy ||
    state.frames.length !== 1 || state.frames[0].kind !== 'list') return null
  return () => params.isRootVisible() && params.getController() === controller && controller.getState() === state
}
