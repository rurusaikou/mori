/**
 * 作用：提供本地音乐特征分析 API，在服务端安全持有 MeloData API Key。
 * 输入：POST /music-profile 的歌曲列表，以及环境变量 MELODATA_API_KEY。
 * 输出：聚合后的音乐偏好画像 JSON；不会向 Extension 返回或记录 API Key。
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const MELODATA_BASE = 'https://melodata.voltenworks.com/api/v1'
const port = Number(process.env.MORI_API_PORT || 3211)
const dataDirectory = fileURLToPath(new URL('./data/', import.meta.url))
const featuresPath = path.join(dataDirectory, 'music-features.json')
const featureCache = new Map(Object.entries(await readJson(featuresPath, {})))

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const numeric = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null

async function readJson(filePath, fallback) {
  try { return JSON.parse(await readFile(filePath, 'utf8')) } catch { return fallback }
}

async function persistFeatureCache() {
  await mkdir(dataDirectory, { recursive: true })
  // Write-then-rename keeps the previous cache valid if the process stops during serialization.
  const temporaryPath = `${featuresPath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(featureCache), null, 2)}\n`, 'utf8')
  await rename(temporaryPath, featuresPath)
}

async function melodata(path, apiKey, attempt = 0) {
  const response = await fetch(`${MELODATA_BASE}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (response.status === 202 && attempt < 4) {
    const retryAfter = Number(response.headers.get('retry-after'))
    await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 3_000)
    return melodata(path, apiKey, attempt + 1)
  }
  if (response.status === 404 || response.status === 202) return null
  if (response.status === 429 && attempt < 3) {
    const retryAfter = Number(response.headers.get('retry-after'))
    await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 1_200 * (attempt + 1))
    return melodata(path, apiKey, attempt + 1)
  }
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(result?.error?.message || `MeloData 请求失败（${response.status}）`)
  return result
}

async function analyzeTrack(track, apiKey) {
  let isrc = track.isrc?.replaceAll('-', '').toUpperCase()
  if (isrc && featureCache.has(isrc)) return featureCache.get(isrc)
  if (!isrc) {
    const resolved = await melodata(`/tracks/resolve?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`, apiKey)
    isrc = resolved?.data?.isrc
  }
  if (!isrc) return null
  // Tracks without an ISRC require title/artist resolution first, but the resolved ISRC may still
  // already exist in the persistent cache and should not consume another feature request.
  if (featureCache.has(isrc)) return featureCache.get(isrc)
  const result = await melodata(`/tracks/${encodeURIComponent(isrc)}/features`, apiKey)
  const values = result?.data?.features
  if (!values) return null
  const features = {
    isrc,
    bpm: numeric(values.bpm),
    energy: numeric(values.energy),
    danceability: numeric(values.danceability),
    valence: numeric(values.valence),
    acousticness: numeric(values.acousticness),
    instrumentalness: numeric(values.instrumentalness),
  }
  featureCache.set(isrc, features)
  return features
}

const average = (values) => {
  const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}

function buildProfile(features, requestedCount) {
  return {
    analyzedAt: Date.now(),
    trackCount: features.length,
    requestedCount,
    averageBpm: average(features.map((item) => item.bpm)),
    energy: average(features.map((item) => item.energy)),
    danceability: average(features.map((item) => item.danceability)),
    valence: average(features.map((item) => item.valence)),
    acousticness: average(features.map((item) => item.acousticness)),
    instrumentalness: average(features.map((item) => item.instrumentalness)),
  }
}

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
  }).end(JSON.stringify(body))
}

createServer(async (request, response) => {
  if (request.method === 'OPTIONS') { json(response, 204, null); return }
  if (request.method !== 'POST' || request.url !== '/music-profile') { json(response, 404, { error: 'Not found' }); return }
  const apiKey = process.env.MELODATA_API_KEY?.trim()
  if (!apiKey) { json(response, 503, { error: 'Mori API 尚未配置 MELODATA_API_KEY' }); return }
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const tracks = Array.isArray(body?.tracks) ? body.tracks.filter((track) => track?.title && track?.artist) : []
    if (!tracks.length) { json(response, 400, { error: '没有可以分析的歌曲' }); return }
    const features = []
    // Small batches avoid consuming MeloData rate limits in a burst and mirror the proven MVP flow.
    for (let index = 0; index < tracks.length; index += 2) {
      const batch = await Promise.all(tracks.slice(index, index + 2).map((track) => analyzeTrack(track, apiKey)))
      const completed = batch.filter(Boolean)
      features.push(...completed)
      // Persist every completed batch so a later rate limit or process restart can reuse work that
      // has already consumed MeloData quota instead of restarting the whole sample.
      if (completed.length) await persistFeatureCache()
      if (index + 2 < tracks.length) await wait(1_100)
    }
    if (!features.length) { json(response, 422, { error: '歌曲特征仍在分析或暂不可用，请稍后重试' }); return }
    json(response, 200, { profile: buildProfile(features, tracks.length) })
  } catch (error) {
    json(response, 502, { error: error instanceof Error ? error.message : '音乐特征分析失败' })
  }
}).listen(port, '127.0.0.1', () => console.log(`Mori API: http://127.0.0.1:${port}`))
