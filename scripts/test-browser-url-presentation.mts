import assert from 'node:assert/strict'
import { browserUrlPresentation as present } from '../src/plugins/web-open/browserUrlPresentation.ts'
const raw='https://docs.example.invalid:8443/a%2Fb?token=synthetic-only&view=all#part'
assert.deepEqual(present(raw),{text:'docs.example.invalid:8443/a%2Fb?…#…',detail:raw})
for(const raw of ['file:///tmp/synthetic','chrome://settings','javascript:alert(1)','not a url','https://','https://a.invalid/\nnext']) assert.equal(present(raw),undefined)
for(const raw of ['https://例子.测试/a','https://[::1]:8443/a','https://user:synthetic@example.invalid/a?token=synthetic-only']) {
 const value=present(raw)!;assert.equal(value.detail,raw);assert.ok(!value.text.includes('synthetic-only'));assert.ok(!value.text.includes('user:'))
}
const long='https://example.invalid/'+('segment/').repeat(30)+'ending';assert.ok(present(long)!.text.startsWith('example.invalid/…'));assert.ok(present(long)!.text.endsWith('ending'));assert.equal(present(long)!.detail,long)
assert.equal(present('https://example.invalid/a?view=all')!.text,present('https://example.invalid/a?view=compact')!.text) // distinction requires full detail, never a guessed query label.
console.log('Browser URL summary preserves exact detail; unsupported inputs unchanged.')
