import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
const { redactionRect } = await createJiti(import.meta.url).import('../src/plugins/encode-decode/imageRedaction.ts')
assert.deepEqual(redactionRect({x: 2.9,y: 3.9},{x: 7.01,y: 8.01},10,10),{x:2,y:3,width:6,height:6})
assert.deepEqual(redactionRect({x: 11,y: 12},{x: -1,y: -2},10,10),{x:0,y:0,width:10,height:10})
assert.deepEqual(redactionRect({x: 100.1,y: 70.8},{x: 1.2,y: 2.3},200,100),{x:1,y:2,width:100,height:69})
assert.equal(redactionRect({x:0,y:0},{x:0,y:5},10,10),null)
assert.equal(redactionRect({x:NaN,y:0},{x:2,y:5},10,10),null)
// CSS coordinates map to source pixels; devicePixelRatio must not enter this mapping.
for (const scale of [0.25,0.5,1,2]) {
  const map = (x,y) => ({x:x/scale,y:y/scale})
  assert.deepEqual(redactionRect(map(10*scale,20*scale),map(50*scale,60*scale),400,200),{x:10,y:20,width:40,height:40})
}
console.log('Redaction pixel bounds: reverse drags, clamp, fractional edges and CSS scales passed')
