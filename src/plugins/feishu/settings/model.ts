export type FeishuSettings = {
  /** Master switch for the Feishu plugin (provider + tools still listed, provider gated). */
  enabled: boolean
  /** When true, register feishu.docs DesktopTargetProvider for L1 mix-in. */
  docsMixEnabled: boolean
  /** When true, mix Feishu chats into Global Launcher L1 search. */
  chatsMixEnabled: boolean
  /** When true, mix Feishu contacts (people) into Global Launcher L1 search. */
  contactsMixEnabled: boolean
  /**
   * L1 always hides people without chat intersection.
   * When true, L2「找人」tool also only shows people you've chatted with.
   */
  contactSearchOnlyChatted: boolean
  /**
   * After openUrl, best-effort raise a matching Feishu/Lark window (macOS).
   * Does not delay open.
   */
  preferWindowFocus: boolean
  /**
   * Show the full 19-tool surface (writes, fetch, tasks, minutes, debug).
   * Default false: the launcher only carries the high-frequency read commands.
   */
  advancedToolsEnabled: boolean
  /** Absolute path to lark-cli; empty = resolve `lark-cli` from PATH. */
  binaryPath: string
}

export const DEFAULT_FEISHU_SETTINGS: FeishuSettings = {
  enabled: true,
  docsMixEnabled: true,
  chatsMixEnabled: true,
  contactsMixEnabled: true,
  contactSearchOnlyChatted: false,
  preferWindowFocus: true,
  advancedToolsEnabled: false,
  binaryPath: '',
}
