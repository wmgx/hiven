/**
 * 应用配置目录初始化 & 内置脚本管理
 *
 * 三层架构：
 *   L0 安装包内嵌（编译时打包）→ 保底，离线可用
 *   L1 本地 builtin/ 目录       → 运行时实际使用
 *   L2 GitHub 远程              → 跟随 app 更新检查拉取
 *
 * 启动时比较内嵌 manifest.version 与本地 manifest.version，
 * 内嵌版本更高则覆盖本地 builtin/ 目录。
 */

// 内嵌脚本（Vite ?raw import）
import dedupScript from './builtin-scripts/dedup.ts?raw'
import sortScript from './builtin-scripts/sort.ts?raw'
import trimScript from './builtin-scripts/trim.ts?raw'
import jsonScript from './builtin-scripts/json.ts?raw'
import extractScript from './builtin-scripts/extract.ts?raw'
import caseScript from './builtin-scripts/case.ts?raw'
import base64Script from './builtin-scripts/base64.ts?raw'
import urlScript from './builtin-scripts/url.ts?raw'
import countScript from './builtin-scripts/count.ts?raw'
import csvScript from './builtin-scripts/csv.ts?raw'
import cssScript from './builtin-scripts/css.ts?raw'
import sqlScript from './builtin-scripts/sql.ts?raw'
import xmlScript from './builtin-scripts/xml.ts?raw'
import htmlScript from './builtin-scripts/html.ts?raw'
import hashScript from './builtin-scripts/hash.ts?raw'
import jwtScript from './builtin-scripts/jwt.ts?raw'
import timestampScript from './builtin-scripts/timestamp.ts?raw'
import hexScript from './builtin-scripts/hex.ts?raw'
import slashesScript from './builtin-scripts/slashes.ts?raw'
import reverseScript from './builtin-scripts/reverse.ts?raw'
import joinScript from './builtin-scripts/join.ts?raw'
import querystringScript from './builtin-scripts/querystring.ts?raw'
import sortjsonScript from './builtin-scripts/sortjson.ts?raw'
import loremScript from './builtin-scripts/lorem.ts?raw'
import mdquoteScript from './builtin-scripts/mdquote.ts?raw'
import yamlScript from './builtin-scripts/yaml.ts?raw'
import appendScript from './builtin-scripts/append.ts?raw'
import prependScript from './builtin-scripts/prepend.ts?raw'
import wrapScript from './builtin-scripts/wrap.ts?raw'
import sqlinScript from './builtin-scripts/sqlin.ts?raw'
import sumScript from './builtin-scripts/sum.ts?raw'
import blanklinesScript from './builtin-scripts/blanklines.ts?raw'

// 内嵌 manifest
import embeddedManifest from './builtin-scripts/manifest.json'

const BUILTIN_SCRIPTS: Record<string, string> = {
  'dedup.ts': dedupScript,
  'sort.ts': sortScript,
  'trim.ts': trimScript,
  'json.ts': jsonScript,
  'extract.ts': extractScript,
  'case.ts': caseScript,
  'base64.ts': base64Script,
  'url.ts': urlScript,
  'count.ts': countScript,
  'csv.ts': csvScript,
  'css.ts': cssScript,
  'sql.ts': sqlScript,
  'xml.ts': xmlScript,
  'html.ts': htmlScript,
  'hash.ts': hashScript,
  'jwt.ts': jwtScript,
  'timestamp.ts': timestampScript,
  'hex.ts': hexScript,
  'slashes.ts': slashesScript,
  'reverse.ts': reverseScript,
  'join.ts': joinScript,
  'querystring.ts': querystringScript,
  'sortjson.ts': sortjsonScript,
  'lorem.ts': loremScript,
  'mdquote.ts': mdquoteScript,
  'yaml.ts': yamlScript,
  'append.ts': appendScript,
  'prepend.ts': prependScript,
  'wrap.ts': wrapScript,
  'sqlin.ts': sqlinScript,
  'sum.ts': sumScript,
  'blanklines.ts': blanklinesScript,
}

const REMOTE_MANIFEST_URL =
  'https://raw.githubusercontent.com/wmgx/flux_text/main/src/builtin-scripts/manifest.json'
const REMOTE_SCRIPT_BASE_URL =
  'https://raw.githubusercontent.com/wmgx/flux_text/main/src/builtin-scripts'

function isTauri() {
  return !!(window as any).__TAURI_INTERNALS__
}

/**
 * 读取本地 builtin/manifest.json 的 version 字段
 */
async function getLocalManifestVersion(builtinDir: string): Promise<number> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const content = await invoke<string>('read_file', {
      path: `${builtinDir}/manifest.json`,
    })
    return JSON.parse(content).version || 0
  } catch {
    return 0
  }
}

/**
 * 初始化配置目录，按需释放内置脚本
 * 返回配置根目录路径
 */
export async function initConfigDir(): Promise<string | null> {
  if (!isTauri()) return null

  try {
    const { invoke } = await import('@tauri-apps/api/core')

    // 创建目录结构
    const configDir = await invoke<string>('init_config_dir')
    const builtinDir = `${configDir}/scripts/builtin`

    // 比较内嵌版本与本地版本
    const localVersion = await getLocalManifestVersion(builtinDir)

    if (embeddedManifest.version > localVersion) {
      // 内嵌版本更新 → 覆盖本地 builtin 目录
      for (const [filename, content] of Object.entries(BUILTIN_SCRIPTS)) {
        await invoke('save_script', {
          path: `${builtinDir}/${filename}`,
          content,
        })
      }
      await invoke('save_script', {
        path: `${builtinDir}/manifest.json`,
        content: JSON.stringify(embeddedManifest, null, 2),
      })
      console.log(
        `[FluxText] Released builtin scripts v${embeddedManifest.version} (local was v${localVersion})`,
      )
    }

    return configDir
  } catch (e) {
    console.error('[FluxText] Failed to init config dir:', e)
    return null
  }
}

/**
 * 从 GitHub 检查并更新内置脚本（跟随 app 更新检查调用）
 */
export async function checkBuiltinScriptsUpdate(): Promise<{
  updated: boolean
  version?: number
  error?: string
}> {
  if (!isTauri()) return { updated: false }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const configDir = await invoke<string>('get_config_dir')
    const builtinDir = `${configDir}/scripts/builtin`

    const localVersion = await getLocalManifestVersion(builtinDir)

    // 拉取远程 manifest
    const remoteManifestStr = await invoke<string>('fetch_url', {
      url: REMOTE_MANIFEST_URL,
    })
    const remoteManifest = JSON.parse(remoteManifestStr)

    if (remoteManifest.version <= localVersion) {
      return { updated: false }
    }

    // 下载所有脚本文件
    for (const filename of remoteManifest.files) {
      const content = await invoke<string>('fetch_url', {
        url: `${REMOTE_SCRIPT_BASE_URL}/${filename}`,
      })
      await invoke('save_script', {
        path: `${builtinDir}/${filename}`,
        content,
      })
    }

    // 保存新 manifest
    await invoke('save_script', {
      path: `${builtinDir}/manifest.json`,
      content: JSON.stringify(remoteManifest, null, 2),
    })

    console.log(
      `[FluxText] Updated builtin scripts from v${localVersion} to v${remoteManifest.version}`,
    )
    return { updated: true, version: remoteManifest.version }
  } catch (e: any) {
    console.error('[FluxText] Failed to check builtin scripts update:', e)
    return { updated: false, error: e.message || String(e) }
  }
}

/**
 * 获取配置目录路径
 */
export async function getConfigDir(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('get_config_dir')
  } catch {
    return null
  }
}
