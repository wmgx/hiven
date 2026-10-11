import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
const dir = await mkdtemp(join(tmpdir(), 'hiven-permissions-'))
try {
  const source = await readFile(new URL('../src/plugins/unix-permissions/core.ts', import.meta.url), 'utf8')
  const path = join(dir, 'core.mjs')
  await writeFile(path, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
  const { decodePermissions, parsePermissionQuery: parse } = await import(pathToFileURL(path))
  for (const intent of ['Unix权限', 'Unix 权限解析', '权限解析', 'unix permissions', 'Unix permission parser']) {
    assert.equal(parse(intent).error, 'syntax')
    assert.equal(parse(`${intent} 755`).value.symbolic, 'rwxr-xr-x')
  }
  assert.equal(parse('chmod 755').value.symbolic, 'rwxr-xr-x')
  assert.equal(parse('permissions755').value.octal, '0755')
  assert.equal(parse('权限 4755').value.symbolic, 'rwsr-xr-x')
  assert.equal(parse('rwxr-xr-x').value.octal, '0755')
  assert.equal(parse('chmod 7644').value.symbolic, 'rwSr-Sr-T')
  assert.equal(parse('chmod 7777').value.symbolic, 'rwsrwsrwt')
  assert.equal(parse('chmod 1000').value.symbolic, '--------T')
  // Exhaustive round trip of all 12 permission bits, including every special/execute combination.
  for (let mode = 0; mode <= 0o7777; mode++) {
    const value = decodePermissions(mode)
    assert.deepEqual(parse(value.symbolic).value, value)
    assert.deepEqual(parse(`chmod ${value.octal}`).value, value)
  }
  for (const query of ['chmod 888', 'chmod 9999', 'chmod 10000', 'chmod 07555', 'chmod 77']) assert.equal(parse(query).error, 'octal')
  for (const query of ['chmod 755 /tmp/file', 'chmod -R 755', 'chmod u+x', 'chmod 755; touch x', 'chmod $(whoami)', 'chmod', 'permissions', 'chmod 0o755', 'chmod +755', 'chmod -1']) assert.equal(parse(query).ok, false)
  for (const query of ['rwtr-xr-x', 'rwxr-xr-s', 'rSxr-xr-x']) assert.equal(parse(query).error, 'symbolic')
  for (const query of ['755', '123', 'permissionless', 'chmodish 755', 'hello']) assert.equal(parse(query), null)
  for (const mode of [-1, 4096, 1.5, NaN]) assert.throws(() => decodePermissions(mode), RangeError)
  console.log('Unix permission parsing and all 4096 mode round trips passed; no chmod or file access.')
} finally { await rm(dir, { recursive: true, force: true }) }
