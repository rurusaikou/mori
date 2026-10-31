import {
  OFFSCREEN_MESSAGE_SOURCE,
  PLAYBACK_HOST_MESSAGE_SOURCE,
  type PlaybackHostEvent,
  type PlaybackHostFrameRequest,
} from '@mori/contracts/playback-host'
import { SpotifyPlaybackDevice } from './spotify-player'

const statusElement = document.querySelector<HTMLElement>('#status')!
let extensionOrigin = '*'

function send(message: object) {
  // The access token only travels from Extension → Host. Responses contain playback state and
  // Spotify's short-lived device id, so the host never leaks credentials back to page contexts.
  window.parent.postMessage({ source: PLAYBACK_HOST_MESSAGE_SOURCE, ...message }, extensionOrigin)
}

const playback = new SpotifyPlaybackDevice((event: PlaybackHostEvent) => send({ type: 'PLAYBACK_EVENT', event }))

async function handleRequest(request: PlaybackHostFrameRequest) {
  if (request.type === 'PLAYER_INIT') {
    if (!request.payload?.token) throw new Error('Playback Host 没有收到 Spotify token')
    return playback.initialize(request.payload.token)
  }
  if (request.type === 'PLAYER_ACTIVATE') { await playback.activate(); return null }
  return null
}

window.addEventListener('message', (event: MessageEvent<PlaybackHostFrameRequest>) => {
  if (event.source !== window.parent || event.data?.source !== OFFSCREEN_MESSAGE_SOURCE) return
  // After the first protocol message, direct every state/error response back to the exact
  // Extension origin. The initial ready beacon contains no credentials and uses `*`.
  extensionOrigin = event.origin
  statusElement.textContent = '正在连接 Spotify…'
  void handleRequest(event.data)
    .then((result) => { statusElement.textContent = 'Mori 播放设备已就绪'; send({ id: event.data.id, ok: true, result }) })
    .catch((error) => {
      const message = error instanceof Error ? error.message : '播放宿主失败'
      statusElement.textContent = message
      send({ id: event.data.id, ok: false, error: message })
    })
})

send({ type: 'PLAYBACK_HOST_READY' })
