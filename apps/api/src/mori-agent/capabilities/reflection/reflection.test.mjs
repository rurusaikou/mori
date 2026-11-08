/** Reflection 行为测试：覆盖保留、弱化、场景化、坏 Action 和临时证据边界。 */
import assert from 'node:assert/strict'; import test from 'node:test'; import { createReflectionCapability } from './reflection.service.mjs'
const input=(evidence='我只是工作的时候喜欢安静，平时还是很喜欢摇滚。')=>({previousBelief:{content:'用户喜欢安静音乐。',confidence:.8},newEvidence:{content:evidence}})
const run=(output,value=input())=>createReflectionCapability(async()=>({data:output,model:'test',tokenUsage:null})).execute(value)
test('contextualizes scene-specific evidence',async()=>assert.equal((await run({action:'CONTEXTUALIZE',updatedBelief:{content:'工作时偏好安静，平时喜欢摇滚',confidence:.9},reason:'新证据给出场景限制'})).data.action,'CONTEXTUALIZE'))
test('keeps compatible belief',async()=>assert.deepEqual((await run({action:'KEEP',updatedBelief:null,reason:'新证据与旧理解一致'},input('我还是喜欢安静音乐'))).data,{action:'KEEP',reason:'新证据与旧理解一致'}))
test('weakens uncertain belief',async()=>assert.equal((await run({action:'WEAKEN',updatedBelief:{content:'用户可能偏好安静音乐',confidence:.5},reason:'存在反例'})).success,true))
test('rejects invalid action',async()=>assert.equal((await run({action:'DELETE',updatedBelief:null,reason:'x'})).success,false))
test('rejects confidence outside range',async()=>assert.equal((await run({action:'UPDATE',updatedBelief:{content:'新理解',confidence:2},reason:'x'})).success,false))
test('temporary state cannot replace long-term preference',async()=>assert.equal((await run({action:'REPLACE',updatedBelief:{content:'用户讨厌安静音乐',confidence:.9},reason:'今天的表达'},input('今天不想听安静音乐'))).success,false))
