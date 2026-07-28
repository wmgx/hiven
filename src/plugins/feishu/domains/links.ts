/**
 * Feishu / Lark client deep links.
 *
 * Prefer native URL schemes so macOS launches the desktop client directly.
 * Official applink path is `/client/chat/open`; the desktop client registers
 * hosts like `applink.feishu.cn` / `applink` on the `lark` / `feishu` schemes.
 *
 * Wrong (only activates app, does not navigate):
 *   lark://client/chat/open?openChatId=oc_...
 *
 * Correct (native, no browser hop):
 *   lark://applink.feishu.cn/client/chat/open?openChatId=oc_...
 *
 * HTTPS remains available as fallback when native scheme fails.
 */

export type FeishuBrand = 'feishu' | 'lark'

/** Default brand for ByteDance CN tenants; can be extended from whoami later. */
export const DEFAULT_FEISHU_BRAND: FeishuBrand = 'feishu'

/**
 * Native scheme for the installed desktop app.
 * CN Feishu desktop (bundle com.electron.lark) registers `lark://`.
 * International Lark also uses `lark://`.
 */
export function clientScheme(brand: FeishuBrand = DEFAULT_FEISHU_BRAND): 'lark' | 'feishu' {
  // Even CN Feishu desktop is Electron Lark shell — lark:// is the reliable handler.
  return brand === 'feishu' || brand === 'lark' ? 'lark' : 'lark'
}

/** Applink host embedded in native scheme / https URL. */
export function applinkHost(brand: FeishuBrand = DEFAULT_FEISHU_BRAND): string {
  return brand === 'lark' ? 'applink.larksuite.com' : 'applink.feishu.cn'
}

/**
 * Open a group or p2p chat in the Feishu/Lark desktop client (no browser).
 * `chatId` is typically `oc_…`.
 *
 * Uses `lark://applink.feishu.cn/client/chat/open?...` — the host segment is
 * required; bare `lark://client/...` only focuses the app without routing.
 */
export function buildChatOpenUrl(chatId: string, brand: FeishuBrand = DEFAULT_FEISHU_BRAND): string {
  const id = chatId.trim()
  const scheme = clientScheme(brand)
  const host = applinkHost(brand)
  return `${scheme}://${host}/client/chat/open?openChatId=${encodeURIComponent(id)}`
}

/**
 * HTTPS applink fallback (may hop browser if not claimed by the desktop app).
 * Prefer {@link buildChatOpenUrl} first.
 */
export function buildChatOpenHttpsUrl(chatId: string, brand: FeishuBrand = DEFAULT_FEISHU_BRAND): string {
  const host = applinkHost(brand)
  return `https://${host}/client/chat/open?openChatId=${encodeURIComponent(chatId.trim())}`
}

/**
 * Best-effort open a user DM via native scheme.
 * Prefer `p2pChatId` when search returns it (most reliable for navigation).
 * Fall back to openId (ou_…).
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
  const scheme = clientScheme(brand)
  const host = applinkHost(brand)
  return `${scheme}://${host}/client/chat/open?openId=${encodeURIComponent(openId)}`
}

/** True if URL is a native Feishu/Lark client scheme (should not open as https). */
export function isFeishuClientScheme(url: string): boolean {
  return /^(lark|feishu|x-feishu|x-lark):\/\//i.test(url.trim())
}
