/** 新主流程回归：Understanding LLM → Decision → optional Tool → Final Response。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMoriAgent as createRuntimeAgent } from '../../../src/mori-agent/runtime/index.mjs'
import { CONVERSATION_UNDERSTANDING_PROMPT_VERSION, understandConversation, resolveTrackReference, validateConversationUnderstanding } from '../../../src/mori-agent/perception/conversation-understanding.mjs'
import { decisionSystemPrompt } from '../../../src/mori-agent/expression/prompts.mjs'

const response = (data) => ({ data, model: 'test-model', tokenUsage: { total_tokens: 10 } })
const base = { userMessage: '你好', currentTrack: null, playbackState: { status: 'none', currentTrack: null }, conversationHistory: [], fakeMemory: [] }
const understanding = (data) => async () => response({ turnRelation: 'INDEPENDENT', reference: null, listeningRequest: null, emotion: null, confidence: 0.99, ambiguity: null, ...data })
const agent = (llm, understood, options = {}) => createRuntimeAgent(llm, { ...options, understandingLlm: understanding(understood) })

test('daily chat responds without a tool', async () => {
  const result = await agent(async () => response({ action: 'respond', intent: 'CHAT', conversationMove: 'ANSWER', reason: '日常接话', response: '你好，我在。', toolCall: null }), { scene: 'DAILY_CHAT', meaning: '用户在打招呼' }).execute(base)
  assert.equal(result.finalResponse, '你好，我在。')
  assert.deepEqual(result.trace.map((step) => step.type), ['INPUT', 'STATE_BEFORE', 'CONVERSATION_UNDERSTANDING', 'TRACK_REFERENCE_RESOLUTION', 'CONTEXT_ASSEMBLY', 'MODEL_DECISION', 'STATE_AFTER', 'FINAL_RESPONSE'])
})

test('passes all twelve normalized history messages into Conversation Understanding', async () => {
  const history = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `消息 ${index + 1}`, playbackTrack: index === 10 ? { uri: 'spotify:track:a', title: 'A', artist: '歌手 A' } : null, discussionTrack: null }))
  let understandingInput
  const understandingLlm = async ({ input }) => {
    understandingInput = input
    return response({ scene: 'DAILY_CHAT', meaning: '用户继续聊天', turnRelation: 'CONTINUATION', reference: null, listeningRequest: null, emotion: null, confidence: 0.99, ambiguity: null })
  }
  const runtime = createRuntimeAgent(async () => response({ action: 'respond', intent: 'CHAT', conversationMove: 'ANSWER', reason: '回应', response: '好。', toolCall: null }), { understandingLlm })
  await runtime.execute({ ...base, conversationHistory: history })
  assert.deepEqual(understandingInput.conversationHistory, history)
})

test('prepares relevant memory once and exposes it through the shared Conversation Context', async () => {
  let decisionInput
  await agent(async ({ input }) => {
    decisionInput = input
    return response({ action: 'respond', response: '我记得你喜欢这种表达。', toolCall: null })
  }, { scene: 'DAILY_CHAT', meaning: '用户继续聊偏好' }).execute({
    ...base,
    userMessage: '含蓄',
    fakeMemory: [
      { id: 'm1', content: '用户喜欢含蓄的情绪表达', context: '言不由衷' },
      { id: 'm2', content: '用户喜欢强烈电子音', context: '其他话题' },
    ],
  })
  assert.equal(decisionInput.context.relevantMemory.source, 'LOCAL_MEMORY')
  assert.equal(decisionInput.context.relevantMemory.matches[0].id, 'm1')
})

test('exposes the evidence-backed taste profile through formal Conversation Context', async () => {
  let decisionInput
  const repository = {
    available: true,
    retrieveRelevant: async ({ trackUri }) => [{ id: 'fact-1', content: `歌曲相关记忆:${trackUri}` }],
    listTasteProfile: async () => [{ id: 'profile-1', dimension: 'vocal', stance: 'likes', confidence: 0.8, evidenceIds: ['fact-1'] }],
    retrieveAssociations: async () => [{ relation: 'ABOUT_TRACK', source: { type: 'MOMENT', key: 'moment-1' }, target: { type: 'CATALOG_TRACK', key: 'spotify:track:current' } }],
  }
  const currentTrack = { uri: 'spotify:track:current', title: '当前歌曲', artist: '歌手' }
  await agent(async ({ input }) => {
    decisionInput = input
    return response({ action: 'respond', response: '我记得你偏爱这种人声。', toolCall: null })
  }, { scene: 'SONG_CHAT', meaning: '用户讨论当前歌曲' }, { memoryRepository: repository, memoryUserId: 'u1' }).execute({
    ...base, userMessage: '这种声音我喜欢', currentTrack, playbackState: { status: 'playing', currentTrack },
  })

  assert.equal(decisionInput.context.relevantMemory.matches[0].id, 'fact-1')
  assert.equal(decisionInput.context.relevantMemory.tasteProfile[0].dimension, 'vocal')
  assert.deepEqual(decisionInput.context.relevantMemory.tasteProfile[0].evidenceIds, ['fact-1'])
  assert.equal(decisionInput.context.relevantMemory.associations[0].source.key, 'moment-1')
})

test('reports the actual Understanding prompt version and raw output before validation', async () => {
  const raw = { scene: 'DAILY_CHAT', meaning: '用户打招呼', turnRelation: 'INDEPENDENT', reference: null, listeningRequest: null, emotion: null, confidence: 0.99, ambiguity: null }
  let observed
  const result = await understandConversation(async () => response(raw), { ...base, worldState: { timeZone: 'UTC' } }, { onRawOutput: (value) => { observed = value } })
  assert.equal(observed.promptVersion, CONVERSATION_UNDERSTANDING_PROMPT_VERSION)
  assert.deepEqual(observed.output, raw)
  assert.deepEqual(result.understanding, raw)
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

test('immediate acceptance of the previous music proposal becomes an authorized recommendation', async () => {
  let calls = 0
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'RECOMMEND', conversationMove: 'ACKNOWLEDGE', reason: '用户接受轻快音乐提议', response: null, toolCall: { name: 'recommend_music', arguments: { query: '轻快', excludeUris: [] } } })
    : response({ response: '我来选一首轻快的歌。' }), {
      scene: 'LISTEN_REQUEST',
      meaning: '用户接受上一轮听轻快歌曲的提议',
      turnRelation: 'ACCEPTS_ACTION_PROPOSAL',
      listeningRequest: { type: 'RECOMMEND', control: null, song: null, artist: null, preferences: ['轻快'], excludeCurrentTrack: false },
    }, { musicSearchMode: 'library' }).execute({
      ...base,
      userMessage: '行',
      conversationHistory: [
        { role: 'user', content: '明天要上班，心情一般', playbackTrack: null, discussionTrack: null },
        { role: 'assistant', content: '或许可以试着听听轻快的歌来转移注意力？', playbackTrack: null, discussionTrack: null },
      ],
    })
  assert.deepEqual(result.action, { type: 'music_request', intent: 'RECOMMEND', query: '轻快', excludeUris: [] })
})

test('runtime replaces Decision music arguments with Structured Understanding constraints', async () => {
  let calls = 0
  const current = { uri: 'spotify:track:current', title: '当前歌曲', artist: 'A' }
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'RECOMMEND', response: null, toolCall: { name: 'recommend_music', arguments: { query: '伤感', excludeUris: [] } } })
    : response({ response: '我来选歌。' }), {
      scene: 'LISTEN_REQUEST', meaning: '用户接受轻快音乐提议', turnRelation: 'ACCEPTS_ACTION_PROPOSAL',
      listeningRequest: { type: 'RECOMMEND', control: null, song: null, artist: null, preferences: ['轻快'], excludeCurrentTrack: true },
    }, { musicSearchMode: 'library' }).execute({ ...base, userMessage: '行', currentTrack: current, playbackState: { status: 'playing', currentTrack: current } })
  assert.deepEqual(result.action, { type: 'music_request', intent: 'RECOMMEND', query: '轻快', excludeUris: [current.uri] })
})

test('runtime replaces a mismatched playback command with the Understanding command', async () => {
  let calls = 0
  const current = { uri: 'spotify:track:current', title: '当前歌曲', artist: 'A' }
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'CONTROL', response: null, toolCall: { name: 'playback_control', arguments: { command: 'PAUSE' } } })
    : response({ response: '正在切歌。' }), {
      scene: 'LISTEN_REQUEST', meaning: '用户要求下一首',
      listeningRequest: { type: 'CONTROL', control: 'NEXT', song: null, artist: null, preferences: [], excludeCurrentTrack: false },
    }).execute({ ...base, userMessage: '下一首', currentTrack: current, playbackState: { status: 'playing', currentTrack: current } })
  assert.deepEqual(result.action, { type: 'playback_control', command: 'NEXT' })
})

test('accepted action proposal without a listening request is rejected', () => {
  assert.throws(() => validateConversationUnderstanding({
    scene: 'DAILY_CHAT', meaning: '用户说行', turnRelation: 'ACCEPTS_ACTION_PROPOSAL', reference: null,
    listeningRequest: null, emotion: null, confidence: 0.9, ambiguity: null,
  }), /必须包含 listeningRequest/)
})

test('emotion evidence cannot be inherited from conversation history', () => {
  assert.throws(() => validateConversationUnderstanding({
    scene: 'DAILY_CHAT', meaning: '用户表示同意', turnRelation: 'CONTINUATION', reference: null,
    listeningRequest: null, emotion: { description: '疲惫、低落', evidence: '明天要上班', confidence: 0.95 }, confidence: 0.9, ambiguity: null,
  }, '行'), /必须来自 latestMessage/)
})

test('playback control delegates pause to the Extension', async () => {
  let calls = 0
  const current = { uri: 'spotify:track:current', title: '当前歌曲', artist: 'A' }
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'CONTROL', conversationMove: 'ACKNOWLEDGE', reason: '用户要求暂停', response: null, toolCall: { name: 'playback_control', arguments: { command: 'PAUSE' } } })
    : response({ response: '正在暂停。' }), { scene: 'LISTEN_REQUEST', meaning: '用户要求暂停当前播放', listeningRequest: { type: 'CONTROL', control: 'PAUSE', song: null, artist: null, preferences: [], excludeCurrentTrack: false } }).execute({ ...base, userMessage: '暂停一下', currentTrack: current, playbackState: { status: 'playing', currentTrack: current } })
  assert.deepEqual(result.action, { type: 'playback_control', command: 'PAUSE' })
})

test('playback control cannot bypass an Understanding CONTROL omission', async () => {
  let calls = 0
  const current = { uri: 'spotify:track:current', title: '当前歌曲', artist: 'A' }
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', response: null, toolCall: { name: 'playback_control', arguments: { command: 'PAUSE' } } })
    : response({ response: '正在暂停。' }), { scene: 'DAILY_CHAT', meaning: '用户希望暂停，但 Understanding 漏标了控制请求' }).execute({ ...base, userMessage: '暂停一下', currentTrack: current, playbackState: { status: 'playing', currentTrack: current } })
  assert.equal(result.action, undefined)
  assert.equal(result.finalResponse, '我还没有暂停播放。')
  assert.equal(result.trace.some((step) => step.type === 'DECISION_REPAIR'), true)
})

test('direct response cannot claim playback paused while state is still playing', async () => {
  const current = { uri: 'spotify:track:current', title: '当前歌曲', artist: 'A' }
  const result = await agent(async () => response({ action: 'respond', response: '好的，音乐已经暂停了。', toolCall: null }), { scene: 'DAILY_CHAT', meaning: '普通回复' }).execute({ ...base, userMessage: '嗯', currentTrack: current, playbackState: { status: 'playing', currentTrack: current } })
  assert.equal(result.finalResponse, '我还没有暂停播放。')
})

test('direct response cannot claim a track switch without a client action', async () => {
  const current = { uri: 'spotify:track:current', title: '当前歌曲', artist: 'A' }
  const result = await agent(async () => response({ action: 'respond', response: '好的，已经切到下一首。', toolCall: null }), { scene: 'DAILY_CHAT', meaning: '普通回复' }).execute({ ...base, userMessage: '嗯', currentTrack: current, playbackState: { status: 'playing', currentTrack: current } })
  assert.equal(result.finalResponse, '我还没有完成切歌。')
})

test('playback control delegates next-track switching to the Extension', async () => {
  let calls = 0
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'CONTROL', conversationMove: 'ACKNOWLEDGE', reason: '用户要求切歌', response: null, toolCall: { name: 'playback_control', arguments: { command: 'NEXT' } } })
    : response({ response: '正在切歌。' }), { scene: 'LISTEN_REQUEST', meaning: '用户要求切到下一首', listeningRequest: { type: 'CONTROL', control: 'NEXT', song: null, artist: null, preferences: [], excludeCurrentTrack: true } }).execute({ ...base, userMessage: '切歌' })
  assert.deepEqual(result.action, { type: 'playback_control', command: 'NEXT' })
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

test('P0 A resolves an explicit current-track reference for get_music_context', async () => {
  let calls = 0
  const current = { uri: 'spotify:track:b', title: '歌曲 B', artist: '歌手 B' }
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'CHAT', conversationMove: 'ANSWER', reason: '读取当前歌曲', response: null, toolCall: { name: 'get_music_context', arguments: {} } })
    : response({ response: '现在是歌曲 B。' }), { scene: 'SONG_CHAT', meaning: '用户询问当前歌曲', reference: { type: 'CURRENT_TRACK', value: null } }).execute({ ...base, userMessage: '现在这首歌叫什么？', currentTrack: current, playbackState: { status: 'playing', currentTrack: current } })
  const toolResult = result.trace.find((step) => step.type === 'TOOL_RESULT').data.result
  assert.equal(toolResult.track.uri, current.uri)
  assert.equal(toolResult.resolution.source, 'PLAYBACK_STATE')
})

test('P0 B keeps the conversation track after Spotify switches', async () => {
  let calls = 0
  let analyzedTrack
  const trackA = { uri: 'spotify:track:a', title: '歌曲 A', artist: '歌手 A' }
  const trackB = { uri: 'spotify:track:b', title: '歌曲 B', artist: '歌手 B' }
  const songUnderstandingAgent = { analyze: async (track) => { analyzedTrack = track; return { integratedInsight: '歌词证据', missingLayers: [] } } }
  const history = [
    { role: 'user', content: '这首歌很好听', playbackTrack: trackA, discussionTrack: trackA },
    { role: 'assistant', content: '它的表达很克制。', playbackTrack: trackA, discussionTrack: trackA },
  ]
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'CHAT', conversationMove: 'ANSWER', reason: '分析对话正在讨论的歌曲', response: null, toolCall: { name: 'get_track_insight', arguments: {} } })
    : response({ response: '它的歌词确实很特别。' }), { scene: 'SONG_CHAT', meaning: '用户继续讨论歌曲 A', reference: { type: 'CONVERSATION_TRACK', value: null } }, { songUnderstandingAgent }).execute({ ...base, userMessage: '我特别喜欢它的歌词', conversationHistory: history, currentTrack: trackB, playbackState: { status: 'playing', currentTrack: trackB } })
  assert.equal(result.success, true)
  assert.equal(analyzedTrack.uri, trackA.uri)
  const resolution = result.trace.find((step) => step.type === 'TRACK_REFERENCE_RESOLUTION').data
  assert.equal(resolution.targetTrack.uri, trackA.uri)
  assert.equal(resolution.source, 'CONVERSATION_HISTORY')
})

test('P0 C switches the discussion target when the user explicitly says current track', async () => {
  let calls = 0
  let analyzedTrack
  const trackA = { uri: 'spotify:track:a', title: '歌曲 A', artist: '歌手 A' }
  const trackB = { uri: 'spotify:track:b', title: '歌曲 B', artist: '歌手 B' }
  const songUnderstandingAgent = { analyze: async (track) => { analyzedTrack = track; return { integratedInsight: '当前歌曲证据', missingLayers: [] } } }
  await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'CHAT', conversationMove: 'ANSWER', reason: '分析当前歌曲', response: null, toolCall: { name: 'get_track_insight', arguments: {} } })
    : response({ response: '当前这首也不错。' }), { scene: 'SONG_CHAT', meaning: '用户切换到当前歌曲 B', reference: { type: 'CURRENT_TRACK', value: null } }, { songUnderstandingAgent }).execute({ ...base, userMessage: '现在这首也不错', conversationHistory: [{ role: 'assistant', content: '歌曲 A 的表达很克制。', playbackTrack: trackA, discussionTrack: trackA }], currentTrack: trackB, playbackState: { status: 'playing', currentTrack: trackB } })
  assert.equal(analyzedTrack.uri, trackB.uri)
})

test('unresolved previous-track reference never falls back to current track', async () => {
  let calls = 0
  let analyzed = false
  const current = { uri: 'spotify:track:b', title: '歌曲 B', artist: '歌手 B' }
  const songUnderstandingAgent = { analyze: async () => { analyzed = true; return {} } }
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'CHAT', conversationMove: 'CLARIFY', reason: '尝试读取上一首', response: null, toolCall: { name: 'get_track_insight', arguments: {} } })
    : response({ response: '我还不能确定你指的是哪一首。' }), { scene: 'SONG_CHAT', meaning: '用户询问播放历史上一首', reference: { type: 'PREVIOUS_TRACK', value: null } }, { songUnderstandingAgent }).execute({ ...base, userMessage: '上一首讲什么？', currentTrack: current, playbackState: { status: 'playing', currentTrack: current } })
  const toolResult = result.trace.find((step) => step.type === 'TOOL_RESULT').data.result
  assert.equal(analyzed, false)
  assert.equal(toolResult.available, false)
  assert.equal(toolResult.resolution.source, 'PLAYBACK_HISTORY_UNAVAILABLE')
})

test('PREVIOUS_TRACK resolves from the confirmed playback previousTrack fact', () => {
  const previous = { uri: 'spotify:track:previous', title: '上一首', artist: 'A' }
  const current = { uri: 'spotify:track:current', title: '当前歌曲', artist: 'B' }
  const result = resolveTrackReference({ reference: { type: 'PREVIOUS_TRACK', value: null }, currentTrack: current, previousTrack: previous })
  assert.equal(result.track.uri, previous.uri)
  assert.equal(result.resolution.source, 'PLAYBACK_STATE_PREVIOUS')
})

test('conversationFocus is distinct from the current playback track', () => {
  const focus = { uri: 'spotify:track:a', title: '歌曲 A', artist: '歌手 A' }
  const current = { uri: 'spotify:track:b', title: '歌曲 B', artist: '歌手 B' }
  const result = resolveTrackReference({ reference: { type: 'CONVERSATION_TRACK', value: null }, currentTrack: current, conversationFocus: focus })
  assert.equal(result.track.uri, focus.uri)
  assert.equal(result.resolution.source, 'CONVERSATION_FOCUS')
})

test('NAMED_TRACK requires exact artist disambiguation for same-title songs', () => {
  const first = { uri: 'spotify:track:a', title: '同名歌', artist: '歌手 A' }
  const second = { uri: 'spotify:track:b', title: '同名歌', artist: '歌手 B' }
  const history = [{ role: 'assistant', content: '两首同名歌', playbackTrack: first, discussionTrack: second }]
  const ambiguous = resolveTrackReference({ reference: { type: 'NAMED_TRACK', value: '同名歌' }, currentTrack: first, conversationHistory: history })
  assert.equal(ambiguous.track, null)
  assert.equal(ambiguous.resolution.source, 'AMBIGUOUS_NAMED_TRACK')
  const exact = resolveTrackReference({ reference: { type: 'NAMED_TRACK', value: '同名歌｜歌手 B' }, currentTrack: first, conversationHistory: history })
  assert.equal(exact.track.uri, second.uri)
})

test('rejects invalid Understanding output before decision', async () => {
  const result = await createRuntimeAgent(async () => response({}), { understandingLlm: understanding({ scene: 'UNKNOWN', meaning: 'x' }) }).execute(base)
  assert.equal(result.success, false)
  assert.match(result.error, /scene/)
})

test('allows a corrective daily-chat turn to carry a new listening request', async () => {
  let calls = 0
  const result = await agent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'RECOMMEND', conversationMove: 'ACKNOWLEDGE', reason: '纠正错误结果并重新执行', response: null, toolCall: { name: 'recommend_music', arguments: { query: '徐佳瑩', excludeUris: [] } } })
    : response({ response: '我找到几首徐佳莹的歌，正准备播放。' }), {
      scene: 'DAILY_CHAT',
      meaning: '用户纠正刚才播放了错误歌手，并要求重新选择徐佳莹的歌曲',
      listeningRequest: { type: 'RECOMMEND', song: null, artist: '徐佳瑩', preferences: [], excludeCurrentTrack: false },
    }, { musicSearchMode: 'library' }).execute({ ...base, userMessage: '但是我想听徐佳莹的歌呀' })
  assert.equal(result.success, true)
  assert.equal(result.finalResponse, '我先把这个选歌请求交给播放器，等实际找到后再告诉你具体是哪一首。')
  assert.equal(result.action.query, '徐佳瑩')
})

test('repairs action=tool with a missing toolCall once and follows listeningRequest', async () => {
  let calls = 0
  const result = await agent(async () => {
    calls += 1
    if (calls === 1) return response({ action: 'tool', intent: 'RECOMMEND', conversationMove: 'ANSWER', reason: '换歌', response: null, toolCall: null })
    if (calls === 2) return response({ action: 'tool', intent: 'RECOMMEND', conversationMove: 'ANSWER', reason: '按请求推荐别的歌', response: null, toolCall: { name: 'recommend_music', arguments: { query: '', excludeUris: [] } } })
    return response({ response: '正在处理。' })
  }, { scene: 'LISTEN_REQUEST', meaning: '用户明确想听别的歌', listeningRequest: { type: 'RECOMMEND', song: null, artist: null, preferences: [], excludeCurrentTrack: true } }, { musicSearchMode: 'library' }).execute({ ...base, userMessage: '我想听别的歌' })
  assert.equal(result.success, true)
  assert.equal(result.trace.filter((step) => step.type === 'DECISION_REPAIR').length, 1)
  assert.equal(result.action.intent, 'RECOMMEND')
})

test('repairs a music Tool call when listeningRequest is null', async () => {
  let calls = 0
  const result = await agent(async () => {
    calls += 1
    if (calls === 1) return response({ action: 'tool', intent: 'RECOMMEND', conversationMove: 'FOLLOW_UP', reason: '错误继承推荐', response: null, toolCall: { name: 'recommend_music', arguments: { query: '', excludeUris: [] } } })
    return response({ action: 'respond', intent: 'CHAT', conversationMove: 'ANSWER', reason: '回答候选追问', response: '你是在问我刚才选了哪些歌。', toolCall: null })
  }, { scene: 'DAILY_CHAT', meaning: '用户追问上一轮候选歌曲' }, { musicSearchMode: 'library' }).execute({ ...base, userMessage: '什么候选歌去' })
  assert.equal(result.success, true)
  assert.equal(result.action, undefined)
  assert.equal(result.finalResponse, '你是在问我刚才选了哪些歌。')
  assert.equal(result.trace.filter((step) => step.type === 'DECISION_REPAIR').length, 1)
})

test('normalizes omitted explanatory Decision fields without failing a safe response', async () => {
  const result = await agent(async () => response({ action: 'respond', response: 'Hi，我在。', toolCall: null }), { scene: 'DAILY_CHAT', meaning: '用户打招呼' }).execute({ ...base, userMessage: 'hi' })
  assert.equal(result.success, true)
  assert.equal(result.finalResponse, 'Hi，我在。')
  assert.equal(result.trace.some((step) => step.type === 'DECISION_REPAIR'), false)
})

test('Decision prompt forbids unsupported promises and language-only actions', () => {
  const prompt = decisionSystemPrompt([{ name: 'search_memory', description: '检索记忆' }])
  assert.match(prompt, /只能承诺当前系统实际支持的操作/)
  assert.match(prompt, /没有对应 Tool 或客户端动作能力，不得声称将执行/)
  assert.match(prompt, /不得用语言描述代替实际操作/)
  assert.match(prompt, /用户询问能力时，应直接、准确地说明能否执行/)
  assert.match(prompt, /不得再次提出同样无法执行的操作/)
})

test('uses deterministic music fallback when one Decision repair still chooses the wrong Tool', async () => {
  let calls = 0
  const result = await agent(async () => {
    calls += 1
    if (calls <= 2) return response({ action: 'tool', response: null, toolCall: { name: 'search_music', arguments: { query: '徐佳瑩', excludeUris: [] } } })
    return response({ response: '正在处理。' })
  }, { scene: 'LISTEN_REQUEST', meaning: '用户想听徐佳瑩的其他歌曲', listeningRequest: { type: 'RECOMMEND', song: null, artist: '徐佳瑩', preferences: [], excludeCurrentTrack: true } }, { musicSearchMode: 'library' }).execute({ ...base, userMessage: '我想听徐佳莹的歌' })
  assert.equal(result.success, true)
  assert.equal(result.action.intent, 'RECOMMEND')
  assert.equal(result.action.query, '徐佳瑩')
  assert.equal(result.trace.filter((step) => step.type === 'DECISION_REPAIR').length, 1)
  assert.equal(result.trace.filter((step) => step.type === 'DECISION_FALLBACK').length, 1)
})

test('rejects malformed agent input', async () => {
  const result = await agent(async () => response({}), { scene: 'DAILY_CHAT', meaning: 'x' }).execute({ ...base, userMessage: '' })
  assert.equal(result.success, false)
})
