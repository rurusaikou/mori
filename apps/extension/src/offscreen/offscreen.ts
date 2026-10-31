import type { PlaybackHostRequest, RuntimeResponse } from '../shared/messages'
import { OFFSCREEN_MESSAGE_SOURCE, PLAYBACK_HOST_MESSAGE_SOURCE } from '@mori/contracts/playback-host'

const frame = document.querySelector<HTMLIFrameElement>('#spotify-player')!
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>()
let requestId = 0
let activeHostUrl = ''
let activeHostOrigin = ''
let hostReady: Promise<void> | null = null
let markHostReady: (() => void) | null = null

function ensurePlaybackHost(hostUrl?: string) {
  if (!hostUrl) throw new Error('未配置 Mori Playback Host URL')
  const parsedUrl = new URL(hostUrl)
  const isLocalDevelopment = parsedUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)
  if (parsedUrl.protocol !== 'https:' && !isLocalDevelopment) throw new Error('Mori Playback Host 必须使用 HTTPS')
  if (hostReady && activeHostUrl === hostUrl) return hostReady
  activeHostUrl = hostUrl
  activeHostOrigin = parsedUrl.origin
  const loading = new Promise<void>((resolve, reject) => {
    markHostReady = resolve
    const timer = window.setTimeout(() => reject(new Error(`Mori Playback Host 无法打开：${hostUrl}`)), 12_000)
    const complete = () => { window.clearTimeout(timer); resolve() }
    markHostReady = complete
  })
  // A transient local-server/network failure must not permanently poison this offscreen
  // document. Clearing the cached promise lets the next explicit click retry the same URL.
  hostReady = loading.catch((error) => {
    hostReady = null
    markHostReady = null
    throw error
  })
  frame.src = hostUrl
  return hostReady
}

async function requestPlayer(type: PlaybackHostRequest['type'], payload: PlaybackHostRequest['payload'] = {}) {
  if (type === 'PLAYER_INIT') await ensurePlaybackHost(payload.hostUrl)
  else if (!hostReady) throw new Error('Mori Playback Host 尚未初始化')
  else await hostReady
  return new Promise((resolve, reject) => {
    const id = `mori-${++requestId}`
    const timer = window.setTimeout(() => { pending.delete(id); reject(new Error('Spotify 播放宿主响应超时')) }, 25_000)
    pending.set(id, { resolve, reject, timer })
    // The token is included in PLAYER_INIT. Target the configured origin rather than `*` so a
    // navigated or compromised iframe cannot receive credentials intended for another host.
    const hostPayload = type === 'PLAYER_INIT' ? { token: payload.token } : undefined
    frame.contentWindow?.postMessage({ source: OFFSCREEN_MESSAGE_SOURCE, id, type, payload: hostPayload }, activeHostOrigin)
  })
}

window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || event.origin !== activeHostOrigin || event.data?.source !== PLAYBACK_HOST_MESSAGE_SOURCE) return
  if (event.data.type === 'PLAYBACK_HOST_READY') { markHostReady?.(); return }
  if (event.data.type === 'PLAYBACK_EVENT') { void chrome.runtime.sendMessage({ type: 'PLAYBACK_EVENT', event: event.data.event }); return }
  const entry = pending.get(event.data.id)
  if (!entry) return
  window.clearTimeout(entry.timer)
  pending.delete(event.data.id)
  if (event.data.ok) entry.resolve(event.data.result)
  else entry.reject(new Error(event.data.error || 'Spotify 播放命令失败'))
})

chrome.runtime.onMessage.addListener((message: PlaybackHostRequest, _sender, sendResponse: (response: RuntimeResponse) => void) => {
  if (message?.target !== 'offscreen') return false
  void requestPlayer(message.type, message.payload)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Spotify 播放宿主失败' }))
  return true
})
