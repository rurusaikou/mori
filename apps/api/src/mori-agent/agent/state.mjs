/**
 * 作用：校验并组装一次 Agent Run 的只读上下文，避免 Tool 自行访问产品状态。
 * 输入：userMessage、currentTrack、conversationHistory、fakeMemory、可选 musicCatalog。
 * 输出：冻结的 AgentState，供模型决策和三个 Tool 显式使用。
 */
import { noExtra, object, text } from '../shared/executor.mjs'

export function createAgentState(input) {
  object(input)
  noExtra(input, ['userMessage', 'currentTrack', 'conversationHistory', 'fakeMemory', 'musicCatalog'], 'Agent input')
  const userMessage = text(input.userMessage, 'userMessage')
  const currentTrack = optionalTrack(input.currentTrack)
  const conversationHistory = Array.isArray(input.conversationHistory) ? input.conversationHistory.map(conversationItem) : []
  const fakeMemory = Array.isArray(input.fakeMemory) ? input.fakeMemory.map(memoryItem) : []
  const musicCatalog = Array.isArray(input.musicCatalog) ? input.musicCatalog.slice(0, 500).map(catalogItem) : []
  return Object.freeze({ userMessage, currentTrack, conversationHistory, fakeMemory, musicCatalog })
}

function optionalTrack(value) {
  if (value === null || value === undefined) return null
  object(value, 'currentTrack')
  return { title: text(value.title, 'currentTrack.title'), artist: text(value.artist, 'currentTrack.artist'), ...(value.album ? { album: String(value.album) } : {}) }
}
function conversationItem(value) { object(value, 'conversation item'); if (!['user', 'assistant'].includes(value.role)) throw new Error('conversation role 无效'); return { role: value.role, content: text(value.content, 'conversation content') } }
function memoryItem(value, index) { object(value, `fakeMemory[${index}]`); return { id: value.id ? String(value.id) : `memory-${index + 1}`, content: text(value.content, `fakeMemory[${index}].content`), ...(value.context ? { context: String(value.context) } : {}) } }
function catalogItem(value, index) {
  object(value, `musicCatalog[${index}]`)
  return { uri: text(value.uri, `musicCatalog[${index}].uri`), ...(value.isrc ? { isrc: String(value.isrc).replaceAll('-', '').toUpperCase() } : {}), title: text(value.title, `musicCatalog[${index}].title`), artist: text(value.artist, `musicCatalog[${index}].artist`) }
}
