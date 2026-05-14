/**
 * CDN 模块动态加载器
 * 从指定 URL 加载远程 ESM 模块，支持 IndexedDB 持久缓存 + 内存缓存
 * 内置脚本的依赖优先从本地加载，自定义脚本的依赖从网络加载（失败时报错提示）
 */

// 内置脚本依赖本地注册表：URL → 本地模块
const LOCAL_REGISTRY: Record<string, () => Promise<any>> = {
  'https://esm.sh/js-yaml@4?bundle': () => import('js-yaml'),
  'https://esm.sh/sql-formatter@15?bundle': () => import('sql-formatter'),
}

const DB_NAME = 'fluxtext-cdn-cache'
const DB_VERSION = 1
const STORE_NAME = 'modules'
const memoryCache = new Map<string, any>()

// ---------- IndexedDB helpers ----------

// 单例 DB 连接，避免每次操作都打开新连接导致内存泄漏
let _dbInstance: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_dbInstance) return Promise.resolve(_dbInstance)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => {
      _dbInstance = req.result
      _dbInstance.onclose = () => { _dbInstance = null }
      resolve(_dbInstance)
    }
    req.onerror = () => reject(req.error)
  })
}

async function getCached(key: string): Promise<string | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(key)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function setCache(key: string, source: string): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(source, key)
  } catch {
    // 缓存写入失败不影响功能
  }
}

// ---------- Module import from source text ----------

async function importFromSource(source: string): Promise<any> {
  const blob = new Blob([source], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    return await import(/* @vite-ignore */ url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ---------- Public API ----------

/**
 * 从 URL 加载远程模块，带本地缓存
 *
 * 用法：
 *   const { format } = await loadCDN('https://esm.sh/sql-formatter@15?bundle')
 *   const yaml = await loadCDN('https://esm.sh/js-yaml@4?bundle')
 *
 * 加载顺序：内存缓存 → IndexedDB → 网络
 */
export async function loadCDN(url: string): Promise<any> {
  if (!url.startsWith('http')) {
    throw new Error(`loadCDN requires a full URL, got: ${url}`)
  }

  // 0. 检查本地注册表（内置依赖优先本地加载）
  if (LOCAL_REGISTRY[url]) {
    if (memoryCache.has(url)) return memoryCache.get(url)
    const mod = await LOCAL_REGISTRY[url]()
    memoryCache.set(url, mod)
    return mod
  }

  // 1. 内存缓存（同 session 内零延迟）
  if (memoryCache.has(url)) return memoryCache.get(url)

  // 2. 检查 IndexedDB 持久缓存
  const cached = await getCached(url)
  if (cached) {
    try {
      const mod = await importFromSource(cached)
      memoryCache.set(url, mod)
      return mod
    } catch {
      // 缓存损坏，继续从网络加载
    }
  }

  // 3. 从网络拉取（自定义脚本依赖）
  let res: Response
  try {
    res = await fetch(url)
  } catch (e: any) {
    throw new Error(
      `无法加载依赖 ${url}：网络请求失败 (${e.message})。请检查网络连接或使用可访问的 CDN 地址。`
    )
  }
  if (!res.ok) {
    throw new Error(
      `无法加载依赖 ${url}：HTTP ${res.status} ${res.statusText}。请检查 URL 是否正确。`
    )
  }
  const source = await res.text()

  // 4. 持久化到 IndexedDB
  await setCache(url, source)

  // 5. 执行模块
  const mod = await importFromSource(source)
  memoryCache.set(url, mod)
  return mod
}

/**
 * 清除所有 CDN 缓存
 */
export async function clearCDNCache(): Promise<void> {
  memoryCache.clear()
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    db.close()
    _dbInstance = null
  } catch {
    // ignore
  }
}

/**
 * 预加载模块（后台静默加载，不阻塞）
 */
export function preloadCDN(...pkgs: string[]): void {
  for (const pkg of pkgs) {
    loadCDN(pkg).catch(() => {})
  }
}

/**
 * 从脚本源码中解析 @deps 注释声明的依赖
 *
 * 格式：// @deps <name> <url>
 *   // @deps sql-formatter https://esm.sh/sql-formatter@15?bundle
 *   // @deps yaml https://esm.sh/js-yaml@4?bundle
 */
export function parseDeps(source: string): { name: string; url: string }[] {
  const deps: { name: string; url: string }[] = []
  const re = /^\s*\/\/\s*@deps\s+(\S+)\s+(https?:\/\/\S+)$/gm
  let match
  while ((match = re.exec(source)) !== null) {
    deps.push({ name: match[1], url: match[2] })
  }
  return deps
}

/**
 * 解析 @deps 并加载所有依赖，返回 name → module 映射
 */
export async function loadDeps(source: string): Promise<Record<string, any>> {
  const deps = parseDeps(source)
  if (deps.length === 0) return {}
  const entries = await Promise.all(
    deps.map(async ({ name, url }) => {
      const mod = await loadCDN(url)
      return [name, mod] as const
    })
  )
  return Object.fromEntries(entries)
}
