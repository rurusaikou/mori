/**
 * 作用：连接 Mori Agent 对话服务，并提供断网 fallback 和音乐瞬间持久化逻辑。
 * 输入：用户文本、当前 PlaybackState，以及 ExtensionStorage 中的历史数据。
 * 输出：更新后的 ConversationMessage 或 MusicMemory 列表，并写入本地存储。
 */
import type { ConversationMessage, MusicMemory, MusicMomentInput, MusicTrack, PlaybackState } from '@mori/domain'
import { extensionStorage } from '../storage/extension-storage'
import { syncMoment } from './memory-client'

const musicMoods = new Set(['calm', 'happy', 'healing', 'moved', 'nostalgic', 'low'])

const GREETING_ID = 'mori-welcome'

export async function getCompanionData() {
  const [storedMessages, memories] = await Promise.all([extensionStorage.getConversation(), extensionStorage.getMemories()])
  const now = new Date()
  const messages = storedMessages.filter((message) => message.text?.trim() && isSameLocalDay(message.createdAt, now))
  // 浏览器只缓存当天会话。历史事实已经由服务端按自然日归档，不再回填聊天窗口。
  // 没有 createdAt 的旧版消息无法可靠判断日期，因此升级后也按历史消息清理。
  if (messages.length !== storedMessages.length) await extensionStorage.setConversation(messages)
  return { messages: messages.length ? messages : [greeting(now)], memories }
}

export async function sendCompanionMessage(
  text: string,
  playback: PlaybackState,
  musicCatalog: MusicTrack[] = [],
  playTrack?: (track: MusicTrack) => Promise<void>,
  onUserStored?: (messages: ConversationMessage[]) => Promise<void>,
) {
  const value = text.trim()
  if (!value) throw new Error('请输入想和 Mori 说的话')
  const { messages, memories } = await getCompanionData()
  const userMessage: ConversationMessage = { id: crypto.randomUUID(), role: 'user', text: value, createdAt: new Date().toISOString() }
  // Persist the user's turn before waiting for a potentially slow local model. This makes the
  // message survive chat-tab unmounts, page navigation and service-worker suspension.
  const messagesWithUser = [...messages, userMessage].slice(-100)
  await extensionStorage.setConversation(messagesWithUser)
  await onUserStored?.(messagesWithUser)

  const agentResult = await requestAgentReply(value, playback, messages, memories, musicCatalog)
  let reply = agentResult.reply
  if (agentResult.action?.type === 'play_track') {
    // The model may only select a URI that was supplied in this request. Resolve it back to the
    // trusted Extension object before touching Spotify, so invented URIs never become commands.
    const track = musicCatalog.find((item) => item.uri === agentResult.action?.track.uri)
    if (!track || !playTrack) reply = '我在你的曲库里找到了候选歌曲，但现在还不能启动播放。'
    else {
      try { await playTrack(track) }
      catch (error) {
        console.error('Agent playback action failed:', error)
        reply = `我找到了《${track.title}》，但这次没能启动播放。请检查 Spotify 设备后再试一次。`
      }
    }
  }
  const moriMessage: ConversationMessage = { id: crypto.randomUUID(), role: 'mori', text: reply, createdAt: new Date().toISOString() }
  // Bound local history so long-lived profiles do not grow chrome.storage indefinitely before a
  // server-side conversation store exists.
  const next = [...messagesWithUser, moriMessage].slice(-100)
  await extensionStorage.setConversation(next)
  return next
}

export async function saveMusicMemory(playback: PlaybackState, input: MusicMomentInput) {
  // Runtime messages can be forged or originate from an older content bundle. Enforce the
  // persistence invariant here as well as in the UI so a Moment can never store an unknown mood.
  if (!input || !musicMoods.has(input.mood)) throw new Error('请选择此刻的心情')
  const memories = await extensionStorage.getMemories()
  const note = input.note?.trim().slice(0, 80)
  const memory: MusicMemory = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    note: note || (playback.track ? `记住和 Mori 一起听《${playback.track.title}》的这一刻。` : '记住这一刻。'),
    mood: input.mood,
    track: playback.track,
  }
  // Memories are user-triggered but still bounded locally; future export/sync can replace this
  // limit without changing the UI contract.
  const next = [memory, ...memories].slice(0, 200)
  await extensionStorage.setMemories(next)
  // 本地写入保证即时 UI；服务端是长期 Memory 事实库。网络失败不应让“记录瞬间”看起来失败。
  void syncMoment(memory).catch((error) => console.error('Mori Memory moment sync failed:', error))
  return next
}

async function requestAgentReply(
  userMessage: string,
  playback: PlaybackState,
  messages: ConversationMessage[],
  memories: MusicMemory[],
  musicCatalog: MusicTrack[],
) {
  const apiBaseUrl = (await extensionStorage.getApiBaseUrl()).replace(/\/$/, '')
  try {
    const response = await fetch(`${apiBaseUrl}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage,
        // Only the fields needed for conversation are sent. Spotify identifiers and artwork stay
        // inside the extension because the Agent has no reason to receive them.
        currentTrack: playback.track ? { uri: playback.track.uri, title: playback.track.title, artist: playback.track.artist } : null,
        conversationHistory: messages
          .filter((message) => message.id !== GREETING_ID && message.text?.trim())
          .slice(-12)
          .map((message) => ({ role: message.role === 'mori' ? 'assistant' : 'user', content: message.text.trim() })),
        // Moment remains user-created product data, never an Agent action. The Agent receives only
        // short searchable summaries, not the complete stored track object.
        fakeMemory: memories.slice(0, 50).map((memory) => ({
          id: memory.id,
          content: memory.note,
          context: memory.track ? `${memory.track.title} · ${memory.track.artist}` : memory.createdAt,
        })),
        // The server receives a bounded, minimal catalogue and may only return one of these URIs.
        // OAuth credentials and playlist ownership remain inside the Extension.
        musicCatalog: musicCatalog.slice(0, 500).map((track) => ({ uri: track.uri, isrc: track.isrc, title: track.title, artist: track.artist })),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      }),
    })
    const result = await response.json() as {
      success?: boolean
      finalResponse?: string
      error?: string
      action?: { type: 'play_track'; track: { uri: string; title: string; artist: string } }
    }
    if (!response.ok || !result.success || !result.finalResponse?.trim()) throw new Error(result.error || `Agent HTTP ${response.status}`)
    return { reply: result.finalResponse.trim(), action: result.action }
  } catch (error) {
    console.error('Mori Agent request failed:', error)
    // Do not imitate an intelligent answer after an outage: a transparent, track-aware fallback
    // avoids the repetitive canned question that previously confused users.
    const modelDidNotFinish = error instanceof Error && /Structured Output|输出额度|响应未完成/.test(error.message)
    if (modelDidNotFinish) return { reply: '本地模型这次没有完成回复。你可以再试一次，或在设置中换用更快的模型。' }
    return { reply: playback.track
      ? `我暂时连不上理解服务，但还在陪你听《${playback.track.title}》。连接恢复后，我再认真回答你。`
      : '我暂时连不上理解服务，但我还在。连接恢复后，我们再继续聊。' }
  }
}

function greeting(now: Date): ConversationMessage {
  return { id: GREETING_ID, role: 'mori', text: '我在。想聊聊现在听到的歌吗？', createdAt: now.toISOString() }
}

function isSameLocalDay(value: string | undefined, now: Date) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return false
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}
