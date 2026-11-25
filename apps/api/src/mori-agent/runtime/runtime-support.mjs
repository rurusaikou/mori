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
import { createPlaybackControlTool } from '../action/tools/playback-control.mjs'
import { capabilityStage } from '../shared/logger.mjs'
import { MORI_AGENT_PROMPT_VERSION } from '../expression/prompts.mjs'
import { composeRelevantMemory } from '../brain/memory/recall-composer.mjs'

export function validateRuntimeOptions(options) {
  const musicSearchMode = options.musicSearchMode ?? 'mock'
  if (!['none', 'mock', 'library'].includes(musicSearchMode)) throw new Error(`不支持的 musicSearchMode：${musicSearchMode}`)
  return { musicSearchMode }
}

export function createRuntimeTools(state, options, musicSearchMode, context = null) {
  // 正式 Agent 只在 composition root 注入服务端仓储；Playground 才读取 fakeMemory。
  const usesServerMemory = Boolean(options.memoryRepository?.available && options.memoryUserId)
  const repository = usesServerMemory ? options.memoryRepository : createMockMemoryRepository(state.fakeMemory)
  const tools = [
    createSearchMemoryTool(repository, usesServerMemory ? { userId: options.memoryUserId } : undefined),
    createGetMusicContextTool(context),
    createPlaybackControlTool(),
  ]
  if (options.songUnderstandingAgent) tools.push(createGetTrackInsightTool(context, options.songUnderstandingAgent))
  // 正式音乐 Tool 只返回待 Extension 执行的请求。OAuth 与完整曲库不进入 Agent API。
  if (musicSearchMode === 'library') {
    tools.push(createSearchMusicTool('delegate'))
    tools.push(createRecommendMusicTool())
  } else if (musicSearchMode === 'mock') tools.push(createSearchMusicTool('mock'))
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]))
}

export async function prepareRelevantMemory(state, options, focusTrack = state.currentTrack) {
  const usesServerMemory = Boolean(options.memoryRepository?.available && options.memoryUserId)
  const repository = usesServerMemory ? options.memoryRepository : createMockMemoryRepository(state.fakeMemory)
  const query = [state.userMessage, focusTrack?.title, focusTrack?.artist].filter(Boolean).join(' ').trim()
  if (!query) return { query: '', matches: [], source: usesServerMemory ? 'SERVER_MEMORY' : 'LOCAL_MEMORY' }
  try {
    const [candidateMatches, tasteProfile, associations] = usesServerMemory
      ? await Promise.all([(typeof repository.retrieveRelevant === 'function'
          ? repository.retrieveRelevant({ userId: options.memoryUserId, query, trackUri: focusTrack?.uri ?? null,
              trackTitle: focusTrack?.title ?? null, trackArtist: focusTrack?.artist ?? null, limit: 20 })
          : repository.search({ userId: options.memoryUserId, query, limit: 5 })),
        typeof repository.listTasteProfile === 'function' ? repository.listTasteProfile({ userId: options.memoryUserId, limit: 3 }) : Promise.resolve([]),
        typeof repository.retrieveAssociations === 'function'
          ? repository.retrieveAssociations({ userId: options.memoryUserId, trackUri: focusTrack?.uri ?? null, limit: 5 })
          : Promise.resolve([])])
      : [await repository.search(query), [], []]
    const matches = usesServerMemory ? composeRelevantMemory(candidateMatches, { limit: 5, factLimit: 2, momentLimit: 2 }) : candidateMatches
    return { query, matches, tasteProfile, associations, source: usesServerMemory ? 'SERVER_MEMORY' : 'LOCAL_MEMORY' }
  } catch {
    // 相关记忆是增强上下文，不是回复成功条件。检索失败保持空结果，由显式 Tool 在确有
    // 需要时仍可独立尝试，不能让 Memory 可用性阻断当前对话。
    return { query, matches: [], tasteProfile: [], associations: [], source: usesServerMemory ? 'SERVER_MEMORY_UNAVAILABLE' : 'LOCAL_MEMORY_UNAVAILABLE' }
  }
}

export async function prepareTargetRelevantMemory(state, options, initialMemory, targetTrack) {
  if (!targetTrack?.uri || targetTrack.uri === state.currentTrack?.uri) return initialMemory
  return prepareRelevantMemory(state, options, targetTrack)
}

export function relevantMemoryLogData(memory, focusTrack, phase) {
  return {
    phase,
    focusTrack: focusTrack ? { uri: focusTrack.uri, title: focusTrack.title, artist: focusTrack.artist } : null,
    query: memory.query,
    source: memory.source,
    matchCount: memory.matches.length,
    matches: memory.matches.map((item) => ({
      id: item.id, kind: item.kind ?? 'unknown', status: item.status ?? 'unknown', source: item.source ?? 'unknown',
      score: item.score ?? 0, matchReason: item.matchReason ?? null, trackUri: item.track?.uri ?? null,
    })),
    tasteProfileCount: memory.tasteProfile?.length ?? 0,
    tasteProfile: (memory.tasteProfile ?? []).map((item) => ({
      id: item.id, dimension: item.dimension, attribute: item.attribute ?? null, stance: item.stance, confidence: item.confidence,
      evidenceCount: item.evidenceIds?.length ?? 0,
    })),
    associationCount: memory.associations?.length ?? 0,
    associations: (memory.associations ?? []).map((item) => ({
      relation: item.relation, sourceType: item.source?.type, sourceKey: item.source?.key,
      targetType: item.target?.type, targetKey: item.target?.key, weight: item.weight,
    })),
  }
}

export function completeRun(logRun, runId, started, model, tokenUsage, finalResponse, trace, action, context = null) {
  const meta = { runId, version: MORI_AGENT_PROMPT_VERSION, model, latency: Date.now() - started, tokenUsage }
  // client action 只代表服务端规划结果。把它写进 completed 日志，使日志不会把
  // Agent Run 完成误读为 Spotify 已经完成播放副作用。
  capabilityStage(logRun, 'completed', { output: { finalResponse, ...(action ? { plannedAction: action } : {}) }, latency: meta.latency, tokenUsage })
  const conversationContext = context ? { targetTrack: context.targetTrack ?? null, resolution: context.trackResolution ?? null } : undefined
  return { success: true, finalResponse, ...(action ? { action } : {}), ...(conversationContext ? { conversationContext } : {}), trace, meta }
}

export function mergeRunTokenUsage(understanding, decision, final = null) {
  // Understanding 已成为正式独立模型调用，必须进入 Run 计量；否则日志会系统性低估
  // 每轮成本。保留 Provider 原始字段，不跨协议猜测 token 字段含义。
  if (!understanding && !decision && !final) return null
  return { understandingCall: understanding ?? null, decisionCall: decision ?? null, finalCall: final ?? null }
}

export function clientAction(toolResult, toolName) {
  if (toolName === 'playback_control' && toolResult?.operation === 'playback_control') {
    return { type: 'playback_control', command: toolResult.command }
  }
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
  if (toolResult?.status === 'PENDING' && ['search_music', 'recommend_music'].includes(toolResult?.operation)) {
    return '我先把这个选歌请求交给播放器，等实际找到后再告诉你具体是哪一首。'
  }
  return modelResponse
}
