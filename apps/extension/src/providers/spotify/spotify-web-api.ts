import type { MusicPlaylist, MusicTrack } from '@mori/domain'
import { getValidAccessToken } from './spotify-auth'

type SpotifyPlayback = {
  is_playing: boolean
  shuffle_state?: boolean
  repeat_state?: 'off' | 'context' | 'track'
  progress_ms?: number
  device?: { id?: string | null }
  item?: {
    uri: string
    name: string
    duration_ms: number
    artists?: { name: string }[]
    album?: { images?: { url: string }[] }
  }
}

type SpotifyDevice = { id: string | null; is_active: boolean; is_restricted: boolean; name: string }
type SpotifyPlaylistTrack = { uri: string; name: string; duration_ms: number; is_local?: boolean; is_playable?: boolean; restrictions?: { reason?: string }; artists?: Array<{ name: string }>; album?: { images?: Array<{ url: string }> } }

export const LIKED_TRACKS_ID = 'mori-liked-tracks'

export async function spotifyFetch<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  let token: string
  try {
    token = await getValidAccessToken()
  } catch (error) {
    if (isNetworkFailure(error)) throw new Error('Spotify 登录续期失败：无法连接 accounts.spotify.com，请检查网络后重试')
    throw error
  }

  let response: Response
  try {
    response = await fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    })
  } catch (error) {
    // fetch only throws before an HTTP response exists (DNS, TLS, proxy, offline or blocking).
    // Keeping it distinct from Spotify's 4xx responses makes extension diagnostics actionable.
    if (isNetworkFailure(error)) throw new Error('无法连接 Spotify Web API（api.spotify.com）。请检查网络、代理或浏览器扩展的网络限制')
    throw error
  }
  if (response.status === 204) return null
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null
    const message = payload?.error?.message
    if (response.status === 403) throw new Error(message || 'Spotify Premium 或播放权限不可用')
    if (response.status === 404) throw new Error(message || 'Spotify 当前没有可控制的播放设备')
    throw new Error(message || `Spotify 请求失败（${response.status}）`)
  }
  const body = await response.text()
  if (!body) return null
  try {
    return JSON.parse(body) as T
  } catch {
    // Spotify write endpoints do not have a useful response body. Some gateways return an opaque
    // success token instead of JSON; treating that as command data produced raw JSON parse errors
    // in the player even though the play/pause request had already succeeded.
    if ((init.method ?? 'GET').toUpperCase() !== 'GET') return null
    throw new Error(`Spotify 返回了无法识别的数据（${path}）`)
  }
}

function isNetworkFailure(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && /failed to fetch|networkerror/i.test(error.message))
}

export const getRemotePlayback = () => spotifyFetch<SpotifyPlayback>('/me/player')
export const getAvailableDevices = () => spotifyFetch<{ devices: SpotifyDevice[] }>('/me/player/devices')

export async function canAccessPlaylist(playlistId: string) {
  try {
    await spotifyFetch<{ items: unknown[] }>(`/playlists/${encodeURIComponent(playlistId)}/items?limit=1`)
    return true
  } catch (error) {
    // Only definitive permission/not-found responses make a playlist unavailable. Network and
    // rate-limit failures are transient and must not permanently gray out valid user content.
    if (error instanceof Error && /forbidden|not available|not found/i.test(error.message)) return false
    throw error
  }
}

export async function getUserPlaylists(): Promise<MusicPlaylist[]> {
  const [response, liked] = await Promise.all([
    spotifyFetch<{ items: Array<{ id: string; uri: string; name: string; images?: Array<{ url: string }>; items?: { total: number }; tracks?: { total: number } }> }>('/me/playlists?limit=30'),
    spotifyFetch<{ total: number }>('/me/tracks?limit=1'),
  ])
  return [{
    id: LIKED_TRACKS_ID,
    uri: 'spotify:collection:tracks',
    name: '我收藏的歌曲',
    trackCount: liked?.total ?? 0,
    isAccessible: true,
  }, ...(response?.items ?? []).map((playlist) => ({
    id: playlist.id,
    uri: playlist.uri,
    name: playlist.name,
    artwork: playlist.images?.[0]?.url,
    trackCount: playlist.items?.total ?? playlist.tracks?.total ?? 0,
    isAccessible: true,
  }))]
}

export async function getPlaylistTracks(playlistId: string): Promise<MusicTrack[]> {
  const path = playlistId === LIKED_TRACKS_ID
    ? '/me/tracks?limit=50'
    : `/playlists/${encodeURIComponent(playlistId)}/items?limit=50`
  const response = await spotifyFetch<{ items: Array<{ item?: SpotifyPlaylistTrack | null; track?: SpotifyPlaylistTrack | null }> }>(path)
  return (response?.items ?? []).flatMap((entry) => {
    // `item` is the current field; `track` keeps existing non-dev-mode apps compatible
    // during Spotify's endpoint migration window.
    const track = entry.item ?? entry.track
    return track?.uri ? [{
    uri: track.uri,
    title: track.name,
    artist: track.artists?.map((artist) => artist.name).join('、') || '',
    artwork: track.album?.images?.[0]?.url,
    durationMs: track.duration_ms,
    isPlayable: !track.is_local && track.is_playable !== false && !track.restrictions,
    }] : []
  })
}

export const transferPlayback = (deviceId: string, play = false) => spotifyFetch<never>('/me/player', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_ids: [deviceId], play }),
})

export const startPlayback = (deviceId: string, uri?: string, contextUri?: string, queueUris?: string[]) => {
  // Starting one track with `uris: [uri]` creates a one-item queue, so Spotify accepts next/prev
  // without changing anything. Preserve the playlist context and start at the selected track.
  const body = queueUris?.length
    ? { uris: queueUris }
    : contextUri && uri
    ? { context_uri: contextUri, offset: { uri } }
    : uri ? (uri.startsWith('spotify:track:') ? { uris: [uri] } : { context_uri: uri }) : undefined
  return spotifyFetch<never>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
  })
}

export const pausePlayback = (deviceId: string) => spotifyFetch<never>(`/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, { method: 'PUT' })
export const nextPlayback = (deviceId: string) => spotifyFetch<never>(`/me/player/next?device_id=${encodeURIComponent(deviceId)}`, { method: 'POST' })
export const previousPlayback = (deviceId: string) => spotifyFetch<never>(`/me/player/previous?device_id=${encodeURIComponent(deviceId)}`, { method: 'POST' })
export const setShuffle = (deviceId: string, enabled: boolean) => spotifyFetch<never>(`/me/player/shuffle?state=${enabled}&device_id=${encodeURIComponent(deviceId)}`, { method: 'PUT' })
export const setRepeat = (deviceId: string, mode: 'off' | 'context' | 'track') => spotifyFetch<never>(`/me/player/repeat?state=${mode}&device_id=${encodeURIComponent(deviceId)}`, { method: 'PUT' })
