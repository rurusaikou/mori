/**
 * Mori 四层函数的 LangGraph Node Wrapper。
 * Node 只读取 Graph State、调用原有领域函数并返回局部更新；路由关系由 graph-runtime
 * 声明，避免把 LangGraph API 渗透到 Perception / Brain / Expression / Action。
 */
import { createAgentState } from '../perception/state.mjs'
import { assembleConversationContext, understandConversation } from '../perception/conversation-understanding.mjs'
import { playbackFactIssue, responseQualityIssue, safePlaybackFallback, safeResponseFallback } from '../expression/response-quality.mjs'
import { DECISION_REPAIR_PROMPT, decisionSystemPrompt, FINAL_RESPONSE_PROMPT, RESPONSE_REPAIR_PROMPT } from '../expression/prompts.mjs'
import { AGENT_DECISION_SCHEMA, FINAL_RESPONSE_SCHEMA, agentStep, fallbackDecisionForUnderstanding, validateDecisionForUnderstanding, validateFinalResponse } from '../shared/agent-types.mjs'
import { capabilityStage } from '../shared/logger.mjs'
import { clientAction, createRuntimeTools, mergeRunTokenUsage, prepareRelevantMemory, prepareTargetRelevantMemory, relevantMemoryLogData, safeToolResponse } from './runtime-support.mjs'

export function createMoriGraphNodes({ llm, options, musicSearchMode, logRun }) {
  // Trace 与文件日志从同一个 record 入口产生，避免 Graph 可观测但 capability 日志缺阶段。
  const record = (state, type, data) => {
    capabilityStage(logRun, `agent_${type.toLowerCase()}`, data)
    return agentStep(state.runId, type, data)
  }
  const toolsFor = (state) => createRuntimeTools(state.agentState, options, musicSearchMode, state.context)

  return {
    perception(state) {
      // 本节点只把不可信 HTTP 输入规范化为只读事实。语义理解和 Context Assembly 留给
      // understanding 节点，避免事实校验、模型调用与记忆检索混成一个不可观测步骤。
      const agentState = createAgentState(state.input)
      return {
        agentState,
        trace: [
          record(state, 'INPUT', state.input),
          record(state, 'STATE_BEFORE', { worldState: agentState.worldState, playbackState: agentState.playbackState }),
        ],
      }
    },

    async understanding(state) {
      capabilityStage(logRun, 'agent_context_preparation_started', {
        historyCount: state.agentState.conversationHistory.length, currentTrack: state.agentState.currentTrack,
        memoryBackend: options.memoryRepository?.available ? options.memoryRepository.backend : 'local_or_unavailable',
      })
      const [result, relevantMemory] = await Promise.all([
        understandConversation(options.understandingLlm ?? llm, state.agentState, {
          onRawOutput: (data) => capabilityStage(logRun, 'agent_conversation_understanding_raw', data),
          onInvalidEmotionEvidence: (data) => capabilityStage(logRun, 'agent_emotion_evidence_dropped', data),
          onInvalidGrounding: (data) => capabilityStage(logRun, 'agent_grounding_evidence_dropped', data),
        }),
        prepareRelevantMemory(state.agentState, options),
      ])
      capabilityStage(logRun, 'agent_relevant_memory_prepared', relevantMemoryLogData(relevantMemory, state.agentState.currentTrack, 'INITIAL'))
      let context = assembleConversationContext(state.agentState, result.understanding, relevantMemory)
      const targetMemory = await prepareTargetRelevantMemory(state.agentState, options, relevantMemory, context.targetTrack)
      if (targetMemory !== relevantMemory) {
        capabilityStage(logRun, 'agent_target_memory_retrieval', {
          reason: 'resolved targetTrack differs from currentTrack', currentTrack: state.agentState.currentTrack, targetTrack: context.targetTrack,
        })
        capabilityStage(logRun, 'agent_relevant_memory_prepared', relevantMemoryLogData(targetMemory, context.targetTrack, 'RESOLVED_TARGET'))
        context = assembleConversationContext(state.agentState, result.understanding, targetMemory)
      }
      const resolutionLog = {
        referenceType: result.understanding.reference?.type ?? null,
        currentTrack: state.agentState.currentTrack ?? null,
        targetTrack: context.targetTrack,
        source: context.trackResolution.source,
        resolved: context.trackResolution.resolved,
      }
      return { conversationUnderstanding: result.understanding, context, understandingTokenUsage: result.tokenUsage, trace: [record(state, 'CONVERSATION_UNDERSTANDING', result.understanding), record(state, 'TRACK_REFERENCE_RESOLUTION', resolutionLog), record(state, 'CONTEXT_ASSEMBLY', context)] }
    },

    async decision(state) {
      const tools = toolsFor(state)
      capabilityStage(logRun, 'agent_tools_available', { tools: Object.values(tools).map(({ name, description }) => ({ name, description })) })
      capabilityStage(logRun, 'agent_decision_model_call', {
        scene: state.conversationUnderstanding.scene, listeningRequest: state.conversationUnderstanding.listeningRequest,
        topic: state.conversationUnderstanding.topic, communicativeAct: state.conversationUnderstanding.communicativeAct,
        eventFrame: state.conversationUnderstanding.eventFrame, conversationState: state.conversationUnderstanding.conversationState,
        reference: state.conversationUnderstanding.reference, targetTrack: state.context.targetTrack,
      })
      const first = await llm({
        prompt: decisionSystemPrompt(Object.values(tools)),
        input: {
          context: state.context,
          understanding: state.conversationUnderstanding,
          availableTools: Object.values(tools).map(({ name, description }) => ({ name, description })),
        },
        schema: AGENT_DECISION_SCHEMA,
        schemaName: 'mori_agent_decision_v0_2',
      })
      logRun.model = first.model
      const trace = []
      capabilityStage(logRun, 'agent_decision_raw', { output: first.data, model: first.model, tokenUsage: first.tokenUsage })
      let decision
      let model = first.model
      let tokenUsage = first.tokenUsage
      try {
        decision = validateDecisionForUnderstanding(first.data, state.conversationUnderstanding, state.context)
      } catch (error) {
        const issue = error instanceof Error ? error.message : 'Decision 无效'
        trace.push(record(state, 'DECISION_REPAIR', { issue, rejectedDecision: first.data }))
        const repaired = await llm({
          prompt: DECISION_REPAIR_PROMPT,
          input: { context: state.context, understanding: state.conversationUnderstanding, availableTools: Object.values(tools).map(({ name, description }) => ({ name, description })), issue, rejectedDecision: first.data },
          schema: AGENT_DECISION_SCHEMA,
          schemaName: 'mori_agent_decision_repair_v0_1',
        })
        capabilityStage(logRun, 'agent_decision_repair_raw', { output: repaired.data, model: repaired.model, tokenUsage: repaired.tokenUsage })
        try {
          decision = validateDecisionForUnderstanding(repaired.data, state.conversationUnderstanding, state.context)
        } catch (repairError) {
          decision = fallbackDecisionForUnderstanding(repaired.data, state.conversationUnderstanding, state.context)
          trace.push(record(state, 'DECISION_FALLBACK', { issue: repairError instanceof Error ? repairError.message : 'Decision 修复仍无效', decision }))
        }
        model = repaired.model
        logRun.model = repaired.model
        tokenUsage = { initialCall: first.tokenUsage ?? null, repairCall: repaired.tokenUsage ?? null }
      }
      capabilityStage(logRun, 'agent_decision_validated', { action: decision.action, intent: decision.intent, conversationMove: decision.conversationMove, toolCall: decision.toolCall })
      trace.push(record(state, 'MODEL_DECISION', decision))
      return { decision, model, firstTokenUsage: tokenUsage, trace }
    },

    async directResponse(state) {
      const qualityIssue = responseQualityIssue(state.decision, state.agentState)
      capabilityStage(logRun, 'agent_direct_response_selected', { response: state.decision.response })
      capabilityStage(logRun, 'agent_response_quality_checked', { passed: !qualityIssue, issue: qualityIssue })
      let finalResponse = state.decision.response
      let model = state.model
      let tokenUsage = state.firstTokenUsage
      const trace = []
      if (qualityIssue) {
        // 最多修订一次：消除重复/无依据表达，同时避免质量门形成不可控 Graph 循环。
        trace.push(record(state, 'RESPONSE_REPAIR', { issue: qualityIssue, rejectedResponse: finalResponse }))
        const repaired = await llm({
          prompt: RESPONSE_REPAIR_PROMPT,
          input: { context: state.context, understanding: state.conversationUnderstanding, issue: qualityIssue, rejectedResponse: finalResponse },
          schema: FINAL_RESPONSE_SCHEMA,
          schemaName: 'mori_agent_response_repair_v0_1',
        })
        logRun.model = repaired.model
        model = repaired.model
        capabilityStage(logRun, 'agent_response_repair_raw', { output: repaired.data, model: repaired.model, tokenUsage: repaired.tokenUsage })
        finalResponse = validateFinalResponse(repaired.data).response
        capabilityStage(logRun, 'agent_response_repair_validated', { response: finalResponse })
        tokenUsage = mergeRunTokenUsage(state.understandingTokenUsage, state.firstTokenUsage, repaired.tokenUsage)
        const remainingQualityIssue = responseQualityIssue({ ...state.decision, response: finalResponse }, state.agentState)
        capabilityStage(logRun, 'agent_response_repair_rechecked', { passed: !remainingQualityIssue, issue: remainingQualityIssue })
        if (remainingQualityIssue && !playbackFactIssue(finalResponse, state.agentState)) {
          const fallback = safeResponseFallback(remainingQualityIssue)
          trace.push(record(state, 'RESPONSE_QUALITY_FALLBACK', { issue: remainingQualityIssue, rejectedResponse: finalResponse, response: fallback }))
          finalResponse = fallback
        }
      } else {
        tokenUsage = mergeRunTokenUsage(state.understandingTokenUsage, state.firstTokenUsage)
      }
      const remainingPlaybackIssue = playbackFactIssue(finalResponse, state.agentState)
      capabilityStage(logRun, 'agent_playback_fact_checked', { passed: !remainingPlaybackIssue, issue: remainingPlaybackIssue, playbackStatus: state.agentState.playbackState.status })
      if (remainingPlaybackIssue) {
        const fallback = safePlaybackFallback(remainingPlaybackIssue)
        trace.push(record(state, 'RESPONSE_FACT_FALLBACK', { issue: remainingPlaybackIssue, rejectedResponse: finalResponse, response: fallback }))
        finalResponse = fallback
      }
      trace.push(record(state, 'STATE_AFTER', { playbackState: state.agentState.playbackState, plannedAction: null }))
      trace.push(record(state, 'FINAL_RESPONSE', { response: finalResponse }))
      return { finalResponse, model, tokenUsage, action: null, trace }
    },

    async tool(state) {
      const tools = toolsFor(state)
      const tool = tools[state.decision.toolCall.name]
      if (!tool) throw new Error(`Tool 未注册：${state.decision.toolCall.name}`)
      const toolResult = await tool.execute(state.decision.toolCall.arguments)
      // Tool 只选择可信候选。clientAction 是待 Extension 校验和执行的计划，当前播放事实
      // 在本次服务端 Run 内保持不变，所以 STATE_AFTER 不能声称歌曲已经播放。
      const action = clientAction(toolResult, tool.name)
      return {
        toolName: tool.name,
        toolResult,
        action,
        trace: [
          record(state, 'TOOL_CALL', { name: tool.name }),
          record(state, 'TOOL_ARGUMENTS', state.decision.toolCall.arguments),
          record(state, 'TOOL_RESULT', { name: tool.name, result: toolResult }),
          record(state, 'FINAL_MODEL_CALL', { tool: tool.name }),
          record(state, 'STATE_AFTER', { playbackState: state.agentState.playbackState, plannedAction: action }),
        ],
      }
    },

    async finalResponse(state) {
      // 最终模型同时看到 Intent、Tool Result、planned action 与未改变的播放事实，防止文案
      // 把“准备播放”描述成“已经播放”。无候选时 safeToolResponse 再封住承诺播放的出口。
      const final = await llm({
        prompt: FINAL_RESPONSE_PROMPT,
        input: {
          context: state.context,
          intent: state.decision.intent,
          decision: state.decision,
          toolResult: state.toolResult,
          actionResult: state.action ? { status: 'planned', action: state.action } : null,
          stateAfter: state.agentState.playbackState,
        },
        schema: FINAL_RESPONSE_SCHEMA,
        schemaName: 'mori_agent_final_response_v0_2',
      })
      logRun.model = final.model
      capabilityStage(logRun, 'agent_final_response_raw', { output: final.data, model: final.model, tokenUsage: final.tokenUsage })
      const validated = validateFinalResponse(final.data)
      capabilityStage(logRun, 'agent_final_response_validated', { response: validated.response })
      const finalResponse = safeToolResponse(state.toolResult, validated.response)
      if (finalResponse !== validated.response) capabilityStage(logRun, 'agent_tool_response_safety_applied', { originalResponse: validated.response, response: finalResponse, tool: state.toolName, toolStatus: state.toolResult?.status })
      return {
        finalResponse,
        model: final.model,
        tokenUsage: mergeRunTokenUsage(state.understandingTokenUsage, state.firstTokenUsage, final.tokenUsage),
        trace: [record(state, 'FINAL_RESPONSE', { response: finalResponse })],
      }
    },
  }
}

export function routeAfterDecision(state) {
  // 第一阶段只有两个出口且每轮至多一个 Tool；后续若增加循环，必须先定义步数和幂等边界。
  return state.decision.action === 'respond' ? 'direct_response' : 'tool'
}
