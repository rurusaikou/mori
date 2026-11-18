/**
 * Conversation Agent 的应用层编排器。
 *
 * 固定流程：State 校验 → Scene/Context → Intent → Model Decision → Optional Tool → Final Response。
 * 这里不维护语言识别规则，也不直接访问产品状态；所有输入先转成只读 State，Tool 由
 * composition root 显式装配。每轮最多执行一个 Tool，保证动作可追踪且不会形成失控循环。
 */
import { randomUUID } from 'node:crypto'
import { createAgentState } from '../perception/state.mjs'
import { decisionSystemPrompt, FINAL_RESPONSE_PROMPT, MORI_AGENT_PROMPT_VERSION, RESPONSE_REPAIR_PROMPT } from '../expression/prompts.mjs'
import { responseQualityIssue } from '../expression/response-quality.mjs'
import { createMockMemoryRepository } from '../brain/memory/mock-repository.mjs'
import { createSearchMemoryTool } from '../action/tools/search-memory.mjs'
import { createGetMusicContextTool } from '../action/tools/get-music-context.mjs'
import { createSearchMusicTool } from '../action/tools/search-music.mjs'
import { createRecommendMusicTool } from '../action/tools/recommend-music.mjs'
import { createGetTrackInsightTool } from '../action/tools/get-track-insight.mjs'
import { AGENT_DECISION_SCHEMA, FINAL_RESPONSE_SCHEMA, agentStep, validateDecision, validateFinalResponse } from '../shared/agent-types.mjs'
import { capabilityStage } from '../shared/logger.mjs'
import { enforceIntentBoundary, ensureRoutedAction, routeIntent } from '../brain/intent-router.mjs'
import { assembleConversationContext, understandConversation } from '../perception/conversation-understanding.mjs'

export function createMoriAgent(llm, options = {}) {
  const musicSearchMode = options.musicSearchMode ?? 'mock'
  const resolveMusicFeatures = options.resolveMusicFeatures
  if (!['none', 'mock', 'library'].includes(musicSearchMode)) {
    throw new Error(`不支持的 musicSearchMode：${musicSearchMode}`)
  }
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
        // 第一阶段只建立事实与语义上下文。Intent 必须在 Context 完成后判断，避免关键词
        // 脱离上一轮问答、当前播放状态而触发音乐动作。
        push('INPUT', input)
        const state = createAgentState(input)
        const tools = createTools(state, musicSearchMode, resolveMusicFeatures, options.memoryRepository, options.memoryUserId, options.songUnderstandingAgent)
        const conversationUnderstanding = understandConversation(state)
        push('SCENE_UNDERSTANDING', conversationUnderstanding)
        const context = { ...assembleConversationContext(state, conversationUnderstanding), conversationUnderstanding }
        push('CONTEXT_ASSEMBLY', context)
        push('STATE_BEFORE', { worldState: state.worldState, playbackState: state.playbackState })
        const routedIntent = routeIntent(state.userMessage, state.playbackState, conversationUnderstanding)
        push('INTENT_ROUTED', routedIntent)

        // 模型负责在已确定的 Intent 边界内选择“回复或 Tool”；代码随后再次执行副作用边界校验。
        const first = await llm({
          prompt: decisionSystemPrompt(Object.values(tools)),
          input: {
            context,
            routedIntent,
            availableTools: Object.values(tools).map(({ name, description }) => ({ name, description })),
          },
          schema: AGENT_DECISION_SCHEMA,
          schemaName: 'mori_agent_decision_v0_2',
        })
        logRun.model = first.model
        let decision = enforceIntentBoundary(validateDecision(first.data), routedIntent, tools)
        decision = ensureRoutedAction(decision, routedIntent, tools, state)
        push('MODEL_DECISION', decision)

        if (decision.action === 'respond') {
          const qualityIssue = responseQualityIssue(decision, state)
          let response = decision.response
          let tokenUsage = first.tokenUsage
          if (qualityIssue) {
            // 质量门只允许一次重生成，避免死循环。Bad Case 作为输入反馈，不进入长期 Prompt。
            push('RESPONSE_REPAIR', { issue: qualityIssue, rejectedResponse: response })
            const repaired = await llm({
              prompt: RESPONSE_REPAIR_PROMPT,
              input: { context, routedIntent, issue: qualityIssue, rejectedResponse: response },
              schema: FINAL_RESPONSE_SCHEMA,
              schemaName: 'mori_agent_response_repair_v0_1',
            })
            logRun.model = repaired.model
            response = validateFinalResponse(repaired.data).response
            tokenUsage = mergeUsage(first.tokenUsage, repaired.tokenUsage)
          }
          push('STATE_AFTER', { playbackState: state.playbackState, plannedAction: null })
          push('FINAL_RESPONSE', { response })
          return complete(logRun, runId, started, logRun.model, tokenUsage, response, trace, null)
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
        return complete(logRun, runId, started, final.model, mergeUsage(first.tokenUsage, final.tokenUsage), response, trace, plannedAction)
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

function createTools(state, musicSearchMode, resolveMusicFeatures, memoryRepository, memoryUserId, songUnderstandingAgent) {
  // 正式 Agent 只在 composition root 注入服务端仓储；Playground 才读取 fakeMemory。
  const usesServerMemory = Boolean(memoryRepository?.available && memoryUserId)
  const repository = usesServerMemory ? memoryRepository : createMockMemoryRepository(state.fakeMemory)
  const tools = [
    createSearchMemoryTool(repository, usesServerMemory ? { userId: memoryUserId } : undefined),
    createGetMusicContextTool(state),
  ]
  if (songUnderstandingAgent) tools.push(createGetTrackInsightTool(state, songUnderstandingAgent))
  // Playground 保留 Mock 只为观察 Tool Trace；正式产品只有 library 模式，防止 Mock 曲目进入用户对话。
  if (musicSearchMode === 'library') {
    tools.push(createSearchMusicTool(state.musicCatalog, resolveMusicFeatures))
    tools.push(createRecommendMusicTool(state.musicCatalog, resolveMusicFeatures))
  }
  else if (musicSearchMode === 'mock') tools.push(createSearchMusicTool())
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]))
}
function complete(logRun, runId, started, model, tokenUsage, finalResponse, trace, action) {
  const meta = { runId, version: MORI_AGENT_PROMPT_VERSION, model, latency: Date.now() - started, tokenUsage }
  capabilityStage(logRun, 'completed', { output: { finalResponse }, latency: meta.latency, tokenUsage })
  return { success: true, finalResponse, ...(action ? { action } : {}), trace, meta }
}
function mergeUsage(first, second) {
  if (!first && !second) return null
  return { firstCall: first ?? null, finalCall: second ?? null }
}
function clientAction(toolResult, toolName) {
  if (!['search_music', 'recommend_music'].includes(toolName)) return null
  const track = ['user_library', 'spotify_search'].includes(toolResult?.source) ? toolResult.results?.[0] : null
  if (!track?.uri) return null
  return {
    type: 'play_track',
    intent: toolName === 'recommend_music' ? 'RECOMMEND' : 'SEARCH',
    track: { uri: track.uri, title: track.title, artist: track.artist },
  }
}
function safeToolResponse(toolResult, modelResponse) {
  // A local model may offer to play or recommend something after the trusted library search found
  // nothing. No candidate means no executable URI, so use a deterministic response rather than
  // letting fluent text imply an action Mori cannot perform.
  if (toolResult?.searchScope && !toolResult.results?.length) {
    return toolResult.searchScope === 'library_then_spotify'
      ? '我先查了你的曲库，也尝试了 Spotify 搜索，但暂时没有找到符合这个条件的歌曲。可以换个歌手、歌名或听感描述再试试。'
      : '你的曲库里暂时没有找到符合这个条件的歌曲。可以换个歌手、歌名或听感描述再试试。'
  }
  return modelResponse
}
