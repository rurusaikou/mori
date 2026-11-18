/**
 * 作用：作为 Extension 后台入口，恢复状态并路由 UI、Spotify、Companion 与播放 Host 消息。
 * 输入：Chrome runtime 消息、工具栏事件和 offscreen document 上报的播放事件。
 * 输出：统一 RuntimeResponse、状态持久化操作，以及向标签页广播的业务状态。
 */
import { getCompanionData, saveMusicMemory, sendCompanionMessage } from '../companion/companion-service'
import type { MusicTrack } from '@mori/domain'
import { syncListeningTransition } from '../companion/memory-client'
import type { RuntimeRequest, RuntimeResponse, TabMessage } from '../shared/messages'
import { broadcastTabMessage } from '../shared/tab-messaging'
import { extensionStorage } from '../storage/extension-storage'
import { MusicController } from './music-controller'
import { analyzeMusicPreference, getMusicPreferenceState } from './music-preference-service'
import { PresenceController } from './presence-controller'
import { logError, logInfo } from './logger'

const music = new MusicController()
const presence = new PresenceController()
let lastToolbarClickAt = 0
let pendingListeningSource: 'user_selected' | 'agent_selected' | 'autoplay' | 'unknown' = 'unknown'
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
  const now = Date.now()
  // Chrome can deliver rapid duplicate action clicks from a double-click. Without a guard the
  // first event shows Mori and the second immediately executes the global close path.
  if (now - lastToolbarClickAt < 600) return
  lastToolbarClickAt = now
  void restored
    .then(() => presence.enabled ? closeMoriEverywhere('toolbar') : presence.toggleFromToolbar(tab))
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
        // Native Spotify skips are fast, but Saved Tracks navigation may initialize/transfer the
        // Mori device and start an exact URI. Acknowledge the gesture immediately so controls do
        // not remain disabled while the canonical PlaybackState carries completion or failure.
        void music.command(message.command).catch((error) => console.error('Failed to change track:', error))
        return { accepted: true }
      case 'MORI_SEEK_PLAYBACK':
        if (!Number.isFinite(message.positionMs) || message.positionMs < 0) throw new Error('无效的播放位置')
        await music.seek(message.positionMs)
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
        pendingListeningSource = 'user_selected'
        void music.playUri(message.track.uri, message.contextUri, message.track, message.navigationQueue).catch((error) => console.error('Failed to play Spotify URI:', error))
        return { accepted: true }
      case 'MORI_GET_COMPANION_DATA':
        return getCompanionData()
      case 'MORI_SEND_MESSAGE': {
        // Library hydration can page through many Spotify playlists. Do it only for an explicit
        // listening/play request; ordinary conversation should stay fast and avoid Spotify quota.
        const catalog = hasMusicArrangementIntent(message.text) ? await getAgentMusicCatalog(message.text) : []
        const messages = await sendCompanionMessage(message.text, music.state, catalog, async (track) => {
          pendingListeningSource = 'agent_selected'
          await music.playUri(track.uri, undefined, track)
          if (!await music.confirmPlayback(track.uri)) throw new Error('Spotify 未确认目标歌曲开始播放')
          logInfo('conversation', 'agent_track_played', { uri: track.uri, title: track.title, artist: track.artist })
        }, broadcastCompanionData)
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
        const memories = await saveMusicMemory(music.state, message.moment)
        const memory = memories[0]
        logInfo('memory', 'moment_saved', {
          id: memory?.id,
          createdAt: memory?.createdAt,
          note: memory?.note,
          mood: memory?.mood,
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
        {
          const previous = music.state
          await music.handleHostEvent(message.event)
          const source = pendingListeningSource
          if (previous.track?.uri !== music.state.track?.uri && music.state.track) pendingListeningSource = 'unknown'
          // 听歌事实同步是可选后台能力。memory-client 自行吸收数据库未配置和 API 离线，
          // 不能让一次正常播放在 Chrome 扩展错误页生成多条重复错误。
          void syncListeningTransition(previous, music.state, source)
        }
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

async function closeMoriEverywhere(source: 'toolbar') {
  // Visibility must still close globally when Spotify is temporarily unavailable. A playback
  // failure is logged, while the persisted Presence state and cross-tab broadcast always run.
  try { await music.pauseForShutdown() }
  catch (error) { logError('playback', 'close_pause_failed', error, { source }) }
  await presence.closeEverywhere()
  logInfo('user_event', 'mori_closed', { source, playbackStopped: !music.state.isPlaying })
}

async function getAgentMusicCatalog(userText: string) {
  // getPreferenceTracks 会遍历并缓存完整收藏/歌单；返回值本身只是听感排序所需的代表样本。
  // 先完成这一步，避免“已经缓存过一张歌单”导致其他个人曲库内容永远不参与精确搜索。
  const preferenceSample = await music.getPreferenceTracks()
  const cache = await extensionStorage.getLibraryCache()
  const library = new Map<string, MusicTrack>()
  for (const entry of Object.values(cache.tracks)) {
    for (const track of entry.data) if (track.uri && track.isPlayable !== false) library.set(track.uri, { ...track, catalogSource: 'user_library' })
  }
  // “随便推荐”没有精确歌名或歌手，不能拿整句做文本匹配。此前“给我推首歌”中的
  // 单字“我”会错误命中歌曲《我》，导致无条件推荐持续收敛到同一首。
  if (isOpenRecommendation(userText)) {
    const candidates = preferenceSample
      .filter((track) => track.uri && track.title?.trim() && track.artist?.trim() && track.isPlayable !== false)
      .map((track) => ({ ...track, catalogSource: 'user_library' as const }))
      .slice(0, 500)
    logInfo('conversation', 'music_recommendation_catalog_ready', { libraryTracks: library.size, candidates: candidates.length, spotifyFallback: false })
    return candidates
  }
  const query = musicSearchQuery(userText)
  const exactLibraryMatches = rankTextMatches([...library.values()], query).slice(0, 30)
  if (exactLibraryMatches.length) {
    logInfo('conversation', 'music_search_catalog_ready', { query, libraryTracks: library.size, libraryMatches: exactLibraryMatches.length, spotifyFallback: false, spotifyMatches: 0 })
    return exactLibraryMatches
  }

  // 个人曲库没有歌名/歌手命中时才访问 Spotify Search。代表样本仍随请求发送，
  // 让“有节奏、安静”等听感请求优先由用户自己的曲库特征匹配。
  const localSample = preferenceSample
    .filter((track) => track.uri && track.isPlayable !== false)
    .map((track) => ({ ...track, catalogSource: 'user_library' as const }))
  let spotifyMatches: MusicTrack[] = []
  try { spotifyMatches = await music.searchTracks(query, 10) }
  catch (error) { logError('conversation', 'spotify_search_failed', error, { query }) }
  const combined = new Map<string, MusicTrack>()
  // Agent 请求上限为 500；为兜底结果预留位置，避免大型曲库样本把 Spotify 命中截掉。
  for (const track of localSample.slice(0, Math.max(0, 500 - spotifyMatches.length))) combined.set(track.uri, track)
  for (const track of spotifyMatches) combined.set(track.uri, track)
  logInfo('conversation', 'music_search_catalog_ready', { query, libraryTracks: library.size, libraryMatches: 0, spotifyFallback: true, spotifyMatches: spotifyMatches.length })
  return [...combined.values()].slice(0, 500)
}

function isOpenRecommendation(text: string) {
  return /(随便|随机|任意).{0,10}(推|推荐|来|放|听)|不知道.{0,5}听什么|换一首/u.test(text)
    || /^(?:再)?(?:给我)?(?:推|推荐|安排|来)(?:一?首|点|一些)?(?:歌|音乐)(?:吧|呗|好吗|好么)?[。！!？?]*$/u.test(text.trim())
}

function musicSearchQuery(text: string) {
  const stripped = text
    .replace(/[《》「」“”]/gu, ' ')
    .replace(/(?:我)?(?:想要听|想听|要听|播放|放一首|来一首|来点|帮我找|给我放)/gu, ' ')
    .replace(/(?:的)?(?:歌曲?|音乐)$/u, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return stripped || text.trim()
}

function rankTextMatches(tracks: MusicTrack[], query: string) {
  const normalized = query.toLocaleLowerCase()
  const terms = normalized.split(/[\s·、，,]+/u).filter((term) => term.length > 1)
  return tracks
    .map((track) => {
      const title = track.title.toLocaleLowerCase(); const artist = track.artist.toLocaleLowerCase()
      const score = (title && normalized.includes(title) ? 12 : 0) + (artist && normalized.includes(artist) ? 10 : 0)
        + terms.reduce((sum, term) => sum + (title.includes(term) ? 6 : 0) + (artist.includes(term) ? 5 : 0), 0)
      return { track, score }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.track)
}

function hasMusicArrangementIntent(text: string) {
  // 这里只决定是否预加载曲库，不替代服务端 Intent Routing。先挡住否定和状态陈述，
  // 否则“我现在没有在听歌”会因为包含“听歌”而触发昂贵搜索并造成伪命中。
  if (/(不想|不要|别|先别|没有|没在|并未).{0,6}(听|放|播放)|没有在听/u.test(text)) return false
  return /(推荐|安排|随便|不知道.{0,5}听什么|换一首|来一首|来点|帮我找|帮我搜|搜索|查找)|想听.{1,24}(的歌|《)|播放《/u.test(text)
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
    case 'MORI_SEEK_PLAYBACK':
      logInfo('user_event', 'playback_seeked', { positionMs: Math.round(message.positionMs) })
      break
    case 'MORI_SET_PLAYBACK_MODE':
      logInfo('user_event', 'playback_mode_changed', { mode: message.mode })
      break
    case 'MORI_PLAY_URI':
      logInfo('user_event', 'track_selected', { uri: message.track.uri, title: message.track.title, artist: message.track.artist, contextUri: message.contextUri ?? null })
      break
    case 'MORI_SEND_MESSAGE':
      logInfo('user_event', 'chat_submitted', { text: message.text })
      break
  }
}
