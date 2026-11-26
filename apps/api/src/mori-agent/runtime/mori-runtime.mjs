/**
 * Conversation Agent 的应用层编排器。
 *
 * 固定流程：State 校验 → Understanding LLM → Model Decision → Optional Tool → Final Response。
 * 这里不维护语言识别规则，也不直接访问产品状态；所有输入先转成只读 State，Tool 由
 * composition root 显式装配。每轮最多执行一个 Tool，保证动作可追踪且不会形成失控循环。
 */
import { randomUUID } from 'node:crypto'
import { createAgentState } from '../perception/state.mjs'
import { DECISION_REPAIR_PROMPT, decisionSystemPrompt, FINAL_RESPONSE_PROMPT, MORI_AGENT_PROMPT_VERSION, RESPONSE_REPAIR_PROMPT } from '../expression/prompts.mjs'
import { playbackFactIssue, responseQualityIssue, safePlaybackFallback, safeResponseFallback } from '../expression/response-quality.mjs'
import { AGENT_DECISION_SCHEMA, FINAL_RESPONSE_SCHEMA, agentStep, fallbackDecisionForUnderstanding, validateDecisionForUnderstanding, validateFinalResponse } from '../shared/agent-types.mjs'
import { capabilityStage } from '../shared/logger.mjs'
import { assembleConversationContext, understandConversation } from '../perception/conversation-understanding.mjs'
import { clientAction, completeRun, createRuntimeTools, mergeRunTokenUsage, modelConversationContext, prepareRelevantMemory, prepareTargetRelevantMemory, relevantMemoryLogData, safeToolResponse, validateRuntimeOptions } from './runtime-support.mjs'

export function createLegacyMoriAgent(llm, options = {}) {
  const { musicSearchMode } = validateRuntimeOptions(options)
  return {
    async execute(input, correlation = {}) {
      const runId = randomUUID()
      const started = Date.now()
      const trace = []
      const logRun = { runId, capability: 'conversation_agent', promptVersion: MORI_AGENT_PROMPT_VERSION, model: 'unresolved', logSource: options.logSource, requestId: correlation.requestId ?? null, exchangeId: correlation.exchangeId ?? null }
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
        push('STATE_BEFORE', { worldState: state.worldState, playbackState: state.playbackState })
        capabilityStage(logRun, 'agent_context_preparation_started', {
          historyCount: state.conversationHistory.length, currentTrack: state.currentTrack,
          memoryBackend: options.memoryRepository?.available ? options.memoryRepository.backend : 'local_or_unavailable',
        })
        const [understood, relevantMemory] = await Promise.all([
          understandConversation(options.understandingLlm ?? llm, state, {
            onRawOutput: (data) => capabilityStage(logRun, 'agent_conversation_understanding_raw', data),
            onInvalidEmotionEvidence: (data) => capabilityStage(logRun, 'agent_emotion_evidence_dropped', data),
            onInvalidGrounding: (data) => capabilityStage(logRun, 'agent_grounding_evidence_dropped', data),
            onInvalidActionGrounding: (data) => capabilityStage(logRun, 'agent_action_grounding_dropped', data),
          }),
          prepareRelevantMemory(state, options),
        ])
        capabilityStage(logRun, 'agent_relevant_memory_prepared', relevantMemoryLogData(relevantMemory, state.currentTrack, 'INITIAL'))
        const conversationUnderstanding = understood.understanding
        push('CONVERSATION_UNDERSTANDING', conversationUnderstanding)
        let context = assembleConversationContext(state, conversationUnderstanding, relevantMemory)
        const targetMemory = await prepareTargetRelevantMemory(state, options, relevantMemory, context.targetTrack)
        if (targetMemory !== relevantMemory) {
          capabilityStage(logRun, 'agent_target_memory_retrieval', {
            reason: 'resolved targetTrack differs from currentTrack', currentTrack: state.currentTrack, targetTrack: context.targetTrack,
          })
          capabilityStage(logRun, 'agent_relevant_memory_prepared', relevantMemoryLogData(targetMemory, context.targetTrack, 'RESOLVED_TARGET'))
          context = assembleConversationContext(state, conversationUnderstanding, targetMemory)
        }
        push('TRACK_REFERENCE_RESOLUTION', {
          referenceType: conversationUnderstanding.reference?.type ?? null,
          currentTrack: state.currentTrack,
          targetTrack: context.targetTrack,
          source: context.trackResolution.source,
          resolved: context.trackResolution.resolved,
        })
        push('CONTEXT_ASSEMBLY', context)
        const modelContext = modelConversationContext(context)
        const tools = createRuntimeTools(state, options, musicSearchMode, context)
        capabilityStage(logRun, 'agent_tools_available', { tools: Object.values(tools).map(({ name, description }) => ({ name, description })) })

        // 模型负责在已确定的 Intent 边界内选择“回复或 Tool”；代码随后再次执行副作用边界校验。
        capabilityStage(logRun, 'agent_decision_model_call', {
          scene: conversationUnderstanding.scene, listeningRequest: conversationUnderstanding.listeningRequest,
          topic: conversationUnderstanding.topic, communicativeAct: conversationUnderstanding.communicativeAct,
          eventFrame: conversationUnderstanding.eventFrame, conversationState: conversationUnderstanding.conversationState,
          reference: conversationUnderstanding.reference, targetTrack: context.targetTrack,
        })
        const first = await llm({
          prompt: decisionSystemPrompt(Object.values(tools)),
          input: {
            context: modelContext,
            understanding: conversationUnderstanding,
            availableTools: Object.values(tools).map(({ name, description }) => ({ name, description })),
          },
          schema: AGENT_DECISION_SCHEMA,
          schemaName: 'mori_agent_decision_v0_2',
        })
        logRun.model = first.model
        capabilityStage(logRun, 'agent_decision_raw', { output: first.data, model: first.model, tokenUsage: first.tokenUsage })
        let decision
        let decisionTokenUsage = first.tokenUsage
        try {
          decision = validateDecisionForUnderstanding(first.data, conversationUnderstanding, context)
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'Decision 无效'
          push('DECISION_REPAIR', { issue, rejectedDecision: first.data })
          const repaired = await llm({
            prompt: DECISION_REPAIR_PROMPT,
            input: { context: modelContext, understanding: conversationUnderstanding, availableTools: Object.values(tools).map(({ name, description }) => ({ name, description })), issue, rejectedDecision: first.data },
            schema: AGENT_DECISION_SCHEMA,
            schemaName: 'mori_agent_decision_repair_v0_1',
          })
          capabilityStage(logRun, 'agent_decision_repair_raw', { output: repaired.data, model: repaired.model, tokenUsage: repaired.tokenUsage })
          try {
            decision = validateDecisionForUnderstanding(repaired.data, conversationUnderstanding, context)
          } catch (repairError) {
            decision = fallbackDecisionForUnderstanding(repaired.data, conversationUnderstanding, context)
            push('DECISION_FALLBACK', { issue: repairError instanceof Error ? repairError.message : 'Decision 修复仍无效', decision })
          }
          logRun.model = repaired.model
          decisionTokenUsage = { initialCall: first.tokenUsage ?? null, repairCall: repaired.tokenUsage ?? null }
        }
        capabilityStage(logRun, 'agent_decision_validated', { action: decision.action, intent: decision.intent, conversationMove: decision.conversationMove, toolCall: decision.toolCall })
        push('MODEL_DECISION', decision)

        if (decision.action === 'respond') {
          const qualityIssue = responseQualityIssue(decision, state)
          capabilityStage(logRun, 'agent_direct_response_selected', { response: decision.response })
          capabilityStage(logRun, 'agent_response_quality_checked', { passed: !qualityIssue, issue: qualityIssue })
          let response = decision.response
          let tokenUsage = mergeRunTokenUsage(understood.tokenUsage, decisionTokenUsage)
          if (qualityIssue) {
            // 质量门只允许一次重生成，避免死循环。Bad Case 作为输入反馈，不进入长期 Prompt。
            push('RESPONSE_REPAIR', { issue: qualityIssue, rejectedResponse: response })
            const repaired = await llm({
              prompt: RESPONSE_REPAIR_PROMPT,
              input: { context: modelContext, understanding: conversationUnderstanding, issue: qualityIssue, rejectedResponse: response },
              schema: FINAL_RESPONSE_SCHEMA,
              schemaName: 'mori_agent_response_repair_v0_1',
            })
            logRun.model = repaired.model
            capabilityStage(logRun, 'agent_response_repair_raw', { output: repaired.data, model: repaired.model, tokenUsage: repaired.tokenUsage })
            response = validateFinalResponse(repaired.data).response
            capabilityStage(logRun, 'agent_response_repair_validated', { response })
            tokenUsage = mergeRunTokenUsage(understood.tokenUsage, decisionTokenUsage, repaired.tokenUsage)
            const remainingQualityIssue = responseQualityIssue({ ...decision, response }, state)
            capabilityStage(logRun, 'agent_response_repair_rechecked', { passed: !remainingQualityIssue, issue: remainingQualityIssue })
            if (remainingQualityIssue && !playbackFactIssue(response, state)) {
              const fallback = safeResponseFallback(remainingQualityIssue)
              push('RESPONSE_QUALITY_FALLBACK', { issue: remainingQualityIssue, rejectedResponse: response, response: fallback })
              response = fallback
            }
          }
          const remainingPlaybackIssue = playbackFactIssue(response, state)
          capabilityStage(logRun, 'agent_playback_fact_checked', { passed: !remainingPlaybackIssue, issue: remainingPlaybackIssue, playbackStatus: state.playbackState.status })
          if (remainingPlaybackIssue) {
            const fallback = safePlaybackFallback(remainingPlaybackIssue)
            push('RESPONSE_FACT_FALLBACK', { issue: remainingPlaybackIssue, rejectedResponse: response, response: fallback })
            response = fallback
          }
          push('STATE_AFTER', { playbackState: state.playbackState, plannedAction: null })
          push('FINAL_RESPONSE', { response })
          return completeRun(logRun, runId, started, logRun.model, tokenUsage, response, trace, null, context)
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
            context: modelContext,
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
        capabilityStage(logRun, 'agent_final_response_raw', { output: final.data, model: final.model, tokenUsage: final.tokenUsage })
        const validated = validateFinalResponse(final.data)
        capabilityStage(logRun, 'agent_final_response_validated', { response: validated.response })
        const response = safeToolResponse(toolResult, validated.response)
        if (response !== validated.response) capabilityStage(logRun, 'agent_tool_response_safety_applied', { originalResponse: validated.response, response, tool: tool.name, toolStatus: toolResult?.status })
        // 有客户端动作时，这只是 API 返回给 Extension 的过渡文案；用户最终看到的回复
        // 要等 Spotify 确认后由 /agent/action-result 单独记录，不能继续叫 final response。
        capabilityStage(logRun, 'agent_planned_response', { response, plannedAction })
        trace.push(agentStep(runId, 'FINAL_RESPONSE', { response }))
        return completeRun(logRun, runId, started, final.model, mergeRunTokenUsage(understood.tokenUsage, decisionTokenUsage, final.tokenUsage), response, trace, plannedAction, context)
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
