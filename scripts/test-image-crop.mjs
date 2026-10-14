import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
const { cropFromDrag, parseCrop, validCrop, exportCrop } = await createJiti(import.meta.url).import('../src/plugins/encode-decode/imageCrop.ts')
assert.deepEqual(cropFromDrag({x:9.8,y:8.4},{x:-1,y:2.2},10,10),{x:0,y:2,width:10,height:7})
assert.equal(cropFromDrag({x:2,y:2},{x:2,y:8},10,10),null)
assert.equal(parseCrop({x:'0',y:'0',width:'',height:'2'},10,10),null)
assert.equal(parseCrop({x:'0',y:'0',width:'1.5',height:'2'},10,10),null)
assert.equal(parseCrop({x:'9',y:'0',width:'2',height:'2'},10,10),null)
assert.equal(validCrop({x:0,y:0,width:Infinity,height:2},10,10),false)
assert.deepEqual(parseCrop({x:'9',y:'9',width:'1',height:'1'},10,10),{x:9,y:9,width:1,height:1})
// Controlled export transport failures: actual export function, no UI claims.
let draw, resolveBlob, output
const source={width:10,height:10}
global.document={createElement:()=> output={width:0,height:0,getContext:()=>({drawImage:(...args)=>{draw=args}}),toBlob:callback=>{resolveBlob=callback}}}
const controller=new AbortController()
let flight=exportCrop(source,{x:1,y:2,width:3,height:4},controller.signal)
assert.equal(output.width,3);assert.equal(output.height,4)
assert.deepEqual(draw,[source,1,2,3,4,0,0,3,4])
controller.abort();resolveBlob(new Blob(['png']))
await assert.rejects(flight,/cancelled/);assert.equal(output.width,0)
flight=exportCrop(source,{x:1,y:2,width:3,height:4},new AbortController().signal)
resolveBlob(null);await assert.rejects(flight,/invalid/);assert.equal(output.height,0)
assert.equal(source.width,10);assert.equal(source.height,10)
console.log('Crop bounds, exact output buffer, cancelled/failed async encoding and source preservation passed (mock canvas).')
