/**
 * 作用：定义 Agent V0.1 的统一决策 Schema、最终回复 Schema 和 Trace Step 构造方式。
 * 输入：模型决策、工具调用与运行阶段数据。
 * 输出：稳定的 Structured Output 和可供日志、评估、Playground 展示的 AgentStep。
 */
import { object, text } from './executor.mjs'

export const TOOL_NAMES = ['search_memory', 'get_music_context', 'get_track_insight', 'search_music', 'recommend_music']
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
              },
              required: ['query', 'excludeUris'],
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
  text(value.reason, 'decision.reason')
  const intent = INTENT_NAMES.includes(value.intent) ? value.intent : null
  const conversationMove = CONVERSATION_MOVES.includes(value.conversationMove) ? value.conversationMove : 'ANSWER'
  if (value.action === 'respond') return { action: 'respond', intent, conversationMove, reason: value.reason, response: text(value.response, 'decision.response'), toolCall: null }
  const toolCall = object(value.toolCall, 'decision.toolCall')
  if (!TOOL_NAMES.includes(toolCall.name)) throw new Error(`Agent 请求了未注册 Tool：${toolCall.name}`)
  object(toolCall.arguments, 'decision.toolCall.arguments')
  return { action: 'tool', intent, conversationMove, reason: value.reason, response: null, toolCall: { ...toolCall, arguments: { ...toolCall.arguments, excludeUris: Array.isArray(toolCall.arguments.excludeUris) ? toolCall.arguments.excludeUris : [] } } }
}

export function validateFinalResponse(value) { return { response: text(object(value, 'final response').response, 'final response.response') } }

export function agentStep(runId, type, data) {
  return { id: `${runId}:${type.toLowerCase()}:${cryptoId()}`, type, timestamp: new Date().toISOString(), data }
}

function cryptoId() { return Math.random().toString(36).slice(2, 9) }
