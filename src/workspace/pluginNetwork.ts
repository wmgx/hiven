import { invoke } from '@tauri-apps/api/core'
import type { PluginNetworkApi, PluginNetworkRequest, PluginNetworkResponse, PluginPermissionSnapshot } from './pluginTypes'
import { requirePluginPermissions } from './pluginPermissions'

export function createPluginNetwork(permissions: PluginPermissionSnapshot): PluginNetworkApi {
  return {
    async request(input: PluginNetworkRequest): Promise<PluginNetworkResponse> {
      requirePluginPermissions(permissions, ['network.request'])
      if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
        const response = await fetch(input.url, {
          method: input.method,
          headers: input.headers,
          body: input.body,
        })
        const headers = Object.fromEntries(response.headers.entries())
        if (input.responseType === 'binary') {
          return {
            status: response.status,
            headers,
            body: '',
            bodyBytes: Array.from(new Uint8Array(await response.arrayBuffer())),
          }
        }
        return { status: response.status, headers, body: await response.text() }
      }
      return invoke<PluginNetworkResponse>('plugin_http_request', { request: input })
    },
  }
}
