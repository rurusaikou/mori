/**
 * 作用：实现 MusicProvider，协调 Spotify Web API、offscreen 播放设备和曲库缓存。
 * 输入：播放命令、Spotify URI、PlaybackState、授权 Token 和 session 曲库缓存。
 * 输出：Spotify 播放操作、MusicPlaylist/MusicTrack 数据、PlaybackState 和更新后的缓存。
 */
import { INITIAL_PLAYBACK_STATE, type MusicPlaylist, type MusicProvider, type MusicTrack, type PlaybackMode, type PlaybackState } from '@mori/domain'
import type { PlaybackHostRequest, RuntimeResponse } from '../../shared/messages'
import { extensionStorage } from '../../storage/extension-storage'
import { connectSpotify, disconnectSpotify, getValidAccessToken } from './spotify-auth'
import { canAccessPlaylist, getAvailableDevices, getPlaylistTracks as fetchPlaylistTracks, getRemotePlayback, getUserPlaylists as fetchUserPlaylists, LIKED_TRACKS_ID, nextPlayback, pausePlayback, previousPlayback, searchTracks as searchSpotifyTracks, seekPlayback, setRepeat, setShuffle, startPlayback, transferPlayback } from './spotify-web-api'

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html'
const LIBRARY_CACHE_TTL_MS = 60 * 60 * 1_000
let creatingOffscreen: Promise<void> | null = null
let embeddedDeviceId: string | null = null
let playlistsRequest: Promise<MusicPlaylist[]> | null = null
const trackRequests = new Map<string, Promise<MusicTrack[]>>()
let libraryGeneration = 0

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH)
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })
  if (contexts.length) return
  // A reclaimed offscreen document also destroys its SDK device. Drop the cached ID before
  // recreating it; while the document is alive, repeated track selections can reuse the ID.
  embeddedDeviceId = null
  if (!creatingOffscreen) {
    // Audio must live outside content scripts so navigation cannot stop playback. Chrome may close
    // this document after prolonged silence, so every command first recreates it when necessary.
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK, chrome.offscreen.Reason.IFRAME_SCRIPTING],
      justification: 'Keep user-controlled Spotify playback alive while browser pages navigate.',
    }).finally(() => { creatingOffscreen = null })
  }
  await creatingOffscreen
}

async function sendToPlaybackHost(type: PlaybackHostRequest['type'], payload: PlaybackHostRequest['payload'] = {}) {
  await ensureOffscreenDocument()
  const response = await chrome.runtime.sendMessage<PlaybackHostRequest, RuntimeResponse>({ target: 'offscreen', type, payload })
  if (!response?.ok) throw new Error(response?.error || 'Mori 播放宿主没有响应')
  return response.result as { deviceId?: string } | null
}

async function ensureSpotifyDevice() {
  await ensureOffscreenDocument()
  if (embeddedDeviceId) return embeddedDeviceId
  const result = await sendToPlaybackHost('PLAYER_INIT', {
    token: await getValidAccessToken(),
    hostUrl: await extensionStorage.getPlaybackHostUrl(),
  })
  if (!result?.deviceId) throw new Error('Spotify Web Playback SDK 尚未返回设备')
  embeddedDeviceId = result.deviceId
  return embeddedDeviceId
}

export class SpotifyMusicProvider implements MusicProvider {
  async connect() {
    await connectSpotify()
    // A new authorization may belong to another Spotify account; never reuse the previous
    // account's cached library after reconnecting.
    await invalidateLibraryCache()
  }
  async disconnect() {
    await disconnectSpotify()
    await invalidateLibraryCache()
  }

  async getPlaybackState(): Promise<PlaybackState> {
    const remote = await getRemotePlayback()
    if (!remote?.item) return { ...INITIAL_PLAYBACK_STATE, availability: 'ready', shuffle: remote?.shuffle_state ?? false, repeatMode: remote?.repeat_state ?? 'off' }
    return {
      ...INITIAL_PLAYBACK_STATE,
      availability: 'ready',
      shuffle: remote.shuffle_state ?? false,
      repeatMode: remote.repeat_state ?? 'off',
      isPlaying: remote.is_playing,
      progressMs: remote.progress_ms ?? 0,
      durationMs: remote.item.duration_ms,
      track: {
        uri: remote.item.uri,
        isrc: remote.item.external_ids?.isrc,
        title: remote.item.name,
        artist: remote.item.artists?.map((artist) => artist.name).join('、') || '',
        artwork: remote.item.album?.images?.[0]?.url,
        durationMs: remote.item.duration_ms,
      },
    }
  }

  async toggle(current: PlaybackState) {
    const { deviceId, embedded } = await resolvePlaybackDevice()
    // activateElement only applies to Mori's embedded SDK device. Existing Spotify Connect
    // devices already own their audio context and are controlled through the Web API.
    if (embedded) await sendToPlaybackHost('PLAYER_ACTIVATE')
    if (current.isPlaying) { await pausePlayback(deviceId); return }
    const remote = await getRemotePlayback()
    if (!remote?.item || !embedded) await transferPlayback(deviceId, false)
    if (remote?.item) {
      await startPlayback(deviceId)
    } else {
      const selection = await this.getRandomLibraryTrack()
      const testUri = (await extensionStorage.getTestUri()).trim()
      if (selection) await startPlayback(deviceId, selection.track.uri, selection.contextUri, selection.queueUris)
      else if (testUri) await startPlayback(deviceId, testUri)
      else throw new Error('Spotify 曲库中没有可随机播放的歌曲，请先收藏歌曲或添加可读取歌单')
    }
    if (embedded) await sendToPlaybackHost('PLAYER_SET_VOLUME', { volume: 0.8 })
  }

  async next() { await nextPlayback(await resolveNavigationPlaybackDevice()) }
  async previous() { await previousPlayback(await resolveNavigationPlaybackDevice()) }
  async seek(positionMs: number) { await seekPlayback(await resolveActivePlaybackDevice(), positionMs) }
  async setPlaybackMode(mode: PlaybackMode) {
    const deviceId = await resolveActivePlaybackDevice()
    // Mori presents mutually exclusive modes even though Spotify models shuffle and repeat
    // as separate settings. Reset the other setting so the visible icon always matches reality.
    await Promise.all([
      setShuffle(deviceId, mode === 'shuffle'),
      setRepeat(deviceId, mode === 'context' ? 'context' : mode === 'track' ? 'track' : 'off'),
    ])
  }
  async getUserPlaylists() {
    const cached = (await extensionStorage.getLibraryCache()).playlists
    if (cached) {
      // Stale-while-revalidate keeps Mori instant across pages. Expired metadata is still useful;
      // refresh it in the background instead of replacing the list with a loading screen.
      if (!isFresh(cached.fetchedAt)) void refreshPlaylists().catch(() => undefined)
      return cached.data
    }
    return refreshPlaylists()
  }

  async getPlaylistTracks(playlistId: string) {
    const cached = (await extensionStorage.getLibraryCache()).tracks[playlistId]
    if (cached) {
      if (!isFresh(cached.fetchedAt)) void refreshPlaylistTracks(playlistId).catch(() => undefined)
      return cached.data
    }
    return refreshPlaylistTracks(playlistId)
  }

  async hasLibraryCache(playlistId?: string) {
    const cache = await extensionStorage.getLibraryCache()
    return playlistId ? Boolean(cache.tracks[playlistId]) : Boolean(cache.playlists)
  }

  async refreshLibrary() {
    await invalidateLibraryCache()
    return refreshPlaylists()
  }

  async playUri(uri: string, contextUri?: string, queueUris?: string[]) {
    const { deviceId, embedded } = await resolvePlaybackDevice()
    if (embedded) await sendToPlaybackHost('PLAYER_ACTIVATE')
    await transferPlayback(deviceId, false)
    await startPlayback(deviceId, uri, contextUri, queueUris)
    // Spotify may reapply the device volume while transferring/starting playback. Restore the
    // local SDK output after the play command, not only before it, to avoid a playing-but-silent host.
    if (embedded) await sendToPlaybackHost('PLAYER_SET_VOLUME', { volume: 0.8 })
  }

  async getSearchableLibraryTracks() {
    const playlists = (await this.getUserPlaylists()).filter((playlist) => playlist.isAccessible !== false)
    const unique = new Map<string, MusicTrack>()
    let cursor = 0
    const worker = async () => {
      while (cursor < playlists.length) {
        const playlist = playlists[cursor++]
        try {
          // UI 的歌单歌曲采用按需缓存；Agent 搜索不能依赖用户碰巧打开过哪些歌单。
          // 这里主动读取每个可访问来源，getPlaylistTracks 会复用已有缓存并补齐缺失项。
          const tracks = await this.getPlaylistTracks(playlist.id)
          for (const track of tracks) {
            if (track.uri && track.isPlayable !== false) unique.set(track.uri, { ...track, catalogSource: 'user_library' })
          }
        } catch {
          // 单个已删除或无权访问的歌单不应让整个搜索曲库不可用。
        }
      }
    }
    // 与歌单可访问性预检保持相同并发度，避免大型账号串行过慢，也避免 API 请求突发。
    await Promise.all(Array.from({ length: Math.min(4, playlists.length) }, () => worker()))
    return [...unique.values()]
  }

  async getPreferenceTracks() {
    const playlists = await this.getUserPlaylists()
    const liked = playlists.find((item) => item.id === LIKED_TRACKS_ID)
    const others = playlists.filter((item) => item.id !== LIKED_TRACKS_ID && item.isAccessible !== false)
    const sources = liked ? [liked, ...others] : others
    const tracksByPlaylist = new Map<string, MusicTrack[]>()
    const allUnique = new Set<string>()

    // The percentage must be based on the complete de-duplicated library, not on Spotify's first
    // page. Read every source before calculating the dynamic 20% sample ceiling.
    for (const playlist of sources) {
      try {
        const tracks = await this.getPlaylistTracks(playlist.id)
        tracksByPlaylist.set(playlist.id, tracks)
        for (const track of tracks) allUnique.add(preferenceTrackKey(track))
      } catch {
        // An unavailable playlist is excluded from both the denominator and the final sample.
      }
    }

    const sampleLimit = Math.ceil(allUnique.size * 0.2)
    const likedQuota = Math.ceil(sampleLimit * 0.5)
    const otherBudget = sampleLimit - likedQuota
    const unique = new Map<string, MusicTrack>()

    const addPlaylistSample = (playlist: MusicPlaylist, quota: number) => {
      if (quota <= 0) return
      let added = 0
      for (const track of tracksByPlaylist.get(playlist.id) ?? []) {
        const key = preferenceTrackKey(track)
        if (unique.has(key)) continue
        unique.set(key, track)
        added += 1
        if (added >= quota) break
      }
    }

    // Saved Tracks receives half of the dynamic sample budget. The other half is divided across
    // readable playlists so list order cannot let the first playlist dominate the taste profile.
    if (liked) addPlaylistSample(liked, likedQuota)
    if (others.length) {
      const quotaPerPlaylist = Math.floor(otherBudget / others.length)
      const remainder = otherBudget % others.length
      for (const [index, playlist] of others.entries()) {
        addPlaylistSample(playlist, quotaPerPlaylist + (index < remainder ? 1 : 0))
      }
    }
    return [...unique.values()]
  }

  async searchTracks(query: string, limit = 10) { return searchSpotifyTracks(query, limit) }

  private async getRandomLibraryTrack() {
    const playlists = shuffled(await this.getUserPlaylists()).filter((playlist) => playlist.isAccessible !== false && playlist.trackCount > 0)
    for (const playlist of playlists) {
      try {
        const tracks = (await this.getPlaylistTracks(playlist.id)).filter((track) => track.isPlayable !== false)
        if (!tracks.length) continue
        const selectedIndex = randomIndex(tracks.length)
        const track = tracks[selectedIndex]
        if (playlist.id !== LIKED_TRACKS_ID) return { track, contextUri: playlist.uri }
        // Saved Tracks has no valid Spotify context URI. Rotate its playable URI queue so the
        // random selection starts first while next/previous still have meaningful items.
        const uris = tracks.map((item) => item.uri)
        return { track, queueUris: [...uris.slice(selectedIndex), ...uris.slice(0, selectedIndex)] }
      } catch {
        // Random start should continue trying other playlists when one became unavailable.
      }
    }
    return null
  }
}

function preferenceTrackKey(track: MusicTrack) {
  return track.isrc || `${track.title.toLowerCase()}::${track.artist.toLowerCase()}`
}

function randomIndex(length: number) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % length
}

function shuffled<T>(items: T[]) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1)
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function isFresh(fetchedAt: number) {
  return Date.now() - fetchedAt < LIBRARY_CACHE_TTL_MS
}

function refreshPlaylists() {
  if (!playlistsRequest) {
    const generation = libraryGeneration
    let request: Promise<MusicPlaylist[]>
    request = fetchUserPlaylists().then(validatePlaylistAccessibility).then(async (data) => {
      if (generation === libraryGeneration) {
        const cache = await extensionStorage.getLibraryCache()
        // Background revalidation must not silently re-enable a playlist already confirmed as
        // forbidden. Explicit refresh clears the cache first and intentionally retries it.
        const merged = data.map((playlist) => cache.playlists?.data.find((item) => item.id === playlist.id)?.isAccessible === false
          ? { ...playlist, isAccessible: false }
          : playlist)
        await extensionStorage.setLibraryCache({ ...cache, playlists: { fetchedAt: Date.now(), data: merged } })
        return merged
      }
      return data
    }).finally(() => { if (playlistsRequest === request) playlistsRequest = null })
    playlistsRequest = request
  }
  return playlistsRequest
}

async function validatePlaylistAccessibility(playlists: MusicPlaylist[]) {
  const result = playlists.map((playlist) => ({ ...playlist }))
  let cursor = 0
  const worker = async () => {
    while (cursor < result.length) {
      const index = cursor++
      const playlist = result[index]
      if (playlist.id === LIKED_TRACKS_ID) continue
      try { playlist.isAccessible = await canAccessPlaylist(playlist.id) }
      catch { playlist.isAccessible = true }
    }
  }
  // Spotify accounts may contain dozens of playlists. Four workers keep first-load validation
  // reasonably fast without creating a burst likely to trigger API rate limiting.
  await Promise.all(Array.from({ length: Math.min(4, result.length) }, () => worker()))
  return result
}

function refreshPlaylistTracks(playlistId: string) {
  const activeRequest = trackRequests.get(playlistId)
  if (activeRequest) return activeRequest
  const generation = libraryGeneration
  let request: Promise<MusicTrack[]>
  request = fetchPlaylistTracks(playlistId).then(async (data) => {
    if (generation === libraryGeneration) {
      const cache = await extensionStorage.getLibraryCache()
      await extensionStorage.setLibraryCache({ ...cache, tracks: { ...cache.tracks, [playlistId]: { fetchedAt: Date.now(), data } } })
    }
    return data
  }).catch(async (error) => {
    if (isPlaylistAccessError(error)) await markPlaylistUnavailable(playlistId)
    throw error
  }).finally(() => { if (trackRequests.get(playlistId) === request) trackRequests.delete(playlistId) })
  trackRequests.set(playlistId, request)
  return request
}

function isPlaylistAccessError(error: unknown) {
  return error instanceof Error && /forbidden|not available|not found/i.test(error.message)
}

async function markPlaylistUnavailable(playlistId: string) {
  const cache = await extensionStorage.getLibraryCache()
  if (!cache.playlists) return
  await extensionStorage.setLibraryCache({
    ...cache,
    playlists: {
      ...cache.playlists,
      data: cache.playlists.data.map((playlist) => playlist.id === playlistId ? { ...playlist, isAccessible: false } : playlist),
    },
  })
}

async function invalidateLibraryCache() {
  // In-flight requests cannot be cancelled reliably. Bump the generation so their late results
  // cannot repopulate data belonging to the previous account or an explicitly cleared cache.
  libraryGeneration += 1
  playlistsRequest = null
  trackRequests.clear()
  await extensionStorage.removeLibraryCache()
}

async function resolveActivePlaybackDevice() {
  const devices = (await getAvailableDevices())?.devices ?? []
  const active = devices.find((device) => device.is_active && !device.is_restricted && device.id)
  // Skip commands must target the device that owns the current Spotify session. Creating a new
  // inactive Mori device here makes the request appear successful without changing the track.
  if (!active?.id) throw new Error('当前没有正在播放的 Spotify 设备，请先播放一首歌')
  return active.id
}

async function resolveNavigationPlaybackDevice() {
  try { return await resolveActivePlaybackDevice() }
  catch {
    // 歌曲刚结束时 Spotify 可能先把设备标记为 inactive，用户此时点击上一首/下一首
    // 仍是明确的播放意图。只对导航命令恢复 Mori 设备并继续会话；seek 和模式设置
    // 继续要求真实 active device，避免无意中启动播放。
    const deviceId = await ensureSpotifyDevice()
    await transferPlayback(deviceId, true)
    return deviceId
  }
}

async function resolvePlaybackDevice() {
  try {
    return { deviceId: await ensureSpotifyDevice(), embedded: true }
  } catch (sdkError) {
    const devices = (await getAvailableDevices())?.devices ?? []
    const fallback = devices.find((device) => device.is_active && !device.is_restricted && device.id)
      ?? devices.find((device) => !device.is_restricted && device.id)
    if (fallback?.id) return { deviceId: fallback.id, embedded: false }
    const reason = sdkError instanceof Error ? sdkError.message : 'Mori 浏览器播放设备初始化失败'
    throw new Error(`${reason}；同时没有可用的 Spotify Connect 设备。请检查网络，或先打开 Spotify 官方客户端。`)
  }
}
