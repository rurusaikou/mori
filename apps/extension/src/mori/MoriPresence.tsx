/**
 * 作用：管理 Mori 悬浮入口、拖拽定位、面板层级及 UI 与后台之间的业务交互。
 * 输入：后台状态快照和广播消息，以及用户拖拽、点击和播放操作。
 * 输出：Mori 悬浮 React UI、发送给后台的 RuntimeRequest，以及本地面板交互状态。
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { MoriCharacter } from './MoriCharacter'
import { MiniPlayer, PlayerCard } from '../player/PlayerCard'
import { INITIAL_PLAYBACK_STATE, type ConversationMessage, type MusicMemory, type MusicPlaylist, type MusicPreferenceAnalysisState, type MusicTrack, type PlaybackMode, type PlaybackState } from '@mori/domain'
import type { TabMessage } from '../shared/messages'
import { sendRuntimeRequest } from '../shared/runtime-client'

type DragState = { id: number; startX: number; startY: number; left: number; top: number; moved: boolean }
type PanelMode = 'closed' | 'mini' | 'full'

const PANEL_GAP = 6
const VIEWPORT_MARGIN = 16

export function MoriPresence() {
  const [visible, setVisible] = useState(false)
  const [panelMode, setPanelMode] = useState<PanelMode>('closed')
  const [playback, setPlayback] = useState<PlaybackState>(INITIAL_PLAYBACK_STATE)
  const [spotifyConnected, setSpotifyConnected] = useState(false)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [memories, setMemories] = useState<MusicMemory[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const moriRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null)

  useEffect(() => {
    // The content script can mount after the service worker has been suspended or after playback
    // changed in another tab. Hydrate all independent snapshots before relying on broadcasts.
    void Promise.all([
      sendRuntimeRequest<{ state: PlaybackState }>({ type: 'MORI_GET_STATE' }),
      sendRuntimeRequest<{ connected: boolean }>({ type: 'MORI_GET_SPOTIFY_CONNECTION' }),
      sendRuntimeRequest<{ visible: boolean; position: { x: number; y: number } | null }>({ type: 'MORI_GET_PRESENCE_STATE' }),
      sendRuntimeRequest<{ messages: ConversationMessage[]; memories: MusicMemory[] }>({ type: 'MORI_GET_COMPANION_DATA' }),
    ]).then(([music, spotify, presence, companion]) => {
      setPlayback(music.state); setVisible(presence.visible); setMessages(companion.messages); setMemories(companion.memories)
      setSpotifyConnected(spotify.connected)
      if (presence.position) setPosition({ left: clamp(presence.position.x * window.innerWidth, 8, window.innerWidth - 84), top: clamp(presence.position.y * window.innerHeight, 8, window.innerHeight - 84) })
    })

    const listener = (message: TabMessage) => {
      if (message.type === 'MORI_SET_VISIBILITY') {
        setVisible(message.visible)
        if (!message.visible) { setPanelMode('closed'); setSettingsOpen(false) }
      }
      if (message.type === 'MORI_PLAYBACK_STATE') {
        setPlayback(message.state)
        if (message.state.availability === 'needs-auth') setSpotifyConnected(false)
        else setSpotifyConnected(true)
      }
      if (message.type === 'MORI_COMPANION_DATA') { setMessages(message.messages); setMemories(message.memories) }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  useEffect(() => {
    if (panelMode === 'closed') return
    const collapseFromOutside = (event: PointerEvent) => {
      const root = rootRef.current
      const rootNode = root?.getRootNode()
      const shadowHost = rootNode instanceof ShadowRoot ? rootNode.host : null
      const path = event.composedPath()
      // A closed Shadow DOM hides its internal nodes from document-level listeners. The composed
      // path still contains the extension host, so treat either root or host as an inside click;
      // otherwise pointerdown would collapse the panel before any control receives its click.
      if ((root && path.includes(root)) || (shadowHost && path.includes(shadowHost))) return
      setPanelMode((mode) => mode === 'full' ? 'mini' : 'closed')
    }
    document.addEventListener('pointerdown', collapseFromOutside, true)
    return () => document.removeEventListener('pointerdown', collapseFromOutside, true)
  }, [panelMode])

  useLayoutEffect(() => {
    if (panelMode === 'closed') { setPanelStyle(null); return }

    const placePanel = () => {
      const root = rootRef.current?.getBoundingClientRect()
      const anchor = moriRef.current?.getBoundingClientRect()
      const panel = panelRef.current?.getBoundingClientRect()
      if (!root || !anchor || !panel) return

      const expandLeft = anchor.left + anchor.width / 2 >= window.innerWidth / 2
      const expandUp = anchor.top + anchor.height / 2 >= window.innerHeight / 2
      const preferredLeft = expandLeft ? anchor.left - PANEL_GAP - panel.width : anchor.right + PANEL_GAP
      const preferredTop = expandUp ? anchor.top - PANEL_GAP - panel.height : anchor.bottom + PANEL_GAP
      const viewportLeft = clamp(preferredLeft, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerWidth - panel.width - VIEWPORT_MARGIN))
      const viewportTop = clamp(preferredTop, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerHeight - panel.height - VIEWPORT_MARGIN))

      // Convert collision-corrected viewport coordinates into offsets from the immutable anchor.
      // The panel is absolute, so changing these offsets never changes Mori's fixed position.
      setPanelStyle({ left: viewportLeft - root.left, top: viewportTop - root.top, visibility: 'visible' })
    }

    placePanel()
    window.addEventListener('resize', placePanel)
    return () => window.removeEventListener('resize', placePanel)
  }, [panelMode, position])

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false }
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    // A small threshold separates an intentional drag from a click on touchpads and touchscreens;
    // without it, normal clicks can save a new position instead of opening the player.
    if (Math.hypot(dx, dy) > 5) current.moved = true
    if (!current.moved) return
    setPosition({ left: clamp(current.left + dx, 8, window.innerWidth - 84), top: clamp(current.top + dy, 8, window.innerHeight - 84) })
  }

  function pointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    drag.current = null
    if (current.moved) {
      const rect = rootRef.current?.getBoundingClientRect()
      // Persist normalized coordinates so Mori keeps the same relative location when the next
      // page has a different viewport size or browser zoom level.
      if (rect) void sendRuntimeRequest({ type: 'MORI_SAVE_POSITION', position: { x: rect.left / window.innerWidth, y: rect.top / window.innerHeight } })
    } else setPanelMode((mode) => mode === 'closed' ? 'mini' : mode === 'full' ? 'mini' : 'closed')
  }

  function pointerCancel() {
    drag.current = null
  }

  async function togglePlayback() {
    try { await sendRuntimeRequest({ type: 'MORI_TOGGLE_PLAYBACK' }) }
    catch (error) { setPlayback((state) => ({ ...state, error: error instanceof Error ? error.message : '播放失败' })); setPanelMode('mini'); throw error }
  }

  async function closeMori() {
    // The backend owns the global Presence and playback state. Do not locally hide first: waiting
    // for the command prevents one tab from appearing closed while other tabs are still active.
    await sendRuntimeRequest<{ closed: true }>({ type: 'MORI_CLOSE' })
  }

  async function command(command: 'previous' | 'next') {
    try { await sendRuntimeRequest({ type: 'MORI_PLAYBACK_COMMAND', command }) }
    catch (error) { setPlayback((state) => ({ ...state, error: error instanceof Error ? error.message : '切歌失败' })); throw error }
  }

  async function setPlaybackMode(mode: PlaybackMode) {
    try { await sendRuntimeRequest({ type: 'MORI_SET_PLAYBACK_MODE', mode }) }
    catch (error) { setPlayback((state) => ({ ...state, error: error instanceof Error ? error.message : '无法切换播放模式' })); throw error }
  }

  async function send(text: string) {
    const result = await sendRuntimeRequest<{ messages: ConversationMessage[] }>({ type: 'MORI_SEND_MESSAGE', text })
    setMessages(result.messages)
  }

  async function saveMemory() {
    await sendRuntimeRequest({ type: 'MORI_SAVE_MEMORY' })
  }

  async function getPlaylists() {
    const result = await sendRuntimeRequest<{ playlists: MusicPlaylist[] }>({ type: 'MORI_GET_PLAYLISTS' })
    return result.playlists
  }

  async function getPlaylistTracks(playlistId: string) {
    const result = await sendRuntimeRequest<{ tracks: MusicTrack[] }>({ type: 'MORI_GET_PLAYLIST_TRACKS', playlistId })
    return result.tracks
  }

  async function hasLibraryCache(playlistId?: string) {
    const result = await sendRuntimeRequest<{ cached: boolean }>({ type: 'MORI_GET_LIBRARY_CACHE_STATUS', playlistId })
    return result.cached
  }

  async function refreshLibrary() {
    const result = await sendRuntimeRequest<{ playlists: MusicPlaylist[] }>({ type: 'MORI_REFRESH_LIBRARY' })
    return result.playlists
  }

  async function playUri(track: MusicTrack, contextUri?: string, queueUris?: string[]) { await sendRuntimeRequest({ type: 'MORI_PLAY_URI', track, contextUri, queueUris }) }

  async function getMusicPreference() {
    return sendRuntimeRequest<MusicPreferenceAnalysisState>({ type: 'MORI_GET_MUSIC_PREFERENCE' })
  }

  async function analyzeMusicPreference() {
    await sendRuntimeRequest<{ accepted: true }>({ type: 'MORI_ANALYZE_MUSIC_PREFERENCE' })
    // Keep every runtime request short-lived. Chrome may discard one long-lived response channel
    // while the user navigates even though the service-worker analysis itself is still healthy.
    while (true) {
      await delay(1_000)
      const state = await getMusicPreference()
      if (state.status === 'succeeded' && state.profile) return state.profile
      if (state.status === 'failed') throw new Error(state.error || '音乐偏好分析失败')
    }
  }

  if (!visible) return null
  return <div ref={rootRef} className={`root ${playback.isPlaying ? 'playing' : ''}`} style={position ?? undefined}>
    <button ref={moriRef} className="mori" type="button" aria-label={panelMode === 'closed' ? '打开 Mori 播放器' : '收起 Mori 播放器'} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel}>
      <MoriCharacter playback={playback} />
    </button>
    {panelMode !== 'closed' && <div ref={panelRef} className="panel-positioner" style={panelStyle ?? { visibility: 'hidden' }}>
      {panelMode === 'mini'
        ? <MiniPlayer playback={playback} onToggle={togglePlayback} onCommand={command} onSaveMemory={saveMemory} onOpenSettings={() => { setSettingsOpen(true); setPanelMode('full') }} onExpand={() => { setSettingsOpen(false); setPanelMode('full') }} />
        : <PlayerCard playback={playback} spotifyConnected={spotifyConnected} messages={messages} memories={memories} settingsOpen={settingsOpen} onOpenSettings={() => setSettingsOpen(true)} onCloseSettings={() => setSettingsOpen(false)} onClose={closeMori} onToggle={togglePlayback} onCommand={command} onSetPlaybackMode={setPlaybackMode} onSend={send} onSaveMemory={saveMemory} onGetPlaylists={getPlaylists} onHasLibraryCache={hasLibraryCache} onRefreshLibrary={refreshLibrary} onGetPlaylistTracks={getPlaylistTracks} onPlayUri={playUri} onGetMusicPreference={getMusicPreference} onAnalyzeMusicPreference={analyzeMusicPreference} />}
    </div>}
  </div>
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function delay(milliseconds: number) { return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)) }
