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

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text.replace(/^\uFEFF/, ''))
    return true
  } catch {
    return false
  }
}
