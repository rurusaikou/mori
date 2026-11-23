/**
 * Conversation Agent 的应用层编排器。
 *
 * 固定流程：State 校验 → Understanding LLM → Model Decision → Optional Tool → Final Response。
 * 这里不维护语言识别规则，也不直接访问产品状态；所有输入先转成只读 State，Tool 由
 * composition root 显式装配。每轮最多执行一个 Tool，保证动作可追踪且不会形成失控循环。
 */
import { randomUUID } from 'node:crypto'
import { createAgentState } from '../perception/state.mjs'
import { decisionSystemPrompt, FINAL_RESPONSE_PROMPT, MORI_AGENT_PROMPT_VERSION, RESPONSE_REPAIR_PROMPT } from '../expression/prompts.mjs'
import { responseQualityIssue } from '../expression/response-quality.mjs'
import { AGENT_DECISION_SCHEMA, FINAL_RESPONSE_SCHEMA, agentStep, validateDecision, validateFinalResponse } from '../shared/agent-types.mjs'
import { capabilityStage } from '../shared/logger.mjs'
import { assembleConversationContext, understandConversation } from '../perception/conversation-understanding.mjs'
import { clientAction, completeRun, createRuntimeTools, mergeRunTokenUsage, safeToolResponse, validateRuntimeOptions } from './runtime-support.mjs'

export function createLegacyMoriAgent(llm, options = {}) {
  const { musicSearchMode } = validateRuntimeOptions(options)
  return {
    async execute(input) {
      const runId = randomUUID()
      const started = Date.now()
      const trace = []
      const logRun = { runId, capability: 'conversation_agent', promptVersion: MORI_AGENT_PROMPT_VERSION, model: 'unresolved', logSource: options.logSource }
      const push = (type, data) => {
        const step = agentStep(runId, type, data)
        trace.push(step)
        capabilityStage(logRun, `agent_${type.toLowerCase()}`, data)
        return step
      }
      try {
        // 第一阶段只建立事实；语义统一交给结构化 Understanding LLM。
        push('INPUT', input)
        const state = createAgentState(input)
        const tools = createRuntimeTools(state, options, musicSearchMode)
        push('STATE_BEFORE', { worldState: state.worldState, playbackState: state.playbackState })
        const understood = await understandConversation(options.understandingLlm ?? llm, state)
        const conversationUnderstanding = understood.understanding
        push('CONVERSATION_UNDERSTANDING', conversationUnderstanding)
        const context = assembleConversationContext(state, conversationUnderstanding)
        push('CONTEXT_ASSEMBLY', context)

        // 模型负责在已确定的 Intent 边界内选择“回复或 Tool”；代码随后再次执行副作用边界校验。
        const first = await llm({
          prompt: decisionSystemPrompt(Object.values(tools)),
          input: {
            context,
            understanding: conversationUnderstanding,
            availableTools: Object.values(tools).map(({ name, description }) => ({ name, description })),
          },
          schema: AGENT_DECISION_SCHEMA,
          schemaName: 'mori_agent_decision_v0_2',
        })
        logRun.model = first.model
        const decision = validateDecision(first.data)
        push('MODEL_DECISION', decision)

        if (decision.action === 'respond') {
          const qualityIssue = responseQualityIssue(decision, state)
          let response = decision.response
          let tokenUsage = mergeRunTokenUsage(understood.tokenUsage, first.tokenUsage)
          if (qualityIssue) {
            // 质量门只允许一次重生成，避免死循环。Bad Case 作为输入反馈，不进入长期 Prompt。
            push('RESPONSE_REPAIR', { issue: qualityIssue, rejectedResponse: response })
            const repaired = await llm({
              prompt: RESPONSE_REPAIR_PROMPT,
              input: { context, understanding: conversationUnderstanding, issue: qualityIssue, rejectedResponse: response },
              schema: FINAL_RESPONSE_SCHEMA,
              schemaName: 'mori_agent_response_repair_v0_1',
            })
            logRun.model = repaired.model
            response = validateFinalResponse(repaired.data).response
            tokenUsage = mergeRunTokenUsage(understood.tokenUsage, first.tokenUsage, repaired.tokenUsage)
          }
          push('STATE_AFTER', { playbackState: state.playbackState, plannedAction: null })
          push('FINAL_RESPONSE', { response })
          return completeRun(logRun, runId, started, logRun.model, tokenUsage, response, trace, null)
        }

        // Tool Result 是外部事实的唯一来源。最终模型只能基于该结果组织语言，不能补造候选或动作。
        const tool = tools[decision.toolCall.name]
        if (!tool) throw new Error(`Tool 未注册：${decision.toolCall.name}`)
        push('TOOL_CALL', { name: tool.name })
        push('TOOL_ARGUMENTS', decision.toolCall.arguments)
        const toolResult = await tool.execute(decision.toolCall.arguments)
        push('TOOL_RESULT', { name: tool.name, result: toolResult })
        push('FINAL_MODEL_CALL', { tool: tool.name })

        const plannedAction = clientAction(toolResult, tool.name)
        // API 此时只完成候选选择，真正播放尚未发生。State After 保持事实不变，
        // Extension 执行动作成功后再把回复升级为“已经播放”。
        const stateAfter = state.playbackState
        push('STATE_AFTER', { playbackState: stateAfter, plannedAction })
        const final = await llm({
          prompt: FINAL_RESPONSE_PROMPT,
          input: {
            context,
            intent: decision.intent,
            decision,
            toolResult,
            actionResult: plannedAction ? { status: 'planned', action: plannedAction } : null,
            stateAfter,
          },
          schema: FINAL_RESPONSE_SCHEMA,
          schemaName: 'mori_agent_final_response_v0_2',
        })
        logRun.model = final.model
        const validated = validateFinalResponse(final.data)
        const response = safeToolResponse(toolResult, validated.response)
        push('FINAL_RESPONSE', { response })
        return completeRun(logRun, runId, started, final.model, mergeRunTokenUsage(understood.tokenUsage, first.tokenUsage, final.tokenUsage), response, trace, plannedAction)
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause)
        push('ERROR', { error })
        const meta = { runId, version: MORI_AGENT_PROMPT_VERSION, model: logRun.model, latency: Date.now() - started }
        capabilityStage(logRun, 'failed', { input, latency: meta.latency, error })
        return { success: false, error, trace, meta }
      }
    },
  }
}

// 兼容旧 import；正式 composition root 通过 runtime/index.mjs 选择 Graph 或 Legacy。
export const createMoriAgent = createLegacyMoriAgent
