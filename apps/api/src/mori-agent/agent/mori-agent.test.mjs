/** Agent V0.1 闭环测试：验证直接回复、三类 Tool、Trace 顺序与错误边界。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMoriAgent } from './mori-agent.mjs'

const base = { userMessage: '你好', currentTrack: { title: '测试歌曲', artist: '测试歌手' }, conversationHistory: [], fakeMemory: [{ id: 'm1', content: '旅行时听过这首歌', context: '旅行' }] }
const response = (data) => ({ data, model: 'test-model', tokenUsage: { total_tokens: 10 } })

test('responds directly without calling a tool', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => { calls += 1; return response({ action: 'respond', reason: '信息足够', response: '你好，我在。', toolCall: null }) }).execute(base)
  assert.equal(result.finalResponse, '你好，我在。'); assert.equal(calls, 1)
  assert.deepEqual(result.trace.map((step) => step.type), ['INPUT', 'CONTEXT_ASSEMBLY', 'MODEL_DECISION', 'FINAL_RESPONSE'])
})

test('searches mock memory and makes a final model call', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => {
    calls += 1
    return calls === 1
      ? response({ action: 'tool', reason: '需要寻找相关经历', response: null, toolCall: { name: 'search_memory', arguments: { query: '旅行' } } })
      : response({ response: '你可能想起了旅行时听这首歌的经历。' })
  }).execute({ ...base, userMessage: '这首歌让我想起什么？' })
  assert.equal(calls, 2); assert.equal(result.success, true)
  assert.deepEqual(result.trace.map((step) => step.type), ['INPUT', 'CONTEXT_ASSEMBLY', 'MODEL_DECISION', 'TOOL_CALL', 'TOOL_ARGUMENTS', 'TOOL_RESULT', 'FINAL_MODEL_CALL', 'FINAL_RESPONSE'])
  assert.equal(result.trace.find((step) => step.type === 'TOOL_RESULT').data.result.matches[0].id, 'm1')
})

test('formal agent searches the injected user-scoped memory repository', async () => {
  let searchInput
  let calls = 0
  const repository = { available: true, search: async (input) => { searchInput = input; return [{ id: 'server-memory', content: '用户常在晚间听克制的人声作品' }] } }
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'tool', reason: '需要记忆', response: null, toolCall: { name: 'search_memory', arguments: { query: '晚间听歌' } } })
    : response({ response: '你以前更常在晚间选择克制的人声作品。' }), { memoryRepository: repository, memoryUserId: 'user-1' }).execute(base)
  assert.equal(result.success, true)
  assert.deepEqual(searchInput, { userId: 'user-1', query: '晚间听歌', limit: 5 })
})

test('gets manually supplied current track', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'tool', reason: '需要当前歌曲', response: null, toolCall: { name: 'get_music_context', arguments: { query: null } } })
    : response({ response: '现在是《测试歌曲》。' })).execute({ ...base, userMessage: '现在是什么歌？' })
  assert.equal(result.trace.find((step) => step.type === 'TOOL_RESULT').data.result.track.title, '测试歌曲')
})

test('returns mock music search result', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'tool', reason: '需要搜索歌曲', response: null, toolCall: { name: 'search_music', arguments: { query: '安静的歌' } } })
    : response({ response: '目前找到的是 Mock 搜索结果。' })).execute({ ...base, userMessage: '帮我搜安静的歌' })
  assert.equal(result.trace.find((step) => step.type === 'TOOL_RESULT').data.result.source, 'mock')
})

test('does not expose mock music search to the formal product agent', async () => {
  let availableTools = []
  const result = await createMoriAgent(async ({ input }) => {
    availableTools = input.availableTools
    return response({ action: 'respond', reason: '正式产品没有真实搜索工具', response: '我现在还不能替你搜索歌曲。', toolCall: null })
  }, { musicSearchMode: 'none' }).execute(base)
  assert.equal(result.success, true)
  assert.deepEqual(availableTools.map((tool) => tool.name), ['search_memory', 'get_music_context'])
})

test('returns a validated play action for a track found in the supplied library', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'tool', reason: '用户要求播放歌手歌曲', response: null, toolCall: { name: 'search_music', arguments: { query: '徐佳莹' } } })
    : response({ response: '好，给你放徐佳莹的《言不由衷》。' }), { musicSearchMode: 'library' }).execute({
      ...base,
      userMessage: '我想听徐佳莹的歌',
      musicCatalog: [{ uri: 'spotify:track:real-track', title: '言不由衷', artist: '徐佳莹' }],
    })
  assert.equal(result.success, true)
  assert.deepEqual(result.action, { type: 'play_track', track: { uri: 'spotify:track:real-track', title: '言不由衷', artist: '徐佳莹' } })
})

test('ranks a playable library track from natural-language feature intent', async () => {
  let calls = 0
  const features = new Map([
    ['CALM', { bpm: 78, energy: 0.2, danceability: 0.18, valence: 0.4, acousticness: 0.8 }],
    ['GROOVE', { bpm: 126, energy: 0.75, danceability: 0.9, valence: 0.7, acousticness: 0.1 }],
  ])
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'tool', reason: '用户要求播放有节奏的歌', response: null, toolCall: { name: 'search_music', arguments: { query: '有节奏' } } })
    : response({ response: '给你放一首更有节奏感的。' }), { musicSearchMode: 'library', resolveMusicFeatures: (isrc) => features.get(isrc) }).execute({
      ...base,
      userMessage: '我想听有节奏的歌曲',
      musicCatalog: [
        { uri: 'spotify:track:calm', isrc: 'CALM', title: '安静', artist: 'A' },
        { uri: 'spotify:track:groove', isrc: 'GROOVE', title: '流动', artist: 'B' },
      ],
    })
  assert.equal(result.success, true)
  assert.equal(result.action.track.uri, 'spotify:track:groove')
})

test('forces an explicit listening request through library search when the model only chats', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'respond', reason: '错误地只回复', response: '有节奏的音乐确实不错。', toolCall: null })
    : response({ response: '给你放一首有节奏感的。' }), { musicSearchMode: 'library', resolveMusicFeatures: () => ({ bpm: 124, energy: 0.8, danceability: 0.85, valence: 0.6, acousticness: 0.1 }) }).execute({
      ...base,
      userMessage: '我想听有节奏的歌曲',
      musicCatalog: [{ uri: 'spotify:track:groove', isrc: 'GROOVE', title: '流动', artist: 'B' }],
    })
  assert.equal(calls, 2)
  assert.equal(result.action.track.uri, 'spotify:track:groove')
  assert.equal(result.trace.find((step) => step.type === 'MODEL_DECISION').data.action, 'tool')
})

test('does not promise playback when trusted library search has no result', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'tool', reason: '搜索听感', response: null, toolCall: { name: 'search_music', arguments: { query: '有节奏' } } })
    : response({ response: '没找到，不过我可以替你播放别的经典歌曲。' }), { musicSearchMode: 'library' }).execute({
      ...base,
      userMessage: '我想听有节奏的歌曲',
      musicCatalog: [{ uri: 'spotify:track:no-features', title: '未知', artist: 'A' }],
    })
  assert.equal(result.action, undefined)
  assert.match(result.finalResponse, /暂时没有找到/)
  assert.doesNotMatch(result.finalResponse, /可以替你播放/)
})

test('rejects malformed agent input', async () => {
  const result = await createMoriAgent(async () => response({})).execute({ ...base, userMessage: '' })
  assert.equal(result.success, false); assert.equal(result.trace.at(-1).type, 'ERROR')
})

test('rejects empty tool query instead of executing silently', async () => {
  const result = await createMoriAgent(async () => response({ action: 'tool', reason: '搜索', response: null, toolCall: { name: 'search_music', arguments: { query: '' } } })).execute(base)
  assert.equal(result.success, false); assert.match(result.error, /query/)
})
