/**
 * 应用配置目录初始化
 * 首次启动时创建 ~/.local/fluxtext/scripts/builtin/ 并释放内置脚本
 */

// 通过 Vite ?raw import 读取源码目录中的脚本文件内容
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
}

function isTauri() {
  return !!(window as any).__TAURI_INTERNALS__
}

/**
 * 初始化配置目录，释放内置脚本（仅首次）
 * 返回配置根目录路径
 */
export async function initConfigDir(): Promise<string | null> {
  if (!isTauri()) return null

  try {
    const { invoke } = await import('@tauri-apps/api/core')

    // 创建目录结构
    const configDir = await invoke<string>('init_config_dir')
    const builtinDir = `${configDir}/scripts/builtin`

    // 检查是否需要释放内置脚本（检查目录下文件数）
    const existing = await invoke<{ name: string }[]>('read_scripts_dir', {
      path: builtinDir,
    })

    // 只在 builtin 目录为空时释放
    if (existing.length === 0) {
      for (const [filename, content] of Object.entries(BUILTIN_SCRIPTS)) {
        await invoke('save_script', {
          path: `${builtinDir}/${filename}`,
          content,
        })
      }
      console.log(`[FluxText] Released ${Object.keys(BUILTIN_SCRIPTS).length} builtin scripts to ${builtinDir}`)
    }

    return configDir
  } catch (e) {
    console.error('[FluxText] Failed to init config dir:', e)
    return null
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
