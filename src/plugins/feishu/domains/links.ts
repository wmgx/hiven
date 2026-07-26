/**
 * Feishu / Lark client deep links (applink).
 * Used to open chats / DMs without extra CLI round-trips.
 */

export type FeishuBrand = 'feishu' | 'lark'

/** Default brand for ByteDance CN tenants; can be extended from whoami later. */
export const DEFAULT_FEISHU_BRAND: FeishuBrand = 'feishu'

function applinkHost(brand: FeishuBrand): string {
  return brand === 'lark' ? 'applink.larksuite.com' : 'applink.feishu.cn'
}

/**
 * Open a group or p2p chat in the Feishu/Lark desktop client.
 * `chatId` is typically `oc_…`.
 */
export function buildChatOpenUrl(chatId: string, brand: FeishuBrand = DEFAULT_FEISHU_BRAND): string {
  const id = chatId.trim()
  return `https://${applinkHost(brand)}/client/chat/open?openChatId=${encodeURIComponent(id)}`
}

/**
 * Best-effort open a user DM. Prefer `p2pChatId` when search returns it;
 * otherwise try openId-based chat open (client may resolve or no-op).
 */
export function buildUserChatOpenUrl(options: {
  p2pChatId?: string
  openId?: string
  brand?: FeishuBrand
}): string | undefined {
  const brand = options.brand ?? DEFAULT_FEISHU_BRAND
  if (options.p2pChatId?.trim()) {
    return buildChatOpenUrl(options.p2pChatId, brand)
  }
  const openId = options.openId?.trim()
  if (!openId) return undefined
  // Client applink for opening chat by user open_id (supported by Feishu client).
  return `https://${applinkHost(brand)}/client/chat/open?openId=${encodeURIComponent(openId)}`
}
