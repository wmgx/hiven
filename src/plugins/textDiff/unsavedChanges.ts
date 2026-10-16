export type TextDiffBaseline = {
  original: string
  modified: string
}

export function hasTextDiffUnsavedChanges(baseline: TextDiffBaseline, original: string, modified: string): boolean {
  return original !== baseline.original || modified !== baseline.modified
}
