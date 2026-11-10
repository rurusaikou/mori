/**
 * 作用：定义 Agent V0.1 的统一决策 Schema、最终回复 Schema 和 Trace Step 构造方式。
 * 输入：模型决策、工具调用与运行阶段数据。
 * 输出：稳定的 Structured Output 和可供日志、评估、Playground 展示的 AgentStep。
 */
import { object, text } from './executor.mjs'

export const AGENT_VERSION = 'mori-agent-v0.1'
export const TOOL_NAMES = ['search_memory', 'get_music_context', 'search_music']

export const AGENT_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['respond', 'tool'] },
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
              properties: { query: { anyOf: [{ type: 'null' }, { type: 'string' }] } },
              required: ['query'],
              additionalProperties: false,
            },
          },
          required: ['name', 'arguments'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['action', 'reason', 'response', 'toolCall'],
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
  if (value.action === 'respond') return { action: 'respond', reason: value.reason, response: text(value.response, 'decision.response'), toolCall: null }
  const toolCall = object(value.toolCall, 'decision.toolCall')
  if (!TOOL_NAMES.includes(toolCall.name)) throw new Error(`Agent 请求了未注册 Tool：${toolCall.name}`)
  object(toolCall.arguments, 'decision.toolCall.arguments')
  return { action: 'tool', reason: value.reason, response: null, toolCall }
}

export function validateFinalResponse(value) { return { response: text(object(value, 'final response').response, 'final response.response') } }

export function agentStep(runId, type, data) {
  return { id: `${runId}:${type.toLowerCase()}:${cryptoId()}`, type, timestamp: new Date().toISOString(), data }
}

function cryptoId() { return Math.random().toString(36).slice(2, 9) }
