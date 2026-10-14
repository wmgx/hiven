// Actual component callbacks with controlled host promises; not a UI/pixel test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createJiti } from 'jiti'
const core=await createJiti(import.meta.url).import('../src/plugins/encode-decode/imageResize.ts')
const jsx=(type,props)=>({type,props}),slots=[];let cursor=0,effects=[],tree,leave,ownerInvalidation
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]))
const react={useState(initial){const i=cursor++;slots[i]??={value:initial};return[slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v}]},useRef(value){const i=cursor++;slots[i]??={current:value};return slots[i]},useLayoutEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()}})}}
let read=async()=>({bytes:new Uint8Array([1])}),put=async()=>({blobId:'crop'}),save=async()=>({status:'saved'}),writes=0,deletes=0,puts=0,current=true,source
const props={t:k=>k,onDirtyChange(){},invalidateRef:{current:null},host:{deliveryFeedbackOwner:{isCurrent:()=>current,subscribeInvalidation(fn){ownerInvalidation=fn;return()=>{}}},subscribeLeaveIntent(fn){leave=fn;return()=>{}},clipboard:{readImage:(...a)=>read(...a),writeImage:async()=>{writes++}},storage:{blob:{put:(...a)=>{puts++;return put(...a)},delete:async()=>{deletes++},savePng:(...a)=>save(...a)}}}}
const exports={}
vm.runInNewContext(ts.transpileModule(readFileSync('src/plugins/encode-decode/ImageResizePanel.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,Uint8Array,require(name){
 if(name==='react')return react
 if(name==='react/jsx-runtime')return{jsx,jsxs:jsx}
 if(name==='@hiven/plugin-ui')return{Button:'Button',useLocalEscapeLayer(){}}
 if(name==='./imageBase64')return{MAX_IMAGE_BYTES:100}
 if(name==='./imageRedaction')return{loadRedactionImage:async()=>source={width:20,height:10}}
 if(name==='./imageResize')return{...core,exportResizedImage:async()=>new Uint8Array([1])}
 if(name.endsWith('.css'))return{}
 throw Error(name)
}})
function render(){cursor=0;effects=[];tree=exports.ImageResizePanel(props);effects.forEach(f=>f())}
function nodes(n){if(!n||typeof n!=='object')return[];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)]}
const button=k=>nodes(tree).find(n=>n.type==='Button'&&n.props.children===k)
const fields=()=>nodes(tree).filter(n=>n.type==='input'&&n.props.type==='number')
const settle=()=>new Promise(r=>setImmediate(r))
render();button('image.readClipboard').props.onClick();await settle();render()
for(const[i,value]of [[0,'8']]){fields()[i].props.onChange({target:{value}});render()}
const oldCopy=button('image.copyImage').props.onClick
let resolvePut;put=()=>new Promise(r=>{resolvePut=r})
oldCopy();oldCopy();await settle();assert.equal(puts,1,'double export fenced')
leave();render();resolvePut({blobId:'late'});await settle();render()
assert.equal(writes,0);assert.equal(deletes,1,'late blob still deleted');assert.equal(source.width,20);assert.equal(fields()[0].props.value,'8')
put=async()=>({blobId:'retry'});button('image.copyImage').props.onClick();await settle();render();assert.equal(writes,1,'retry after cancelled leave')
read=async()=>{throw Error('synthetic failure')};button('image.readClipboard').props.onClick();await settle();render()
assert.equal(button('image.copyImage').props.disabled,true);oldCopy();await settle();assert.equal(writes,1,'retained callback cannot export failed replacement')
button('redact.keep').props.onClick();render();assert.equal(fields()[0].props.value,'8')
let resolveSave;save=()=>new Promise(r=>{resolveSave=r})
button('image.save').props.onClick();await settle();leave();render();resolveSave({status:'saved'});await settle();render()
assert(!nodes(tree).some(n=>n.props?.children==='image.saved'),'late save does not claim current success')
assert.equal(source.width,20)
put=()=>new Promise(r=>{resolvePut=r});button('image.copyImage').props.onClick();await settle();current=false;ownerInvalidation();resolvePut({blobId:'old-owner'});await settle();render();assert.equal(writes,1);assert.equal(source.width,20)
console.log('Resize delivery fence, late blob cleanup, leave cancellation/retry, failed replacement and retained callback guard passed (controlled host).')
