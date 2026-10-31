import { INITIAL_PLAYBACK_STATE, type MusicPlaylist, type MusicProvider, type MusicTrack, type PlaybackMode, type PlaybackState } from '@mori/domain'
import type { PlaybackHostRequest, RuntimeResponse } from '../../shared/messages'
import { extensionStorage } from '../../storage/extension-storage'
import { connectSpotify, disconnectSpotify, getValidAccessToken } from './spotify-auth'
import { canAccessPlaylist, getAvailableDevices, getPlaylistTracks as fetchPlaylistTracks, getRemotePlayback, getUserPlaylists as fetchUserPlaylists, LIKED_TRACKS_ID, nextPlayback, pausePlayback, previousPlayback, setRepeat, setShuffle, startPlayback, transferPlayback } from './spotify-web-api'

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html'
const LIBRARY_CACHE_TTL_MS = 60 * 60 * 1_000
let creatingOffscreen: Promise<void> | null = null
let playlistsRequest: Promise<MusicPlaylist[]> | null = null
const trackRequests = new Map<string, Promise<MusicTrack[]>>()
let libraryGeneration = 0

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH)
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })
  if (contexts.length) return
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
  const result = await sendToPlaybackHost('PLAYER_INIT', {
    token: await getValidAccessToken(),
    hostUrl: await extensionStorage.getPlaybackHostUrl(),
  })
  if (!result?.deviceId) throw new Error('Spotify Web Playback SDK 尚未返回设备')
  return result.deviceId
}

export class SpotifyMusicProvider implements MusicProvider {
  readonly id = 'spotify'
  readonly capabilities = {
    canCreatePlaybackDevice: true,
    requiresExistingDevice: false,
    canPlay: true,
    canPause: true,
    canSkipNext: true,
    canSkipPrevious: true,
    canSave: false,
  }

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
    if (!remote?.item) return { ...INITIAL_PLAYBACK_STATE, availability: 'ready', deviceId: remote?.device?.id ?? null, shuffle: remote?.shuffle_state ?? false, repeatMode: remote?.repeat_state ?? 'off' }
    return {
      ...INITIAL_PLAYBACK_STATE,
      availability: 'ready',
      deviceId: remote.device?.id ?? null,
      shuffle: remote.shuffle_state ?? false,
      repeatMode: remote.repeat_state ?? 'off',
      isPlaying: remote.is_playing,
      progressMs: remote.progress_ms ?? 0,
      durationMs: remote.item.duration_ms,
      track: {
        uri: remote.item.uri,
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
    await startPlayback(deviceId, remote?.item ? undefined : (await extensionStorage.getTestUri()).trim() || undefined)
  }

  async next() { await nextPlayback(await resolveActivePlaybackDevice()) }
  async previous() { await previousPlayback(await resolveActivePlaybackDevice()) }
  async setPlaybackMode(mode: PlaybackMode) {
    const deviceId = await resolveActivePlaybackDevice()
    // The mini UI presents mutually exclusive modes even though Spotify models shuffle and repeat
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

  async refreshLibrary() {
    await invalidateLibraryCache()
    return refreshPlaylists()
  }

  async playUri(uri: string, contextUri?: string, queueUris?: string[]) {
    const { deviceId, embedded } = await resolvePlaybackDevice()
    if (embedded) await sendToPlaybackHost('PLAYER_ACTIVATE')
    await transferPlayback(deviceId, false)
    await startPlayback(deviceId, uri, contextUri, queueUris)
  }
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
