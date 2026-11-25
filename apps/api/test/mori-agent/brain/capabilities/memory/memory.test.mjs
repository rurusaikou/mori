/** Memory 行为测试：覆盖长期经历、稳定偏好、命令、坏输入和临时状态边界。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryCapability } from '../../../../../src/mori-agent/brain/capabilities/memory/memory.service.mjs'

const run = (output, input) => createMemoryCapability(async () => ({ data: output, model: 'test', tokenUsage: null })).execute(input)
const fact = (overrides = {}) => ({ category: 'preference', dimension: 'arrangement', attribute: 'restrained_arrangement', content: '用户长期喜欢克制的编曲', confidence: 0.95, evidence: '我一直喜欢克制的编曲', supersedesId: null, ...overrides })

test('extracts an explicit stable Music Fact', async () => {
  const result = await run({ facts: [fact()], moments: [] }, { userMessage: '我一直喜欢克制的编曲' })
  assert.equal(result.data.facts[0].category, 'preference')
})

test('extracts a track-bound Music Moment separately from a Fact', async () => {
  const input = { userMessage: '这是我毕业旅行时反复听的歌', currentTrack: { uri: 'spotify:track:1', title: '歌', artist: '歌手' } }
  const result = await run({ facts: [], moments: [{ summary: '用户在毕业旅行反复听当前歌曲', userReflection: '与毕业旅行相关', confidence: 0.9, evidence: '毕业旅行时反复听' }] }, input)
  assert.equal(result.data.moments.length, 1)
})

test('allows correction only when supersedesId comes from retrieved existing facts', async () => {
  const input = { userMessage: '其实我不喜欢强烈电子音', existingFacts: [{ id: 'old', content: '喜欢强烈电子音' }] }
  const result = await run({ facts: [fact({ category: 'dislike', content: '用户不喜欢强烈电子音', evidence: '我不喜欢强烈电子音', supersedesId: 'old' })], moments: [] }, input)
  assert.equal(result.data.facts[0].supersedesId, 'old')
  assert.equal((await run({ facts: [fact({ supersedesId: 'invented' })], moments: [] }, { userMessage: '我一直喜欢克制的编曲', existingFacts: [] })).success, false)
})

test('playback command and temporary state produce no memory', async () => {
  assert.deepEqual((await run({ facts: [], moments: [] }, { userMessage: '下一首。' })).data, { facts: [], moments: [] })
  assert.deepEqual((await run({ facts: [], moments: [] }, { userMessage: '今天好累。' })).data, { facts: [], moments: [] })
})

test('rejects unsupported or non-verbatim evidence', async () => {
  assert.equal((await run({ facts: [fact()], moments: [] }, { userMessage: '' })).success, false)
  assert.equal((await run({ facts: [fact({ confidence: 2 })], moments: [] }, { userMessage: '我一直喜欢克制的编曲' })).success, false)
  assert.equal((await run({ facts: [fact({ evidence: '模型改写的证据' })], moments: [] }, { userMessage: '我一直喜欢克制的编曲' })).success, false)
})
