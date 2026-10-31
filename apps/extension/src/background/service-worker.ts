import { getCompanionData, saveMusicMemory, sendCompanionMessage } from '../companion/companion-service'
import type { RuntimeRequest, RuntimeResponse, TabMessage } from '../shared/messages'
import { extensionStorage } from '../storage/extension-storage'
import { MusicController } from './music-controller'
import { PresenceController } from './presence-controller'

const music = new MusicController()
const presence = new PresenceController()
// Content scripts normally share chrome.storage access with extension pages. Restricting both
// stores makes OAuth tokens, conversations and memories inaccessible from the host-page context.
const storageSecured = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
])
const restored = storageSecured.then(() => Promise.all([music.restore(), presence.restore()]))

chrome.action.onClicked.addListener((tab) => {
  void restored
    .then(() => presence.toggleFromToolbar(tab))
    .catch((error) => console.error('Failed to toggle Mori presence:', error))
})

chrome.runtime.onMessage.addListener((message: RuntimeRequest & { target?: string }, sender, sendResponse: (response: RuntimeResponse) => void) => {
  // Offscreen messages share runtime.onMessage with the service worker. Ignoring addressed messages
  // prevents two contexts from racing to answer the same request.
  if (message?.target === 'offscreen') return false

  const handle = async () => {
    await restored
    switch (message?.type) {
      case 'MORI_GET_STATE':
        return { state: music.state }
      case 'MORI_GET_PRESENCE_STATE':
        return { visible: presence.enabled, position: await extensionStorage.getPosition() }
      case 'MORI_SAVE_POSITION':
        await extensionStorage.setPosition(message.position)
        return { saved: true }
      case 'MORI_CONNECT_SPOTIFY':
        await music.connect()
        return { connected: true }
      case 'MORI_DISCONNECT_SPOTIFY':
        await music.disconnect()
        return { connected: false }
      case 'MORI_TOGGLE_PLAYBACK':
        // Playback setup may create an offscreen document, initialize DRM and transfer a Spotify
        // device. A content-script message channel is too fragile for that multi-second workflow,
        // so acknowledge the user gesture immediately and publish success/error through MusicState.
        void music.toggle().catch((error) => console.error('Failed to toggle playback:', error))
        return { accepted: true }
      case 'MORI_PLAYBACK_COMMAND':
        // Skip targets an already active device and should finish quickly. Await it so the UI
        // receives the real Spotify success/error instead of an unconditional acknowledgement.
        await music.command(message.command)
        return { changed: true }
      case 'MORI_SET_PLAYBACK_MODE':
        await music.setPlaybackMode(message.mode)
        return { changed: true }
      case 'MORI_GET_PLAYLISTS':
        return { playlists: await music.getUserPlaylists() }
      case 'MORI_REFRESH_LIBRARY':
        return { playlists: await music.refreshLibrary() }
      case 'MORI_GET_PLAYLIST_TRACKS':
        return { tracks: await music.getPlaylistTracks(message.playlistId) }
      case 'MORI_PLAY_URI':
        // Device/DRM initialization can take several seconds. Acknowledge the click now and
        // publish the eventual playback state or specific error through MusicController.
        void music.playUri(message.uri, message.contextUri, message.queueUris).catch((error) => console.error('Failed to play Spotify URI:', error))
        return { accepted: true }
      case 'MORI_GET_COMPANION_DATA':
        return getCompanionData()
      case 'MORI_SEND_MESSAGE': {
        const messages = await sendCompanionMessage(message.text, music.state)
        await broadcastCompanionData(messages)
        return { messages }
      }
      case 'MORI_SAVE_MEMORY': {
        const memories = await saveMusicMemory(message.note, music.state)
        const data = await getCompanionData()
        await broadcastCompanionData(data.messages, memories)
        return { memories }
      }
      case 'PLAYBACK_EVENT':
        // Playback events are privileged state updates. Accept them only from Mori's own
        // offscreen document, never from a content script that shares runtime messaging.
        if (sender.url !== chrome.runtime.getURL('src/offscreen/offscreen.html')) throw new Error('拒绝非播放服务发送的状态事件')
        await music.handleHostEvent(message.event)
        return { accepted: true }
      default:
        return null
    }
  }

  void handle()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Mori 后台操作失败' }))
  return true
})

async function broadcastCompanionData(messages: Awaited<ReturnType<typeof getCompanionData>>['messages'], memories?: Awaited<ReturnType<typeof getCompanionData>>['memories']) {
  const data = memories ? { messages, memories } : await getCompanionData()
  const message: TabMessage = { type: 'MORI_COMPANION_DATA', ...data }
  const tabs = await chrome.tabs.query({})
  await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id!, message)))
}
