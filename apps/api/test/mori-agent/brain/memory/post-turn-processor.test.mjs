import assert from 'node:assert/strict'
import test from 'node:test'
import { createPostTurnMemoryProcessor } from '../../../../src/mori-agent/brain/memory/post-turn-processor.mjs'

test('runs retrieval, Fact/Moment storage and taste refresh after a completed exchange', async () => {
  const calls = []
  const repository = {
    available: true,
    retrieveRelevant: async () => [{ id: 'old', kind: 'preference', source: 'user_statement', content: '喜欢强电子音', status: 'confirmed', confidence: 1, tags: ['preference'] }],
    upsertMusicFact: async (input) => { calls.push(['fact', input]); return { id: 'new' } },
    createMusicMoment: async (input) => { calls.push(['moment', input]); return { id: 'moment' } },
    refreshTasteProfile: async () => { calls.push(['profile']); return [{ dimension: 'arrangement' }] },
  }
  let extractorInput
  const processor = createPostTurnMemoryProcessor({
    userId: 'u1', repository,
    extractor: async (input) => {
      extractorInput = input
      return { success: true, data: {
        facts: [{ category: 'dislike', dimension: 'arrangement', attribute: 'heavy_electronic', content: '不喜欢强电子音', confidence: 1, evidence: '不喜欢强电子音', supersedesId: 'old' }],
        moments: [{ summary: '讨论当前歌曲的编曲', userReflection: '不喜欢强电子音', confidence: 0.9, evidence: '不喜欢强电子音' }],
      } }
    },
  })
  const result = await processor.process({
    input: { userMessage: '其实我不喜欢强电子音', currentTrack: { uri: 'spotify:track:1', title: '歌', artist: '歌手' }, conversationHistory: [] },
    userMessage: { id: 'user-message', exchangeId: 'exchange', createdAt: '2026-11-24T12:00:00.000Z' },
    assistantMessage: { id: 'assistant-message', content: '明白了。', createdAt: '2026-11-24T12:00:01.000Z' },
  })

  assert.equal(extractorInput.existingFacts[0].id, 'old')
  assert.equal(calls[0][1].supersedesId, 'old')
  assert.deepEqual(calls[1][1].sourceMessageIds, ['user-message', 'assistant-message'])
  assert.equal(calls[1][1].confirmed, false)
  assert.deepEqual(result, { processed: true, factCount: 1, momentCount: 1, tasteDimensionCount: 1 })
})

test('isolates extraction failure from the completed conversation', async () => {
  const processor = createPostTurnMemoryProcessor({
    userId: 'u1', repository: { available: true, retrieveRelevant: async () => [] },
    extractor: async () => ({ success: false }),
  })
  const result = await processor.process({ input: { userMessage: '你好' }, userMessage: { id: 'u' }, assistantMessage: { id: 'a' } })
  assert.equal(result.processed, false)
  assert.equal(result.reason, 'extraction_failed')
})
