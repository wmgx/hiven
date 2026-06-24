import { invoke } from '@tauri-apps/api/core'
import type { PluginNetworkApi, PluginNetworkRequest, PluginNetworkResponse, PluginPermissionSnapshot } from './pluginTypes'
import { requirePluginPermissions } from './pluginPermissions'

export function createPluginNetwork(permissions: PluginPermissionSnapshot): PluginNetworkApi {
  return {
    async request(input: PluginNetworkRequest): Promise<PluginNetworkResponse> {
      requirePluginPermissions(permissions, ['network.request'])
      return invoke<PluginNetworkResponse>('plugin_http_request', { request: input })
    },
  }
}
