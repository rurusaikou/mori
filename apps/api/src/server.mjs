/**
 * 作用：组合 Mori API 的 HTTP 边界、路由和音乐画像服务。
 * 输入：/logs、/music-profile 请求及服务端环境变量。
 * 输出：监听 localhost 的受 Origin 和请求体大小限制的 JSON API。
 */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { isAllowedOrigin, json } from './http.mjs'
import { logError, logInfo } from './logging.mjs'
import { handleLogsRoute } from './routes/logs.mjs'
import { createMusicProfileRoute } from './routes/music-profile.mjs'
import { createCapabilityRegistry } from './mori-agent/brain/capability-registry.mjs'
import { createCapabilityRoutes } from './routes/capabilities.mjs'
import { createAgentRoutes } from './routes/agent.mjs'
import { createCapabilityLlm } from './mori-agent/shared/llm.mjs'
import { createAgentLlm } from './mori-agent/shared/agent-llm.mjs'
import { createMoriAgent } from './mori-agent/runtime/index.mjs'
import { createFeatureStore } from './services/feature-store.mjs'
import { createMusicProfileService } from './services/music-profile.mjs'
import { createMusicPortraitService } from './services/music-portrait.mjs'
import { createEmbeddingProvider } from './mori-agent/brain/memory/embedding-provider.mjs'
import { createPostgresMemoryRepository } from './mori-agent/brain/memory/postgres-repository.mjs'
import { createMemoryRoutes } from './routes/memory.mjs'
import { createMemoryCapability } from './mori-agent/brain/capabilities/memory/memory.service.mjs'
import { createSongUnderstandingAgent } from './mori-agent/perception/song-understanding/song-understanding-agent.mjs'
import { createSongEvidenceProviders } from './mori-agent/perception/song-understanding/providers.mjs'
import { createPostTurnMemoryProcessor } from './mori-agent/brain/memory/post-turn-processor.mjs'

const port = Number(process.env.MORI_API_PORT || 3211)
const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url))
const featureStore = await createFeatureStore(dataDirectory)
const generateMusicPortrait = createMusicPortraitService({ logInfo, logError })
const analyzeMusicProfile = createMusicProfileService({
  featureStore,
  logInfo,
  generateMusicPortrait,
  melodataBaseUrl: process.env.MELODATA_BASE_URL?.trim(),
})
const handleMusicProfileRoute = createMusicProfileRoute(analyzeMusicProfile)
const handleCapabilityRequest = createCapabilityRoutes(createCapabilityRegistry())
const structuredLlm = createCapabilityLlm()
const conversationLlm = createAgentLlm()
const memoryEmbedding = createEmbeddingProvider({ env: process.env })
const memoryRepository = await createPostgresMemoryRepository({
  connectionString: process.env.MORI_MEMORY_DATABASE_URL?.trim(),
  embeddingProvider: memoryEmbedding,
  logInfo,
  logError,
})
// V0.1 暂无账号系统；开发身份必须由服务端环境变量固定，不能相信 Extension 请求体。
const memoryUserId = process.env.MORI_MEMORY_USER_ID?.trim() || null
const memoryCandidateCapability = createMemoryCapability(structuredLlm)
const postTurnMemoryProcessor = createPostTurnMemoryProcessor({
  extractor: (input) => memoryCandidateCapability.execute(input),
  repository: memoryRepository,
  userId: memoryUserId,
  logInfo,
  logError,
})
const songUnderstandingAgent = createSongUnderstandingAgent({
  llm: structuredLlm,
  resolveFeatures: (isrc) => featureStore.get(isrc),
  providers: createSongEvidenceProviders(),
  logInfo,
  logError,
})
const handleAgentRequest = createAgentRoutes({
  productAgent: createMoriAgent(structuredLlm, { agentLlm: conversationLlm, actionAuthorizationLlm: structuredLlm, musicSearchMode: 'library', memoryRepository, memoryUserId, songUnderstandingAgent }),
  playgroundAgent: createMoriAgent(structuredLlm, { agentLlm: conversationLlm, actionAuthorizationLlm: structuredLlm, logSource: 'debug' }),
  memoryRepository,
  memoryUserId,
  postTurnMemoryProcessor,
})
const handleMemoryRequest = createMemoryRoutes({ repository: memoryRepository, userId: memoryUserId })

createServer(async (request, response) => {
  const isDevelopmentAgentRoute = request.url?.startsWith('/agent-playground') || request.url === '/agent/playground/run'
  // Playground is a same-origin development surface. The formal /agent/run endpoint deliberately
  // continues through the extension Origin check below.
  if (isDevelopmentAgentRoute && await handleAgentRequest(request, response)) return
  // Capability Lab is a same-origin, development-only surface and performs its own route gating.
  if (await handleCapabilityRequest(request, response)) return
  if (!isAllowedOrigin(request)) { json(request, response, 403, { error: 'Origin is not allowed' }); return }
  if (request.method === 'OPTIONS') { json(request, response, 204, null); return }
  if (await handleAgentRequest(request, response)) return
  if (await handleMemoryRequest(request, response)) return
  if (request.method === 'POST' && request.url === '/logs') { await handleLogsRoute(request, response); return }
  if (request.method === 'POST' && request.url === '/music-profile') { await handleMusicProfileRoute(request, response); return }
  json(request, response, 404, { error: 'Not found' })
}).listen(port, '127.0.0.1', () => logInfo('server', 'listening', { url: `http://127.0.0.1:${port}`, cachedFeatures: featureStore.size }))
