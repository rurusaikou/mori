/**
 * 作用：调用 MeloData、复用特征缓存并聚合用户音乐偏好画像。
 * 输入：歌曲标题/歌手/ISRC 列表、MeloData API Key 和 FeatureStore。
 * 输出：MusicPreferenceProfile 及逐批分析进度日志。
 */
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const numeric = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null
const MAX_TRANSIENT_ATTEMPTS = 4
const PROFILE_CONCURRENCY = 5

export function createMusicProfileService({ featureStore, logInfo, generateMusicPortrait, melodataBaseUrl, fetchImpl = fetch, waitImpl = wait, rateLimit = true }) {
  if (!melodataBaseUrl?.trim()) throw new Error('Mori API 尚未配置 MELODATA_BASE_URL')
  const baseUrl = melodataBaseUrl.trim().replace(/\/$/, '')
  const acquireRequestSlot = rateLimit ? createRequestLimiter({ waitImpl }) : async () => {}

  async function melodata(path, apiKey, attempt = 0) {
    let response
    try {
      // Limit actual HTTP requests rather than songs: one uncached song may resolve its ISRC and
      // retry a pending feature analysis, while a cache hit sends no request at all.
      await acquireRequestSlot()
      response = await fetchImpl(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } })
    } catch (error) {
      // A profile can run for hours on a large library. One transient network failure must not
      // discard the whole run after earlier batches have already completed.
      if (attempt < MAX_TRANSIENT_ATTEMPTS) {
        logInfo('music_preference', 'melodata_retry', { reason: 'network', attempt: attempt + 1 })
        await waitImpl(1_500 * (attempt + 1))
        return melodata(path, apiKey, attempt + 1)
      }
      logInfo('music_preference', 'track_skipped', { reason: 'network_retries_exhausted' })
      return null
    }
    if (response.status === 202 && attempt < 4) {
      const retryAfter = Number(response.headers.get('retry-after'))
      await waitImpl(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 3_000)
      return melodata(path, apiKey, attempt + 1)
    }
    if (response.status === 404 || response.status === 202) return null
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after'))
      await waitImpl(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 1_200 * (attempt + 1))
      return melodata(path, apiKey, attempt + 1)
    }
    if (response.status >= 500) {
      if (attempt < MAX_TRANSIENT_ATTEMPTS) {
        logInfo('music_preference', 'melodata_retry', { reason: 'server_error', status: response.status, attempt: attempt + 1 })
        await waitImpl(1_500 * (attempt + 1))
        return melodata(path, apiKey, attempt + 1)
      }
      logInfo('music_preference', 'track_skipped', { reason: 'server_retries_exhausted', status: response.status })
      return null
    }
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.error?.message || `MeloData 请求失败（${response.status}）`)
    return result
  }

  async function analyzeTrack(track, apiKey) {
    let isrc = track.isrc?.replaceAll('-', '').toUpperCase()
    if (isrc && featureStore.has(isrc)) return featureStore.get(isrc)
    if (!isrc) {
      const resolved = await melodata(`/tracks/resolve?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`, apiKey)
      isrc = resolved?.data?.isrc
    }
    if (!isrc) return null
    if (featureStore.has(isrc)) return featureStore.get(isrc)
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
    featureStore.set(isrc, features)
    return features
  }

  return async function analyzeMusicProfile(tracks, apiKey) {
    logInfo('music_preference', 'request_received', { requestedTracks: tracks.length, cachedFeatures: featureStore.size })
    const features = []
    for (let index = 0; index < tracks.length; index += PROFILE_CONCURRENCY) {
      const cacheSizeBefore = featureStore.size
      const batch = await Promise.all(tracks.slice(index, index + PROFILE_CONCURRENCY).map((track) => analyzeTrack(track, apiKey)))
      const completed = batch.filter(Boolean)
      features.push(...completed)
      if (completed.length) await featureStore.persist()
      const fetchedFeatures = featureStore.size - cacheSizeBefore
      logInfo('music_preference', 'batch_completed', {
        processed: Math.min(index + PROFILE_CONCURRENCY, tracks.length),
        total: tracks.length,
        resolved: completed.length,
        cacheHits: Math.max(0, completed.length - fetchedFeatures),
        fetchedFeatures,
      })
    }
    if (!features.length) return null
    const profile = buildProfile(features, tracks.length)
    const portrait = await generateMusicPortrait?.(profile)
    const result = portrait ? { ...profile, portrait } : profile
    logInfo('music_preference', 'analysis_completed', { analyzedTracks: profile.trackCount, requestedTracks: profile.requestedCount, cachedFeatures: featureStore.size, portraitSource: portrait ? 'llm' : 'fallback' })
    return result
  }
}

function createRequestLimiter({ waitImpl, now = Date.now }) {
  const windows = [
    { duration: 1_000, limit: 4, timestamps: [] },
    { duration: 60_000, limit: 90, timestamps: [] },
  ]
  let queue = Promise.resolve()

  return function acquire() {
    const task = queue.then(async () => {
      while (true) {
        const current = now()
        for (const window of windows) {
          while (window.timestamps.length && current - window.timestamps[0] >= window.duration) window.timestamps.shift()
        }
        const delays = windows
          .filter((window) => window.timestamps.length >= window.limit)
          .map((window) => window.duration - (current - window.timestamps[0]))
        if (!delays.length) {
          for (const window of windows) window.timestamps.push(current)
          return
        }
        await waitImpl(Math.max(...delays))
      }
    })
    queue = task.catch(() => undefined)
    return task
  }
}

function average(values) {
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
