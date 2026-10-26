import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function load(path, imports = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module, exports: module.exports, require: key => {
    assert.ok(key in imports, key)
    return imports[key]
  } })
  return module.exports
}
const content = load('src/kits/content/detectContent.ts')
const snapshot = load('src/launcher/clipboard/clipboardSnapshot.ts', { '../../kits/content/index': content })
const { shouldShowClipboardHint, shouldPasteAsBlock } = load('src/launcher/clipboard/attachPolicy.ts', {
  '../../kits/content/index': content, './clipboardSnapshot': snapshot,
})
const copied = text => ({ text, hash: snapshot.hashClipboardText(text), detectedType: snapshot.detectClipboardType(text) })
// Hint: recognition shows it, using/dismissing suppresses this identity until a change.
const json = copied('{"a":1}')
assert.equal(shouldShowClipboardHint(json, null), true)
assert.equal(shouldShowClipboardHint(json, json.hash), false)
assert.equal(shouldShowClipboardHint(copied('{"a":2}'), json.hash), true)
// Failure path: an ordinary search phrase is not clipboard material.
assert.equal(shouldShowClipboardHint(copied('ordinary short text'), null), false)
// Paste: newline or measured wrapping beyond four lines becomes a block.
assert.equal(shouldPasteAsBlock('a\nb', 2), true)
assert.equal(shouldPasteAsBlock('a'.repeat(41), 5), true)
// Failure path: a single-line structured value stays ordinary input.
assert.equal(shouldPasteAsBlock('{"a":1}', 1), false)
console.log('Clipboard hint and paste policy: two groups passed')
