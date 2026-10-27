// Development-only Vite alias: native internals are immutable; keep Tauri's transport intact.
export * from '../../node_modules/@tauri-apps/api/core'
import { invoke as nativeInvoke, type InvokeArgs, type InvokeOptions } from '../../node_modules/@tauri-apps/api/core'
import { nativeDiagnostics } from './debugSnapshot'

export async function invoke<T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  try { return await nativeInvoke<T>(command, args, options) }
  catch (error) {
    const keys = (args as { shortcuts?: unknown } | undefined)?.shortcuts
    nativeDiagnostics.record(command, error, Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [])
    throw error
  }
}
