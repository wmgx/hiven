/**
 * Feishu / Lark client deep links.
 *
 * Prefer native URL schemes (`lark://` / `feishu://`) so macOS/Windows launch the
 * desktop client directly. `https://applink.feishu.cn/...` always hops through a
 * browser first — that is what felt like "open via browser".
 */

export type FeishuBrand = 'feishu' | 'lark'

/** Default brand for ByteDance CN tenants; can be extended from whoami later. */
export const DEFAULT_FEISHU_BRAND: FeishuBrand = 'feishu'

/**
 * Native scheme for the installed desktop app.
 * CN Feishu desktop (bundle com.electron.lark) registers `lark://`.
 * International Lark also uses `lark://`. Keep `feishu://` as a secondary candidate.
 */
export function clientScheme(brand: FeishuBrand = DEFAULT_FEISHU_BRAND): 'lark' | 'feishu' {
  // Even CN Feishu desktop is Electron Lark shell — lark:// is the reliable handler.
  return brand === 'feishu' || brand === 'lark' ? 'lark' : 'lark'
}

/**
 * Open a group or p2p chat in the Feishu/Lark desktop client (no browser).
 * `chatId` is typically `oc_…`.
 */
export function buildChatOpenUrl(chatId: string, brand: FeishuBrand = DEFAULT_FEISHU_BRAND): string {
  const id = chatId.trim()
  const scheme = clientScheme(brand)
  return `${scheme}://client/chat/open?openChatId=${encodeURIComponent(id)}`
}

/**
 * HTTPS applink fallback (browser hop). Prefer {@link buildChatOpenUrl} first.
 */
export function buildChatOpenHttpsUrl(chatId: string, brand: FeishuBrand = DEFAULT_FEISHU_BRAND): string {
  const host = brand === 'lark' ? 'applink.larksuite.com' : 'applink.feishu.cn'
  return `https://${host}/client/chat/open?openChatId=${encodeURIComponent(chatId.trim())}`
}

/**
 * Best-effort open a user DM via native scheme.
 * Prefer `p2pChatId` when search returns it.
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
  return `${scheme}://client/chat/open?openId=${encodeURIComponent(openId)}`
}

/** True if URL is a native Feishu/Lark client scheme (should not open as https). */
export function isFeishuClientScheme(url: string): boolean {
  return /^(lark|feishu):\/\//i.test(url.trim())
}
