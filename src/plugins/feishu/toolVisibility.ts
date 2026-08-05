/**
 * Which Feishu tools the launcher surfaces by default.
 *
 * The plugin ships 19 tools, but only a few earn their place in the launcher.
 * The bar is not read-vs-write — it is whether the command completes WITHOUT
 * switching context. Searching for a doc and creating one both qualify:
 * you stay where you are and walk away with a link. Sending a message does
 * not: you will have to switch to Feishu to read the reply anyway.
 *
 * Everything else stays shipped but off by default.
 */

/** Tools always available: high-frequency actions plus the two ops commands. */
export const CORE_FEISHU_TOOL_IDS: readonly string[] = [
  'feishu.status',
  'feishu.login',
  'feishu.docs-search',
  'feishu.chat-search',
  'feishu.contact-search',
  'feishu.calendar-agenda',
  'feishu.create-doc',
  'feishu.create-sheet',
]

/** Filter a tool list down to what should be visible for the given settings. */
export function selectVisibleFeishuTools<T extends { id: string }>(
  tools: readonly T[],
  options: { advancedToolsEnabled?: boolean },
): T[] {
  if (options.advancedToolsEnabled) return [...tools]
  const core = new Set(CORE_FEISHU_TOOL_IDS)
  return tools.filter((tool) => core.has(tool.id))
}
