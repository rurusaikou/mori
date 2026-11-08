/** Understanding 行为测试：验证事实/解释分层，并覆盖无依据心理推断边界。 */
import assert from 'node:assert/strict'; import test from 'node:test'; import { createUnderstandingCapability } from './understanding.service.mjs'
const empty={facts:[],interpretations:[],unsupportedInferences:[]}; const item=(content)=>({content,confidence:.8,evidence:'用户原话'})
const run=(output,input)=>createUnderstandingCapability(async()=>({data:output,model:'test',tokenUsage:null})).execute(input)
test('separates fact and interpretation',async()=>{const r=await run({facts:[item('最近更喜欢安静音乐')],interpretations:[item('低刺激偏好可能增加')],unsupportedInferences:[]},{userMessage:'最近越来越喜欢这种安静的歌。'});assert.equal(r.data.facts.length,1)})
test('marks emotional inference unsupported',async()=>{const r=await run({facts:[item('歌曲听起来悲伤')],interpretations:[],unsupportedInferences:[{content:'用户悲伤',reason:'描述对象是歌曲'}]},{userMessage:'这首歌听起来很悲伤。'});assert.equal(r.data.unsupportedInferences.length,1)})
test('accepts no inferred meaning',async()=>assert.equal((await run(empty,{userMessage:'下一首'})).success,true))
test('rejects missing arrays',async()=>assert.equal((await run({facts:[]},{userMessage:'你好'})).success,false))
test('rejects empty input',async()=>assert.equal((await run(empty,{userMessage:''})).success,false))
test('blocks unsupported user sadness as interpretation',async()=>assert.equal((await run({facts:[],interpretations:[item('用户现在很悲伤')],unsupportedInferences:[]},{userMessage:'这首歌听起来很悲伤。'})).success,false))
