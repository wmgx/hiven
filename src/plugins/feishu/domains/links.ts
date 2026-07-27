/**
 * Feishu / Lark client deep links.
 *
 * Prefer native URL schemes so macOS launches the desktop client directly.
 *
 * Desktop delivery (macOS, empirically):
 *   lark://client/chat/open?openChatId=oc_...   ← works with `open` / open location
 *   lark://applink.feishu.cn/...                ← can be handed to the browser
 *   https://applink.feishu.cn/...               ← often hops browser (Edge/Chrome)
 *
 * HTTPS remains available as an explicit fallback helper.
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
 * Uses bare `lark://client/chat/open?...` — this is what macOS LaunchServices
 * delivers into the running Feishu process. Embedding `applink.feishu.cn` as a
 * host often causes the URL to be handed to the default browser instead.
 */
export function buildChatOpenUrl(chatId: string, brand: FeishuBrand = DEFAULT_FEISHU_BRAND): string {
  const id = chatId.trim()
  const scheme = clientScheme(brand)
  return `${scheme}://client/chat/open?openChatId=${encodeURIComponent(id)}`
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
  return `${scheme}://client/chat/open?openId=${encodeURIComponent(openId)}`
}

/** True if URL is a native Feishu/Lark client scheme (should not open as https). */
export function isFeishuClientScheme(url: string): boolean {
  return /^(lark|feishu|x-feishu|x-lark):\/\//i.test(url.trim())
}
