import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
const { compareLists, MAX_LIST_BYTES, MAX_LIST_LINES } = await createJiti(import.meta.url).import('../src/plugins/line-tools/compareLists.ts')
const a='001\r\nBob\ralice\n001\n\n Carol \n9007199254740993', b='alice\nbob\n002\n \t\n001\nCarol'
const exact=compareLists(a,b,{ignoreCase:false,trim:false})
assert.deepEqual(exact,{ok:true,values:{leftOnly:['Bob',' Carol ','9007199254740993'],common:['001','alice'],rightOnly:['bob','002','Carol']},ignored:{left:1,right:1},duplicates:{left:1,right:0}})
assert.deepEqual(compareLists(a,b,{ignoreCase:true,trim:true}).values,{leftOnly:['9007199254740993'],common:['001','Bob','alice',' Carol '],rightOnly:['002']})
assert.deepEqual(compareLists('Ä\nİ\nß\nK\n A ','ä\ni\nss\nK\na',{ignoreCase:true,trim:true}).values,{leftOnly:['Ä','İ','ß','K'],common:[' A '],rightOnly:['ä','i','ss','K']})
assert.deepEqual(compareLists('x\nx\n x ','x',{ignoreCase:false,trim:true}).values,{leftOnly:[],common:['x'],rightOnly:[]})
assert.deepEqual(compareLists('', '001\n001', {ignoreCase:false,trim:false}).values,{leftOnly:[],common:[],rightOnly:['001']})
assert.equal(compareLists('a'.repeat(MAX_LIST_BYTES),'',{ignoreCase:false,trim:false}).ok,true)
assert.equal(compareLists('中'.repeat(Math.floor(MAX_LIST_BYTES/3)+1),'',{ignoreCase:false,trim:false}).reason,'bytes')
assert.equal(compareLists(Array(MAX_LIST_LINES).fill('x').join('\n'),'',{ignoreCase:false,trim:false}).ok,true)
assert.equal(compareLists(Array(MAX_LIST_LINES+1).fill('x').join('\n'),'',{ignoreCase:false,trim:false}).reason,'lines')
console.log('List comparison: exact/source order, key-only options, ASCII/Unicode, blank/duplicate counts and caps passed')
