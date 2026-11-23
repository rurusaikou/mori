/** Conversation Understanding 使用结构化 LLM，不包含关键词、正则或 Tool 路由规则。 */
import { object, text } from '../shared/executor.mjs'

export const CONVERSATION_UNDERSTANDING_PROMPT_VERSION = 'conversation-understanding-v1.1'
export const CONVERSATION_SCENES = ['LISTEN_REQUEST', 'DAILY_CHAT', 'SONG_CHAT']
export const TRACK_REFERENCE_TYPES = ['CURRENT_TRACK', 'PREVIOUS_TRACK', 'CONVERSATION_TRACK', 'NAMED_TRACK', 'RECOMMENDED_TRACK', 'UNKNOWN']
export const CONVERSATION_UNDERSTANDING_SCHEMA = {
  type: 'object',
  properties: {
    scene: { type: 'string', enum: CONVERSATION_SCENES }, meaning: { type: 'string' },
    reference: { anyOf: [{ type: 'null' }, { type: 'object', properties: { type: { type: 'string', enum: TRACK_REFERENCE_TYPES }, value: { anyOf: [{ type: 'null' }, { type: 'string' }] } }, required: ['type', 'value'], additionalProperties: false }] },
    listeningRequest: { anyOf: [{ type: 'null' }, { type: 'object', properties: { type: { type: 'string', enum: ['SEARCH', 'RECOMMEND', 'CONTROL'] }, control: { anyOf: [{ type: 'null' }, { type: 'string', enum: ['PAUSE', 'RESUME', 'NEXT', 'PREVIOUS'] }] }, song: { anyOf: [{ type: 'null' }, { type: 'string' }] }, artist: { anyOf: [{ type: 'null' }, { type: 'string' }] }, preferences: { type: 'array', items: { type: 'string' } }, excludeCurrentTrack: { type: 'boolean' } }, required: ['type', 'control', 'song', 'artist', 'preferences', 'excludeCurrentTrack'], additionalProperties: false }] },
    emotion: { anyOf: [{ type: 'null' }, { type: 'object', properties: { description: { type: 'string' }, confidence: { type: 'number' } }, required: ['description', 'confidence'], additionalProperties: false }] },
    confidence: { type: 'number' }, ambiguity: { anyOf: [{ type: 'null' }, { type: 'string' }] },
  },
  required: ['scene', 'meaning', 'reference', 'listeningRequest', 'emotion', 'confidence', 'ambiguity'], additionalProperties: false,
}

export const CONVERSATION_UNDERSTANDING_PROMPT = `
你是 Mori 的 Conversation Understanding 模块。

你的任务是理解 latestMessage 在当前上下文中的含义，而不是总结整段 conversation。

【信息使用原则】
1. latestMessage 是当前轮用户真正说的话，也是判断本轮意图的唯一主体。
2. conversationHistory 只用于理解 latestMessage 的指代、省略、承接和背景。
3. currentState 只用于理解当前客观状态，例如当前正在播放什么歌曲。
4. 不要把 conversationHistory 中过去的请求、意图或情绪自动继承到当前轮。
5. 如果过去的请求已经得到响应或执行，除非 latestMessage 明确继续该请求，否则不要把它判断为当前请求。
6. meaning 必须描述 latestMessage 当前表达的意思，不要总结历史对话。
7. 先判断 latestMessage 与上一轮操作的关系：新的操作请求、结果追问、确认、质疑、纠正或重新执行。只有“新的操作请求”和“明确要求重新执行”才能生成新的 listeningRequest。
8. “我想听别的歌”“换一首”“来点别的”是当前消息明确提出的新音乐动作，必须生成 listeningRequest，不能解释成对当前歌曲的评价、追问或喜爱。
9. “hi / hello / 你好 / 嗯？”等独立短招呼或简短确认仍以 latestMessage 为主体；除非其中有明确指代，不得用历史请求替换它的含义。

【scene】
LISTEN_REQUEST：
latestMessage 当前正在要求 Mori 搜索、推荐或播放音乐。
只有当前消息存在音乐行动请求时才使用。

SONG_CHAT：
latestMessage 是在讨论、评价、回应歌曲、歌手、歌词、声音或音乐感受，但没有提出新的搜索、推荐或播放请求。

DAILY_CHAT：
其他日常聊天、分享、提问、倾诉或回应。
对上一轮搜索/推荐结果的追问、确认或质疑属于 DAILY_CHAT，不因为历史里存在音乐请求就创建新请求。例如“你选了哪几首”“什么候选歌”“为什么推荐这些”都不是新的推荐请求。

【listeningRequest】
只有 latestMessage 当前确实提出搜索或推荐音乐的请求时才生成。
历史中已经提出或执行过的音乐请求不能自动继承到当前轮。
“换一批”“再推荐几首”是重新执行，应生成 listeningRequest；“但是我想听徐佳莹的歌呀”在实际播放了其他歌时既是纠正，也明确要求满足原请求，应生成 listeningRequest。
scene 描述当前表达的主要对话行为，listeningRequest 描述是否存在需要执行的音乐动作；纠正可以是 DAILY_CHAT 或 SONG_CHAT，同时包含 listeningRequest，两者不要求互斥。
暂停、继续、下一首/切歌、上一首属于 CONTROL，分别输出 control=PAUSE、RESUME、NEXT、PREVIOUS；此时 song/artist 为 null、preferences 为空数组。

【reference】
- CURRENT_TRACK：用户明确指向现在这首、当前播放上下文中的歌曲。
- PREVIOUS_TRACK：用户明确指向播放历史中的上一首；不要与刚才讨论的歌混淆。
- CONVERSATION_TRACK：用户继续指向当前对话正在讨论的歌曲，即使 Spotify 已经切歌。
- NAMED_TRACK：用户明确说出歌名；value 填写歌名，能确定歌手时使用“歌名｜歌手”。
- RECOMMENDED_TRACK：用户指向 Mori 之前推荐的歌曲。
- UNKNOWN：知道用户在引用歌曲，但无法确定属于哪一种。
你只识别引用的语义类型，不猜 URI，也不因为解析困难而改成 CURRENT_TRACK。
只出现歌手名、且用户是在请求该歌手的任意歌曲时，reference 必须为 null，歌手应写入 listeningRequest.artist；歌手名本身不是 NAMED_TRACK。

【emotion】
只提取 latestMessage 当前明确表达的用户情绪。
不要从 conversationHistory 继承过去的情绪。

你不回复用户、不选择 Tool、不执行动作，只返回给定 Schema。
`

export async function understandConversation(llm, state, { onRawOutput } = {}) {
  // History 只提供指代和承接证据，截断可防止久远意图压过本轮消息；完整长期事实应通过
  // Memory Tool 按需检索，而不是无限塞入 Conversation Understanding。
  const result = await llm({
    prompt: CONVERSATION_UNDERSTANDING_PROMPT,
    input: { latestMessage: state.userMessage, conversationHistory: state.conversationHistory.slice(-12), currentState: { worldState: state.worldState, playbackState: state.playbackState, conversationFocus: state.conversationFocus } },
    schema: CONVERSATION_UNDERSTANDING_SCHEMA,
    schemaName: 'mori_conversation_understanding_v1',
  })
  onRawOutput?.({ promptVersion: CONVERSATION_UNDERSTANDING_PROMPT_VERSION, output: result.data, model: result.model, tokenUsage: result.tokenUsage })
  return { understanding: validateConversationUnderstanding(result.data), model: result.model, tokenUsage: result.tokenUsage }
}

export function validateConversationUnderstanding(value) {
  object(value, 'conversation understanding')
  if (!CONVERSATION_SCENES.includes(value.scene)) throw new Error('conversation understanding scene 无效')
  text(value.meaning, 'conversation understanding meaning')
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error('conversation understanding confidence 无效')
  if (value.reference && !TRACK_REFERENCE_TYPES.includes(value.reference.type)) throw new Error('conversation understanding reference.type 无效')
  // scene 描述对话行为，listeningRequest 独立描述副作用请求。纠正表达可能以 DAILY_CHAT
  // 为主但仍要求重新选歌；不能让合法的组合语义因为字段互斥而导致整轮失败。
  if (value.scene === 'LISTEN_REQUEST' && !value.listeningRequest) throw new Error('LISTEN_REQUEST 必须包含 listeningRequest')
  return value
}

export function assembleConversationContext(state, understanding) {
  // 原始消息只帮助 Decision 组织自然回复和承接；音乐副作用仍由 Structured Understanding
  // 与运行时一致性校验约束，不能根据原文绕过 listeningRequest 新建动作。
  const resolved = resolveTrackReference({ reference: understanding.reference, currentTrack: state.currentTrack, conversationHistory: state.conversationHistory, conversationFocus: state.conversationFocus })
  return { latestMessage: state.userMessage, conversationHistory: state.conversationHistory.slice(-12), understanding, worldState: state.worldState, playbackState: state.playbackState, targetTrack: resolved.track, trackResolution: resolved.resolution }
}

export function resolveTrackReference({ reference, currentTrack, conversationHistory = [], conversationFocus = null }) {
  const unresolved = (source = 'UNRESOLVED') => ({ track: null, resolution: { source, confidence: 0, resolved: false, referenceType: reference?.type ?? null } })
  if (!reference) return unresolved('NO_REFERENCE')
  if (reference.type === 'CURRENT_TRACK') return currentTrack
    ? resolved(currentTrack, 'PLAYBACK_STATE', 1, reference.type)
    : unresolved('PLAYBACK_STATE')
  if (reference.type === 'CONVERSATION_TRACK') {
    if (conversationFocus) return resolved(conversationFocus, 'CONVERSATION_FOCUS', 0.98, reference.type)
    const item = [...conversationHistory].reverse().find((message) => message.discussionTrack)
    return item?.discussionTrack ? resolved(item.discussionTrack, 'CONVERSATION_HISTORY', 0.9, reference.type) : unresolved('CONVERSATION_HISTORY')
  }
  if (reference.type === 'RECOMMENDED_TRACK') {
    const item = [...conversationHistory].reverse().find((message) => message.role === 'assistant' && message.discussionTrack)
    return item?.discussionTrack ? resolved(item.discussionTrack, 'CONVERSATION_HISTORY', 0.95, reference.type) : unresolved('CONVERSATION_HISTORY')
  }
  if (reference.type === 'NAMED_TRACK') {
    const candidates = uniqueTracks([currentTrack, conversationFocus, ...[...conversationHistory].reverse().flatMap((message) => [message.discussionTrack, message.playbackTrack])].filter(Boolean))
    const matches = candidates.filter((candidate) => namedTrackMatches(candidate, reference.value))
    if (matches.length === 1) return resolved(matches[0], 'KNOWN_TRACK_MATCH', 0.95, reference.type)
    return unresolved(matches.length > 1 ? 'AMBIGUOUS_NAMED_TRACK' : 'KNOWN_TRACK_MATCH')
  }
  // P0 没有可靠 playbackHistory；PREVIOUS_TRACK 和 UNKNOWN 必须保持未解析，不能静默回退。
  return unresolved(reference.type === 'PREVIOUS_TRACK' ? 'PLAYBACK_HISTORY_UNAVAILABLE' : 'UNKNOWN_REFERENCE')
}

function resolved(track, source, confidence, referenceType) { return { track, resolution: { source, confidence, resolved: true, referenceType } } }
function namedTrackMatches(track, value) {
  if (!value) return false
  const [title, artist] = String(value).split('｜').map(normalizeTrackText)
  if (normalizeTrackText(track.title) !== title) return false
  return !artist || normalizeTrackText(track.artist) === artist
}
function normalizeTrackText(value) { return String(value ?? '').toLocaleLowerCase().replaceAll(/[\s《》「」“”]/g, '') }
function uniqueTracks(tracks) { return [...new Map(tracks.map((track) => [track.uri || `${normalizeTrackText(track.title)}|${normalizeTrackText(track.artist)}`, track])).values()] }
