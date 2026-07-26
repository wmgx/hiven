export type FeishuSettings = {
  /** Master switch for the Feishu plugin (provider + tools still listed, provider gated). */
  enabled: boolean
  /** When true, register feishu.docs DesktopTargetProvider for L1 mix-in. */
  docsMixEnabled: boolean
  /** Absolute path to lark-cli; empty = resolve `lark-cli` from PATH. */
  binaryPath: string
}

export const DEFAULT_FEISHU_SETTINGS: FeishuSettings = {
  enabled: true,
  docsMixEnabled: true,
  binaryPath: '',
}
