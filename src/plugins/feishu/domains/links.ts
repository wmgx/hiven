/**
 * Feishu / Lark AppLink deep links.
 *
 * Official docs:
 * - Open a chat page:
 *   https://open.feishu.cn/document/common-capabilities/applink-protocol/supported-protocol/open-a-chat-page
 * - AppLink application (PC opens https as webpage then tries Feishu):
 *   https://open.feishu.cn/document/uAjLw4CM/uYjL24iN/applink-protocol/applink-introduction/applink-application
 *
 * Protocol (official):
 *   https://applink.feishu.cn/client/chat/open?openChatId=oc_…
 *   https://applink.feishu.cn/client/chat/open?openId=ou_…
 *
 * Custom scheme (same path, direct client attempt):
 *   lark://applink.feishu.cn/client/chat/open?…
 *   feishu://applink.feishu.cn/client/chat/open?…
 *
 * Constraints from docs:
 * - openId and openChatId are mutually exclusive (fill only one).
 * - User must have joined the chat; same tenant only.
 * - On PC, https AppLink first opens as a webpage which then tries to open Feishu.
 */

export type FeishuBrand = 'feishu' | 'lark'

/** Default brand for ByteDance CN tenants. */
export const DEFAULT_FEISHU_BRAND: FeishuBrand = 'feishu'

/**
 * Native scheme registered by the desktop client (com.electron.lark).
 * CN Feishu and international Lark both commonly register `lark://`.
 */
export function clientScheme(brand: FeishuBrand = DEFAULT_FEISHU_BRAND): 'lark' | 'feishu' {
  return brand === 'lark' ? 'lark' : 'lark'
}

/** Official applink host. */
export function applinkHost(brand: FeishuBrand = DEFAULT_FEISHU_BRAND): string {
  return brand === 'lark' ? 'applink.larksuite.com' : 'applink.feishu.cn'
}

/**
 * Primary chat open URL — official HTTPS AppLink.
 * PC: opens intermediate webpage then tries to launch Feishu (per AppLink docs).
 */
export function buildChatOpenUrl(chatId: string, brand: FeishuBrand = DEFAULT_FEISHU_BRAND): string {
  return buildChatOpenHttpsUrl(chatId, brand)
}

/** Official HTTPS AppLink for openChatId (oc_…). */
export function buildChatOpenHttpsUrl(
  chatId: string,
  brand: FeishuBrand = DEFAULT_FEISHU_BRAND,
): string {
  const host = applinkHost(brand)
  return `https://${host}/client/chat/open?openChatId=${encodeURIComponent(chatId.trim())}`
}

/**
 * Custom-scheme AppLink for direct client open (no browser intermediate).
 * Path must keep the applink host segment per AppLink structure:
 *   lark://applink.feishu.cn/client/chat/open?…
 * Bare `lark://client/...` is NOT the documented form.
 */
export function buildChatOpenNativeUrl(
  chatId: string,
  brand: FeishuBrand = DEFAULT_FEISHU_BRAND,
): string {
  const scheme = clientScheme(brand)
  const host = applinkHost(brand)
  return `${scheme}://${host}/client/chat/open?openChatId=${encodeURIComponent(chatId.trim())}`
}

/** Official HTTPS AppLink for openId (ou_…) — 1:1 chat. */
export function buildUserOpenIdHttpsUrl(
  openId: string,
  brand: FeishuBrand = DEFAULT_FEISHU_BRAND,
): string {
  const host = applinkHost(brand)
  return `https://${host}/client/chat/open?openId=${encodeURIComponent(openId.trim())}`
}

/** Custom-scheme AppLink for openId. */
export function buildUserOpenIdNativeUrl(
  openId: string,
  brand: FeishuBrand = DEFAULT_FEISHU_BRAND,
): string {
  const scheme = clientScheme(brand)
  const host = applinkHost(brand)
  return `${scheme}://${host}/client/chat/open?openId=${encodeURIComponent(openId.trim())}`
}

/**
 * Best-effort user DM URL (primary = https).
 * Prefer p2pChatId (openChatId) when search returns it; else openId.
 * Docs: openId and openChatId are mutually exclusive.
 */
export function buildUserChatOpenUrl(options: {
  p2pChatId?: string
  openId?: string
  brand?: FeishuBrand
}): string | undefined {
  const brand = options.brand ?? DEFAULT_FEISHU_BRAND
  if (options.p2pChatId?.trim()) {
    return buildChatOpenHttpsUrl(options.p2pChatId, brand)
  }
  const openId = options.openId?.trim()
  if (!openId) return undefined
  return buildUserOpenIdHttpsUrl(openId, brand)
}

/** Native custom-scheme variant of {@link buildUserChatOpenUrl}. */
export function buildUserChatOpenNativeUrl(options: {
  p2pChatId?: string
  openId?: string
  brand?: FeishuBrand
}): string | undefined {
  const brand = options.brand ?? DEFAULT_FEISHU_BRAND
  if (options.p2pChatId?.trim()) {
    return buildChatOpenNativeUrl(options.p2pChatId, brand)
  }
  const openId = options.openId?.trim()
  if (!openId) return undefined
  return buildUserOpenIdNativeUrl(openId, brand)
}

/** True if URL is a native Feishu/Lark client scheme. */
export function isFeishuClientScheme(url: string): boolean {
  return /^(lark|feishu|x-feishu|x-lark):\/\//i.test(url.trim())
}

/** True if URL is an official https applink. */
export function isFeishuHttpsApplink(url: string): boolean {
  return /^https:\/\/applink\.(feishu\.cn|larksuite\.com)\/client\//i.test(url.trim())
}

/**
 * Convert any known chat-open form to official https AppLink.
 * Returns null when the URL is not a recognized chat deep link.
 */
export function toHttpsApplink(url: string, brand: FeishuBrand = DEFAULT_FEISHU_BRAND): string | null {
  const raw = url.trim()
  if (!raw) return null
  if (isFeishuHttpsApplink(raw)) return raw

  const host = applinkHost(brand)

  // lark://applink.feishu.cn/client/chat/open?…  or  lark://client/chat/open?…
  const native = raw.match(
    /^(?:lark|feishu|x-feishu|x-lark):\/\/(?:applink\.(?:feishu\.cn|larksuite\.com)\/)?client\/chat\/open\?(.+)$/i,
  )
  if (native) {
    return `https://${host}/client/chat/open?${native[1]}`
  }

  // Broken triple-slash form from older bugs
  const broken = raw.match(
    /^(?:lark|feishu|x-feishu|x-lark):\/\/\/+client\/chat\/open\?(.+)$/i,
  )
  if (broken) {
    return `https://${host}/client/chat/open?${broken[1]}`
  }

  return null
}

/**
 * Convert https (or bare) chat AppLink to custom-scheme form with applink host.
 *   https://applink.feishu.cn/client/chat/open?… → lark://applink.feishu.cn/client/chat/open?…
 */
export function toNativeApplink(url: string, brand: FeishuBrand = DEFAULT_FEISHU_BRAND): string | null {
  const https = toHttpsApplink(url, brand) ?? (isFeishuHttpsApplink(url) ? url.trim() : null)
  if (!https) return null
  const scheme = clientScheme(brand)
  return https.replace(/^https:\/\//i, `${scheme}://`)
}
