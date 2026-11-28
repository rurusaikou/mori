import assert from 'node:assert/strict'
import test from 'node:test'
import { createMoriAgent } from '../../../src/mori-agent/runtime/index.mjs'
import { buildMoriContext } from '../../../src/mori-agent/context/context-builder.mjs'
import { DEFAULT_CONTEXT_BUDGET } from '../../../src/mori-agent/context/context-budget.mjs'

const base = {
  userMessage: '最近我很喜欢这首歌',
  currentTrack: { uri: 'spotify:track:current', title: '当前歌曲', artist: '歌手' },
  playbackState: { status: 'playing', currentTrack: { uri: 'spotify:track:current', title: '当前歌曲', artist: '歌手' }, previousTrack: null },
  worldState: { timeZone: 'Asia/Tokyo' },
  conversationHistory: [
    { role: 'user', content: '昨天在日语课上聊了很久', playbackTrack: null, discussionTrack: null },
    { role: 'assistant', content: '听起来你们聊得很投缘。', playbackTrack: null, discussionTrack: null },
  ],
  fakeMemory: [{ id: 'moment-1', content: '用户喜欢下课后和老师聊天', context: '日语课' }],
}

test('unified runtime uses persona context and preserves real conversation roles for direct replies', async () => {
  let request
  const runtime = createMoriAgent(async (value) => {
    request = value
    return { content: '这首歌最近让你很有感觉吗？', toolCalls: [], model: 'unified-test', tokenUsage: { total_tokens: 20 } }
  }, { runtime: 'unified', persona: 'Mori 是自然、坦率的音乐伙伴。', logSource: 'test' })
  const result = await runtime.execute(base)

  assert.equal(result.success, true, result.error)
  assert.equal(result.finalResponse, '这首歌最近让你很有感觉吗？')
  assert.deepEqual(request.messages.map((message) => message.role), ['system', 'user', 'assistant', 'user'])
  assert.match(request.messages[0].content, /Mori 是自然、坦率的音乐伙伴/)
  assert.match(request.messages[0].content, /当前歌曲：当前歌曲 — 歌手/)
  assert.equal(request.messages[1].content, '昨天在日语课上聊了很久')
  assert.equal(request.tools.some((tool) => tool.name === 'playback_control'), true)
})

test('unified runtime forwards direct response deltas to the stream callback', async () => {
  const agentLlm = async () => { throw new Error('stream path expected') }
  agentLlm.stream = async (_request, onEvent) => {
    onEvent({ type: 'text_delta', delta: '你好，' })
    onEvent({ type: 'text_delta', delta: '我在。' })
    return { content: '你好，我在。', toolCalls: [], model: 'stream-model', tokenUsage: null }
  }
  const runtime = createMoriAgent(agentLlm, { runtime: 'unified', persona: 'Mori Persona', logSource: 'test' })
  const events = []
  const result = await runtime.execute(base, { onStreamEvent: (event) => events.push(event) })

  assert.equal(result.finalResponse, '你好，我在。')
  assert.deepEqual(events, [{ type: 'delta', text: '你好，' }, { type: 'delta', text: '我在。' }])
})

test('Context Builder keeps persona, memory, runtime facts, and historical music snapshots distinct', () => {
  const context = buildMoriContext({
    persona: 'Mori Persona',
    state: {
      ...base,
      conversationHistory: [{
        role: 'user', content: '这首歌我喜欢',
        playbackTrack: { title: '当时播放', artist: '播放歌手' },
        discussionTrack: { title: '当时讨论', artist: '讨论歌手' },
      }],
    },
    relevantMemory: {
      matches: [{
        id: 'memory-1', kind: 'moment', status: 'confirmed', source: 'user_moment', matchReason: 'TRACK_URI', confidence: 0.94,
        content: '用户喜欢下课后和老师聊天', context: '日语课', track: { title: '当前歌曲', artist: '歌手' }, evidence: [{ content: '用户说下课后聊得很开心' }],
      }],
      tasteProfile: [], associations: [],
    },
  })

  assert.match(context.messages[0].content, /Mori Persona/)
  assert.match(context.messages[0].content, /相关记忆/)
  assert.match(context.messages[0].content, /来源=user_moment/)
  assert.match(context.messages[0].content, /匹配=TRACK_URI/)
  assert.match(context.messages[0].content, /证据=用户说下课后聊得很开心/)
  assert.match(context.messages[0].content, /当前歌曲：当前歌曲 — 歌手/)
  assert.equal(context.messages[1].role, 'user')
  assert.match(context.messages[1].content, /发言时播放：当时播放 — 播放歌手/)
  assert.match(context.messages[1].content, /当时讨论：当时讨论 — 讨论歌手/)
  assert.equal(context.messages.at(-1).role, 'user')
  assert.equal(context.messages.at(-1).content, base.userMessage)
})

test('Context Builder prioritizes recent history and enforces the latest-message budget', () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', content: `history-${index}-${'x'.repeat(100)}`,
    playbackTrack: null, discussionTrack: null,
  }))
  const budget = { ...DEFAULT_CONTEXT_BUDGET, historyChars: 120, perMessageChars: 50, latestMessageChars: 24 }
  const context = buildMoriContext({
    persona: 'Persona',
    state: { ...base, userMessage: 'latest-' + 'y'.repeat(40), conversationHistory: history },
    relevantMemory: { matches: [], tasteProfile: [], associations: [] },
    budget,
  })
  const pastMessages = context.messages.slice(1, -1)

  assert.ok(pastMessages.length < history.length)
  assert.match(pastMessages.at(-1).content, /history-7/)
  assert.ok(pastMessages.reduce((length, message) => length + message.content.length, 0) <= budget.historyChars)
  assert.ok(context.messages.at(-1).content.length <= budget.latestMessageChars)
  assert.ok(context.budget.systemChars > 0)
})

test('unified runtime allows one read-only tool and feeds its observation back as a tool message', async () => {
  const requests = []
  const runtime = createMoriAgent(async (value) => {
    requests.push(value)
    if (requests.length === 1) return {
      content: '', model: 'unified-test', tokenUsage: { total_tokens: 9 },
      toolCalls: [{ id: 'memory-call-1', name: 'search_memory', arguments: { query: '日语课' } }],
    }
    return { content: '我记得你提过喜欢和日语老师聊天。', toolCalls: [], model: 'unified-test', tokenUsage: { total_tokens: 8 } }
  }, { runtime: 'unified', persona: 'Mori Persona', logSource: 'test' })
  const result = await runtime.execute({ ...base, userMessage: '你还记得日语课吗？' })

  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].messages.map((message) => message.role), ['system', 'user', 'assistant', 'user', 'assistant', 'tool'])
  assert.equal(requests[1].messages[4].toolCalls[0].name, 'search_memory')
  assert.match(requests[1].messages[5].content, /用户喜欢下课后和老师聊天/)
  assert.deepEqual(requests[1].tools, [])
  assert.equal(result.finalResponse, '我记得你提过喜欢和日语老师聊天。')
  assert.equal(result.action, undefined)
})

test('unified runtime clears provisional text before tool observation and streams final reply', async () => {
  let calls = 0
  const agentLlm = async () => { throw new Error('stream path expected') }
  agentLlm.stream = async (_request, onEvent) => {
    calls += 1
    if (calls === 1) {
      onEvent({ type: 'text_delta', delta: '我查查。' })
      return { content: '我查查。', model: 'stream-model', tokenUsage: null, toolCalls: [{ id: 'memory-call', name: 'search_memory', arguments: { query: '日语课' } }] }
    }
    onEvent({ type: 'text_delta', delta: '记得你刚上完日语课。' })
    return { content: '记得你刚上完日语课。', model: 'stream-model', tokenUsage: null, toolCalls: [] }
  }
  const runtime = createMoriAgent(agentLlm, { runtime: 'unified', persona: 'Mori Persona', logSource: 'test' })
  const events = []
  await runtime.execute({ ...base, userMessage: '你记得日语课吗？' }, { onStreamEvent: (event) => events.push(event) })

  assert.deepEqual(events.map((event) => event.type), ['delta', 'reset', 'tool_start', 'delta'])
  assert.equal(events.at(-1).text, '记得你刚上完日语课。')
})

test('unified runtime refuses an ambiguous playback call without semantic action authorization', async () => {
  const requests = []
  const runtime = createMoriAgent(async (value) => {
    requests.push(value)
    if (requests.length === 1) return {
      content: '', model: 'unified-test', tokenUsage: null,
      toolCalls: [{ id: 'unsafe-call', name: 'playback_control', arguments: { command: 'PAUSE', authorizationQuote: '安静一点' } }],
    }
    return { content: '这轮我没有执行播放操作。', toolCalls: [], model: 'unified-test', tokenUsage: null }
  }, {
    runtime: 'unified', persona: 'Mori Persona', logSource: 'test',
    actionAuthorizationLlm: async () => ({ data: {
      scene: 'DAILY_CHAT', meaning: '普通聊天', turnRelation: 'CONTINUATION', reference: null,
      listeningRequest: null, emotion: null, topic: null, communicativeAct: 'OTHER', eventFrame: null,
      conversationState: { activeTopic: null, entities: [], facts: [], unresolvedContext: null },
      confidence: 0.9, ambiguity: null,
    }, model: 'auth-test', tokenUsage: null }),
  })
  const result = await runtime.execute({ ...base, userMessage: '安静一点', conversationHistory: [] })

  assert.equal(requests[0].tools.some((tool) => tool.name === 'playback_control'), true)
  assert.match(requests[1].messages.at(-1).content, /listeningRequest 为空时不能调用音乐动作 Tool/)
  assert.equal(result.action, undefined)
})

test('unified runtime gates playback action and routes the approved action to Extension', async () => {
  let agentCalls = 0
  let authorizationCalls = 0
  const runtime = createMoriAgent(async () => ++agentCalls === 1
    ? {
      content: '', model: 'unified-test', tokenUsage: null,
      toolCalls: [{ id: 'pause-call', name: 'playback_control', arguments: { command: 'PAUSE', authorizationQuote: '暂停一下' } }],
    }
    : { content: '我已把暂停请求交给播放器。', toolCalls: [], model: 'unified-test', tokenUsage: null },
  {
    runtime: 'unified', persona: 'Mori Persona', musicSearchMode: 'library', logSource: 'test',
    actionAuthorizationLlm: async () => {
      authorizationCalls += 1
      return { data: {
        scene: 'LISTEN_REQUEST', meaning: '用户请求暂停播放', turnRelation: 'INDEPENDENT', reference: null,
        listeningRequest: { type: 'CONTROL', control: 'PAUSE', song: null, artist: null, preferences: [], excludeCurrentTrack: false },
        emotion: null, topic: null, communicativeAct: 'REQUEST', eventFrame: null,
        conversationState: { activeTopic: null, entities: [], facts: [], unresolvedContext: null },
        confidence: 0.99, ambiguity: null,
      }, model: 'auth-test', tokenUsage: null }
    },
  })
  const result = await runtime.execute({
    ...base,
    userMessage: '暂停一下',
    playbackState: { status: 'playing', currentTrack: base.currentTrack, previousTrack: null },
  })

  assert.equal(authorizationCalls, 0)
  assert.deepEqual(result.action, { type: 'playback_control', command: 'PAUSE' })
  assert.equal(result.success, true)
  assert.equal(result.finalResponse, '好，我先试着暂停，等播放器确认一下。')
})

test('unified runtime authorizes search and returns the existing Extension music action contract', async () => {
  let agentCalls = 0
  const runtime = createMoriAgent(async () => ++agentCalls === 1
    ? {
      content: '', model: 'unified-test', tokenUsage: null,
      toolCalls: [{ id: 'search-call', name: 'search_music', arguments: { query: '言不由衷', authorizationQuote: '想听言不由衷', excludeCurrentTrack: false } }],
    }
    : { content: '我去找这首歌。', toolCalls: [], model: 'unified-test', tokenUsage: null },
  {
    runtime: 'unified', persona: 'Mori Persona', musicSearchMode: 'library', logSource: 'test',
    actionAuthorizationLlm: async () => ({ data: {
      scene: 'LISTEN_REQUEST', meaning: '用户请求搜索歌曲', turnRelation: 'INDEPENDENT', reference: null,
      listeningRequest: { type: 'SEARCH', control: null, song: '言不由衷', artist: null, preferences: [], excludeCurrentTrack: false },
      emotion: null, topic: null, communicativeAct: 'REQUEST', eventFrame: null,
      conversationState: { activeTopic: null, entities: [], facts: [], unresolvedContext: null },
      confidence: 0.99, ambiguity: null,
    }, model: 'auth-test', tokenUsage: null }),
  })
  const result = await runtime.execute({ ...base, userMessage: '我想听言不由衷' })

  assert.deepEqual(result.action, { type: 'music_request', intent: 'SEARCH', query: '言不由衷', excludeUris: [] })
  assert.equal(result.finalResponse, '我先把这个选歌请求交给播放器，等实际找到后再告诉你具体是哪一首。')
})

test('P0 pending client action ends after one conversation-model call without a final-response model call', async () => {
  let agentCalls = 0
  const runtime = createMoriAgent(async () => {
    agentCalls += 1
    return {
      content: '', model: 'unified-test', tokenUsage: { total_tokens: 10 },
      toolCalls: [{ id: 'pause-call', name: 'playback_control', arguments: { command: 'PAUSE', authorizationQuote: '暂停一下' } }],
    }
  }, {
    runtime: 'unified', persona: 'Mori Persona', musicSearchMode: 'library', logSource: 'test',
    actionAuthorizationLlm: async () => ({ data: {
      scene: 'LISTEN_REQUEST', meaning: '用户请求暂停', turnRelation: 'INDEPENDENT', reference: null,
      listeningRequest: { type: 'CONTROL', control: 'PAUSE', song: null, artist: null, preferences: [], excludeCurrentTrack: false },
      emotion: null, topic: null, communicativeAct: 'REQUEST', eventFrame: null,
      conversationState: { activeTopic: null, entities: [], facts: [], unresolvedContext: null }, confidence: 1, ambiguity: null,
    }, model: 'auth-test', tokenUsage: { total_tokens: 5 } }),
  })
  const result = await runtime.execute({ ...base, userMessage: '暂停一下', conversationHistory: [] })

  assert.equal(agentCalls, 1)
  assert.deepEqual(result.action, { type: 'playback_control', command: 'PAUSE' })
  assert.equal(result.finalResponse, '好，我先试着暂停，等播放器确认一下。')
})

test('P1 pending client action streams a deterministic plan without provisional model prose', async () => {
  const agentLlm = async () => { throw new Error('stream path expected') }
  agentLlm.stream = async (_request, onEvent) => ({
    content: '', model: 'stream-model', tokenUsage: null,
    toolCalls: [{ id: 'next-call', name: 'playback_control', arguments: { command: 'NEXT', authorizationQuote: '切下一首' } }],
  })
  const runtime = createMoriAgent(agentLlm, {
    runtime: 'unified', persona: 'Mori Persona', musicSearchMode: 'library', logSource: 'test',
    actionAuthorizationLlm: async () => ({ data: {
      scene: 'LISTEN_REQUEST', meaning: '用户请求下一首', turnRelation: 'INDEPENDENT', reference: null,
      listeningRequest: { type: 'CONTROL', control: 'NEXT', song: null, artist: null, preferences: [], excludeCurrentTrack: false },
      emotion: null, topic: null, communicativeAct: 'REQUEST', eventFrame: null,
      conversationState: { activeTopic: null, entities: [], facts: [], unresolvedContext: null }, confidence: 1, ambiguity: null,
    }, model: 'auth-test', tokenUsage: null }),
  })
  const events = []
  await runtime.execute({ ...base, userMessage: '切下一首', conversationHistory: [] }, { onStreamEvent: (event) => events.push(event) })

  assert.deepEqual(events.map((event) => event.type), ['reset', 'tool_start', 'delta'])
  assert.match(events.at(-1).text, /切到下一首/)
})

test('P1 music proposal is persisted as explicit non-executed state', async () => {
  let calls = 0
  const runtime = createMoriAgent(async () => {
    calls += 1
    return {
      content: '', model: 'unified-test', tokenUsage: null,
      toolCalls: [{ id: 'proposal-call', name: 'propose_music', arguments: { query: '轻快', response: '要不要听点轻快的？' } }],
    }
  }, { runtime: 'unified', persona: 'Mori Persona', logSource: 'test' })
  const result = await runtime.execute({ ...base, userMessage: '明天要上班，心情一般', conversationHistory: [] })

  assert.equal(calls, 1)
  assert.equal(result.action, undefined)
  assert.equal(result.finalResponse, '要不要听点轻快的？')
  assert.deepEqual(result.conversationContext.conversationState.pendingProposal, {
    type: 'RECOMMEND', query: '轻快', status: 'AWAITING_CONFIRMATION',
  })
})

test('P1 a completed music action clears the pending proposal', async () => {
  const runtime = createMoriAgent(async () => ({
    content: '', model: 'unified-test', tokenUsage: null,
    toolCalls: [{ id: 'recommend-call', name: 'recommend_music', arguments: { query: '轻快', authorizationQuote: '想听轻快的', excludeCurrentTrack: false } }],
  }), { runtime: 'unified', persona: 'Mori Persona', musicSearchMode: 'library', logSource: 'test' })
  const result = await runtime.execute({
    ...base, userMessage: '想听轻快的', conversationHistory: [],
    conversationState: { activeTopic: '放松', entities: [], facts: [], lastUserMessage: null, lastAssistantMessage: null, unresolvedContext: null, pendingProposal: { type: 'RECOMMEND', query: '轻快', status: 'AWAITING_CONFIRMATION' } },
  })

  assert.equal(result.action.intent, 'RECOMMEND')
  assert.equal(result.conversationContext.conversationState.pendingProposal, null)
})

test('a rejected or ignored proposal expires after the immediately following turn', async () => {
  const runtime = createMoriAgent(async () => ({
    content: '好，那我们先不听。', toolCalls: [], model: 'unified-test', tokenUsage: null,
  }), { runtime: 'unified', persona: 'Mori Persona', logSource: 'test' })
  const result = await runtime.execute({
    ...base, userMessage: '不用了', conversationHistory: [],
    conversationState: { activeTopic: '放松', entities: [], facts: [], lastUserMessage: null, lastAssistantMessage: '要不要听点轻快的？', unresolvedContext: null, pendingProposal: { type: 'RECOMMEND', query: '轻快', status: 'AWAITING_CONFIRMATION' } },
  })

  assert.equal(result.action, undefined)
  assert.equal(result.conversationContext.conversationState.pendingProposal, null)
})

test('propose_music cannot claim playback completion or omit the confirmation question', async () => {
  let calls = 0
  const runtime = createMoriAgent(async () => {
    calls += 1
    if (calls === 1) return {
      content: '', model: 'unified-test', tokenUsage: null,
      toolCalls: [{ id: 'bad-proposal', name: 'propose_music', arguments: { query: '轻快', response: '已经给你播放轻快的歌了，要继续听吗？' } }],
    }
    return { content: '今晚先慢一点也好。', toolCalls: [], model: 'unified-test', tokenUsage: null }
  }, { runtime: 'unified', persona: 'Mori Persona', logSource: 'test' })
  const result = await runtime.execute({ ...base, userMessage: '今天有点累', conversationHistory: [] })

  assert.equal(calls, 2)
  assert.equal(result.action, undefined)
  assert.equal(result.conversationContext.conversationState.pendingProposal, null)
  assert.equal(result.finalResponse, '今晚先慢一点也好。')
})

test('unified direct reply cannot claim that new music has already started', async () => {
  const runtime = createMoriAgent(async () => ({
    content: '已经给你播放轻快的歌了。', toolCalls: [], model: 'unified-test', tokenUsage: null,
  }), { runtime: 'unified', persona: 'Mori Persona', logSource: 'test' })
  const result = await runtime.execute({ ...base, userMessage: '今天有点累', conversationHistory: [] })

  assert.equal(result.action, undefined)
  assert.equal(result.finalResponse, '我还没有开始新的播放。你想听什么，可以直接告诉我。')
})

test('unified runtime rejects all calls when the model returns multiple tools', async () => {
  const requests = []
  const runtime = createMoriAgent(async (value) => {
    requests.push(value)
    if (requests.length === 1) return {
      content: '', model: 'unified-test', tokenUsage: null,
      toolCalls: [
        { id: 'memory-call', name: 'search_memory', arguments: { query: '日语课' } },
        { id: 'context-call', name: 'get_music_context', arguments: {} },
      ],
    }
    return { content: '我先一次处理一件事。', toolCalls: [], model: 'unified-test', tokenUsage: null }
  }, { runtime: 'unified', persona: 'Mori Persona', logSource: 'test' })
  const result = await runtime.execute({ ...base, userMessage: '你记得我那首歌吗？' })

  assert.equal(requests.length, 2)
  const observations = requests[1].messages.filter((message) => message.role === 'tool')
  assert.equal(observations.length, 2)
  assert.ok(observations.every((message) => /所有并发 Tool Call 均未执行/.test(message.content)))
  assert.equal(result.finalResponse, '我先一次处理一件事。')
})

test('unified direct replies cannot claim an unexecuted playback change', async () => {
  const runtime = createMoriAgent(async () => ({
    content: '好的，我已经帮你暂停了。', toolCalls: [], model: 'unified-test', tokenUsage: null,
  }), { runtime: 'unified', persona: 'Mori Persona', logSource: 'test' })
  const result = await runtime.execute(base)

  assert.equal(result.finalResponse, '音乐还在继续。你想安静一下的话，告诉我一声，我可以替你暂停。')
})
