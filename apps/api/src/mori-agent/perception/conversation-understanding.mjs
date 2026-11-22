/** Conversation Understanding 使用结构化 LLM，不包含关键词、正则或 Tool 路由规则。 */
import { object, text } from '../shared/executor.mjs'

export const CONVERSATION_UNDERSTANDING_PROMPT_VERSION = 'conversation-understanding-v1.0'
export const CONVERSATION_SCENES = ['LISTEN_REQUEST', 'DAILY_CHAT', 'SONG_CHAT']
export const CONVERSATION_UNDERSTANDING_SCHEMA = {
  type: 'object',
  properties: {
    scene: { type: 'string', enum: CONVERSATION_SCENES }, meaning: { type: 'string' },
    reference: { anyOf: [{ type: 'null' }, { type: 'object', properties: { type: { type: 'string' }, value: { anyOf: [{ type: 'null' }, { type: 'string' }] } }, required: ['type', 'value'], additionalProperties: false }] },
    listeningRequest: { anyOf: [{ type: 'null' }, { type: 'object', properties: { type: { type: 'string', enum: ['SEARCH', 'RECOMMEND'] }, song: { anyOf: [{ type: 'null' }, { type: 'string' }] }, artist: { anyOf: [{ type: 'null' }, { type: 'string' }] }, preferences: { type: 'array', items: { type: 'string' } }, excludeCurrentTrack: { type: 'boolean' } }, required: ['type', 'song', 'artist', 'preferences', 'excludeCurrentTrack'], additionalProperties: false }] },
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

【scene】
LISTEN_REQUEST：
latestMessage 当前正在要求 Mori 搜索、推荐或播放音乐。
只有当前消息存在音乐行动请求时才使用。

SONG_CHAT：
latestMessage 是在讨论、评价、回应歌曲、歌手、歌词、声音或音乐感受，但没有提出新的搜索、推荐或播放请求。

DAILY_CHAT：
其他日常聊天、分享、提问、倾诉或回应。

【listeningRequest】
只有 latestMessage 当前确实提出搜索或推荐音乐的请求时才生成。
历史中已经提出或执行过的音乐请求不能自动继承到当前轮。

【emotion】
只提取 latestMessage 当前明确表达的用户情绪。
不要从 conversationHistory 继承过去的情绪。

你不回复用户、不选择 Tool、不执行动作，只返回给定 Schema。
`

export async function understandConversation(llm, state) {
  const result = await llm({
    prompt: CONVERSATION_UNDERSTANDING_PROMPT,
    input: { latestMessage: state.userMessage, conversationHistory: state.conversationHistory.slice(-12), currentState: { worldState: state.worldState, playbackState: state.playbackState } },
    schema: CONVERSATION_UNDERSTANDING_SCHEMA,
    schemaName: 'mori_conversation_understanding_v1',
  })
  return { understanding: validateConversationUnderstanding(result.data), model: result.model, tokenUsage: result.tokenUsage }
}

export function validateConversationUnderstanding(value) {
  object(value, 'conversation understanding')
  if (!CONVERSATION_SCENES.includes(value.scene)) throw new Error('conversation understanding scene 无效')
  text(value.meaning, 'conversation understanding meaning')
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error('conversation understanding confidence 无效')
  if (value.scene === 'LISTEN_REQUEST' && !value.listeningRequest) throw new Error('LISTEN_REQUEST 必须包含 listeningRequest')
  if (value.scene !== 'LISTEN_REQUEST' && value.listeningRequest) throw new Error('非 LISTEN_REQUEST 不能包含 listeningRequest')
  return value
}

export function assembleConversationContext(state, understanding) {
  // Decision 不再接触原始消息和 History，避免绕过 Understanding 重新分类语义。
  return { understanding, worldState: state.worldState, playbackState: state.playbackState }
}
