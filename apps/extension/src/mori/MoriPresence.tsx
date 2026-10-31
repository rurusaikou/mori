import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { MoriCharacter } from './MoriCharacter'
import { PlayerCard } from '../player/PlayerCard'
import { INITIAL_PLAYBACK_STATE, type ConversationMessage, type MusicMemory, type MusicPlaylist, type MusicTrack, type PlaybackMode, type PlaybackState } from '@mori/domain'
import type { TabMessage } from '../shared/messages'
import { sendRuntimeRequest } from '../shared/runtime-client'

type DragState = { id: number; startX: number; startY: number; left: number; top: number; moved: boolean }

export function MoriPresence() {
  const [visible, setVisible] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [playback, setPlayback] = useState<PlaybackState>(INITIAL_PLAYBACK_STATE)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [memories, setMemories] = useState<MusicMemory[]>([])
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)

  useEffect(() => {
    void Promise.all([
      sendRuntimeRequest<{ state: PlaybackState }>({ type: 'MORI_GET_STATE' }),
      sendRuntimeRequest<{ visible: boolean; position: { x: number; y: number } | null }>({ type: 'MORI_GET_PRESENCE_STATE' }),
      sendRuntimeRequest<{ messages: ConversationMessage[]; memories: MusicMemory[] }>({ type: 'MORI_GET_COMPANION_DATA' }),
    ]).then(([music, presence, companion]) => {
      setPlayback(music.state); setVisible(presence.visible); setMessages(companion.messages); setMemories(companion.memories)
      if (presence.position) setPosition({ left: clamp(presence.position.x * window.innerWidth, 8, window.innerWidth - 84), top: clamp(presence.position.y * window.innerHeight, 8, window.innerHeight - 84) })
    })

    const listener = (message: TabMessage) => {
      if (message.type === 'MORI_SET_VISIBILITY') setVisible(message.visible)
      if (message.type === 'MORI_PLAYBACK_STATE') setPlayback(message.state)
      if (message.type === 'MORI_COMPANION_DATA') { setMessages(message.messages); setMemories(message.memories) }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false }
    longPressed.current = false
    // One surface supports click, long-press and drag. The timer only wins if movement stays
    // below the drag threshold; pointerUp then suppresses the ordinary playback click.
    longPressTimer.current = window.setTimeout(() => {
      if (!drag.current?.moved) { longPressed.current = true; setExpanded((value) => !value) }
    }, 550)
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (Math.hypot(dx, dy) > 5) current.moved = true
    if (!current.moved) return
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current)
    setPosition({ left: clamp(current.left + dx, 8, window.innerWidth - 84), top: clamp(current.top + dy, 8, window.innerHeight - 84) })
  }

  function pointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current)
    drag.current = null
    if (current.moved) {
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect) void sendRuntimeRequest({ type: 'MORI_SAVE_POSITION', position: { x: rect.left / window.innerWidth, y: rect.top / window.innerHeight } })
    } else if (!longPressed.current) void togglePlayback()
  }

  function pointerCancel() {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current)
    longPressTimer.current = null
    drag.current = null
  }

  async function togglePlayback() {
    try { await sendRuntimeRequest({ type: 'MORI_TOGGLE_PLAYBACK' }) }
    catch (error) { setPlayback((state) => ({ ...state, error: error instanceof Error ? error.message : '播放失败' })); setExpanded(true); throw error }
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

  async function saveMemory(note: string) {
    await sendRuntimeRequest({ type: 'MORI_SAVE_MEMORY', note })
  }

  async function getPlaylists() {
    const result = await sendRuntimeRequest<{ playlists: MusicPlaylist[] }>({ type: 'MORI_GET_PLAYLISTS' })
    return result.playlists
  }

  async function getPlaylistTracks(playlistId: string) {
    const result = await sendRuntimeRequest<{ tracks: MusicTrack[] }>({ type: 'MORI_GET_PLAYLIST_TRACKS', playlistId })
    return result.tracks
  }

  async function refreshLibrary() {
    const result = await sendRuntimeRequest<{ playlists: MusicPlaylist[] }>({ type: 'MORI_REFRESH_LIBRARY' })
    return result.playlists
  }

  async function playUri(uri: string, contextUri?: string, queueUris?: string[]) { await sendRuntimeRequest({ type: 'MORI_PLAY_URI', uri, contextUri, queueUris }) }

  if (!visible) return null
  return <div ref={rootRef} className={`root ${playback.isPlaying ? 'playing' : ''}`} style={position ?? undefined}>
    <button className="mori" type="button" aria-label={playback.isPlaying ? '暂停音乐' : '播放音乐'} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel}>
      <MoriCharacter playback={playback} />
    </button>
    {expanded && <PlayerCard playback={playback} messages={messages} memories={memories} onToggle={togglePlayback} onCommand={command} onSetPlaybackMode={setPlaybackMode} onSend={send} onSaveMemory={saveMemory} onGetPlaylists={getPlaylists} onRefreshLibrary={refreshLibrary} onGetPlaylistTracks={getPlaylistTracks} onPlayUri={playUri} />}
  </div>
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
