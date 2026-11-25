/**
 * 作用：连接 Mori Agent 对话服务，并提供断网 fallback 和音乐瞬间持久化逻辑。
 * 输入：用户文本、当前 PlaybackState，以及 ExtensionStorage 中的历史数据。
 * 输出：更新后的 ConversationMessage 或 MusicMemory 列表，并写入本地存储。
 */
import { EMPTY_CONVERSATION_STATE, type ConversationMessage, type ConversationState, type MusicMemory, type MusicMomentInput, type MusicTrack, type PlaybackState } from '@mori/domain'
import { extensionStorage } from '../storage/extension-storage'
import type { PendingAgentActionResult } from '../storage/extension-storage'
import { syncMoment } from './memory-client'
import { logError, logInfo } from '../background/logger'

const musicMoods = new Set(['calm', 'happy', 'healing', 'moved', 'nostalgic', 'low'])

const GREETING_ID = 'mori-welcome'

export async function getCompanionData() {
  await flushPendingAgentActionResults()
  const now = new Date()
  const [storedMessages, memories, storedState] = await Promise.all([extensionStorage.getConversation(), extensionStorage.getMemories(), extensionStorage.getConversationState()])
  const messages = storedMessages.filter((message) => message.text?.trim() && isSameLocalDay(message.createdAt, now))
  // 浏览器只缓存当天会话。历史事实已经由服务端按自然日归档，不再回填聊天窗口。
  // 没有 createdAt 的旧版消息无法可靠判断日期，因此升级后也按历史消息清理。
  if (messages.length !== storedMessages.length) await extensionStorage.setConversation(messages)
  const localDate = localDateKey(now)
  const conversationState = storedState?.localDate === localDate ? storedState.state : EMPTY_CONVERSATION_STATE
  if (storedState && storedState.localDate !== localDate) await extensionStorage.setConversationState({ localDate, state: EMPTY_CONVERSATION_STATE })
  return { messages: messages.length ? messages : [greeting(now)], memories, conversationState, localDate }
}

export async function sendCompanionMessage(
  text: string,
  playback: PlaybackState,
  executeAction?: (request: AgentClientAction) => Promise<MusicTrack | null>,
  onUserStored?: (messages: ConversationMessage[]) => Promise<void>,
  requestId?: string,
  onStreamEvent?: (event: AgentStreamEvent) => void,
) {
  const value = text.trim()
  if (!value) throw new Error('请输入想和 Mori 说的话')
  const { messages, memories, conversationState, localDate } = await getCompanionData()
  const userMessage: ConversationMessage = { id: crypto.randomUUID(), role: 'user', text: value, createdAt: new Date().toISOString(), playbackTrack: playback.track }
  // Persist the user's turn before waiting for a potentially slow local model. This makes the
  // message survive chat-tab unmounts, page navigation and service-worker suspension.
  const messagesWithUser = [...messages, userMessage].slice(-100)
  await extensionStorage.setConversation(messagesWithUser)
  await onUserStored?.(messagesWithUser)
  logInfo('conversation', 'conversation_user_message_stored', { requestId: requestId ?? null, userMessageId: userMessage.id, text: value })

  const agentResult = await requestAgentReply(value, playback, messages, memories, conversationState, requestId, onStreamEvent)
  let reply = agentResult.reply
  let replyTrack = playback.track
  let actionStatus: 'COMPLETED' | 'FAILED' | null = null
  let switchedTrack = false
  if (agentResult.action?.type === 'music_request') {
    if (!executeAction) { reply = '这次还不能执行音乐请求。'; actionStatus = 'FAILED' }
    else {
      try {
        const track = await executeAction(agentResult.action) as MusicTrack | null
        if (!track) {
          actionStatus = 'COMPLETED'
          reply = agentResult.action.intent === 'SEARCH'
            ? '我查了你的完整曲库和 Spotify，暂时没有找到这首歌。'
            : '这次没有找到合适且可播放的歌曲。'
        }
        else {
          replyTrack = track
          actionStatus = 'COMPLETED'
          reply = agentResult.action.intent === 'RECOMMEND'
            ? `给你选了《${track.title}》— ${track.artist}，现在开始播放。`
            : `找到了《${track.title}》— ${track.artist}，现在开始播放。`
        }
      }
      catch (error) {
        actionStatus = 'FAILED'
        logError('conversation', 'agent_music_action_failed', error, { requestId: requestId ?? null, exchangeId: agentResult.exchangeId ?? null, agentRunId: agentResult.action.agentRunId ?? null, intent: agentResult.action.intent, query: agentResult.action.query })
        reply = '我找到了候选歌曲，但这次没能启动播放。请检查 Spotify 设备后再试一次。'
      }
    }
  } else if (agentResult.action?.type === 'playback_control') {
    if (!executeAction) { reply = '这次还不能控制播放。'; actionStatus = 'FAILED' }
    else {
      try {
        const confirmedTrack = await executeAction(agentResult.action)
        if (confirmedTrack) replyTrack = confirmedTrack
        switchedTrack = ['NEXT', 'PREVIOUS'].includes(agentResult.action.command)
        actionStatus = 'COMPLETED'
        reply = ({ PAUSE: '已经暂停。', RESUME: '继续播放。', NEXT: '切到下一首。', PREVIOUS: '回到上一首。' })[agentResult.action.command]
      } catch (error) {
        actionStatus = 'FAILED'
        logError('conversation', 'agent_playback_control_failed', error, { requestId: requestId ?? null, exchangeId: agentResult.exchangeId ?? null, agentRunId: agentResult.action.agentRunId ?? null, command: agentResult.action.command })
        reply = '这次没能完成播放控制，请检查 Spotify 设备后再试一次。'
      }
    }
  }
  // NEXT/PREVIOUS 成功后，真实讨论对象必须切换到确认后的新曲；否则下一轮“这首歌”
  // 会被 conversationFocus 错误地解析回动作前的歌曲。
  const discussionTrack = switchedTrack && actionStatus === 'COMPLETED'
    ? replyTrack
    : agentResult.conversationContext?.targetTrack ?? (agentResult.action && replyTrack ? replyTrack : null)
  const moriMessage: ConversationMessage = { id: crypto.randomUUID(), role: 'mori', text: reply, createdAt: new Date().toISOString(), playbackTrack: replyTrack, discussionTrack }
  // Bound local history so long-lived profiles do not grow chrome.storage indefinitely before a
  // server-side conversation store exists.
  const next = [...messagesWithUser, moriMessage].slice(-100)
  await extensionStorage.setConversation(next)
  const nextConversationState: ConversationState = {
    ...(agentResult.conversationContext?.conversationState ?? conversationState),
    lastUserMessage: value,
    lastAssistantMessage: reply,
  }
  await extensionStorage.setConversationState({ localDate, state: nextConversationState })
  if (agentResult.action && agentResult.exchangeId && actionStatus) {
    await reportAgentActionResult({
      exchangeId: agentResult.exchangeId,
      runId: agentResult.action.agentRunId ?? '',
      actionResultToken: agentResult.actionResultToken ?? '',
      finalResponse: reply,
      status: actionStatus,
      currentTrack: replyTrack,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    })
  }
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
  void syncMoment(memory).catch((error) => logError('memory', 'moment_sync_failed', error, { id: memory.id }))
  return next
}

async function requestAgentReply(
  userMessage: string,
  playback: PlaybackState,
  messages: ConversationMessage[],
  memories: MusicMemory[],
  conversationState: ConversationState,
  requestId?: string,
  onStreamEvent?: (event: AgentStreamEvent) => void,
) {
  const apiBaseUrl = (await extensionStorage.getApiBaseUrl()).replace(/\/$/, '')
  try {
    logInfo('conversation', 'agent_http_request_started', {
      requestId: requestId ?? null, text: userMessage, topic: conversationState.activeTopic,
      entityCount: conversationState.entities.length, factCount: conversationState.facts.length,
      unresolvedContext: conversationState.unresolvedContext,
    })
    const requestBody = JSON.stringify({
        userMessage,
        // Only the fields needed for conversation are sent. Spotify identifiers and artwork stay
        // inside the extension because the Agent has no reason to receive them.
        currentTrack: playback.track ? { uri: playback.track.uri, isrc: playback.track.isrc, title: playback.track.title, artist: playback.track.artist } : null,
        playbackState: {
          status: playback.track ? (playback.isPlaying ? 'playing' : 'paused') : 'none',
          currentTrack: playback.track ? { uri: playback.track.uri, isrc: playback.track.isrc, title: playback.track.title, artist: playback.track.artist } : null,
          previousTrack: compactTrack(playback.previousTrack),
          availability: playback.availability,
        },
        worldState: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
        conversationHistory: messages
          .filter((message) => message.id !== GREETING_ID && message.text?.trim())
          .slice(-12)
          .map((message) => ({
            role: message.role === 'mori' ? 'assistant' : 'user',
            content: message.text.trim(),
            playbackTrack: compactTrack(message.playbackTrack ?? message.track),
            discussionTrack: compactTrack(message.discussionTrack),
          })),
        conversationFocus: compactTrack([...messages].reverse().find((message) => message.role === 'mori')?.discussionTrack),
        conversationState,
        // Moment remains user-created product data, never an Agent action. The Agent receives only
        // short searchable summaries, not the complete stored track object.
        fakeMemory: memories.slice(0, 50).map((memory) => ({
          id: memory.id,
          content: memory.note,
          context: memory.track ? `${memory.track.title} · ${memory.track.artist}` : memory.createdAt,
        })),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      })
    const requestHeaders = { 'Content-Type': 'application/json', 'X-Mori-Request-ID': requestId ?? '' }
    let response = await fetch(`${apiBaseUrl}/agent/stream`, {
      method: 'POST',
      headers: { ...requestHeaders, 'Accept': 'text/event-stream' },
      body: requestBody,
    })
    if (response.status === 404) {
      response = await fetch(`${apiBaseUrl}/agent/run`, {
        method: 'POST', headers: requestHeaders, body: requestBody,
      })
    }
    let result: AgentRunResponse
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      onStreamEvent?.({ phase: 'started' })
      result = await readAgentEventStream(response, onStreamEvent)
    } else result = await response.json() as AgentRunResponse
    if (!response.ok || !result.success || !result.finalResponse?.trim()) throw new Error(result.error || `Agent HTTP ${response.status}`)
    logInfo('conversation', 'agent_http_request_completed', { requestId: requestId ?? null, exchangeId: result.exchangeId ?? null, agentRunId: result.meta?.runId ?? null, httpStatus: response.status, actionType: result.action?.type ?? 'direct_response' })
    return {
      reply: result.finalResponse.trim(),
      action: result.action ? { ...result.action, agentRunId: result.meta?.runId, promptVersion: result.meta?.version } : undefined,
      conversationContext: result.conversationContext,
      exchangeId: result.exchangeId,
      actionResultToken: result.actionResultToken,
    }
  } catch (error) {
    logError('conversation', 'agent_http_request_failed', error, { requestId: requestId ?? null })
    // Do not imitate an intelligent answer after an outage: a transparent, track-aware fallback
    // avoids the repetitive canned question that previously confused users.
    const modelDidNotFinish = error instanceof Error && /Structured Output|输出额度|响应未完成/.test(error.message)
    if (modelDidNotFinish) return { reply: '本地模型这次没有完成回复。你可以再试一次，或在设置中换用更快的模型。' }
    return { reply: playback.track
      ? `我暂时连不上理解服务，但还在陪你听《${playback.track.title}》。连接恢复后，我再认真回答你。`
      : '我暂时连不上理解服务，但我还在。连接恢复后，我们再继续聊。' }
  }
}

async function readAgentEventStream(response: Response, onStreamEvent?: (event: AgentStreamEvent) => void): Promise<AgentRunResponse> {
  if (!response.body) throw new Error('Agent 流响应没有 Body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: AgentRunResponse | null = null
  const consume = (block: string) => {
    const data = block.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data) return
    const event = JSON.parse(data) as { type: string; event?: AgentStreamProgress; result?: AgentRunResponse; error?: string }
    if (event.type === 'started') onStreamEvent?.({ phase: 'started' })
    if (event.type === 'progress' && event.event) {
      const progress = event.event as { type: 'delta' | 'reset' | 'tool_start'; text?: string; name?: string }
      onStreamEvent?.({ phase: progress.type, text: progress.text, toolName: progress.name })
    }
    if (event.type === 'result' && event.result) result = event.result
    if (event.type === 'error') throw new Error(event.error || 'Agent 流请求失败')
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      let boundary
      while ((boundary = buffer.search(/\r?\n\r?\n/u)) !== -1) {
        consume(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/u, '')
      }
      if (done) break
    }
    if (buffer.trim()) consume(buffer)
  } finally {
    reader.releaseLock()
  }
  if (!result) throw new Error('Agent 流结束时没有最终结果')
  return result
}

async function reportAgentActionResult(input: PendingAgentActionResult) {
  if (!input.runId || !input.actionResultToken) return
  const result = await sendAgentActionResult(input)
  if (result !== 'retry') return
  const pending = await extensionStorage.getPendingAgentActionResults()
  await extensionStorage.setPendingAgentActionResults([input, ...pending.filter((item) => item.exchangeId !== input.exchangeId)].slice(0, 20))
}

async function flushPendingAgentActionResults() {
  const pending = await extensionStorage.getPendingAgentActionResults()
  if (!pending.length) return
  const remaining: PendingAgentActionResult[] = []
  for (const item of pending) if (await sendAgentActionResult(item) === 'retry') remaining.push(item)
  await extensionStorage.setPendingAgentActionResults(remaining)
}

async function sendAgentActionResult(input: PendingAgentActionResult) {
  const apiBaseUrl = (await extensionStorage.getApiBaseUrl()).replace(/\/$/, '')
  try {
    const response = await fetch(`${apiBaseUrl}/agent/action-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (response.ok) return 'sent' as const
    // 4xx 表示 token/请求已经无效，继续重试只会制造永久队列；5xx 才保留等待恢复。
    if (response.status >= 400 && response.status < 500) return 'drop' as const
    throw new Error(`Agent action result HTTP ${response.status}`)
  } catch (error) {
    // 本地对话已经保存成功；调用方把回写放入持久待同步队列，连接恢复后重试。
    logError('conversation', 'agent_action_result_sync_failed', error, { requestId: input.exchangeId, exchangeId: input.exchangeId, agentRunId: input.runId })
    return 'retry' as const
  }
}

function compactTrack(track: MusicTrack | null | undefined) {
  return track ? { uri: track.uri, isrc: track.isrc, title: track.title, artist: track.artist } : null
}

type MusicRequestAction = {
  type: 'music_request'
  intent: 'SEARCH' | 'RECOMMEND'
  query: string
  excludeUris: string[]
  agentRunId?: string
  promptVersion?: string
}
type PlaybackControlAction = { type: 'playback_control'; command: 'PAUSE' | 'RESUME' | 'NEXT' | 'PREVIOUS'; agentRunId?: string; promptVersion?: string }
type AgentClientAction = MusicRequestAction | PlaybackControlAction
type AgentRunResponse = {
  success?: boolean
  finalResponse?: string
  error?: string
  action?: AgentClientAction
  conversationContext?: { targetTrack: MusicTrack | null; resolution: { source: string; resolved: boolean; confidence: number; referenceType: string | null }; conversationState?: ConversationState | null }
  exchangeId?: string
  actionResultToken?: string
  meta?: { runId?: string; version?: string }
}
export type AgentStreamEvent = { phase: 'started' | 'delta' | 'reset' | 'tool_start' | 'complete'; text?: string; toolName?: string }
type AgentStreamProgress = { type: 'delta' | 'reset' | 'tool_start'; text?: string; name?: string }

function greeting(now: Date): ConversationMessage {
  // 每个本地自然日都从同一个开放式问题开始，既建立稳定的陪伴仪式，也避免在用户
  // 尚未播放音乐时预设音乐话题。跨日过滤由 getCompanionData 负责。
  return { id: GREETING_ID, role: 'mori', text: '今天心情怎么样？', createdAt: now.toISOString() }
}

function isSameLocalDay(value: string | undefined, now: Date) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return false
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
