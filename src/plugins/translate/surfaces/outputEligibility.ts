/** The result captured by an output action when its button was rendered. */
export type TranslationOutput = {
  view: {
    identity: string
    outputText: string
    status: { kind: string }
  }
  aiRevision?: number
}

export function isCurrentTranslationOutput(
  output: TranslationOutput | null,
  current: TranslationOutput | null,
  requestIdentity: string,
  aiRevision: number,
): output is TranslationOutput {
  return Boolean(output
    && output.view === current?.view
    && output.view.identity === requestIdentity
    && output.view.status.kind === 'success'
    && output.view.outputText.trim()
    && (output.aiRevision === undefined || output.aiRevision === aiRevision))
}
