/**
 * 作用：渲染 Mini Player 与完整播放面板，并协调播放控制、功能页签和进度展示。
 * 输入：PlaybackState、Companion 数据、曲库操作回调和播放控制回调。
 * 输出：播放器 React UI，以及通过回调提交的播放、模式、记忆和导航操作。
 */
import { useEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { ConversationMessage, MusicMemory, MusicMomentInput, MusicPlaylist, MusicPreferenceAnalysisState, MusicPreferenceProfile, MusicTrack, PlaybackMode, PlaybackState } from '@mori/domain'
import { ChatPanel } from '../chat/ChatPanel'
import { MomentComposer } from '../companion/MomentComposer'
import { MomentPanel } from '../companion/MomentPanel'
import { SettingsPanel } from '../settings/SettingsPanel'
import type { MusicPreferenceView } from '../settings/MusicPreferencePanel'
import { PlaylistPanel } from './PlaylistPanel'

type View = 'playlists' | 'chat' | 'moments'

type Props = {
  playback: PlaybackState
  spotifyConnected: boolean
  messages: ConversationMessage[]
  memories: MusicMemory[]
  settingsOpen: boolean
  onOpenSettings: () => void
  onCloseSettings: () => void
  onClose: () => void
  onToggle: () => Promise<void>
  onCommand: (command: 'previous' | 'next') => Promise<void>
  onSeek: (positionMs: number) => Promise<void>
  onSetPlaybackMode: (mode: PlaybackMode) => Promise<void>
  onSend: (text: string) => Promise<void>
  onSaveMemory: (input: MusicMomentInput) => Promise<void>
  onGetPlaylists: () => Promise<MusicPlaylist[]>
  onHasLibraryCache: (playlistId?: string) => Promise<boolean>
  onRefreshLibrary: () => Promise<MusicPlaylist[]>
  onGetPlaylistTracks: (playlistId: string) => Promise<MusicTrack[]>
  onPlayUri: (track: MusicTrack, contextUri?: string, navigationQueue?: MusicTrack[]) => Promise<void>
  onGetMusicPreference: () => Promise<MusicPreferenceAnalysisState>
  onAnalyzeMusicPreference: () => Promise<MusicPreferenceProfile>
}

export function PlayerCard({ playback, spotifyConnected, messages, memories, settingsOpen, onOpenSettings, onCloseSettings, onClose, onToggle, onCommand, onSeek, onSetPlaybackMode, onSend, onSaveMemory, onGetPlaylists, onHasLibraryCache, onRefreshLibrary, onGetPlaylistTracks, onPlayUri, onGetMusicPreference, onAnalyzeMusicPreference }: Props) {
  const [view, setView] = useState<View>('playlists')
  const [settingsView, setSettingsView] = useState<'settings' | 'preference'>('settings')
  const [preferenceView, setPreferenceView] = useState<MusicPreferenceView>('overview')
  const [controlBusy, setControlBusy] = useState<'previous' | 'toggle' | 'next' | 'memory' | 'mode' | null>(null)
  const [feedback, setFeedback] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const [momentOpen, setMomentOpen] = useState(false)
  const playbackMode: PlaybackMode = playback.shuffle ? 'shuffle' : playback.repeatMode
  const visibleFeedback = feedback.startsWith('播放模式：') ? modeLabel(playbackMode) : feedback

  useEffect(() => {
    if (!settingsOpen) { setSettingsView('settings'); setPreferenceView('overview') }
  }, [settingsOpen])

  async function runControl(action: typeof controlBusy, task: () => Promise<void>) {
    // Spotify writes may complete out of order. Serialize controls so a rapid sequence cannot
    // leave feedback and the visible mode describing different commands.
    if (controlBusy) return
    setControlBusy(action); setFeedback('')
    try { await task() }
    catch (error) { setFeedback(error instanceof Error ? error.message : '操作失败') }
    finally { setControlBusy(null) }
  }

  async function saveMoment(input: MusicMomentInput) {
    await runControl('memory', async () => {
      await onSaveMemory(input)
      setMomentOpen(false)
      setFeedback('已保存到「瞬间」')
      setView('moments')
    })
  }

  async function cyclePlaybackMode() {
    // The product exposes one mode button although Spotify stores shuffle and repeat separately.
    // Keep the cycle aligned with SpotifyMusicProvider, which resets the non-selected setting.
    const modes: PlaybackMode[] = ['off', 'shuffle', 'context', 'track']
    const nextMode = modes[(modes.indexOf(playbackMode) + 1) % modes.length]
    await runControl('mode', async () => {
      await onSetPlaybackMode(nextMode)
      setFeedback(modeLabel(nextMode))
    })
  }

  async function sendChatMessage(text: string) {
    if (chatSending) return
    setChatSending(true); setChatError('')
    try { await onSend(text) }
    catch (error) {
      setChatError(error instanceof Error ? error.message : '消息发送失败，请重试。')
      throw error
    } finally { setChatSending(false) }
  }

  function navigateBackFromSettings() {
    if (settingsView === 'preference' && preferenceView === 'detail') { setPreferenceView('overview'); return }
    if (settingsView === 'preference') { setSettingsView('settings'); return }
    onCloseSettings()
  }

  return <section className={`card ${settingsOpen ? 'settings-open' : ''}`} aria-label="Mori 音乐伙伴">
    <header className="card-header">
      {settingsOpen
        ? <span className="settings-title"><button type="button" className="settings-back" onClick={navigateBackFromSettings} aria-label={settingsView === 'preference' ? '返回上一页' : '返回播放器'}>‹</button><strong>{settingsView === 'preference' ? preferenceView === 'detail' ? '详细分析' : '我的音乐偏好' : '设置'}</strong></span>
        : <strong>Mori</strong>}
      <span className="card-header-actions">
        {!settingsOpen && <button type="button" className="settings-button" onClick={onOpenSettings} aria-label="打开 Mori 设置" title="设置"><SettingsIcon /></button>}
        <button type="button" className="panel-close" onClick={onClose} aria-label="关闭 Mori 并停止播放" title="关闭 Mori">●</button>
      </span>
    </header>
    {settingsOpen ? <SettingsPanel spotifyConnected={spotifyConnected} getMusicPreference={onGetMusicPreference} analyzeMusicPreference={onAnalyzeMusicPreference} view={settingsView} preferenceView={preferenceView} onPreferenceViewChange={setPreferenceView} onOpenPreference={() => { setSettingsView('preference'); setPreferenceView('overview') }} /> : <><section className="expanded-player" aria-label="当前歌曲播放器">
      <div className="expanded-track-row">
        <span className={`expanded-cover ${playback.isPlaying ? 'spinning' : ''}`}>
          {playback.track?.artwork ? <img src={playback.track.artwork} alt="" /> : <span>♪</span>}
        </span>
        <div className="expanded-track-info">
          <strong>{playback.track?.title ?? '等待音乐'}</strong>
          <small>{playback.track?.artist || '从歌单选择一首歌'}</small>
          <PlaybackProgress playback={playback} onSeek={onSeek} />
          <div className="expanded-controls">
            <button type="button" className={`moment-control ${controlBusy === 'memory' ? 'busy' : ''}`} disabled={Boolean(controlBusy)} onClick={() => setMomentOpen(true)} aria-label="记录这一瞬间" title="记录这一瞬间">✦</button>
            <button type="button" disabled={Boolean(controlBusy)} onClick={() => void runControl('previous', () => onCommand('previous'))} aria-label="上一首">|‹</button>
            <button type="button" className="primary" disabled={Boolean(controlBusy)} onClick={() => void runControl('toggle', onToggle)} aria-label={playback.isPlaying ? '暂停' : '播放'}>{controlBusy === 'toggle' ? '…' : playback.isPlaying ? 'Ⅱ' : '▶'}</button>
            <button type="button" disabled={Boolean(controlBusy)} onClick={() => void runControl('next', () => onCommand('next'))} aria-label="下一首">›|</button>
            <div className="playback-mode-control">
              <button type="button" className={playbackMode !== 'off' ? 'active' : ''} disabled={Boolean(controlBusy)} onClick={() => void cyclePlaybackMode()} aria-label={`${modeLabel(playbackMode)}，点击切换`} title={`${modeLabel(playbackMode)}，点击切换`}>
                <ModeIcon mode={playbackMode} />
              </button>
            </div>
          </div>
        </div>
      </div>
      {(visibleFeedback || playback.error) && <p className="expanded-feedback">{visibleFeedback || playback.error}</p>}
    </section>
    <nav className="feature-tabs" aria-label="Mori 功能">
      <Tab active={view === 'playlists'} icon={<MusicIcon />} label="歌单" onClick={() => setView('playlists')} />
      <Tab active={view === 'chat'} icon={<ChatIcon />} label="对话" onClick={() => setView('chat')} />
      <Tab active={view === 'moments'} icon={<SparkleIcon />} label="瞬间" onClick={() => setView('moments')} />
    </nav>

    <main className="card-content">
      {view === 'playlists' && <PlaylistPanel playback={playback} getPlaylists={onGetPlaylists} hasLibraryCache={onHasLibraryCache} refreshLibrary={onRefreshLibrary} getPlaylistTracks={onGetPlaylistTracks} playUri={onPlayUri} />}
      {view === 'chat' && <ChatPanel messages={messages} onSend={sendChatMessage} sending={chatSending} sendError={chatError} />}
      {view === 'moments' && <MomentPanel memories={memories} />}
    </main>
    </>}
    {momentOpen && <MomentComposer saving={controlBusy === 'memory'} onCancel={() => setMomentOpen(false)} onConfirm={saveMoment} />}
  </section>
}

type MiniPlayerProps = {
  playback: PlaybackState
  onToggle: () => Promise<void>
  onCommand: (command: 'previous' | 'next') => Promise<void>
  onSeek: (positionMs: number) => Promise<void>
  onSaveMemory: (input: MusicMomentInput) => Promise<void>
  onOpenSettings: () => void
  onExpand: () => void
}

export function MiniPlayer({ playback, onToggle, onCommand, onSeek, onSaveMemory, onOpenSettings, onExpand }: MiniPlayerProps) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [momentOpen, setMomentOpen] = useState(false)

  async function run(event: ReactMouseEvent, task: () => Promise<void>) {
    event.stopPropagation()
    if (busy) return
    setBusy(true); setFeedback('')
    try { await task() }
    catch (error) { setFeedback(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(false) }
  }

  async function saveMoment(input: MusicMomentInput) {
    if (busy) return
    setBusy(true); setFeedback('')
    try { await onSaveMemory(input); setMomentOpen(false); setFeedback('已保存到「瞬间」') }
    catch (error) { setFeedback(error instanceof Error ? error.message : '保存失败') }
    finally { setBusy(false) }
  }

  return <section className="mini-player" aria-label="Mori 迷你播放器" onClick={onExpand}>
    <button type="button" className="mini-settings settings-button" onClick={(event) => { event.stopPropagation(); onOpenSettings() }} aria-label="打开 Mori 设置" title="设置"><SettingsIcon /></button>
    <div className="mini-track">
      <span className={`mini-cover ${playback.isPlaying ? 'spinning' : ''}`}>
        {playback.track?.artwork ? <img src={playback.track.artwork} alt="" /> : <span>♪</span>}
      </span>
      <span><strong>{playback.track?.title ?? '等待音乐'}</strong><small>{playback.track?.artist || '点击播放或打开完整面板'}</small></span>
    </div>
    <PlaybackProgress playback={playback} onSeek={onSeek} />
    <div className="mini-controls">
      <button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); setMomentOpen(true) }} aria-label="记录音乐瞬间">✦</button>
      <button type="button" disabled={busy} onClick={(event) => void run(event, () => onCommand('previous'))} aria-label="上一首">|‹</button>
      <button type="button" className="primary" disabled={busy} onClick={(event) => void run(event, onToggle)} aria-label={playback.isPlaying ? '暂停' : '播放'}>{playback.isPlaying ? 'Ⅱ' : '▶'}</button>
      <button type="button" disabled={busy} onClick={(event) => void run(event, () => onCommand('next'))} aria-label="下一首">›|</button>
      <button type="button" onClick={(event) => { event.stopPropagation(); onExpand() }} aria-label="打开完整面板">☷</button>
    </div>
    {(feedback || playback.error) && <p className="mini-feedback">{feedback || playback.error}</p>}
    {momentOpen && <MomentComposer saving={busy} onCancel={() => setMomentOpen(false)} onConfirm={saveMoment} />}
  </section>
}

function Tab({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onClick}><span>{icon}</span>{label}</button>
}

function MusicIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l10-2v13M9 9l10-2M6.5 21A2.5 2.5 0 1 0 6.5 16 2.5 2.5 0 0 0 6.5 21ZM16.5 19A2.5 2.5 0 1 0 16.5 14 2.5 2.5 0 0 0 16.5 19Z" /></svg>
}

function ChatIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.47 8.8 8.8 0 0 1-3.2-.82L4 20l1.63-4.08A7.5 7.5 0 1 1 20 11.5Z" /></svg>
}

function SparkleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.55 4.45L18 9l-4.45 1.55L12 15l-1.55-4.45L6 9l4.45-1.55L12 3Zm6 11 .75 2.25L21 17l-2.25.75L18 20l-.75-2.25L15 17l2.25-.75L18 14Z" /></svg>
}

function SettingsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20.3h-3v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.56-1.03H5.3v-3h.14A1.7 1.7 0 0 0 7 9.94a1.7 1.7 0 0 0-.34-1.88L6.6 8l2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34h.02A1.7 1.7 0 0 0 11.7 4.7v-.1h3v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 8l-.06.06a1.7 1.7 0 0 0-.34 1.88v.02a1.7 1.7 0 0 0 1.56 1.02h.04v3h-.04A1.7 1.7 0 0 0 19.4 15Z" /></svg>
}

function ModeIcon({ mode }: { mode: PlaybackMode }) {
  if (mode === 'shuffle' || mode === 'off') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h2.5c4 0 5 10 9 10H20M17 14l3 3-3 3M4 17h2.5c1.5 0 2.6-1.4 3.7-3M14 7h6M17 4l3 3-3 3" /></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />{mode === 'track' && <text x="12" y="14.5">1</text>}</svg>
}

function PlaybackProgress({ playback, onSeek }: { playback: PlaybackState; onSeek: (positionMs: number) => Promise<void> }) {
  const [progress, setProgress] = useState(playback.progressMs)
  const [dragging, setDragging] = useState(false)
  const duration = playback.durationMs || playback.track?.durationMs || 0

  useEffect(() => {
    if (!dragging) setProgress(playback.progressMs)
    if (dragging || !playback.isPlaying || !duration) return
    // SDK/Web API snapshots are intermittent. Advance only the visual progress locally and reset
    // from the next authoritative playback snapshot; no synthetic value is sent to the backend.
    const timer = window.setInterval(() => setProgress((value) => Math.min(duration, value + 1_000)), 1_000)
    return () => window.clearInterval(timer)
  }, [playback.progressMs, playback.isPlaying, playback.track?.uri, duration, dragging])

  const percentage = duration ? Math.min(100, Math.max(0, progress / duration * 100)) : 0
  const commit = (positionMs: number) => {
    setDragging(false)
    setProgress(positionMs)
    void onSeek(positionMs).catch(() => setProgress(playback.progressMs))
  }
  return <input
    className="playback-progress"
    type="range"
    min={0}
    max={Math.max(duration, 1)}
    step={1_000}
    value={Math.min(progress, Math.max(duration, 1))}
    disabled={!duration}
    aria-label="歌曲播放进度"
    aria-valuetext={`${formatPlaybackTime(progress)} / ${formatPlaybackTime(duration)}`}
    style={{ '--playback-progress': `${percentage}%` } as CSSProperties}
    onPointerDown={(event) => { event.stopPropagation(); setDragging(true) }}
    onPointerUp={(event) => { event.stopPropagation(); commit(Number(event.currentTarget.value)) }}
    onPointerCancel={() => { setDragging(false); setProgress(playback.progressMs) }}
    onClick={(event) => event.stopPropagation()}
    onChange={(event) => setProgress(Number(event.currentTarget.value))}
    onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit(Number(event.currentTarget.value)) }}
  />
}

function formatPlaybackTime(valueMs: number) {
  const seconds = Math.max(0, Math.round(valueMs / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function modeLabel(mode: PlaybackMode) {
  if (mode === 'shuffle') return '播放模式：歌曲随机'
  if (mode === 'context') return '播放模式：歌单循环'
  if (mode === 'track') return '播放模式：单曲循环'
  return '播放模式：顺序播放'
}
