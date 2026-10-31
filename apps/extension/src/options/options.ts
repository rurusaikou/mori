import { sendRuntimeRequest } from '../shared/runtime-client'
import { extensionStorage } from '../storage/extension-storage'

const clientIdInput = document.querySelector<HTMLInputElement>('#client-id')!
const testUriInput = document.querySelector<HTMLInputElement>('#test-uri')!
const playbackHostUrlInput = document.querySelector<HTMLInputElement>('#playback-host-url')!
const status = document.querySelector<HTMLElement>('#status')!
document.querySelector<HTMLOutputElement>('#redirect')!.textContent = chrome.identity.getRedirectURL('spotify')

void Promise.all([extensionStorage.getClientId(), extensionStorage.getTestUri(), extensionStorage.getPlaybackHostUrl(), extensionStorage.getToken()])
  .then(([clientId, testUri, playbackHostUrl, token]) => {
    clientIdInput.value = clientId
    testUriInput.value = testUri
    playbackHostUrlInput.value = playbackHostUrl
    status.textContent = token ? 'Spotify 已连接。' : 'Spotify 尚未连接。'
  })
  .catch(showError)

async function save() {
  const normalizedClientId = clientIdInput.value.trim()
  const normalizedTestUri = testUriInput.value.trim()
  const playbackHostUrl = playbackHostUrlInput.value.trim()
  if (!normalizedClientId) throw new Error('请填写 Spotify Client ID')
  if (normalizedTestUri && !/^spotify:(track|album|playlist):[^:]+$/.test(normalizedTestUri)) {
    throw new Error('测试播放 URI 必须留空，或使用 spotify:track:…、spotify:album:…、spotify:playlist:… 格式')
  }
  const parsedHostUrl = new URL(playbackHostUrl)
  if (parsedHostUrl.protocol !== 'https:' && !(parsedHostUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsedHostUrl.hostname))) {
    throw new Error('Playback Host 必须使用 HTTPS；仅本地开发可使用 localhost HTTP')
  }
  // The host is deployed as a static directory. A trailing slash keeps its relative player.js
  // URL inside that directory instead of resolving against the site root.
  if (!parsedHostUrl.pathname.endsWith('/')) parsedHostUrl.pathname += '/'
  await Promise.all([
    extensionStorage.setClientId(normalizedClientId),
    extensionStorage.setTestUri(normalizedTestUri),
    extensionStorage.setPlaybackHostUrl(parsedHostUrl.toString()),
  ])
  status.textContent = '设置已保存。'
}

document.querySelector('#save')!.addEventListener('click', () => void save().catch(showError))
document.querySelector('#connect')!.addEventListener('click', () => void (async () => {
  await save()
  status.textContent = '正在连接 Spotify…'
  await sendRuntimeRequest({ type: 'MORI_CONNECT_SPOTIFY' })
  status.textContent = 'Spotify 已连接。请打开任意普通网页，再点击扩展图标召唤 Mori；设置页本身不能注入。'
})().catch(showError))
document.querySelector('#disconnect')!.addEventListener('click', () => void sendRuntimeRequest({ type: 'MORI_DISCONNECT_SPOTIFY' })
  .then(() => { status.textContent = 'Spotify 已解除连接。' })
  .catch(showError))

function showError(error: unknown) {
  status.textContent = error instanceof Error ? error.message : '操作失败'
}
