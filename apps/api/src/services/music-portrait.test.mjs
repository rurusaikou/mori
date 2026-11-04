import assert from 'node:assert/strict'
import test from 'node:test'
import { createMusicPortraitService } from './music-portrait.mjs'

const profile = {
  analyzedAt: 0, trackCount: 373, requestedCount: 394, averageBpm: 123,
  energy: 0.72, danceability: 0.39, valence: 0.5, acousticness: 0.46, instrumentalness: 0.1,
}

const validInsight = {
  summary: '你通常会被有推动力却不过分躁动的声音吸引，也愿意在明暗情绪之间自由切换。',
  traits: [
    { name: '稳步推进', description: '偏爱能持续向前、又不会让听感显得仓促的音乐。' },
    { name: '沉浸多于舞动', description: '比起强烈的身体摆动，更重视声音带来的包裹感。' },
    { name: '情绪开放', description: '明亮与深沉的表达都可能进入你的长期播放列表。' },
  ],
  listeningStyle: '听歌时通常会追求清晰的推动感和适度力量，同时保留沉浸空间；情绪不必始终明亮，也不需要靠强烈舞感维持吸引力。',
  keywords: ['有推进感', '沉浸聆听', '情绪开放'],
}

test('sends four normalized dimensions through Responses JSON Schema', async () => {
  let requestBody
  const events = []
  const generate = createMusicPortraitService({
    logInfo: (_category, event, data) => events.push({ event, data }), logError() {},
    env: { MORI_LLM_ENDPOINT: 'https://llm.example/v1/responses', MORI_LLM_API_KEY: 'secret', MORI_LLM_MODEL: 'model' },
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body)
      return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(validInsight) }), { status: 200 })
    },
  })

  const insight = await generate(profile)
  assert.match(requestBody.input[1].content, /节奏倾向：63 \/ 100/)
  assert.match(requestBody.input[1].content, /能量倾向：72 \/ 100/)
  assert.match(requestBody.input[1].content, /律动倾向：39 \/ 100/)
  assert.match(requestBody.input[1].content, /情绪倾向：50 \/ 100/)
  assert.doesNotMatch(requestBody.input[1].content, /原声|用户身份/)
  assert.equal(requestBody.text.format.type, 'json_schema')
  assert.equal(requestBody.text.format.schema.additionalProperties, false)
  assert.deepEqual(Object.keys(requestBody.text.format.schema.properties), ['summary', 'traits', 'listeningStyle', 'keywords'])
  assert.equal(requestBody.text.format.schema.properties.traits.minItems, 3)
  assert.deepEqual(insight, validInsight)
  assert.deepEqual(events.map(({ event }) => event), ['portrait_generation_started', 'portrait_generated'])
  assert.deepEqual(events[0].data, { model: 'model', rhythm: 63, energy: 72, groove: 39, mood: 50 })
  assert.equal(events[1].data.summary, validInsight.summary)
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
    logInfo() {}, logError: (_category, event) => errors.push(event),
    env: { MORI_LLM_ENDPOINT: 'https://llm.example', MORI_LLM_API_KEY: 'secret', MORI_LLM_MODEL: 'model' },
    fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', output_text: '{"summary":"越界推断"}' }), { status: 200 }),
  })
  assert.equal(await generate(profile), null)
  assert.deepEqual(errors, ['portrait_generation_failed'])
})
