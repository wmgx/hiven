import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
const { resizeDimensions: size, exportResizedImage: encode } = await createJiti(import.meta.url).import('../src/plugins/encode-decode/imageResize.ts')
assert.deepEqual(size('800',2400,1500),{width:800,height:500})
assert.deepEqual(size('2',3,2),{width:2,height:1})
assert.deepEqual(size('320',320,200),{width:320,height:200})
for(const width of ['','0','-1','1.5','1e2','321','Infinity','01']) assert.equal(size(width,320,200),null)
assert.equal(size('1',8192,1),null)
assert.equal(size('100',8193,1),null)
assert.equal(size('100',8192,8192),null)
let output, draw, callback, context
const original={width:2400,height:1500}
global.document={createElement:()=>output={width:0,height:0,getContext:()=>context={drawImage:(...args)=>{draw=args}},toBlob:fn=>{callback=fn}}}
let signal=new AbortController(),flight=encode(original,'800',signal.signal)
assert.equal(output.width,800);assert.equal(output.height,500);assert.equal(context.imageSmoothingEnabled,true)
assert.deepEqual(draw,[original,0,0,800,500]);callback(new Blob(['png']));assert.deepEqual([...await flight],[112,110,103]);assert.equal(output.width,0)
flight=encode(original,'600',signal.signal);assert.deepEqual(draw,[original,0,0,600,375]);signal.abort();callback(new Blob(['png']));await assert.rejects(flight,/cancelled/);assert.equal(output.height,0)
flight=encode(original,'800',new AbortController().signal);callback({size:10*1024*1024+1});await assert.rejects(flight,/size/);assert.equal(output.width,0)
flight=encode(original,'800',new AbortController().signal);callback(null);await assert.rejects(flight,/invalid/);assert.equal(original.width,2400)
console.log('Resize dimensions, no enlargement, extreme ratios, fresh original resampling, size/cancel/error cleanup passed (controlled canvas).')
