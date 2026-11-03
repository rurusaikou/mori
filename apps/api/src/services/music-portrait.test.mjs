import assert from 'node:assert/strict'
import test from 'node:test'
import { createMusicPortraitService } from './music-portrait.mjs'

const profile = {
  analyzedAt: 0,
  trackCount: 373,
  requestedCount: 394,
  averageBpm: 123,
  energy: 0.72,
  danceability: 0.39,
  valence: 0.5,
  acousticness: 0.46,
  instrumentalness: 0.1,
}

test('sends only aggregate metrics and enriches a valid LLM portrait', async () => {
  let requestBody
  const generate = createMusicPortraitService({
    logInfo() {},
    logError() {},
    env: { MORI_LLM_ENDPOINT: 'https://llm.example/v1/chat/completions', MORI_LLM_API_KEY: 'secret', MORI_LLM_MODEL: 'model' },
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        rhythmPreference: { status: '中等偏快', description: '偏爱利落而不仓促的节奏' },
        energyPreference: { status: '有能量', description: '更容易被有力量感的音乐吸引' },
        groovePreference: { status: '沉浸', description: '更偏向沉浸聆听而非强烈舞感' },
        moodPreference: { status: '平衡', description: '明亮与深沉的表达都会听' },
        soundPreference: { status: '混合', description: '自然乐器与现代制作都能接受' },
        musicProfileSummary: '你偏爱有能量、有推进感，却不过分躁动的音乐。',
      }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })

  const portrait = await generate(profile)
  const sentMetrics = JSON.parse(requestBody.messages[1].content)
  assert.deepEqual(Object.keys(sentMetrics).sort(), ['acousticness', 'analyzedTrackCount', 'averageBpm', 'danceability', 'energy', 'instrumentalness', 'requestedTrackCount', 'valence'])
  assert.equal(portrait.rhythmPreference.position, 0.63)
  assert.equal(portrait.energyPreference.level, 'high')
  assert.match(portrait.musicProfileSummary, /有推进感/)
})

test('returns null when LLM is not configured', async () => {
  const events = []
  const generate = createMusicPortraitService({ logInfo: (_category, event) => events.push(event), logError() {}, env: {} })
  assert.equal(await generate(profile), null)
  assert.deepEqual(events, ['portrait_fallback'])
})

test('returns null for an invalid LLM schema', async () => {
  const errors = []
  const generate = createMusicPortraitService({
    logInfo() {},
    logError: (_category, event) => errors.push(event),
    env: { MORI_LLM_ENDPOINT: 'https://llm.example', MORI_LLM_API_KEY: 'secret', MORI_LLM_MODEL: 'model' },
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"musicProfileSummary":"越界推断"}' } }] }), { status: 200 }),
  })
  assert.equal(await generate(profile), null)
  assert.deepEqual(errors, ['portrait_generation_failed'])
})
