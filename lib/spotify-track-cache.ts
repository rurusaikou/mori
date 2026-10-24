import type { SpotifyTrack } from './spotify'

type TrackCacheEntry = { savedAt: number; tracks: SpotifyTrack[] }

const TRACK_CACHE_TTL = 24 * 60 * 60 * 1000
const CACHE_PREFIX = 'mori.track-cache.'
const CACHE_ENABLED_KEY = 'mori.spotify.keep-track-cache'
const memoryCache = new Map<string, TrackCacheEntry>()
// 页面切换会卸载 ConnectScreen；共享进行中的 Promise，避免返回页面时重复请求同一歌单。
const activeRequests = new Map<string, Promise<SpotifyTrack[]>>()

export function shouldKeepSpotifyTrackCache() {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(CACHE_ENABLED_KEY) !== 'false'
}

export function setKeepSpotifyTrackCache(enabled: boolean) {
  localStorage.setItem(CACHE_ENABLED_KEY, String(enabled))
  if (!enabled) clearSpotifyTrackCache()
}

export function readSpotifyTrackCache(key: string) {
  if (!shouldKeepSpotifyTrackCache()) return null
  const memory = memoryCache.get(key)
  if (memory && Date.now() - memory.savedAt < TRACK_CACHE_TTL) return memory.tracks
  if (typeof window === 'undefined') return null
  try {
    const stored = JSON.parse(sessionStorage.getItem(`${CACHE_PREFIX}${key}`) ?? 'null') as TrackCacheEntry | null
    if (stored && Date.now() - stored.savedAt < TRACK_CACHE_TTL) {
      memoryCache.set(key, stored)
      return stored.tracks
    }
    sessionStorage.removeItem(`${CACHE_PREFIX}${key}`)
  } catch { sessionStorage.removeItem(`${CACHE_PREFIX}${key}`) }
  return null
}

export function loadSpotifyTrackCache(key: string, loader: () => Promise<SpotifyTrack[]>) {
  const cached = readSpotifyTrackCache(key)
  if (cached) return Promise.resolve(cached)
  const activeRequest = activeRequests.get(key)
  if (activeRequest) return activeRequest
  const request = loader().then((tracks) => {
    if (shouldKeepSpotifyTrackCache()) {
      const entry = { savedAt: Date.now(), tracks }
      memoryCache.set(key, entry)
      // 大歌单可能超过 sessionStorage 配额，此时仍保留内存缓存，不中断播放流程。
      try { sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(entry)) } catch { /* 内存缓存仍然可用 */ }
    }
    return tracks
  }).finally(() => activeRequests.delete(key))
  activeRequests.set(key, request)
  return request
}

export function clearSpotifyTrackCache() {
  memoryCache.clear()
  activeRequests.clear()
  if (typeof window === 'undefined') return
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index)
    if (key?.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(key)
  }
}
