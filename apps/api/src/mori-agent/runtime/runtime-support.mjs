/**
 * Legacy Runtime 与 LangGraph Runtime 共用的无状态运行支持函数。
 * 这些函数只负责依赖装配和结果规范化，不能包含 Graph 路由或 Conversation 语义判断，
 * 否则两个 Runtime 会因为复制业务规则而逐渐产生行为差异。
 */
import { createMockMemoryRepository } from '../brain/memory/mock-repository.mjs'
import { createSearchMemoryTool } from '../action/tools/search-memory.mjs'
import { createGetMusicContextTool } from '../action/tools/get-music-context.mjs'
import { createSearchMusicTool } from '../action/tools/search-music.mjs'
import { createRecommendMusicTool } from '../action/tools/recommend-music.mjs'
import { createGetTrackInsightTool } from '../action/tools/get-track-insight.mjs'
import { capabilityStage } from '../shared/logger.mjs'
import { MORI_AGENT_PROMPT_VERSION } from '../expression/prompts.mjs'

export function validateRuntimeOptions(options) {
  const musicSearchMode = options.musicSearchMode ?? 'mock'
  if (!['none', 'mock', 'library'].includes(musicSearchMode)) throw new Error(`不支持的 musicSearchMode：${musicSearchMode}`)
  return { musicSearchMode }
}

export function createRuntimeTools(state, options, musicSearchMode) {
  // 正式 Agent 只在 composition root 注入服务端仓储；Playground 才读取 fakeMemory。
  const usesServerMemory = Boolean(options.memoryRepository?.available && options.memoryUserId)
  const repository = usesServerMemory ? options.memoryRepository : createMockMemoryRepository(state.fakeMemory)
  const tools = [
    createSearchMemoryTool(repository, usesServerMemory ? { userId: options.memoryUserId } : undefined),
    createGetMusicContextTool(state),
  ]
  if (options.songUnderstandingAgent) tools.push(createGetTrackInsightTool(state, options.songUnderstandingAgent))
  // 正式音乐 Tool 只返回待 Extension 执行的请求。OAuth 与完整曲库不进入 Agent API。
  if (musicSearchMode === 'library') {
    tools.push(createSearchMusicTool('delegate'))
    tools.push(createRecommendMusicTool())
  } else if (musicSearchMode === 'mock') tools.push(createSearchMusicTool('mock'))
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]))
}

export function completeRun(logRun, runId, started, model, tokenUsage, finalResponse, trace, action) {
  const meta = { runId, version: MORI_AGENT_PROMPT_VERSION, model, latency: Date.now() - started, tokenUsage }
  capabilityStage(logRun, 'completed', { output: { finalResponse }, latency: meta.latency, tokenUsage })
  return { success: true, finalResponse, ...(action ? { action } : {}), trace, meta }
}

export function mergeRunTokenUsage(understanding, decision, final = null) {
  // Understanding 已成为正式独立模型调用，必须进入 Run 计量；否则日志会系统性低估
  // 每轮成本。保留 Provider 原始字段，不跨协议猜测 token 字段含义。
  if (!understanding && !decision && !final) return null
  return { understandingCall: understanding ?? null, decisionCall: decision ?? null, finalCall: final ?? null }
}

export function clientAction(toolResult, toolName) {
  if (!['search_music', 'recommend_music'].includes(toolName)) return null
  if (!['search_music', 'recommend_music'].includes(toolResult?.operation)) return null
  return {
    type: 'music_request',
    intent: toolName === 'recommend_music' ? 'RECOMMEND' : 'SEARCH',
    query: toolResult.query ?? '',
    excludeUris: toolResult.excludeUris ?? [],
  }
}

export function safeToolResponse(toolResult, modelResponse) {
  // 音乐请求的真实结果要等 Extension 执行后才能确定；服务端不能提前声称找到或播放。
  return modelResponse
}
