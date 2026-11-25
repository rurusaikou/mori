/**
 * 作用：校验并组装一次 Agent Run 的只读上下文，避免 Tool 自行访问产品状态。
 * 输入：userMessage、currentTrack、conversationHistory、fakeMemory、timeZone。
 * 输出：冻结的 AgentState，供模型决策和三个 Tool 显式使用。
 */
import { noExtra, object, text } from '../shared/executor.mjs'
import { EMPTY_CONVERSATION_STATE, normalizeConversationState } from './conversation-state.mjs'

export function createAgentState(input) {
  object(input)
  noExtra(input, ['userMessage', 'currentTrack', 'playbackState', 'worldState', 'conversationHistory', 'conversationFocus', 'conversationState', 'fakeMemory', 'timeZone'], 'Agent input')
  const userMessage = text(input.userMessage, 'userMessage')
  const currentTrack = optionalTrack(input.currentTrack)
  const conversationHistory = Array.isArray(input.conversationHistory) ? input.conversationHistory.map(conversationItem) : []
  const conversationFocus = optionalTrack(input.conversationFocus)
  const conversationState = normalizeConversationState(input.conversationState, EMPTY_CONVERSATION_STATE)
  const fakeMemory = Array.isArray(input.fakeMemory) ? input.fakeMemory.map(memoryItem) : []
  const timeZone = typeof input.timeZone === 'string' && input.timeZone.trim() ? input.timeZone.trim() : 'UTC'
  const playbackState = normalizePlaybackState(input.playbackState, currentTrack)
  const worldState = normalizeWorldState(input.worldState, timeZone)
  return Object.freeze({ userMessage, currentTrack: playbackState.currentTrack, playbackState, worldState, conversationHistory, conversationFocus, conversationState, fakeMemory, timeZone })
}

function normalizePlaybackState(value, legacyTrack) {
  // 兼容仍只发送 currentTrack 的旧 Extension：有曲目不等于正在播放，因此保守映射为 paused。
  // 新调用方必须发送 playbackState，避免模型把“已选中歌曲”误认为“正在播放”。
  if (value === undefined) return Object.freeze({ status: legacyTrack ? 'paused' : 'none', currentTrack: legacyTrack })
  object(value, 'playbackState')
  const status = ['playing', 'paused', 'none'].includes(value.status) ? value.status : null
  if (!status) throw new Error('playbackState.status 无效')
  const currentTrack = optionalTrack(value.currentTrack)
  const previousTrack = optionalTrack(value.previousTrack)
  if (status === 'none' && currentTrack) throw new Error('playbackState.status=none 时不能包含 currentTrack')
  if (status !== 'none' && !currentTrack) throw new Error('播放或暂停状态必须包含 currentTrack')
  return Object.freeze({ status, currentTrack, previousTrack, availability: typeof value.availability === 'string' ? value.availability : 'ready' })
}
function normalizeWorldState(value, timeZone) {
  if (value === undefined) return Object.freeze({ timeZone })
  object(value, 'worldState')
  return Object.freeze({ timeZone: typeof value.timeZone === 'string' && value.timeZone.trim() ? value.timeZone.trim() : timeZone })
}

function optionalTrack(value) {
  if (value === null || value === undefined) return null
  object(value, 'currentTrack')
  return { title: text(value.title, 'currentTrack.title'), artist: text(value.artist, 'currentTrack.artist'), ...(value.uri ? { uri: String(value.uri) } : {}), ...(value.isrc ? { isrc: String(value.isrc).replaceAll('-', '').toUpperCase() } : {}), ...(value.album ? { album: String(value.album) } : {}) }
}
function conversationItem(value) {
  object(value, 'conversation item')
  if (!['user', 'assistant'].includes(value.role)) throw new Error('conversation role 无效')
  return {
    role: value.role,
    content: text(value.content, 'conversation content'),
    playbackTrack: optionalTrack(value.playbackTrack ?? value.track),
    discussionTrack: optionalTrack(value.discussionTrack),
  }
}
function memoryItem(value, index) { object(value, `fakeMemory[${index}]`); return { id: value.id ? String(value.id) : `memory-${index + 1}`, content: text(value.content, `fakeMemory[${index}].content`), ...(value.context ? { context: String(value.context) } : {}) } }
