export type AutoDiffMode = 'json-semantic' | 'text'
export type AutoDiffLayout = 'side-by-side'

export function decideAutoDiffMode({
  leftText,
  rightText,
  semanticEnabled,
}: {
  leftText: string
  rightText: string
  semanticEnabled: boolean
}): AutoDiffMode {
  if (semanticEnabled && isValidJson(leftText) && isValidJson(rightText)) {
    return 'json-semantic'
  }
  return 'text'
}

export function normalizeAutoDiffLayout(_layout: unknown): AutoDiffLayout {
  return 'side-by-side'
}

export function isAutoDiffExitKey(key: string): boolean {
  return key === 'Escape'
}

export function canUseSemanticJsonDiff(leftText: string, rightText: string): boolean {
  return isValidJson(leftText) && isValidJson(rightText)
}

/** Match kit parseJson: allow trailing commas so JSON mode doesn't fall back mid-edit. */
function relaxJsonText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/,(\s*[}\]])/g, '$1')
}

function isValidJson(text: string): boolean {
  const raw = text.replace(/^\uFEFF/, '')
  try {
    JSON.parse(raw)
    return true
  } catch {
    try {
      JSON.parse(relaxJsonText(raw))
      return true
    } catch {
      return false
    }
  }
}
