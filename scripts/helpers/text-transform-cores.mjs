import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import jsYaml from 'js-yaml'
import * as textTransforms from '../../src/kits/textTransforms/index.ts'

// Installed plugins receive kits through the public SDK. Supply that binding
// without starting the UI host, and run the unchanged cores in the same realm
// as the kit so their native Error checks retain production semantics.
function loadCore(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const exports = {}
  const dependencies = {
    'js-yaml': jsYaml,
    '@hiven/plugin': { getPluginHostSdk: () => ({ kits: { textTransforms } }) },
  }
  new Function('require', 'exports', code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `${relativePath}: unexpected dependency ${name}`)
    return dependencies[name]
  }, exports)
  return exports
}

export const jsonCore = loadCore('../../src/plugins/json-tools/jsonCore.ts')
export const encodeDecodeCore = loadCore('../../src/plugins/encode-decode/core.ts')
