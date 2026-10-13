import assert from 'node:assert/strict'
import { marked } from 'marked'
import { transformPaths, PathTransformError, MARKDOWN_IMAGE_MAX_BYTES } from '../src/plugins/file-paths/core.ts'
const rejects = (fn: () => unknown, code: string) => assert.throws(fn, (error) => error instanceof PathTransformError && error.code === code)
assert.equal(transformPaths('C:\\Users\\小王\\my file#.txt', 'posix'), 'C:/Users/小王/my file#.txt')
assert.equal(transformPaths('C:\\Users\\小王\\my file#.txt', 'uri'), 'file:///C:/Users/%E5%B0%8F%E7%8E%8B/my%20file%23.txt')
assert.equal(transformPaths('\\\\server\\my share\\文档.txt', 'uri'), 'file://server/my%20share/%E6%96%87%E6%A1%A3.txt')
assert.equal(transformPaths('file://server/my%20share/%E6%96%87.txt', 'posix'), '//server/my share/文.txt')
assert.equal(transformPaths('/tmp/a b%?#.txt', 'uri'), 'file:///tmp/a%20b%25%3F%23.txt')
assert.equal(transformPaths('/tmp/ a ', 'name'), ' a ')
assert.equal(transformPaths('/tmp/a\\b', 'name', '', 'unix'), 'a\\b')
assert.equal(transformPaths('sub\\file.txt', 'posix', '', 'windows'), 'sub/file.txt')
assert.equal(transformPaths('/a/x/../b/c', 'relative', '/a/d/.'), '../b/c')
assert.equal(transformPaths('c:\\Work\\a.txt', 'relative', 'C:\\work'), 'a.txt')
assert.equal(transformPaths('\\\\server\\share\\x', 'relative', '\\\\SERVER\\SHARE\\base'), '../x')
assert.equal(transformPaths('/a', 'relative', '/a'), '.')
assert.equal(transformPaths('/tmp/α.txt\r\n/tmp/β.txt\r\n', 'name'), 'α.txt\nβ.txt')
assert.equal(transformPaths('file:///tmp/a%20b', 'name'), 'a b')
rejects(() => transformPaths('C:foo', 'uri'), 'absolute')
rejects(() => transformPaths('foo', 'uri'), 'absolute')
rejects(() => transformPaths('/a', 'relative'), 'base')
rejects(() => transformPaths('D:/a', 'relative', 'C:/a'), 'root')
rejects(() => transformPaths('file:///tmp/a?query', 'posix'), 'invalid')
rejects(() => transformPaths('file:///tmp/%2fetc', 'name'), 'invalid')
rejects(() => transformPaths('file:///tmp/%ZZ', 'name'), 'invalid')
rejects(() => transformPaths('/tmp/a\n\n/tmp/b', 'name'), 'invalid')
rejects(() => transformPaths('x'.repeat(1_048_577), 'name'), 'limit')
// Markdown references use an explicit document directory, with no filesystem inference.
const markdownCases: [string, string, 'auto' | 'unix' | 'windows', string][] = [
  ['/docs/assets/a.png', '/docs', 'unix', '![](assets/a.png)'],
  ['/project/images/a.png', '/project/docs', 'unix', '![](../images/a.png)'],
  ['/project/x/../images/a.png', '/project/docs/.', 'unix', '![](../images/a.png)'],
  ['c:\\Work\\assets\\a.png', 'C:\\work\\docs', 'windows', '![](../assets/a.png)'],
  ['\\\\server\\share\\images\\a.png', '\\\\SERVER\\SHARE\\docs', 'auto', '![](../images/a.png)'],
  ['//server/share/images/a.png', '//server/share/docs', 'windows', '![](../images/a.png)'],
  ['/docs/中文 空格(1)#%?.png', '/docs', 'unix', '![](%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC%281%29%23%25%3F.png)'],
  ['/docs/a\\b.png', '/docs', 'unix', '![](a%5Cb.png)'],
  ['file:///docs/a%20b%23%25.png', '/docs', 'auto', '![](a%20b%23%25.png)'],
  ['file:///C:/Work/assets/a%20b.png', 'C:\\Work\\docs', 'auto', '![](../assets/a%20b.png)'],
]
for (const [source, base, style, expected] of markdownCases) {
  assert.equal(transformPaths(source, 'markdown-image', base, style), expected)
}
for (const path of ['/docs/', '/', '/docs', '/docs/x/..', '/docs/.']) {
  rejects(() => transformPaths(path, 'markdown-image', '/docs/sub', 'unix'), 'directory')
}
rejects(() => transformPaths('/docs/a.png', 'markdown-image'), 'base')
rejects(() => transformPaths('/docs/a.png', 'markdown-image', 'docs', 'unix'), 'base')
rejects(() => transformPaths('a.png', 'markdown-image', '/docs', 'unix'), 'absolute')
rejects(() => transformPaths('D:/a.png', 'markdown-image', 'C:/docs', 'windows'), 'root')
rejects(() => transformPaths('\\\\server\\other\\a.png', 'markdown-image', '\\\\server\\share\\docs'), 'root')
rejects(() => transformPaths('C:/a.png', 'markdown-image', '/docs', 'unix'), 'absolute')
assert.equal(transformPaths('/docs/z.png\r\n/docs/a.png\r\n', 'markdown-image', '/docs'), '![](z.png)\n![](a.png)')
// Parse generated Markdown without rendering or loading resources: exactly one image, empty alt.
const injectionName = '[x](javascript:alert(1))"<tag>#?.png'
const reference = transformPaths(`/docs/${injectionName}`, 'markdown-image', '/docs', 'unix')
const tokens = marked.lexer(reference)
assert.equal(tokens.length, 1)
assert.equal(tokens[0].type, 'paragraph')
if (tokens[0].type === 'paragraph') {
  assert.equal(tokens[0].tokens.length, 1)
  const image = tokens[0].tokens[0]
  assert.equal(image.type, 'image')
  if (image.type === 'image') {
    assert.equal(image.text, '')
    assert.equal(image.title, null)
    assert.equal(decodeURIComponent(image.href), injectionName)
    assert.ok(!/[<>"#?()\[\]]/.test(image.href))
  }
}
// UTF-8 limit applies to the serialized references, including syntax and separators.
const exactName = 'x'.repeat(MARKDOWN_IMAGE_MAX_BYTES - 5)
assert.equal(new TextEncoder().encode(transformPaths(`/a/${exactName}`, 'markdown-image', '/a')).byteLength, MARKDOWN_IMAGE_MAX_BYTES)
rejects(() => transformPaths(`/a/${exactName}x`, 'markdown-image', '/a'), 'output-limit')
rejects(() => transformPaths('/a/' + '中'.repeat(Math.floor(MARKDOWN_IMAGE_MAX_BYTES / 9)), 'markdown-image', '/a'), 'output-limit')
const expandedExactName = '中'.repeat(Math.floor((MARKDOWN_IMAGE_MAX_BYTES - 5) / 9)) + 'x'.repeat((MARKDOWN_IMAGE_MAX_BYTES - 5) % 9)
assert.equal(new TextEncoder().encode(transformPaths(`/a/${expandedExactName}`, 'markdown-image', '/a')).byteLength, MARKDOWN_IMAGE_MAX_BYTES)
rejects(() => transformPaths(`/a/${expandedExactName}x`, 'markdown-image', '/a'), 'output-limit')
const firstName = 'a'.repeat(500_000)
const secondName = 'b'.repeat(MARKDOWN_IMAGE_MAX_BYTES - 11 - firstName.length)
const pair = `/a/${firstName}\n/a/${secondName}`
assert.equal(new TextEncoder().encode(transformPaths(pair, 'markdown-image', '/a')).byteLength, MARKDOWN_IMAGE_MAX_BYTES)
rejects(() => transformPaths(pair + 'b', 'markdown-image', '/a'), 'output-limit')
console.log('File path string semantics passed (Unix, Windows drive / UNC, URI, explicit relative base, bounds).')
