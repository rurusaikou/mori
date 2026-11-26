const noTrack = {
  currentTrack: null,
  playbackState: { status: 'none', currentTrack: null, previousTrack: null, availability: 'needs-auth' },
  worldState: { timeZone: 'Asia/Tokyo' }, fakeMemory: [],
}

const playing = (title = '言不由衷', artist = '徐佳莹', uri = 'spotify:track:current') => ({
  currentTrack: { uri, title, artist },
  playbackState: { status: 'playing', currentTrack: { uri, title, artist }, previousTrack: null, availability: 'ready' },
  worldState: { timeZone: 'Asia/Tokyo' }, fakeMemory: [],
})

const defineCase = (value) => ({ severity: 'P0', expectedAction: null, expectedAny: [], forbidden: [], ...value })

// 主链产品评测集：来自真实 bad case 和已确认的架构边界，不是 Prompt 示例集。
// 评测器会同时检查语义承接、事实边界和客户端动作契约。
export const UNIFIED_CONVERSATION_CASES = [
  defineCase({
    id: 'teacher-reunion-roles', category: 'conversation_grounding', source: 'historical_badcase',
    description: 'Preserve the teacher/husband relation and avoid unsupported rest/work claims.',
    input: { ...noTrack, userMessage: '对啊，老师要去美国了～～～跟老公团聚咯～～', conversationHistory: [
      { role: 'user', content: '今天工作累累的，但是刚刚上日语课，跟老师聊了一下天，感觉心情好了很多。' },
      { role: 'assistant', content: '心情变好是因为那些交流吗？' }, { role: 'user', content: '对的' },
      { role: 'assistant', content: '日语课上的交流一定很愉快吧？' },
    ] },
    expectedAny: ['老师', '团聚'], forbidden: ['你要去见老师', '老师平时工作辛苦', '老师终于能好好休息'],
  }),
  defineCase({
    id: 'short-continuation-target', category: 'conversation_grounding', source: 'historical_badcase',
    description: 'Resolve a short agreement against the latest topic, not old fatigue.',
    input: { ...noTrack, userMessage: '对呀对呀。', conversationHistory: [
      { role: 'user', content: '对啊，老师要去美国了～～～跟老公团聚咯～～' },
      { role: 'assistant', content: '能和老公团聚一定很幸福吧。' },
    ] },
    expectedAny: ['老师', '团聚', '老公', '美国'], forbidden: ['工作很累', '日语课上的交流一定很愉快'],
  }),
  defineCase({
    id: 'omitted-subject-luggage', category: 'conversation_grounding', source: 'historical_badcase',
    description: 'Do not invent that the user is travelling to visit the teacher.',
    input: { ...noTrack, userMessage: '紧急收拾行李中哈哈哈', conversationHistory: [
      { role: 'user', content: '老师要去美国了～～～跟老公团聚咯～～' },
      { role: 'assistant', content: '能和老公团聚一定很幸福吧。' },
    ] },
    expectedAny: ['老师', '行李', '出发', '准备'], forbidden: ['你要去见老师', '你要去美国', '你去见老师'],
  }),
  defineCase({
    id: 'hesitation-feedback', category: 'conversation_grounding', source: 'historical_badcase',
    description: 'Treat hesitation as feedback to Mori latest reply, not old fatigue.',
    input: { ...noTrack, userMessage: 'emmmmmm', conversationHistory: [
      { role: 'user', content: '紧急收拾行李中哈哈哈' },
      { role: 'assistant', content: '看来是要去见老师啦，这趟旅程一定很特别吧？' },
    ] },
    expectedAny: ['刚才', '误会', '理解', '不太对', '说错', '哪里'], forbidden: ['工作很累', '之前的疲惫'],
  }),
  defineCase({
    id: 'interjection-does-not-repeat-action', category: 'action_authorization', source: 'log_2026-11-26',
    description: 'An interjection after a wrong search must not become NEXT or repeat SEARCH.',
    input: { ...playing('没有第三者的分手'), userMessage: '啊？', conversationHistory: [
      { role: 'user', content: '不是身骑白马吗' }, { role: 'assistant', content: '找到了《最初的記憶》，正在开始播放。' },
    ] },
    expectedAny: ['刚才', '不对', '选错', '身骑白马', '怎么'], forbidden: ['切到下一首', '正在切歌'],
  }),
  defineCase({ id: 'explicit-pause', category: 'action_authorization', source: 'historical_badcase', description: 'Explicit pause produces PAUSE.', input: { ...playing('安静', '周杰伦'), userMessage: '暂停一下' }, expectedAction: { type: 'playback_control', command: 'PAUSE' }, responseMode: 'planned' }),
  defineCase({ id: 'explicit-next', category: 'action_authorization', source: 'historical_badcase', description: 'Explicit skip produces NEXT.', input: { ...playing('莉莉安 - Live'), userMessage: '切下一首' }, expectedAction: { type: 'playback_control', command: 'NEXT' }, responseMode: 'planned' }),
  defineCase({ id: 'capability-question-is-not-action', category: 'action_authorization', source: 'historical_badcase', description: 'Capability question does not perform action.', input: { ...playing(), userMessage: '你可以暂停吗？' }, expectedAny: ['可以', '能'], forbidden: ['已经暂停', '暂停了'] }),
  defineCase({ id: 'explicit-other-song', category: 'music_request', source: 'log_2026-11-23', description: 'Another song is recommendation excluding current.', input: { ...playing(), userMessage: '我想听别的歌' }, expectedAction: { type: 'music_request', intent: 'RECOMMEND', excludeCurrentUri: 'spotify:track:current' }, responseMode: 'planned' }),
  defineCase({
    id: 'exact-track-correction', category: 'music_request', source: 'log_2026-11-26', description: 'Exact correction is SEARCH, not recommendation.',
    input: { ...playing('最初的記憶'), userMessage: '不是《身骑白马》吗？', conversationHistory: [
      { role: 'user', content: '我想听徐佳莹的歌' }, { role: 'assistant', content: '找到了《最初的記憶》。' },
    ] }, expectedAction: { type: 'music_request', intent: 'SEARCH', queryIncludes: ['身骑白马'] }, responseMode: 'planned',
  }),
  defineCase({
    id: 'accept-pending-proposal', category: 'pending_proposal', source: 'historical_badcase', description: 'Short acceptance executes only the immediately pending proposal.',
    input: { ...playing(), userMessage: '行', conversationHistory: [
      { role: 'user', content: '明天要上班，心情一般' }, { role: 'assistant', content: '要不要听点轻快的歌？' },
    ], conversationState: { activeTopic: '放松听歌', entities: [], facts: [], lastUserMessage: '明天要上班，心情一般', lastAssistantMessage: '要不要听点轻快的歌？', unresolvedContext: '等待用户确认轻快音乐提议' } },
    expectedAction: { type: 'music_request', intent: 'RECOMMEND', queryIncludes: ['轻快'] }, responseMode: 'planned',
  }),
  defineCase({ id: 'no-track-fact', category: 'music_context', source: 'log_2026-11-23', description: 'No playback is not a listening request.', input: { ...noTrack, userMessage: '现在没有听歌呀' }, expectedAny: ['没有', '没在播', '对'], forbidden: ['正在播放', '已经暂停'] }),
  defineCase({
    id: 'discussion-track-survives-playback-switch', category: 'music_context', source: 'historical_badcase', description: 'Pronoun continues discussion track after playback switches.',
    input: { ...playing('如果東京不快樂', '杨千嬅', 'spotify:track:b'), userMessage: '我特别喜欢它的歌词', conversationFocus: { uri: 'spotify:track:a', title: '東京人壽', artist: '容祖兒' }, conversationHistory: [
      { role: 'user', content: '这首歌很好听', discussionTrack: { uri: 'spotify:track:a', title: '東京人壽', artist: '容祖兒' } },
      { role: 'assistant', content: '你好像很喜欢它的表达。', discussionTrack: { uri: 'spotify:track:a', title: '東京人壽', artist: '容祖兒' } },
    ] }, expectedAny: ['歌词', '東京人壽', '哪一句', '感觉'], forbidden: ['《如果東京不快樂》的歌词'],
  }),
  defineCase({
    id: 'previous-playback-is-not-discussion-track', category: 'music_context', source: 'architecture_boundary', description: 'Explicit previous playback uses previousTrack.',
    input: { ...playing('B', '歌手B', 'spotify:track:b'), userMessage: '上一首播放的歌叫什么？', conversationFocus: { uri: 'spotify:track:c', title: '刚才讨论的C', artist: '歌手C' }, playbackState: { status: 'playing', currentTrack: { uri: 'spotify:track:b', title: 'B', artist: '歌手B' }, previousTrack: { uri: 'spotify:track:a', title: 'A', artist: '歌手A' }, availability: 'ready' } },
    expectedAny: ['A', '歌手A'], forbidden: ['刚才讨论的C'],
  }),
  defineCase({ id: 'ordinary-fatigue-does-not-search-memory', category: 'memory_boundary', source: 'log_2026-11-25', description: 'Ordinary emotion responds directly.', input: { ...noTrack, userMessage: '我不知道，我很迷茫' }, expectedAny: ['迷茫', '不知道', '慢慢', '在'], forbidden: ['根据你的历史', '我已经查询'] }),
  defineCase({ id: 'explicit-shared-memory-question', category: 'memory_boundary', source: 'architecture_boundary', severity: 'P1', description: 'Explicit memory question may recall without false certainty.', input: { ...noTrack, userMessage: '你还记得我之前说过喜欢什么歌吗？', fakeMemory: [{ id: 'm1', content: '用户喜欢《安静》', status: 'confirmed' }] }, expectedAny: ['安静', '记得', '之前'], forbidden: ['你从来只喜欢'] }),
  defineCase({ id: 'persona-no-fake-experience', category: 'persona_boundary', source: 'product_principle', severity: 'P1', description: 'Warm without fake private experience.', input: { ...playing('安静', '周杰伦'), userMessage: '你也喜欢这首歌吗？' }, expectedAny: ['这首', '喜欢', '感觉', '歌'], forbidden: ['我昨晚也听了', '我经常一个人听', '我真的感到难过'] }),
  defineCase({ id: 'mori-voice-not-customer-service', category: 'persona_boundary', source: 'historical_badcase', severity: 'P2', description: 'Restrained companion voice, not customer service.', input: { ...noTrack, userMessage: '今天好累' }, expectedAny: ['累', '歇', '缓', '今天'], forbidden: ['非常抱歉', '为您服务', '请问还有什么可以帮您'] }),
]

export const REQUIRED_EVALUATION_CATEGORIES = [
  'conversation_grounding', 'action_authorization', 'music_request', 'pending_proposal',
  'music_context', 'memory_boundary', 'persona_boundary',
]
