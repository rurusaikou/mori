export const SPOTIFY_SCOPES = [
  'playlist-read-private', 'playlist-read-collaborative', 'user-read-private', 'user-read-email',
  'user-library-read',
]

const STORAGE = { verifier: 'mori.spotify.verifier', state: 'mori.spotify.state', token: 'mori.spotify.token' } as const

export type SpotifyToken = { accessToken: string; refreshToken?: string; expiresAt: number; scope: string }
export type SpotifyUser = { id: string; display_name: string | null; images?: { url: string }[]; external_urls: { spotify: string } }
export type SpotifyPlaylist = {
  id: string; name: string; description: string
  images?: { url: string; width: number | null; height: number | null }[]
  owner?: { id?: string; display_name: string | null }
  collaborative?: boolean
  tracks?: { total: number }
  items?: { total: number }
  external_urls?: { spotify?: string }
}
type SpotifyPage<T> = { items: T[]; next: string | null }
export type SpotifyTrack = {
  id: string; uri: string; name: string; duration_ms: number
  artists: { name: string }[]; album: { name: string; images?: { url: string }[] }
  external_ids?: { isrc?: string }
}

function clientId() {
  const value = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim()
  if (!value) throw new Error('尚未配置 Spotify Client ID')
  return value
}

export function spotifyRedirectUri() {
  const configured = process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI?.trim()
  if (configured) return configured
  if (typeof window === 'undefined') return ''
  const url = new URL('/spotify/callback', window.location.origin)
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  return url.toString()
}

function randomString(length = 64) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

async function challengeFor(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export async function startSpotifyLogin() {
  // PKCE verifier 只需跨越本次授权跳转，使用 sessionStorage 可避免它长期驻留。
  const verifier = randomString(96)
  const state = randomString(32)
  sessionStorage.setItem(STORAGE.verifier, verifier)
  sessionStorage.setItem(STORAGE.state, state)
  const params = new URLSearchParams({
    client_id: clientId(), response_type: 'code', redirect_uri: spotifyRedirectUri(), scope: SPOTIFY_SCOPES.join(' '),
    code_challenge_method: 'S256', code_challenge: await challengeFor(verifier), state,
  })
  window.location.assign(`https://accounts.spotify.com/authorize?${params}`)
}

function saveToken(payload: { access_token: string; refresh_token?: string; expires_in: number; scope?: string }, previous?: SpotifyToken) {
  const token: SpotifyToken = {
    accessToken: payload.access_token, refreshToken: payload.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + payload.expires_in * 1000, scope: payload.scope ?? previous?.scope ?? '',
  }
  localStorage.setItem(STORAGE.token, JSON.stringify(token))
  return token
}

export async function completeSpotifyLogin(code: string, returnedState: string | null) {
  const verifier = sessionStorage.getItem(STORAGE.verifier)
  const expectedState = sessionStorage.getItem(STORAGE.state)
  sessionStorage.removeItem(STORAGE.verifier)
  sessionStorage.removeItem(STORAGE.state)
  if (!verifier || !expectedState || returnedState !== expectedState) throw new Error('Spotify 登录校验失败，请重新连接')
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), grant_type: 'authorization_code', code, redirect_uri: spotifyRedirectUri(), code_verifier: verifier }),
  })
  if (!response.ok) throw new Error('Spotify 授权交换失败，请检查回调地址配置')
  return saveToken(await response.json())
}

export function getSpotifyToken() {
  if (typeof window === 'undefined') return null
  try {
    const value = localStorage.getItem(STORAGE.token)
    return value ? (JSON.parse(value) as SpotifyToken) : null
  } catch {
    localStorage.removeItem(STORAGE.token)
    return null
  }
}

export function disconnectSpotify() {
  localStorage.removeItem(STORAGE.token)
  localStorage.removeItem('mori.music-profile')
  localStorage.removeItem('mori.music-features')
}

async function refreshSpotifyToken(token: SpotifyToken) {
  if (!token.refreshToken) throw new Error('Spotify 登录已过期，请重新连接')
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), grant_type: 'refresh_token', refresh_token: token.refreshToken }),
  })
  if (!response.ok) throw new Error('Spotify 登录已过期，请重新连接')
  return saveToken(await response.json(), token)
}

async function validToken() {
  const token = getSpotifyToken()
  if (!token) throw new Error('请先连接 Spotify')
  return token.expiresAt - Date.now() > 60_000 ? token : refreshSpotifyToken(token)
}

async function spotifyFetch<T>(url: string): Promise<T> {
  const token = await validToken()
  const request = (accessToken: string) => fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) })
  let response: Response
  try {
    response = await request(token.accessToken)
  } catch {
    throw new Error('Spotify 响应超时，请稍后重试')
  }
  if (response.status === 401 && token.refreshToken) {
    const refreshed = await refreshSpotifyToken(token)
    try {
      response = await request(refreshed.accessToken)
    } catch {
      throw new Error('Spotify 响应超时，请稍后重试')
    }
  }
  if (!response.ok) throw new Error(response.status === 403 ? 'Spotify 仅允许读取本人创建或参与协作的歌单' : 'Spotify 数据读取失败')
  return response.json()
}

export function hasSpotifyLibraryScope() {
  return new Set(getSpotifyToken()?.scope.split(' ') ?? []).has('user-library-read')
}

export async function getSpotifySavedTracks(maxTracks = Number.POSITIVE_INFINITY) {
  const tracks: SpotifyTrack[] = []
  let next: string | null = 'https://api.spotify.com/v1/me/tracks?limit=50'
  while (next && tracks.length < maxTracks) {
    const page: SpotifyPage<{ track: SpotifyTrack }> = await spotifyFetch(next)
    tracks.push(...page.items.map((entry) => entry.track).filter((track): track is SpotifyTrack => Boolean(track?.uri)))
    next = page.next
  }
  return tracks.slice(0, maxTracks)
}

export async function getSpotifyPlaylistItems(playlistId: string, maxTracks = Number.POSITIVE_INFINITY) {
  const tracks: SpotifyTrack[] = []
  let next: string | null = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=50`
  while (next && tracks.length < maxTracks) {
    const page: SpotifyPage<{ item?: SpotifyTrack; track?: SpotifyTrack }> = await spotifyFetch(next)
    tracks.push(...page.items.map((entry) => entry.item ?? entry.track).filter((track): track is SpotifyTrack => Boolean(track?.uri)))
    next = page.next
  }
  return tracks.slice(0, maxTracks)
}

export async function getSpotifyLibrary() {
  const user = await spotifyFetch<SpotifyUser>('https://api.spotify.com/v1/me')
  const playlists: SpotifyPlaylist[] = []
  let next: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50'
  while (next) {
    const page: SpotifyPage<SpotifyPlaylist> = await spotifyFetch<SpotifyPage<SpotifyPlaylist>>(next)
    playlists.push(...page.items.filter(Boolean))
    next = page.next
  }
  return { user, playlists }
}
