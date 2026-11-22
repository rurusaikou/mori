/**
 * Mori 四层函数的 LangGraph Node Wrapper。
 * Node 只读取 Graph State、调用原有领域函数并返回局部更新；路由关系由 graph-runtime
 * 声明，避免把 LangGraph API 渗透到 Perception / Brain / Expression / Action。
 */
import { createAgentState } from '../perception/state.mjs'
import { assembleConversationContext, understandConversation } from '../perception/conversation-understanding.mjs'
import { responseQualityIssue } from '../expression/response-quality.mjs'
import { decisionSystemPrompt, FINAL_RESPONSE_PROMPT, RESPONSE_REPAIR_PROMPT } from '../expression/prompts.mjs'
import { AGENT_DECISION_SCHEMA, FINAL_RESPONSE_SCHEMA, agentStep, validateDecision, validateFinalResponse } from '../shared/agent-types.mjs'
import { capabilityStage } from '../shared/logger.mjs'
import { clientAction, createRuntimeTools, mergeTokenUsage, safeToolResponse } from './runtime-support.mjs'

export function createMoriGraphNodes({ llm, options, musicSearchMode, resolveMusicFeatures, logRun }) {
  // Trace 与文件日志从同一个 record 入口产生，避免 Graph 可观测但 capability 日志缺阶段。
  const record = (state, type, data) => {
    capabilityStage(logRun, `agent_${type.toLowerCase()}`, data)
    return agentStep(state.runId, type, data)
  }
  const toolsFor = (state) => createRuntimeTools(state.agentState, options, musicSearchMode, resolveMusicFeatures)

  return {
    perception(state) {
      // 本节点一次完成输入校验、Scene 理解和 Context Assembly；这些仍由原领域函数负责，
      // Wrapper 只把结果写入显式 State，不在 Graph 层复制语言规则。
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
      const result = await understandConversation(options.understandingLlm ?? llm, state.agentState)
      const context = assembleConversationContext(state.agentState, result.understanding)
      return { conversationUnderstanding: result.understanding, context, understandingTokenUsage: result.tokenUsage, trace: [record(state, 'CONVERSATION_UNDERSTANDING', result.understanding), record(state, 'CONTEXT_ASSEMBLY', context)] }
    },

    async decision(state) {
      const tools = toolsFor(state)
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
      // LLM 的结构化 Decision 仍需经过确定性边界校验。Graph Edge 不能替代 Intent 安全规则，
      // 否则模型可以通过返回任意 Tool 名绕过 Router。
      const decision = validateDecision(first.data)
      return { decision, model: first.model, firstTokenUsage: first.tokenUsage, trace: [record(state, 'MODEL_DECISION', decision)] }
    },

    async directResponse(state) {
      const qualityIssue = responseQualityIssue(state.decision, state.agentState)
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
        finalResponse = validateFinalResponse(repaired.data).response
        tokenUsage = mergeTokenUsage(state.firstTokenUsage, repaired.tokenUsage)
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
      const finalResponse = safeToolResponse(state.toolResult, validateFinalResponse(final.data).response)
      return {
        finalResponse,
        model: final.model,
        tokenUsage: mergeTokenUsage(state.firstTokenUsage, final.tokenUsage),
        trace: [record(state, 'FINAL_RESPONSE', { response: finalResponse })],
      }
    },
  }
}

export function routeAfterDecision(state) {
  // 第一阶段只有两个出口且每轮至多一个 Tool；后续若增加循环，必须先定义步数和幂等边界。
  return state.decision.action === 'respond' ? 'direct_response' : 'tool'
}
