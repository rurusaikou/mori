/**
 * 作用：定义 Agent V0.1 的统一决策 Schema、最终回复 Schema 和 Trace Step 构造方式。
 * 输入：模型决策、工具调用与运行阶段数据。
 * 输出：稳定的 Structured Output 和可供日志、评估、Playground 展示的 AgentStep。
 */
import { object, text } from './executor.mjs'

export const TOOL_NAMES = ['search_memory', 'get_music_context', 'get_track_insight', 'search_music', 'recommend_music', 'playback_control']
export const INTENT_NAMES = ['CHAT', 'SEARCH', 'RECOMMEND', 'CONTROL', 'FEEDBACK']
export const CONVERSATION_MOVES = ['ANSWER', 'FOLLOW_UP', 'ACKNOWLEDGE', 'CLARIFY', 'CONNECT', 'PLAYFUL']

export const AGENT_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['respond', 'tool'] },
    intent: { type: 'string', enum: INTENT_NAMES },
    conversationMove: { type: 'string', enum: CONVERSATION_MOVES },
    reason: { type: 'string' },
    response: { anyOf: [{ type: 'null' }, { type: 'string' }] },
    toolCall: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            name: { type: 'string', enum: TOOL_NAMES },
            arguments: {
              type: 'object',
              properties: {
                query: { anyOf: [{ type: 'null' }, { type: 'string' }] },
                excludeUris: { type: 'array', items: { type: 'string' } },
                command: { type: 'string', enum: ['PAUSE', 'RESUME', 'NEXT', 'PREVIOUS'] },
              },
              required: [],
              additionalProperties: false,
            },
          },
          required: ['name', 'arguments'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['action', 'intent', 'conversationMove', 'reason', 'response', 'toolCall'],
  allOf: [
    {
      anyOf: [
        { properties: { action: { enum: ['respond'] }, response: { type: 'string' }, toolCall: { type: 'null' } }, required: ['action', 'response', 'toolCall'] },
        { properties: { action: { enum: ['tool'] }, response: { type: 'null' }, toolCall: { type: 'object' } }, required: ['action', 'response', 'toolCall'] },
      ],
    },
  ],
  additionalProperties: false,
}

export const FINAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: { response: { type: 'string' } },
  required: ['response'],
  additionalProperties: false,
}

export function validateDecision(value) {
  object(value, 'model decision')
  if (!['respond', 'tool'].includes(value.action)) throw new Error('Agent decision action 无效')
  const reason = typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim() : '模型未提供决策原因'
  const inferredIntent = value.action === 'tool' ? ({ search_music: 'SEARCH', recommend_music: 'RECOMMEND', playback_control: 'CONTROL' }[value.toolCall?.name] ?? 'CHAT') : 'CHAT'
  const intent = INTENT_NAMES.includes(value.intent) ? value.intent : inferredIntent
  const conversationMove = CONVERSATION_MOVES.includes(value.conversationMove) ? value.conversationMove : 'ANSWER'
  if (value.action === 'respond') return { action: 'respond', intent, conversationMove, reason, response: text(value.response, 'decision.response'), toolCall: null }
  const toolCall = object(value.toolCall, 'decision.toolCall')
  if (!TOOL_NAMES.includes(toolCall.name)) throw new Error(`Agent 请求了未注册 Tool：${toolCall.name}`)
  object(toolCall.arguments, 'decision.toolCall.arguments')
  const argumentsValue = ['search_music', 'recommend_music'].includes(toolCall.name)
    ? { ...toolCall.arguments, excludeUris: Array.isArray(toolCall.arguments.excludeUris) ? toolCall.arguments.excludeUris : [] }
    : toolCall.name === 'search_memory'
      ? { query: text(toolCall.arguments.query, 'decision.toolCall.arguments.query') }
    : toolCall.name === 'playback_control' ? { command: toolCall.arguments.command } : {}
  return { action: 'tool', intent, conversationMove, reason, response: null, toolCall: { ...toolCall, arguments: argumentsValue } }
}

export function validateDecisionForUnderstanding(value, understanding, context = {}) {
  const decision = validateDecision(value)
  const requestType = understanding?.listeningRequest?.type ?? null
  const expectedMusicTool = requestType === 'SEARCH' ? 'search_music' : requestType === 'RECOMMEND' ? 'recommend_music' : requestType === 'CONTROL' ? 'playback_control' : null
  if (expectedMusicTool && (decision.action !== 'tool' || decision.toolCall.name !== expectedMusicTool)) {
    throw new Error(`listeningRequest=${requestType} 必须调用 ${expectedMusicTool}`)
  }
  // 所有音乐副作用都必须来自 Structured Understanding。播放控制虽然可恢复，仍会改变
  // 用户正在听到的内容，不能因为 Decision 单独猜测就越过 listeningRequest 边界。
  if (!expectedMusicTool && decision.action === 'tool' && ['search_music', 'recommend_music', 'playback_control'].includes(decision.toolCall.name)) {
    throw new Error('listeningRequest 为空时不能调用音乐动作 Tool')
  }
  // Relevant Memory 已在每轮 Context Preparation 中自动召回。search_memory 只用于用户明确
  // 询问过去经历或共同记忆的场景，不能把普通聊天、情绪表达或召回为空升级成额外检索。
  if (decision.action === 'tool' && decision.toolCall.name === 'search_memory' && !explicitMemoryLookup(context.latestMessage)) {
    throw new Error('当前消息没有明确询问历史或记忆，不能调用 search_memory')
  }
  if (expectedMusicTool) {
    // Decision 只选择动作，不拥有重新解释歌曲条件或控制命令的权限。Tool 参数始终由
    // Structured Understanding 与 Playback State 确定生成，避免“轻快”被改成“伤感”、
    // NEXT 被改成 PAUSE，或模型遗漏当前歌曲排除项。
    return { ...decision, toolCall: { ...decision.toolCall, arguments: musicToolArguments(understanding.listeningRequest, context) } }
  }
  return decision
}

function explicitMemoryLookup(message) {
  if (typeof message !== 'string') return false
  return /(还记得|记不记得|你记得|回忆|以前|之前|上次|曾经|过去|那次|第一次|我们聊过|我说过|我提过|你知道我|什么时候.*(?:听|说|聊|提)|哪一次)/u.test(message)
}

export function fallbackDecisionForUnderstanding(value, understanding, context = {}) {
  const request = understanding?.listeningRequest
  if (!request) {
    if (typeof value?.response === 'string' && value.response.trim()) {
      return { action: 'respond', intent: 'CHAT', conversationMove: 'ANSWER', reason: 'Decision 修复失败，保留无副作用回复', response: value.response.trim(), toolCall: null }
    }
    throw new Error('Decision 修复失败且没有安全回复')
  }
  const name = request.type === 'SEARCH' ? 'search_music' : request.type === 'RECOMMEND' ? 'recommend_music' : 'playback_control'
  return {
    action: 'tool',
    intent: request.type,
    conversationMove: 'ACKNOWLEDGE',
    reason: 'Decision 修复失败，按 Structured Understanding 的明确音乐请求安全降级',
    response: null,
    toolCall: { name, arguments: musicToolArguments(request, context) },
  }
}

function musicToolArguments(request, context = {}) {
  if (request.type === 'CONTROL') return { command: request.control }
  const query = [request.song, request.artist, ...(request.preferences ?? [])].filter(Boolean).map((value) => String(value).trim()).filter(Boolean).join(' ')
  const currentUri = context.playbackState?.currentTrack?.uri ?? context.currentTrack?.uri
  return { query, excludeUris: request.excludeCurrentTrack && currentUri ? [currentUri] : [] }
}

export function validateFinalResponse(value) { return { response: text(object(value, 'final response').response, 'final response.response') } }

export function agentStep(runId, type, data) {
  return { id: `${runId}:${type.toLowerCase()}:${cryptoId()}`, type, timestamp: new Date().toISOString(), data }
}

function cryptoId() { return Math.random().toString(36).slice(2, 9) }
