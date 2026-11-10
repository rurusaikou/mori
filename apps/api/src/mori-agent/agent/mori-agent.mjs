/**
 * 作用：执行 Agent V0.1 最小闭环：Context Assembly → Model Decision → Optional Tool → Final Response。
 * 输入：Playground AgentState 和 Structured LLM transport。
 * 输出：最终回复、统一 Agent Trace 与运行 Meta；最多执行一次 Tool，避免形成自主循环。
 */
import { randomUUID } from 'node:crypto'
import { createAgentState } from './state.mjs'
import { decisionSystemPrompt, FINAL_RESPONSE_PROMPT, MORI_AGENT_PROMPT_VERSION } from './system-prompt.mjs'
import { createMockMemoryRepository } from '../memory/mock-repository.mjs'
import { createSearchMemoryTool } from '../tools/search-memory.mjs'
import { createGetMusicContextTool } from '../tools/get-music-context.mjs'
import { createSearchMusicTool } from '../tools/search-music.mjs'
import { AGENT_DECISION_SCHEMA, FINAL_RESPONSE_SCHEMA, agentStep, validateDecision, validateFinalResponse } from '../shared/agent-types.mjs'
import { capabilityStage } from '../shared/logger.mjs'

export function createMoriAgent(llm, options = {}) {
  const musicSearchMode = options.musicSearchMode ?? 'mock'
  if (!['none', 'mock', 'library'].includes(musicSearchMode)) throw new Error(`不支持的 musicSearchMode：${musicSearchMode}`)
  return {
    async execute(input) {
      const runId = randomUUID(); const started = Date.now(); const trace = []
      const logRun = { runId, capability: 'agent_v0_1', promptVersion: MORI_AGENT_PROMPT_VERSION, model: 'unresolved' }
      const push = (type, data) => { const step = agentStep(runId, type, data); trace.push(step); capabilityStage(logRun, `agent_${type.toLowerCase()}`, data); return step }
      try {
        push('INPUT', input)
        const state = createAgentState(input)
        const tools = createTools(state, musicSearchMode)
        const context = contextForModel(state)
        push('CONTEXT_ASSEMBLY', context)

        const first = await llm({ prompt: decisionSystemPrompt(Object.values(tools)), input: { context, availableTools: Object.values(tools).map(({ name, description }) => ({ name, description })) }, schema: AGENT_DECISION_SCHEMA, schemaName: 'mori_agent_decision_v0_1' })
        logRun.model = first.model
        const decision = validateDecision(first.data)
        push('MODEL_DECISION', decision)

        if (decision.action === 'respond') {
          push('FINAL_RESPONSE', { response: decision.response })
          return complete(logRun, runId, started, first.model, first.tokenUsage, decision.response, trace, null)
        }

        const tool = tools[decision.toolCall.name]
        if (!tool) throw new Error(`Tool 未注册：${decision.toolCall.name}`)
        push('TOOL_CALL', { name: tool.name })
        push('TOOL_ARGUMENTS', decision.toolCall.arguments)
        const toolResult = await tool.execute(decision.toolCall.arguments)
        push('TOOL_RESULT', { name: tool.name, result: toolResult })
        push('FINAL_MODEL_CALL', { tool: tool.name })

        const final = await llm({ prompt: FINAL_RESPONSE_PROMPT, input: { context, decision, toolResult }, schema: FINAL_RESPONSE_SCHEMA, schemaName: 'mori_agent_final_response_v0_1' })
        logRun.model = final.model
        const { response } = validateFinalResponse(final.data)
        push('FINAL_RESPONSE', { response })
        return complete(logRun, runId, started, final.model, mergeUsage(first.tokenUsage, final.tokenUsage), response, trace, clientAction(toolResult))
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

function createTools(state, musicSearchMode) {
  const repository = createMockMemoryRepository(state.fakeMemory)
  const tools = [createSearchMemoryTool(repository), createGetMusicContextTool(state)]
  // search_music remains useful for exercising Tool traces in Playground, but its Mock result must
  // never enter the formal product conversation as if it were a real music catalogue.
  if (musicSearchMode === 'library') tools.push(createSearchMusicTool(state.musicCatalog))
  else if (musicSearchMode === 'mock') tools.push(createSearchMusicTool())
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]))
}
function contextForModel(state) { return { userMessage: state.userMessage, currentTrack: state.currentTrack, conversationHistory: state.conversationHistory.slice(-10) } }
function complete(logRun, runId, started, model, tokenUsage, finalResponse, trace, action) {
  const meta = { runId, version: MORI_AGENT_PROMPT_VERSION, model, latency: Date.now() - started, tokenUsage }
  capabilityStage(logRun, 'completed', { output: { finalResponse }, latency: meta.latency, tokenUsage })
  return { success: true, finalResponse, ...(action ? { action } : {}), trace, meta }
}
function mergeUsage(first, second) { if (!first && !second) return null; return { firstCall: first ?? null, finalCall: second ?? null } }
function clientAction(toolResult) {
  const track = toolResult?.source === 'user_library' ? toolResult.results?.[0] : null
  return track?.uri ? { type: 'play_track', track } : null
}
