/** Agent V0.1 闭环测试：验证直接回复、三类 Tool、Trace 顺序与错误边界。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMoriAgent } from '../../../src/mori-agent/runtime/index.mjs'

const base = { userMessage: '你好', currentTrack: { title: '测试歌曲', artist: '测试歌手' }, conversationHistory: [], fakeMemory: [{ id: 'm1', content: '旅行时听过这首歌', context: '旅行' }] }
const response = (data) => ({ data, model: 'test-model', tokenUsage: { total_tokens: 10 } })

test('responds directly without calling a tool', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => { calls += 1; return response({ action: 'respond', reason: '信息足够', response: '你好，我在。', toolCall: null }) }).execute(base)
  assert.equal(result.finalResponse, '你好，我在。'); assert.equal(calls, 1)
  assert.deepEqual(result.trace.map((step) => step.type), ['INPUT', 'SCENE_UNDERSTANDING', 'CONTEXT_ASSEMBLY', 'STATE_BEFORE', 'INTENT_ROUTED', 'MODEL_DECISION', 'STATE_AFTER', 'FINAL_RESPONSE'])
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
  assert.deepEqual(result.trace.map((step) => step.type), ['INPUT', 'SCENE_UNDERSTANDING', 'CONTEXT_ASSEMBLY', 'STATE_BEFORE', 'INTENT_ROUTED', 'MODEL_DECISION', 'TOOL_CALL', 'TOOL_ARGUMENTS', 'TOOL_RESULT', 'FINAL_MODEL_CALL', 'STATE_AFTER', 'FINAL_RESPONSE'])
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

test('delegates song meaning questions to the Song Understanding Agent', async () => {
  let calls = 0
  let analyzedTrack
  const songUnderstandingAgent = { analyze: async (track) => {
    analyzedTrack = track
    return { integratedInsight: '声音推进明显；歌词主题资料暂缺。', missingLayers: ['lyrics', 'creation', 'reception'], sound: { available: true }, lyrics: { available: false } }
  } }
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'tool', reason: '需要歌曲四层证据', response: null, toolCall: { name: 'get_track_insight', arguments: { query: '为什么是这种感觉' } } })
    : response({ response: '从声音上能确认它有推进感；但我还没有可靠歌词资料，不想凭歌名猜。' }), { songUnderstandingAgent }).execute({
      ...base,
      userMessage: '为什么这首歌让我觉得很压抑？',
      currentTrack: { uri: 'spotify:track:1', isrc: 'TEST-ISRC', title: '测试歌曲', artist: '测试歌手' },
    })
  assert.equal(result.success, true)
  assert.equal(analyzedTrack.isrc, 'TESTISRC')
  assert.equal(result.trace.find((step) => step.type === 'TOOL_RESULT').data.result.insight.missingLayers[0], 'lyrics')
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
  assert.deepEqual(result.action, { type: 'play_track', intent: 'SEARCH', track: { uri: 'spotify:track:real-track', title: '言不由衷', artist: '徐佳莹' } })
})

test('accepts a trusted Spotify fallback candidate when the user library did not match', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'tool', reason: '搜索指定歌曲', response: null, toolCall: { name: 'search_music', arguments: { query: '言不由衷' } } })
    : response({ response: '你的曲库没有这首歌，我从 Spotify 找到了，给你播放。' }), { musicSearchMode: 'library' }).execute({
      ...base,
      userMessage: '我想听言不由衷',
      musicCatalog: [{ uri: 'spotify:track:external', title: '言不由衷', artist: '徐佳莹', catalogSource: 'spotify_search' }],
    })
  assert.equal(result.success, true)
  assert.deepEqual(result.action, { type: 'play_track', intent: 'SEARCH', track: { uri: 'spotify:track:external', title: '言不由衷', artist: '徐佳莹' } })
  assert.equal(result.trace.find((step) => step.type === 'TOOL_RESULT').data.result.source, 'spotify_search')
})

test('routes natural-language feature intent through recommendation ranking', async () => {
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
  assert.equal(result.action.intent, 'RECOMMEND')
  assert.equal(result.trace.find((step) => step.type === 'TOOL_CALL').data.name, 'recommend_music')
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

test('drops an incomplete catalogue candidate without failing the conversation', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => {
    calls += 1
    return calls === 1
      ? response({ action: 'tool', intent: 'SEARCH', conversationMove: 'ANSWER', reason: '查找完整曲目', response: null, toolCall: { name: 'search_music', arguments: { query: '完整曲目', excludeUris: [] } } })
      : response({ response: '找到完整曲目了。' })
  }, { musicSearchMode: 'library' }).execute({
    ...base,
    userMessage: '帮我找完整曲目这首歌',
    musicCatalog: [
      { uri: 'spotify:track:broken', title: '已下架曲目', artist: '' },
      { uri: 'spotify:track:valid', title: '完整曲目', artist: '歌手' },
    ],
  })
  assert.equal(result.success, true)
  assert.equal(result.action.track.uri, 'spotify:track:valid')
})

test('rejects empty tool query instead of executing silently', async () => {
  const result = await createMoriAgent(async () => response({ action: 'tool', intent: 'SEARCH', reason: '搜索', response: null, toolCall: { name: 'search_music', arguments: { query: '', excludeUris: [] } } })).execute({ ...base, userMessage: '帮我找《新歌》' })
  assert.equal(result.success, false); assert.match(result.error, /query/)
})

test('treats a negative playback statement as chat instead of music search', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => {
    calls += 1
    return response({ action: 'tool', intent: 'SEARCH', reason: '错误关键词判断', response: null, toolCall: { name: 'search_music', arguments: { query: '我现在没有在听歌呢', excludeUris: [] } } })
  }, { musicSearchMode: 'library' }).execute({ ...base, userMessage: '我现在没有在听歌呢', currentTrack: null, playbackState: { status: 'none', currentTrack: null }, musicCatalog: [{ uri: 'spotify:track:me', title: '我', artist: 'A' }] })
  assert.equal(result.success, true)
  assert.equal(calls, 1)
  assert.equal(result.action, undefined)
  assert.equal(result.trace.find((step) => step.type === 'INTENT_ROUTED').data.intent, 'CHAT')
  assert.equal(result.trace.some((step) => step.type === 'TOOL_CALL'), false)
})

test('passes explicit world and playback state into model context', async () => {
  let modelContext
  const result = await createMoriAgent(async ({ input }) => {
    modelContext = input.context
    return response({ action: 'respond', intent: 'CHAT', reason: '直接读取当前状态', response: '现在暂停在《测试歌曲》。', toolCall: null })
  }).execute({ ...base, playbackState: { status: 'paused', currentTrack: base.currentTrack, availability: 'ready' }, worldState: { timeZone: 'Asia/Tokyo' } })
  assert.equal(result.success, true)
  assert.equal(modelContext.playbackState.status, 'paused')
  assert.equal(modelContext.worldState.timeZone, 'Asia/Tokyo')
})

test('uses recommendation tool and excludes current track', async () => {
  let calls = 0
  const current = { uri: 'spotify:track:current', title: '当前歌曲', artist: 'A' }
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'respond', intent: 'RECOMMEND', reason: '模型只想聊天', response: '我想想。', toolCall: null })
    : response({ response: '我找到了一首，正准备播放。' }), { musicSearchMode: 'library' }).execute({
      ...base,
      userMessage: '不知道听什么，你推荐一首',
      currentTrack: current,
      playbackState: { status: 'playing', currentTrack: current },
      musicCatalog: [current, { uri: 'spotify:track:next', title: '下一首', artist: 'B' }],
    })
  assert.equal(result.success, true)
  assert.equal(result.trace.find((step) => step.type === 'TOOL_CALL').data.name, 'recommend_music')
  assert.deepEqual(result.trace.find((step) => step.type === 'TOOL_RESULT').data.result.excludedUris, [current.uri])
  assert.equal(result.action.track.uri, 'spotify:track:next')
  assert.equal(result.action.intent, 'RECOMMEND')
})

test('final model receives planned action without claiming playback state changed', async () => {
  let calls = 0
  let finalInput
  const current = { uri: 'spotify:track:old', title: '旧歌', artist: 'A' }
  const result = await createMoriAgent(async (request) => {
    calls += 1
    if (calls === 1) return response({ action: 'tool', intent: 'SEARCH', reason: '明确歌曲', response: null, toolCall: { name: 'search_music', arguments: { query: '新歌', excludeUris: [] } } })
    finalInput = request.input
    return response({ response: '找到了《新歌》，正准备播放。' })
  }, { musicSearchMode: 'library' }).execute({
    ...base,
    userMessage: '帮我找《新歌》',
    currentTrack: current,
    playbackState: { status: 'playing', currentTrack: current },
    musicCatalog: [{ uri: 'spotify:track:new', title: '新歌', artist: 'B' }],
  })
  assert.equal(result.success, true)
  assert.equal(finalInput.actionResult.status, 'planned')
  assert.equal(finalInput.stateAfter.currentTrack.uri, current.uri)
  assert.equal(finalInput.actionResult.action.track.uri, 'spotify:track:new')
})

test('keeps router intent as the single source of truth', async () => {
  const result = await createMoriAgent(async () => response({ action: 'respond', intent: 'FEEDBACK', conversationMove: 'ACKNOWLEDGE', reason: '模型二次误判', response: '我明白了。', toolCall: null })).execute({
    ...base,
    userMessage: '对啊，你的意思是你很喜欢——？',
    conversationHistory: [{ role: 'assistant', content: '前辈姐可爱耍无赖的样子很有趣。' }],
  })
  assert.equal(result.trace.find((step) => step.type === 'INTENT_ROUTED').data.intent, 'CHAT')
  assert.equal(result.trace.find((step) => step.type === 'MODEL_DECISION').data.intent, 'CHAT')
})

test('clarifies ambiguous latest message instead of falling back to old topic', async () => {
  const result = await createMoriAgent(async () => response({ action: 'respond', intent: 'CHAT', conversationMove: 'ACKNOWLEDGE', reason: '错误继承旧话题', response: '辛苦了，刚下班一定很累吧。', toolCall: null })).execute({
    ...base,
    userMessage: '说善恶',
    conversationHistory: [{ role: 'user', content: '刚下班' }, { role: 'assistant', content: '辛苦了。' }],
  })
  assert.match(result.finalResponse, /说什么/)
  assert.doesNotMatch(result.finalResponse, /下班|辛苦/)
  assert.equal(result.trace.find((step) => step.type === 'MODEL_DECISION').data.conversationMove, 'CLARIFY')
})

test('assembles latest message and local conversation focus ahead of deduplicated history', async () => {
  let context
  await createMoriAgent(async ({ input }) => {
    context = input.context
    return response({ action: 'respond', intent: 'CHAT', conversationMove: 'ANSWER', reason: '承接上一句', response: '你是在问我刚才那句话。', toolCall: null })
  }).execute({
    ...base,
    userMessage: '你的意思是你很喜欢？',
    conversationHistory: [
      { role: 'assistant', content: '重复回复' },
      { role: 'assistant', content: '重复回复' },
      { role: 'user', content: '前辈姐很可爱' },
      { role: 'assistant', content: '她耍无赖的样子很有趣。' },
    ],
  })
  assert.equal(context.latestMessage, '你的意思是你很喜欢？')
  assert.equal(context.conversationFocus.previousAssistantMessage, '她耍无赖的样子很有趣。')
  assert.equal(context.conversationFocus.referenceContinuation, true)
  assert.equal(context.emotionSignal, null)
  assert.equal(context.recentHistory.filter((item) => item.content === '重复回复').length, 1)
})

test('only exposes emotion when the latest message contains direct evidence', async () => {
  const contexts = []
  const agent = createMoriAgent(async ({ input }) => {
    contexts.push(input.context)
    return response({ action: 'respond', intent: 'CHAT', conversationMove: 'ACKNOWLEDGE', reason: '接话', response: '我在听。', toolCall: null })
  })
  await agent.execute({ ...base, userMessage: '刚下班。。。' })
  await agent.execute({ ...base, userMessage: '我真的很累' })
  assert.equal(contexts[0].emotionSignal, null)
  assert.deepEqual(contexts[1].emotionSignal, { label: 'tired', confidence: 0.98, evidence: '我真的很累' })
})

test('keeps ordinary sharing in social chat despite words such as like', async () => {
  const result = await createMoriAgent(async () => response({ action: 'respond', intent: 'MUSIC_REQUEST', conversationMove: 'ANSWER', reason: '错误音乐先验', response: '要不要听一首歌？', toolCall: null }), { musicSearchMode: 'library' }).execute({
    ...base,
    userMessage: '今天前辈姐被吐槽了，她还很喜欢耍无赖',
    currentTrack: null,
    playbackState: { status: 'none', currentTrack: null },
    musicCatalog: [{ uri: 'spotify:track:one', title: '喜欢', artist: 'A' }],
  })
  assert.equal(result.trace.find((step) => step.type === 'SCENE_UNDERSTANDING').data.scene, 'SOCIAL_CHAT')
  assert.equal(result.trace.find((step) => step.type === 'INTENT_ROUTED').data.intent, 'CHAT')
  assert.equal(result.action, undefined)
})

test('requires music evidence before treating a message as music chat', async () => {
  let calls = 0
  const agent = createMoriAgent(async () => {
    calls += 1
    return response({ action: 'respond', intent: 'CHAT', conversationMove: 'ACKNOWLEDGE', reason: '接话', response: '我懂你的意思。', toolCall: null })
  })
  const noTrack = await agent.execute({ ...base, userMessage: '我很喜欢这个', currentTrack: null, playbackState: { status: 'none', currentTrack: null } })
  const withTrack = await agent.execute({ ...base, userMessage: '我很喜欢这首歌', playbackState: { status: 'playing', currentTrack: base.currentTrack } })
  assert.equal(noTrack.trace.find((step) => step.type === 'SCENE_UNDERSTANDING').data.scene, 'SOCIAL_CHAT')
  assert.equal(withTrack.trace.find((step) => step.type === 'SCENE_UNDERSTANDING').data.scene, 'MUSIC_CHAT')
  assert.equal(calls, 2)
})

test('classifies an explicit recommendation as music request before intent routing', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'respond', intent: 'CHAT', conversationMove: 'ANSWER', reason: '模型漏判', response: '聊点别的。', toolCall: null })
    : response({ response: '找到一首，正准备播放。' }), { musicSearchMode: 'library' }).execute({
      ...base,
      userMessage: '给我推荐一首安静的歌',
      musicCatalog: [{ uri: 'spotify:track:calm', title: '安静', artist: 'A' }],
    })
  assert.equal(result.trace.find((step) => step.type === 'SCENE_UNDERSTANDING').data.scene, 'MUSIC_REQUEST')
  assert.equal(result.trace.find((step) => step.type === 'INTENT_ROUTED').data.intent, 'RECOMMEND')
})

test('does not treat a non-music recommendation sentence as music request', async () => {
  const result = await createMoriAgent(async () => response({ action: 'respond', intent: 'RECOMMEND', conversationMove: 'ANSWER', reason: '错误音乐先验', response: '要听歌吗？', toolCall: null }), { musicSearchMode: 'library' }).execute({
    ...base,
    userMessage: '我推荐她去看那部电影',
    currentTrack: null,
    playbackState: { status: 'none', currentTrack: null },
  })
  assert.equal(result.trace.find((step) => step.type === 'SCENE_UNDERSTANDING').data.scene, 'SOCIAL_CHAT')
  assert.equal(result.trace.find((step) => step.type === 'INTENT_ROUTED').data.intent, 'CHAT')
})

test('Case A switches from no playback to the new Japanese class topic', async () => {
  let context
  const result = await createMoriAgent(async ({ input }) => {
    context = input.context
    return response({ action: 'respond', intent: 'CHAT', conversationMove: 'FOLLOW_UP', reason: '跟随新话题', response: '刚上完日语课啊，今天学了什么？', toolCall: null })
  }).execute({
    ...base,
    userMessage: '刚上完日语课',
    currentTrack: null,
    playbackState: { status: 'none', currentTrack: null },
    conversationHistory: [{ role: 'user', content: '我现在没有听歌呢' }, { role: 'assistant', content: '嗯，现在没有音乐在播放。' }],
  })
  assert.equal(context.conversationUnderstanding.currentTopic, '日语课程与刚结束的学习经历')
  assert.match(result.finalResponse, /日语课/)
  assert.doesNotMatch(result.finalResponse, /没有.{0,3}(听歌|音乐|播放)/)
})

test('Case B treats a short answer as continuation of the previous question', async () => {
  let context
  await createMoriAgent(async ({ input }) => {
    context = input.context
    return response({ action: 'respond', intent: 'CHAT', conversationMove: 'ACKNOWLEDGE', reason: '回答上一问', response: '听起来今天就是一般般。', toolCall: null })
  }).execute({ ...base, userMessage: '一般', conversationHistory: [{ role: 'assistant', content: '今天过得怎么样？' }] })
  assert.equal(context.conversationUnderstanding.referenceRelation.type, 'CONTINUES_PREVIOUS')
  assert.equal(context.conversationUnderstanding.currentTopic, '回应上一轮问题：今天过得怎么样')
})

test('Case C ends old feedback when the user introduces Japanese class', async () => {
  let context
  const result = await createMoriAgent(async ({ input }) => {
    context = input.context
    return response({ action: 'respond', intent: 'CHAT', conversationMove: 'ACKNOWLEDGE', reason: '新话题', response: '刚上完日语课啊。', toolCall: null })
  }).execute({
    ...base,
    userMessage: '刚上完日语课',
    conversationHistory: [
      { role: 'user', content: '你说话很像人机' },
      { role: 'assistant', content: '抱歉，我刚才确实说得有点机械。' },
    ],
  })
  assert.equal(context.conversationUnderstanding.referenceRelation.type, 'NEW_TOPIC')
  assert.equal(context.conversationFocus.currentTopic, '日语课程与刚结束的学习经历')
  assert.doesNotMatch(result.finalResponse, /抱歉|人机|机械/)
})

test('Case D recognizes casual song recommendation even if scene history was social', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'respond', intent: 'CHAT', conversationMove: 'ACKNOWLEDGE', reason: '模型误判', response: '继续聊吧。', toolCall: null })
    : response({ response: '找到一首，正准备播放。' }), { musicSearchMode: 'library' }).execute({
      ...base,
      userMessage: '随便给我推一首歌',
      conversationHistory: [{ role: 'user', content: '刚上完日语课' }, { role: 'assistant', content: '今天学了什么？' }],
      musicCatalog: [{ uri: 'spotify:track:one', title: '一首歌', artist: 'A' }],
    })
  const scene = result.trace.find((step) => step.type === 'SCENE_UNDERSTANDING').data
  assert.equal(scene.musicEvidence.explicitRequest, true)
  assert.equal(result.trace.find((step) => step.type === 'INTENT_ROUTED').data.intent, 'RECOMMEND')
})

test('Case E prevents a repeated apology and advances the new topic', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'respond', intent: 'CHAT', conversationMove: 'ACKNOWLEDGE', reason: '重复道歉', response: '抱歉，我确实有些啰嗦了。', toolCall: null })
    : response({ response: '刚上完日语课啊，今天学到哪一部分了？' })).execute({
    ...base,
    userMessage: '刚上完日语课',
    conversationHistory: [
      { role: 'user', content: '你有点啰嗦' },
      { role: 'assistant', content: '抱歉，我确实有些啰嗦了……' },
    ],
  })
  assert.doesNotMatch(result.finalResponse, /抱歉|啰嗦/)
  assert.match(result.finalResponse, /日语课/)
})

test('does not invent an emotional reason for a random recommendation', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({
      action: 'respond', intent: 'CHAT', conversationMove: 'ANSWER', reason: '解释推荐',
      response: '因为这首歌的孤独主题和你泡澡后的平静心情很有共鸣。', toolCall: null,
    })
    : response({ response: '你刚才让我随便选，我只是从可播放的候选里挑了一首，不是根据你的心情判断的。' }), { musicSearchMode: 'library' }).execute({
    ...base,
    userMessage: '为什么是这首',
    conversationHistory: [
      { role: 'user', content: '随便给我推首歌吧' },
      { role: 'assistant', content: '给你选了《测试歌曲》，现在开始播放。' },
    ],
  })
  assert.equal(result.finalResponse, '你刚才让我随便选，我只是从可播放的候选里挑了一首，不是根据你的心情判断的。')
})

test('avoids recently recommended tracks even when playback state is missing', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({ action: 'tool', intent: 'RECOMMEND', conversationMove: 'ANSWER', reason: '随机推荐', response: null, toolCall: { name: 'recommend_music', arguments: { query: '', excludeUris: [] } } })
    : response({ response: '换一首。' }), { musicSearchMode: 'library' }).execute({
      ...base,
      userMessage: '再随便推一首歌',
      currentTrack: null,
      playbackState: { status: 'none', currentTrack: null },
      conversationHistory: [{ role: 'assistant', content: '给你选了《已经推荐》，现在开始播放。' }],
      musicCatalog: [
        { uri: 'spotify:track:old', title: '已经推荐', artist: 'A' },
        { uri: 'spotify:track:new', title: '新的候选', artist: 'B' },
      ],
    })
  assert.equal(result.action.track.uri, 'spotify:track:new')
})

test('rewrites repetitive relaxation copy into a short contextual reply', async () => {
  let calls = 0
  const result = await createMoriAgent(async () => ++calls === 1
    ? response({
      action: 'respond', intent: 'CHAT', conversationMove: 'ACKNOWLEDGE', reason: '接话',
      response: '平静也是一种难得的宁静，在这样放松的时刻，偶尔什么都不想也是一种难得的宁静。', toolCall: null,
    })
    : response({ response: '那确实很爽，整个人都松下来了。' })).execute({
    ...base,
    userMessage: '爽的嘞',
    conversationHistory: [{ role: 'assistant', content: '泡澡确实是放松身心的好方式，静静待着也是一种难得的宁静。' }],
  })
  assert.equal(result.finalResponse, '那确实很爽，整个人都松下来了。')
})
