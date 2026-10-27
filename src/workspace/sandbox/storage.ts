// IPC-shaped memory storage; no filesystem, browser persistence, or desktop transport.
type Args = Record<string, any>
export function createSandboxStorage() {
  const namespaces = new Map<string, Map<string, { valueJson: string; updatedAt: number }>>()
  const blobs = new Map<string, { bytes: Uint8Array; contentType: string }>()
  const files = new Map<string, string>()
  const at = (value: any, path: string) => path.slice(2).split('.').reduce((node, key) => node?.[key], value)
  return async (command: string, args: Args, options?: Args): Promise<unknown> => {
    const headers = options?.headers ?? {}
    const namespace = `${args.source ?? headers['x-hiven-source']}:${args.pluginId ?? headers['x-hiven-plugin']}`
    if (!namespaces.has(namespace)) namespaces.set(namespace, new Map())
    const data = namespaces.get(namespace)!
    const put = (key: string, valueJson: string) => data.set(key, { valueJson, updatedAt: Date.now() })
    const get = (key: string) => data.get(key)?.valueJson ?? null
    const list = (prefix = '') => [...data.keys()].filter(key => key.startsWith(prefix)).sort()
    if (command.startsWith('plugin_blob_')) {
      const id = `${namespace}:${args.blobId ?? headers['x-hiven-blob']}`
      if (command === 'plugin_blob_save' || command === 'plugin_blob_save_json') {
        blobs.set(id, { bytes: new Uint8Array(args.bytes ?? args), contentType: args.contentType ?? headers['x-hiven-content-type'] })
        return
      }
      if (command === 'plugin_blob_delete') { blobs.delete(id); return }
      if (command === 'plugin_blob_clear') { for (const key of blobs.keys()) if (key.startsWith(namespace + ':')) blobs.delete(key); return }
      const blob = blobs.get(id)
      if (command === 'plugin_blob_path') return blob ? URL.createObjectURL(new Blob([blob.bytes.slice().buffer], { type: blob.contentType })) : null
      if (command === 'plugin_blob_read_json') return blob ? { ...blob, bytes: [...blob.bytes] } : null
      if (command === 'plugin_blob_read') {
        if (!blob) return new ArrayBuffer(0)
        const header = new TextEncoder().encode(JSON.stringify({ contentType: blob.contentType }))
        const result = new Uint8Array(4 + header.length + blob.bytes.length)
        new DataView(result.buffer).setUint32(0, header.length)
        result.set(header, 4); result.set(blob.bytes, 4 + header.length)
        return result.buffer
      }
    }
    switch (command) {
      case 'plugin_kv_get': return get(args.key)
      case 'plugin_kv_get_many': return args.keys.flatMap((key: string) => data.has(key) ? [{ key, valueJson: get(key) }] : [])
      case 'plugin_kv_set': put(args.key, args.valueJson); return
      case 'plugin_kv_delete': data.delete(args.key); return
      case 'plugin_kv_clear': data.clear(); return
      case 'plugin_kv_list': return list(args.prefix).map(key => ({ key, updatedAt: data.get(key)!.updatedAt }))
      case 'plugin_kv_usage': return { bytes: [...data.values()].reduce((n, entry) => n + new TextEncoder().encode(entry.valueJson).length, 0), itemCount: data.size }
      case 'plugin_kv_batch': {
        if (args.input.checks.some((check: Args) => get(check.key) !== check.expectedJson)) return { committed: false }
        for (const op of args.input.operations) { if (op.type === 'set') put(op.key, op.valueJson); else data.delete(op.key) }
        return { committed: true }
      }
      case 'plugin_kv_page': {
        const { prefix, after, limit = 64, order = 'asc' } = args.options
        let keys = list(prefix)
        if (order === 'desc') keys.reverse()
        keys = keys.filter(key => !after || (order === 'asc' ? key > after : key < after))
        const page = keys.slice(0, limit)
        return { entries: page.map(key => ({ key, ...data.get(key) })), ...(keys.length > limit ? { nextCursor: page.at(-1) } : {}) }
      }
      case 'plugin_kv_array_page': {
        const { key, path, afterIndex = -1, limit = 64 } = args.options
        const raw = get(key)
        if (raw === null) return { entries: [] }
        const array = at(JSON.parse(raw), path)
        if (!Array.isArray(array)) throw new Error('SandboxInvalidArray')
        const page = array.slice(afterIndex + 1, afterIndex + 1 + limit)
        return { entries: page.map((value, index) => ({ index: afterIndex + index + 1, valueJson: JSON.stringify(value) })),
          ...(afterIndex + 1 + page.length < array.length ? { nextIndex: afterIndex + page.length } : {}) }
      }
      case 'plugin_kv_related_search': {
        const { indexPrefix, valuePrefix, after, limit = 64, scanLimit = 512, query, matchMode, idPath, indexPaths, indexPathGroups = [], valuePaths } = args.options
        const keys = list(indexPrefix).filter(key => !after || key > after)
        const normalized = query.trim().toLowerCase()
        const terms = matchMode === 'all-terms' ? normalized.split(/\s+/u).filter(Boolean) : [normalized]
        const matches = (value: unknown): boolean => Array.isArray(value) ? value.some(matches)
          : (typeof value === 'string' || typeof value === 'number') && terms.every((term: string) => String(value).toLowerCase().includes(term))
        const entries = []
        let scanned = 0
        for (const key of keys.slice(0, scanLimit)) {
          scanned++
          const index = JSON.parse(get(key)!)
          const related = JSON.parse(get(valuePrefix + at(index, idPath)) ?? 'null')
          const candidates = [...indexPaths.map((path: string) => at(index, path)),
            ...indexPathGroups.map((paths: string[]) => paths.map(path => at(index, path)).join(' ')), ...valuePaths.map((path: string) => at(related, path))]
          if (candidates.some(matches)) entries.push({ key, valueJson: get(key) })
          if (entries.length === limit) break
        }
        return { entries, scanned, ...(scanned < keys.length ? { nextCursor: keys[scanned - 1] } : {}) }
      }
      case 'init_config_dir': case 'get_config_dir': return '/sandbox'
      case 'save_plugin_file': files.set(args.path, args.content); return
      case 'read_plugin_file': {
        if (!files.has(args.path)) throw new Error('SandboxFileMissing')
        return files.get(args.path)
      }
      case 'list_plugin_dirs': case 'list_plugin_files': return []
      case 'remove_plugin_dir': {
        const prefix = `${args.rootPath}/${args.pluginId}/`
        for (const key of files.keys()) if (key.startsWith(prefix)) files.delete(key)
        return
      }
    }
    throw new Error(`SandboxUnsupported:${command}`)
  }
}
