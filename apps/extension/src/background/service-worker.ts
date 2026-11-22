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
        // Brain 先判断三类场景；只有返回 music_request 时才在 Action 层访问曲库/Spotify。
        // 普通聊天不再由 Extension 猜测意图，也不会预加载数百首候选。
        const messages = await sendCompanionMessage(message.text, music.state, async (request) => {
          const candidates = await findMusicCandidates(request.query, request.intent)
          const available = candidates.filter((item) => !request.excludeUris.includes(item.uri))
          // 开放推荐没有足够证据做确定性排名时随机选择，避免曲库顺序让 Mori 总推荐
          // 同一首；明确搜索仍保留最相关结果的首项顺序。
          const track = request.intent === 'RECOMMEND' ? randomTrack(available) : available[0] ?? null
          if (!track) return null
          pendingListeningSource = 'agent_selected'
          await music.playUri(track.uri, undefined, track)
          if (!await music.confirmPlayback(track.uri)) throw new Error('Spotify 未确认目标歌曲开始播放')
          logInfo('conversation', 'agent_track_played', { uri: track.uri, title: track.title, artist: track.artist })
          return track
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

function randomTrack(tracks: MusicTrack[]) {
  if (!tracks.length) return null
  const value = crypto.getRandomValues(new Uint32Array(1))[0]
  return tracks[value % tracks.length]
}

async function closeMoriEverywhere(source: 'toolbar') {
  // Visibility must still close globally when Spotify is temporarily unavailable. A playback
  // failure is logged, while the persisted Presence state and cross-tab broadcast always run.
  try { await music.pauseForShutdown() }
  catch (error) { logError('playback', 'close_pause_failed', error, { source }) }
  await presence.closeEverywhere()
  logInfo('user_event', 'mori_closed', { source, playbackStopped: !music.state.isPlaying })
}

async function findMusicCandidates(userText: string, intent: 'SEARCH' | 'RECOMMEND') {
  // “随便推荐”没有精确歌名或歌手，不能拿整句做文本匹配。此前“给我推首歌”中的
  // 单字“我”会错误命中歌曲《我》，导致无条件推荐持续收敛到同一首。
  if (intent === 'RECOMMEND') {
    const preferenceSample = await music.getPreferenceTracks()
    const candidates = preferenceSample
      .filter((track) => track.uri && track.title?.trim() && track.artist?.trim() && track.isPlayable !== false)
      .map((track) => ({ ...track, catalogSource: 'user_library' as const }))
      .slice(0, 500)
    logInfo('conversation', 'music_recommendation_catalog_ready', { libraryTracks: preferenceSample.length, candidates: candidates.length, spotifyFallback: false })
    return candidates
  }

  const query = musicSearchQuery(userText)
  // 精确搜索使用完整可搜索曲库，而不是直接读取 cache.tracks。后者只是 UI 按需缓存，
  // 在用户没有逐个打开歌单时并不完整。
  const library = await music.getSearchableLibraryTracks()
  const exactLibraryMatches = rankTextMatches(library, query).slice(0, 30)
  if (exactLibraryMatches.length) {
    logInfo('conversation', 'music_search_catalog_ready', { query, libraryTracks: library.length, libraryMatches: exactLibraryMatches.length, spotifyFallback: false, spotifyMatches: 0 })
    return exactLibraryMatches
  }

  // 完整个人曲库没有歌名/歌手命中时才访问 Spotify Search。此时无需再把无关的
  // 本地样本塞进本轮精确搜索；只传 Spotify 命中能缩小 payload 和误选空间。
  let spotifyMatches: MusicTrack[] = []
  try { spotifyMatches = await music.searchTracks(query, 10) }
  catch (error) { logError('conversation', 'spotify_search_failed', error, { query }) }
  logInfo('conversation', 'music_search_catalog_ready', { query, libraryTracks: library.length, libraryMatches: 0, spotifyFallback: true, spotifyMatches: spotifyMatches.length })
  return spotifyMatches
}

function musicSearchQuery(text: string) {
  const stripped = text
    .replace(/[《》「」“”]/gu, ' ')
    // Extension 必须和 Agent 提取出同一个检索实体。若把“还”“的其他歌”留在 query
    // 中，服务端虽然正确选择 search_music，预加载阶段仍会把可信候选过滤成空数组。
    .replace(/(?:我)?(?:还想听|想要听|想听|要听|播放|放一首|来一首|来点|帮我找|帮我搜|给我放)/gu, ' ')
    .replace(/(?:的)?(?:其他|其它|别的)?(?:歌曲?|音乐)(?:吧|呢|啊|呀)?$/u, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return stripped || text.trim()
}

function rankTextMatches(tracks: MusicTrack[], query: string) {
  const normalized = normalizeMusicSearchText(query)
  const terms = normalized.split(/[\s·、，,]+/u).filter((term) => term.length > 1)
  return tracks
    .map((track) => {
      const title = normalizeMusicSearchText(track.title); const artist = normalizeMusicSearchText(track.artist)
      const score = (title && normalized.includes(title) ? 12 : 0) + (artist && normalized.includes(artist) ? 10 : 0)
        + terms.reduce((sum, term) => sum + (title.includes(term) ? 6 : 0) + (artist.includes(term) ? 5 : 0), 0)
      return { track, score }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.track)
}

function normalizeMusicSearchText(value: string) {
  // Spotify 与用户曲库可能分别返回简体、繁体艺名。这里只折叠已知会影响精确搜索
  // 的字形，不做大规模语言转换，避免错误改写真实歌名。
  return value.normalize('NFKC').toLocaleLowerCase().replaceAll('瑩', '莹')
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
