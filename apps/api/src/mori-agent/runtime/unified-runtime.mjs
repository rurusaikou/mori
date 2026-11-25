import { randomUUID } from 'node:crypto'
import { END, START, StateGraph, Annotation } from '@langchain/langgraph'
import { agentStep, validateDecisionForUnderstanding } from '../shared/agent-types.mjs'
import { capabilityStage } from '../shared/logger.mjs'
import { MORI_AGENT_PROMPT_VERSION } from '../expression/prompts.mjs'
import { playbackFactIssue, safePlaybackFallback } from '../expression/response-quality.mjs'
import { buildMoriContext } from '../context/context-builder.mjs'
import { loadMoriPersona } from '../persona/persona-loader.mjs'
import { understandConversation } from '../perception/conversation-understanding.mjs'
import { createAgentState } from '../perception/state.mjs'
import { clientAction, completeRun, createRuntimeTools, mergeRunTokenUsage, prepareRelevantMemory, safeToolResponse, validateRuntimeOptions } from './runtime-support.mjs'

const value = () => Annotation()
const UnifiedState = Annotation.Root({
  input: value(), runId: value(), started: value(), agentState: value(), context: value(), messages: value(),
  toolDefinitions: value(), firstResponse: value(), toolResult: value(), action: value(), finalResponse: value(), model: value(), tokenUsage: value(),
  trace: Annotation({ reducer: (current, update) => [...current, ...update], default: () => [] }),
})

const TOOL_PARAMETERS = {
  search_memory: {
    type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
  },
  get_music_context: { type: 'object', properties: {}, required: [], additionalProperties: false },
  get_track_insight: { type: 'object', properties: {}, required: [], additionalProperties: false },
  search_music: {
    type: 'object', properties: { query: { type: 'string' }, authorizationQuote: { type: 'string' }, excludeCurrentTrack: { type: 'boolean' } },
    required: ['query', 'authorizationQuote', 'excludeCurrentTrack'], additionalProperties: false,
  },
  recommend_music: {
    type: 'object', properties: { query: { type: 'string' }, authorizationQuote: { type: 'string' }, excludeCurrentTrack: { type: 'boolean' } },
    required: ['query', 'authorizationQuote', 'excludeCurrentTrack'], additionalProperties: false,
  },
  playback_control: {
    type: 'object', properties: {
      command: { type: 'string', enum: ['PAUSE', 'RESUME', 'NEXT', 'PREVIOUS'] },
      authorizationQuote: { type: 'string' },
    }, required: ['command', 'authorizationQuote'], additionalProperties: false,
  },
}

const TOOL_LIMIT = '本轮最多执行一个 Tool。播放控制、搜索和推荐必须由当前用户消息明确授权；动作工具的 authorizationQuote 必须逐字引用当前用户消息中的连续片段，不能改写或引用历史。excludeCurrentTrack 仅按用户本轮表达设置。读取音乐/记忆信息不能触发播放或其他副作用。'

export function createUnifiedMoriAgent(agentLlm, options = {}) {
  if (typeof agentLlm !== 'function') throw new Error('Unified Runtime 需要 Agent LLM Transport')
  return {
    async execute(input, correlation = {}) {
      const runId = randomUUID()
      const started = Date.now()
      const logRun = {
        runId, capability: 'conversation_agent', promptVersion: MORI_AGENT_PROMPT_VERSION,
        model: 'unresolved', logSource: options.logSource,
        requestId: correlation.requestId ?? null, exchangeId: correlation.exchangeId ?? null,
      }
      let latest = { input, runId, started, trace: [] }
      try {
        const nodes = createUnifiedNodes({ agentLlm, options, logRun, onStreamEvent: correlation.onStreamEvent, signal: correlation.signal })
        const graph = new StateGraph(UnifiedState)
          .addNode('prepare_context', nodes.context)
          .addNode('agent', nodes.agent)
          .addNode('tool', nodes.tool)
          .addNode('final_response', nodes.finalResponse)
          .addEdge(START, 'prepare_context')
          .addEdge('prepare_context', 'agent')
          .addConditionalEdges('agent', routeAfterAgent, ['tool', END])
          .addEdge('tool', 'final_response')
          .addEdge('final_response', END)
          .compile()
        for await (const state of await graph.stream(latest, { streamMode: 'values' })) latest = state
        return completeRun(logRun, runId, started, latest.model, latest.tokenUsage, latest.finalResponse, latest.trace, latest.action, latest.context)
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause)
        const trace = [...(latest.trace ?? []), agentStep(runId, 'ERROR', { error })]
        const meta = { runId, version: MORI_AGENT_PROMPT_VERSION, model: logRun.model, latency: Date.now() - started }
        capabilityStage(logRun, 'agent_error', { error })
        capabilityStage(logRun, 'failed', { input, latency: meta.latency, error })
        return { success: false, error, trace, meta }
      }
    },
  }
}

function createUnifiedNodes({ agentLlm, options, logRun, onStreamEvent, signal }) {
  const { musicSearchMode } = validateRuntimeOptions(options)
  let safeTools = {}
  const record = (state, type, data) => {
    capabilityStage(logRun, `agent_${type.toLowerCase()}`, data)
    return agentStep(state.runId, type, data)
  }

  return {
    async context(state) {
      const agentState = createAgentState(state.input)
      const [relevantMemory, persona] = await Promise.all([
        prepareRelevantMemory(agentState, options),
        options.persona ? Promise.resolve(options.persona) : loadMoriPersona(),
      ])
      const targetTrack = agentState.conversationFocus ?? agentState.currentTrack
      const trackResolution = agentState.conversationFocus
        ? { source: 'CONVERSATION_FOCUS', confidence: 0.9, resolved: true, referenceType: 'CONVERSATION_TRACK' }
        : agentState.currentTrack
          ? { source: 'PLAYBACK_STATE', confidence: 0.8, resolved: true, referenceType: 'CURRENT_TRACK' }
          : { source: 'NO_TRACK_CONTEXT', confidence: 0, resolved: false, referenceType: null }
      const context = {
        targetTrack,
        trackResolution,
        playbackState: agentState.playbackState,
        conversationState: agentState.conversationState,
        relevantMemory,
      }
      const runtimeTools = createRuntimeTools(agentState, options, musicSearchMode, context)
      const tools = Object.values(runtimeTools)
      safeTools = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
      const toolDefinitions = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: TOOL_PARAMETERS[tool.name],
      }))
      const built = buildMoriContext({ persona, state: agentState, relevantMemory })
      const messages = [
        { role: 'system', content: `${built.system}\n\n${TOOL_LIMIT}` },
        ...built.messages.slice(1),
      ]
      capabilityStage(logRun, 'agent_unified_context_ready', {
        messageCount: messages.length, activeTopic: agentState.conversationState.activeTopic,
        currentTrack: agentState.currentTrack, previousTrack: agentState.playbackState.previousTrack,
        relevantMemoryCount: relevantMemory.matches.length, tools: toolDefinitions.map((tool) => tool.name),
        contextBudget: built.budget,
      })
      return {
        agentState, context: { ...context, messages, budget: built.budget }, messages, toolDefinitions,
        trace: [record(state, 'UNIFIED_CONTEXT', {
          messageRoles: messages.map(({ role }) => role), topic: agentState.conversationState.activeTopic,
          currentTrack: agentState.currentTrack, toolNames: toolDefinitions.map((tool) => tool.name),
        })],
      }
    },

    async agent(state) {
      const request = { messages: state.messages, tools: state.toolDefinitions, toolChoice: 'auto', signal }
      const response = typeof agentLlm.stream === 'function' && onStreamEvent
        ? await agentLlm.stream(request, (event) => {
          if (event.type === 'text_delta') onStreamEvent({ type: 'delta', text: event.delta })
        })
        : await agentLlm(request)
      logRun.model = response.model
      const firstResponse = normalizeResponse(response)
      const playbackIssue = firstResponse.toolCalls.length ? null : playbackFactIssue(firstResponse.content, state.agentState)
      const directResponse = playbackIssue ? safePlaybackFallback(playbackIssue) : firstResponse.content
      if (playbackIssue && onStreamEvent) {
        onStreamEvent({ type: 'reset' })
        onStreamEvent({ type: 'delta', text: directResponse })
      }
      capabilityStage(logRun, 'agent_unified_model_response', {
        contentLength: firstResponse.content.length,
        toolCalls: firstResponse.toolCalls.map(({ id, name, arguments: args }) => ({ id, name, arguments: args })),
        playbackFactIssue: playbackIssue,
        tokenUsage: response.tokenUsage,
      })
      return {
        firstResponse, model: response.model, tokenUsage: response.tokenUsage,
        finalResponse: firstResponse.toolCalls.length ? null : directResponse,
        messages: [...state.messages, assistantMessage(firstResponse)],
        trace: [record(state, 'UNIFIED_AGENT_RESPONSE', { content: firstResponse.content, toolCalls: firstResponse.toolCalls })],
      }
    },

    async tool(state) {
      const calls = state.firstResponse.toolCalls
      const tooManyCalls = calls.length > 1
      onStreamEvent?.({ type: 'reset' })
      onStreamEvent?.({ type: 'tool_start', name: calls[0]?.name ?? 'tool' })
      const observations = []
      let action = null
      for (const call of calls) {
        const tool = safeTools[call.name]
        let args = call.arguments
        let validationError = validateToolArguments(call.name, args)
        let observation
        if (tooManyCalls) observation = { ok: false, error: '本轮最多执行一个 Tool；所有并发 Tool Call 均未执行' }
        else if (!tool) observation = { ok: false, error: '该 Tool 未在 Unified Runtime 中开放' }
        else {
          if (!validationError && isMusicSideEffectTool(call.name)) {
            try {
              args = await authorizeMusicToolCall(call, state.agentState, options, logRun)
            } catch (cause) {
              validationError = cause instanceof Error ? cause.message : String(cause)
            }
          }
          if (validationError) observation = { ok: false, error: validationError }
          else {
            try {
              const result = await tool.execute(args)
              observation = { ok: true, result }
              action = clientAction(result, tool.name)
            } catch (cause) {
              observation = { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
            }
          }
        }
        observations.push({ call, observation })
      }
      const toolResult = { observations }
      const messages = [
        ...state.messages,
        ...observations.map(({ call, observation }) => ({ role: 'tool', toolCallId: call.id, content: JSON.stringify(observation) })),
      ]
      capabilityStage(logRun, 'agent_unified_tool_observed', { observations })
      return {
        toolResult, messages, action,
        trace: [record(state, 'UNIFIED_TOOL_RESULT', { observations })],
      }
    },

    async finalResponse(state) {
      const request = { messages: state.messages, tools: [], toolChoice: 'none', signal }
      const response = typeof agentLlm.stream === 'function' && onStreamEvent
        ? await agentLlm.stream(request, (event) => {
          if (event.type === 'text_delta') onStreamEvent({ type: 'delta', text: event.delta })
        })
        : await agentLlm(request)
      logRun.model = response.model
      const final = normalizeResponse(response)
      if (final.toolCalls.length) throw new Error('Agent LLM 在无工具收尾轮仍返回 Tool Call')
      const candidate = final.content.trim() || '我这轮没有组织好回答，你可以换个说法再告诉我。'
      const playbackIssue = playbackFactIssue(candidate, state.agentState)
      const modelFinalResponse = playbackIssue ? safePlaybackFallback(playbackIssue) : candidate
      if (playbackIssue && onStreamEvent) {
        onStreamEvent({ type: 'reset' })
        onStreamEvent({ type: 'delta', text: modelFinalResponse })
      }
      const finalResponse = safeToolResponse(state.toolResult?.observations?.at(-1)?.observation?.result, modelFinalResponse)
      const tokenUsage = mergeAgentUsage(state.tokenUsage, response.tokenUsage)
      capabilityStage(logRun, 'agent_unified_final_response', {
        response: finalResponse,
        tools: state.toolResult?.observations?.map(({ call }) => call.name) ?? [],
        playbackFactIssue: playbackIssue,
      })
      return {
        finalResponse, model: response.model, tokenUsage,
        action: state.action ?? null,
        trace: [record(state, 'UNIFIED_FINAL_RESPONSE', { response: finalResponse })],
      }
    },
  }
}

function routeAfterAgent(state) {
  return state.firstResponse.toolCalls.length ? 'tool' : END
}

function validateToolArguments(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Tool 参数必须是 JSON 对象'
  if (name === 'search_memory') return typeof args.query === 'string' && args.query.trim() && Object.keys(args).every((key) => key === 'query') ? null : 'search_memory 只接受非空 query'
  if (['get_music_context', 'get_track_insight'].includes(name)) return Object.keys(args).length ? `${name} 不接受参数` : null
  if (name === 'search_music' || name === 'recommend_music') {
    const keysValid = Object.keys(args).every((key) => ['query', 'authorizationQuote', 'excludeCurrentTrack'].includes(key))
    if (!keysValid || typeof args.query !== 'string' || typeof args.authorizationQuote !== 'string' || typeof args.excludeCurrentTrack !== 'boolean') return `${name} 参数结构无效`
    if (name === 'search_music' && !args.query.trim()) return 'search_music.query 不能为空'
    return null
  }
  if (name === 'playback_control') {
    const keysValid = Object.keys(args).every((key) => ['command', 'authorizationQuote'].includes(key))
    return keysValid && ['PAUSE', 'RESUME', 'NEXT', 'PREVIOUS'].includes(args.command) && typeof args.authorizationQuote === 'string'
      ? null
      : 'playback_control 参数结构无效'
  }
  return 'Tool 未授权'
}

function isMusicSideEffectTool(name) {
  return ['search_music', 'recommend_music', 'playback_control'].includes(name)
}

async function authorizeMusicToolCall(call, agentState, options, logRun) {
  const quote = call.arguments.authorizationQuote.trim()
  if (!quote || !agentState.userMessage.includes(quote)) throw new Error('动作授权引句必须是本轮用户原文的连续片段')
  if (typeof options.actionAuthorizationLlm !== 'function') throw new Error('Unified Runtime 未配置动作授权校验器')
  const understood = await understandConversation(options.actionAuthorizationLlm, agentState, {
    onRawOutput: (data) => capabilityStage(logRun, 'agent_action_authorization_understanding', data),
  })
  const intent = call.name === 'search_music' ? 'SEARCH' : call.name === 'recommend_music' ? 'RECOMMEND' : 'CONTROL'
  const decision = validateDecisionForUnderstanding({
    action: 'tool', intent, conversationMove: 'ANSWER', reason: '动作请求待授权校验', response: null,
    toolCall: { name: call.name, arguments: call.arguments },
  }, understood.understanding, {
    currentTrack: agentState.currentTrack,
    playbackState: agentState.playbackState,
  })
  capabilityStage(logRun, 'agent_action_authorized', {
    tool: call.name, intent: understood.understanding.listeningRequest?.type ?? null,
    authorizationQuote: quote, normalizedArguments: decision.toolCall.arguments,
  })
  return decision.toolCall.arguments
}

function normalizeResponse(response) {
  return {
    content: typeof response.content === 'string' ? response.content : '',
    toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls.map((call) => ({
      id: call.id || randomUUID(), name: call.name, arguments: call.arguments,
    })) : [],
  }
}

function assistantMessage(response) {
  return { role: 'assistant', content: response.content, ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}) }
}

function mergeAgentUsage(first, second) {
  return { agentCall: first ?? null, observationCall: second ?? null }
}