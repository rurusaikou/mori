import { SPOTIFY_SCOPES } from '../../shared/constants'
import { extensionStorage, type SpotifyToken } from '../../storage/extension-storage'

function randomString(length = 64) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

async function challengeFor(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function requireClientId() {
  const clientId = (await extensionStorage.getClientId()).trim()
  if (!clientId) throw new Error('请先在 Mori 扩展设置中填写 Spotify Client ID')
  return clientId
}

function normalizeToken(payload: { access_token: string; refresh_token?: string; expires_in: number; scope?: string }, previous?: SpotifyToken): SpotifyToken {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + payload.expires_in * 1_000,
    scope: payload.scope ?? previous?.scope ?? '',
  }
}

async function saveToken(payload: { access_token: string; refresh_token?: string; expires_in: number; scope?: string }, previous?: SpotifyToken) {
  const token = normalizeToken(payload, previous)
  await extensionStorage.setToken(token)
  return token
}

export async function connectSpotify() {
  // PKCE keeps Mori client-secret-free: the verifier stays in this trusted service-worker
  // call while Spotify only receives its SHA-256 challenge during browser authorization.
  const clientId = await requireClientId()
  const verifier = randomString(96)
  const state = randomString(32)
  const redirectUri = chrome.identity.getRedirectURL('spotify')
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    state,
  })

  let responseUrl: string | undefined
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: `https://accounts.spotify.com/authorize?${params}`, interactive: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes('Authorization page could not be loaded')) {
      throw new Error(`Spotify 授权页无法打开。请确认 Developer Dashboard 已保存 Redirect URI：${redirectUri}`)
    }
    throw error
  }
  if (!responseUrl) throw new Error('Spotify 没有返回授权结果')

  const returned = new URL(responseUrl)
  if (returned.searchParams.get('state') !== state) throw new Error('Spotify 登录校验失败')
  const authError = returned.searchParams.get('error')
  if (authError) throw new Error(authError === 'access_denied' ? '你取消了 Spotify 授权' : `Spotify 授权失败：${authError}`)
  const code = returned.searchParams.get('code')
  if (!code) throw new Error('Spotify 没有返回授权码')

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }),
  })
  if (!response.ok) throw new Error('Spotify Token 交换失败，请检查 Client ID 和 Redirect URI')
  await saveToken(await parseTokenResponse(response))
}

export async function getValidAccessToken() {
  const token = await extensionStorage.getToken()
  if (!token) throw new Error('请先连接 Spotify')
  // Refresh one minute early so a token cannot expire while the SDK is registering a device.
  if (token.expiresAt - Date.now() > 60_000) return token.accessToken
  if (!token.refreshToken) throw new Error('Spotify 登录已过期，请重新连接')

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: await requireClientId(), grant_type: 'refresh_token', refresh_token: token.refreshToken }),
  })
  if (!response.ok) throw new Error('Spotify 登录已过期，请重新连接')
  return (await saveToken(await parseTokenResponse(response), token)).accessToken
}

export async function disconnectSpotify() {
  await extensionStorage.removeToken()
}

async function parseTokenResponse(response: Response) {
  const body = await response.text()
  try {
    const payload = JSON.parse(body) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }
    if (!payload.access_token || typeof payload.expires_in !== 'number') throw new Error('missing token fields')
    return payload as { access_token: string; refresh_token?: string; expires_in: number; scope?: string }
  } catch {
    // Do not leak an opaque token or a proxy response into the UI through JSON.parse's raw error.
    throw new Error('Spotify 登录服务返回了无法识别的数据，请重新连接 Spotify')
  }
}
