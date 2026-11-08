/** Companionship 行为测试：覆盖回应、沉默、坏 Action、坏输入和禁止追问边界。 */
import assert from 'node:assert/strict'; import test from 'node:test'; import { createCompanionshipCapability } from './companionship.service.mjs'
const run=(output,input)=>createCompanionshipCapability(async()=>({data:output,model:'test',tokenUsage:null})).execute(input)
const decision=(action)=>({action,reason:'符合用户明确表达',responseGuidance:'保持简短'})
test('acknowledges request for quiet',async()=>assert.equal((await run(decision('ACKNOWLEDGE'),{userMessage:'今天不想讲话，就陪我听吧。'})).data.action,'ACKNOWLEDGE'))
test('can respond to direct question',async()=>assert.equal((await run(decision('RESPOND'),{userMessage:'你觉得这首歌怎么样？'})).data.action,'RESPOND'))
test('can stay silent when requested',async()=>assert.equal((await run({action:'SILENT',reason:'用户要求安静',responseGuidance:null},{userMessage:'不用回复我'})).data.action,'SILENT'))
test('rejects unknown action',async()=>assert.equal((await run(decision('CHAT'),{userMessage:'你好'})).success,false))
test('rejects empty message',async()=>assert.equal((await run(decision('RESPOND'),{userMessage:''})).success,false))
test('cannot ask when user requests silence',async()=>assert.equal((await run(decision('ASK'),{userMessage:'今天不想聊天，别问我。'})).success,false))
