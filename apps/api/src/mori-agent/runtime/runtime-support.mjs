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
  return { musicSearchMode, resolveMusicFeatures: options.resolveMusicFeatures }
}

export function createRuntimeTools(state, options, musicSearchMode, resolveMusicFeatures) {
  // 正式 Agent 只在 composition root 注入服务端仓储；Playground 才读取 fakeMemory。
  const usesServerMemory = Boolean(options.memoryRepository?.available && options.memoryUserId)
  const repository = usesServerMemory ? options.memoryRepository : createMockMemoryRepository(state.fakeMemory)
  const tools = [
    createSearchMemoryTool(repository, usesServerMemory ? { userId: options.memoryUserId } : undefined),
    createGetMusicContextTool(state),
  ]
  if (options.songUnderstandingAgent) tools.push(createGetTrackInsightTool(state, options.songUnderstandingAgent))
  // Playground 保留 Mock 只为观察 Tool Trace；正式产品只有 library 模式，防止 Mock 曲目进入用户对话。
  if (musicSearchMode === 'library') {
    tools.push(createSearchMusicTool(state.musicCatalog, resolveMusicFeatures))
    tools.push(createRecommendMusicTool(state.musicCatalog, resolveMusicFeatures))
  } else if (musicSearchMode === 'mock') tools.push(createSearchMusicTool())
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]))
}

export function completeRun(logRun, runId, started, model, tokenUsage, finalResponse, trace, action) {
  const meta = { runId, version: MORI_AGENT_PROMPT_VERSION, model, latency: Date.now() - started, tokenUsage }
  capabilityStage(logRun, 'completed', { output: { finalResponse }, latency: meta.latency, tokenUsage })
  return { success: true, finalResponse, ...(action ? { action } : {}), trace, meta }
}

export function mergeTokenUsage(first, second) {
  // 不直接相加不同 Provider 的字段；保留原始两次用量，避免 Responses 与 Chat Completions
  // token 命名差异造成错误统计。
  if (!first && !second) return null
  return { firstCall: first ?? null, finalCall: second ?? null }
}

export function clientAction(toolResult, toolName) {
  // 只有来自可信曲库或 Spotify Search 的完整 URI 才能跨越服务端边界。Mock、Memory、
  // Song Insight 的结果即使包含相似字段，也不能被解释为播放命令。
  if (!['search_music', 'recommend_music'].includes(toolName)) return null
  const track = ['user_library', 'spotify_search'].includes(toolResult?.source) ? toolResult.results?.[0] : null
  if (!track?.uri) return null
  return {
    type: 'play_track',
    intent: toolName === 'recommend_music' ? 'RECOMMEND' : 'SEARCH',
    track: { uri: track.uri, title: track.title, artist: track.artist },
  }
}

export function safeToolResponse(toolResult, modelResponse) {
  // 本地模型可能在可信候选为空时仍承诺播放。没有 URI 就没有可执行动作，因此使用
  // 确定性回复封住副作用边界，而不是让流畅文本掩盖 Tool 失败。
  if (toolResult?.searchScope && !toolResult.results?.length) {
    return toolResult.searchScope === 'library_then_spotify'
      ? '我先查了你的曲库，也尝试了 Spotify 搜索，但暂时没有找到符合这个条件的歌曲。可以换个歌手、歌名或听感描述再试试。'
      : '你的曲库里暂时没有找到符合这个条件的歌曲。可以换个歌手、歌名或听感描述再试试。'
  }
  return modelResponse
}
