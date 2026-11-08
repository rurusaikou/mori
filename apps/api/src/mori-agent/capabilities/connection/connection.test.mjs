/** Connection 行为测试：覆盖有效对比、延续、无关联、坏输入和人生解释边界。 */
import assert from 'node:assert/strict'; import test from 'node:test'; import { createConnectionCapability } from './connection.service.mjs'
const input=(current='现在觉得一个人在外面生活其实也挺自由。',past='一个人在国外生活有时候挺孤独。')=>({current:{message:current},candidates:[{id:'m1',content:past}]})
const yes={shouldConnect:true,connection:{pastEvidence:'过去觉得孤独',currentEvidence:'现在觉得自由',observation:'对独居感受可能出现变化',confidence:.82}}
const run=(output,value=input())=>createConnectionCapability(async()=>({data:output,model:'test',tokenUsage:null})).execute(value)
test('finds supported contrast',async()=>assert.equal((await run(yes)).data.shouldConnect,true))
test('allows supported continuity',async()=>assert.equal((await run({...yes,connection:{...yes.connection,observation:'对安静音乐的偏好仍在延续'}} ,input('最近还是喜欢安静音乐','过去常听安静音乐'))).success,true))
test('returns no connection',async()=>assert.deepEqual((await run({shouldConnect:false,connection:null},input('今天下雨','我喜欢爵士'))).data,{shouldConnect:false}))
test('rejects empty candidates',async()=>assert.equal((await run(yes,{current:{message:'x'},candidates:[]})).success,false))
test('rejects malformed confidence',async()=>assert.equal((await run({...yes,connection:{...yes.connection,confidence:4}})).success,false))
test('blocks life-growth interpretation',async()=>assert.equal((await run({...yes,connection:{...yes.connection,observation:'用户成长了'}})).success,false))
