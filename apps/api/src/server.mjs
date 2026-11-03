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
import { createFeatureStore } from './services/feature-store.mjs'
import { createMusicProfileService } from './services/music-profile.mjs'
import { createMusicPortraitService } from './services/music-portrait.mjs'

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

createServer(async (request, response) => {
  if (!isAllowedOrigin(request)) { json(request, response, 403, { error: 'Origin is not allowed' }); return }
  if (request.method === 'OPTIONS') { json(request, response, 204, null); return }
  if (request.method === 'POST' && request.url === '/logs') { await handleLogsRoute(request, response); return }
  if (request.method === 'POST' && request.url === '/music-profile') { await handleMusicProfileRoute(request, response); return }
  json(request, response, 404, { error: 'Not found' })
}).listen(port, '127.0.0.1', () => logInfo('server', 'listening', { url: `http://127.0.0.1:${port}`, cachedFeatures: featureStore.size }))
