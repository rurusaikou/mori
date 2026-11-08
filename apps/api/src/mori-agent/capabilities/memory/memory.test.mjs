/** Memory 行为测试：覆盖长期经历、稳定偏好、命令、坏输入和临时状态边界。 */
import assert from 'node:assert/strict'; import test from 'node:test'; import { createMemoryCapability } from './memory.service.mjs'
const candidate=(type='experience')=>({shouldCreate:true,candidate:{content:'长期信息',type,confidence:.9,evidence:'用户明确说“一直”'}})
const run=(output,input)=>createMemoryCapability(async()=>({data:output,model:'test',tokenUsage:null})).execute(input)
test('experience creates candidate',async()=>assert.equal((await run(candidate(),{userMessage:'我第一次听这首歌是在毕业旅行。'})).data.candidate.type,'experience'))
test('stable preference creates candidate',async()=>assert.equal((await run(candidate('preference'),{userMessage:'我一直不喜欢特别吵的歌。'})).data.candidate.type,'preference'))
test('playback command is not memory',async()=>assert.deepEqual((await run({shouldCreate:false,candidate:null},{userMessage:'下一首。'})).data,{shouldCreate:false}))
test('rejects empty message',async()=>assert.equal((await run(candidate(),{userMessage:''})).success,false))
test('rejects invalid confidence',async()=>assert.equal((await run({...candidate(),candidate:{...candidate().candidate,confidence:2}},{userMessage:'我一直喜欢它'})).success,false))
test('temporary state remains no candidate',async()=>assert.equal((await run({shouldCreate:false,candidate:null},{userMessage:'今天好累。'})).data.shouldCreate,false))
