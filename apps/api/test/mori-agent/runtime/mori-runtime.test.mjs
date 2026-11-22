/** 新主流程回归：Understanding LLM → Decision → optional Tool → Final Response。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMoriAgent as createRuntimeAgent } from '../../../src/mori-agent/runtime/index.mjs'

const response = (data) => ({ data, model: 'test-model', tokenUsage: { total_tokens: 10 } })
const base = { userMessage: '你好', currentTrack: null, playbackState: { status: 'none', currentTrack: null }, conversationHistory: [], fakeMemory: [] }
const understanding = (data) => async () => response({ reference: null, listeningRequest: null, emotion: null, confidence: 0.99, ambiguity: null, ...data })
const agent = (llm, understood, options = {}) => createRuntimeAgent(llm, { ...options, understandingLlm: understanding(understood) })

test('daily chat responds without a tool', async () => {
  const result = await agent(async () => response({ action: 'respond', intent: 'CHAT', conversationMove: 'ANSWER', reason: '日常接话', response: '你好，我在。', toolCall: null }), { scene: 'DAILY_CHAT', meaning: '用户在打招呼' }).execute(base)
  assert.equal(result.finalResponse, '你好，我在。')
  assert.deepEqual(result.trace.map((step) => step.type), ['INPUT', 'STATE_BEFORE', 'CONVERSATION_UNDERSTANDING', 'CONTEXT_ASSEMBLY', 'MODEL_DECISION', 'STATE_AFTER', 'FINAL_RESPONSE'])
})

test('structured understanding is the only scene input to decision', async () => {
  let decisionInput
  await agent(async ({ input }) => { decisionInput = input; return response({ action: 'respond', intent: 'CHAT', conversationMove: 'ANSWER', reason: '回应', response: '刚上完课啊。', toolCall: null }) }, { scene: 'DAILY_CHAT', meaning: '用户分享刚上完日语课' }).execute({ ...base, userMessage: '刚上完日语课' })
  assert.equal(decisionInput.understanding.scene, 'DAILY_CHAT')
  assert.equal(decisionInput.understanding.meaning, '用户分享刚上完日语课')
})

test('listen request delegates exact search to Extension', async () => {
  let calls = 0
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'SEARCH', conversationMove: 'ANSWER', reason: '明确歌曲', response: null, toolCall: { name: 'search_music', arguments: { query: '言不由衷', excludeUris: [] } } })
    : response({ response: '我去查找这首歌。' }), { scene: 'LISTEN_REQUEST', meaning: '用户要听言不由衷', listeningRequest: { type: 'SEARCH', song: '言不由衷', artist: null, preferences: [], excludeCurrentTrack: false } }, { musicSearchMode: 'library' }).execute({ ...base, userMessage: '我想听言不由衷' })
  assert.deepEqual(result.action, { type: 'music_request', intent: 'SEARCH', query: '言不由衷', excludeUris: [] })
})

test('listen request delegates recommendation and excludes current track', async () => {
  let calls = 0
  const current = { uri: 'spotify:track:current', title: '当前歌曲', artist: 'A' }
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'RECOMMEND', conversationMove: 'ANSWER', reason: '开放推荐', response: null, toolCall: { name: 'recommend_music', arguments: { query: '', excludeUris: [current.uri] } } })
    : response({ response: '我来选一首。' }), { scene: 'LISTEN_REQUEST', meaning: '用户要随机推荐', listeningRequest: { type: 'RECOMMEND', song: null, artist: null, preferences: [], excludeCurrentTrack: true } }, { musicSearchMode: 'library' }).execute({ ...base, userMessage: '随便推荐一首', currentTrack: current, playbackState: { status: 'playing', currentTrack: current } })
  assert.deepEqual(result.action, { type: 'music_request', intent: 'RECOMMEND', query: '', excludeUris: [current.uri] })
})

test('song chat delegates evidence lookup to Song Understanding', async () => {
  let calls = 0
  const current = { uri: 'spotify:track:1', title: '测试歌曲', artist: 'A' }
  const songUnderstandingAgent = { analyze: async () => ({ sound: { available: true, summary: '低能量', confidence: 0.9, sources: [], observations: ['声音较克制'] }, lyrics: { available: false, summary: '', confidence: 0, sources: [], themes: [], perspective: '', imagery: [], emotionalArc: '' }, creation: { available: false, summary: '', confidence: 0, sources: [], lyricists: [], composers: [], relationships: [], background: '' }, reception: { available: false, summary: '', confidence: 0, sources: [], listenerTags: [], commonInterpretations: [], disagreements: [], culturalContext: '' }, integratedInsight: '声音较克制', missingLayers: ['lyrics', 'creation', 'reception'] }) }
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'CHAT', conversationMove: 'ANSWER', reason: '需要歌曲证据', response: null, toolCall: { name: 'get_track_insight', arguments: { query: '为什么听起来压抑', excludeUris: [] } } })
    : response({ response: '从声音证据看，它的能量比较低。' }), { scene: 'SONG_CHAT', meaning: '用户询问当前歌曲的听感', reference: { type: 'CURRENT_TRACK', value: null } }, { songUnderstandingAgent }).execute({ ...base, userMessage: '这首歌为什么听起来压抑', currentTrack: current, playbackState: { status: 'playing', currentTrack: current } })
  assert.match(result.finalResponse, /声音证据/)
})

test('rejects invalid Understanding output before decision', async () => {
  const result = await createRuntimeAgent(async () => response({}), { understandingLlm: understanding({ scene: 'UNKNOWN', meaning: 'x' }) }).execute(base)
  assert.equal(result.success, false)
  assert.match(result.error, /scene/)
})

test('rejects malformed agent input', async () => {
  const result = await agent(async () => response({}), { scene: 'DAILY_CHAT', meaning: 'x' }).execute({ ...base, userMessage: '' })
  assert.equal(result.success, false)
})
