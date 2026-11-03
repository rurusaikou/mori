/**
 * 作用：作为 Extension 后台入口，恢复状态并路由 UI、Spotify、Companion 与播放 Host 消息。
 * 输入：Chrome runtime 消息、工具栏事件和 offscreen document 上报的播放事件。
 * 输出：统一 RuntimeResponse、状态持久化操作，以及向标签页广播的业务状态。
 */
import { getCompanionData, saveMusicMemory, sendCompanionMessage } from '../companion/companion-service'
import type { RuntimeRequest, RuntimeResponse, TabMessage } from '../shared/messages'
import { broadcastTabMessage } from '../shared/tab-messaging'
import { extensionStorage } from '../storage/extension-storage'
import { MusicController } from './music-controller'
import { analyzeMusicPreference, getMusicPreferenceState } from './music-preference-service'
import { PresenceController } from './presence-controller'
import { logError, logInfo } from './logger'

const music = new MusicController()
const presence = new PresenceController()
// Content scripts normally share chrome.storage access with extension pages. Restricting both
// stores makes OAuth tokens, conversations and memories inaccessible from the host-page context.
const storageSecured = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
])
const restored = storageSecured.then(() => Promise.all([music.restore(), presence.restore()]))

chrome.runtime.onInstalled.addListener(() => {
  // Reloading or updating an unpacked extension invalidates the isolated worlds already injected
  // into open pages. Reinject the new bundle so content/index.tsx can remove stale Shadow DOM and
  // mount a runtime client connected to the current extension context without a manual page reload.
  void chrome.tabs.query({}).then((tabs) => Promise.allSettled(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined && Boolean(tab.url && /^https?:/.test(tab.url)))
      .map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['build/src/content/content.js'] })),
  )).then((results) => {
    const restoredTabs = results.filter((result) => result.status === 'fulfilled').length
    logInfo('extension', 'content_contexts_reinjected', { restoredTabs, attemptedTabs: results.length })
  }).catch((error) => logError('extension', 'content_reinjection_failed', error))
})

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
    logUserEvent(message)
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
      case 'MORI_GET_SPOTIFY_CONNECTION':
        return { connected: Boolean(await extensionStorage.getToken()) }
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
      case 'MORI_GET_LIBRARY_CACHE_STATUS':
        return { cached: await music.hasLibraryCache(message.playlistId) }
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
        const exchange = messages.slice(-2)
        logInfo('conversation', 'message_exchange', {
          userText: exchange.find((item) => item.role === 'user')?.text ?? message.text,
          moriText: exchange.find((item) => item.role === 'mori')?.text ?? '',
          trackUri: music.state.track?.uri ?? null,
        })
        await broadcastCompanionData()
        return { messages }
      }
      case 'MORI_SAVE_MEMORY': {
        const memories = await saveMusicMemory(music.state)
        const memory = memories[0]
        logInfo('memory', 'moment_saved', {
          id: memory?.id,
          createdAt: memory?.createdAt,
          note: memory?.note,
          track: memory?.track ? { uri: memory.track.uri, title: memory.track.title, artist: memory.track.artist } : null,
        })
        await broadcastCompanionData()
        return { memories }
      }
      case 'MORI_GET_MUSIC_PREFERENCE':
        return getMusicPreferenceState()
      case 'MORI_ANALYZE_MUSIC_PREFERENCE':
        // Sampling and metadata analysis can outlive a content-script message channel. Start the
        // singleton task here and let the UI read progress through short status requests.
        void analyzeMusicPreference(music).catch(() => undefined)
        return { accepted: true }
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
    .catch((error) => {
      logError('runtime', 'request_failed', error, { type: message?.type ?? 'unknown' })
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Mori 后台操作失败' })
    })
  return true
})

async function broadcastCompanionData() {
  const data = await getCompanionData()
  const message: TabMessage = { type: 'MORI_COMPANION_DATA', ...data }
  await broadcastTabMessage(message)
}

function logUserEvent(message: RuntimeRequest & { target?: string }) {
  switch (message?.type) {
    case 'MORI_SAVE_POSITION':
      logInfo('user_event', 'presence_moved', { position: message.position })
      break
    case 'MORI_CONNECT_SPOTIFY':
    case 'MORI_DISCONNECT_SPOTIFY':
    case 'MORI_TOGGLE_PLAYBACK':
    case 'MORI_REFRESH_LIBRARY':
    case 'MORI_SAVE_MEMORY':
    case 'MORI_ANALYZE_MUSIC_PREFERENCE':
      logInfo('user_event', message.type.toLowerCase())
      break
    case 'MORI_PLAYBACK_COMMAND':
      logInfo('user_event', 'playback_command', { command: message.command })
      break
    case 'MORI_SET_PLAYBACK_MODE':
      logInfo('user_event', 'playback_mode_changed', { mode: message.mode })
      break
    case 'MORI_PLAY_URI':
      logInfo('user_event', 'track_selected', { uri: message.uri, contextUri: message.contextUri ?? null })
      break
    case 'MORI_SEND_MESSAGE':
      logInfo('user_event', 'chat_submitted', { text: message.text })
      break
  }
}
