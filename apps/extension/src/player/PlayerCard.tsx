import { useEffect, useState, type ReactNode } from 'react'
import type { ConversationMessage, MusicMemory, MusicPlaylist, MusicTrack, PlaybackMode, PlaybackState } from '@mori/domain'
import { ChatPanel } from '../chat/ChatPanel'
import { MomentPanel } from '../companion/MomentPanel'
import { PlaylistPanel } from './PlaylistPanel'

type View = 'playlists' | 'chat' | 'moments'

type Props = {
  playback: PlaybackState
  messages: ConversationMessage[]
  memories: MusicMemory[]
  onToggle: () => Promise<void>
  onCommand: (command: 'previous' | 'next') => Promise<void>
  onSetPlaybackMode: (mode: PlaybackMode) => Promise<void>
  onSend: (text: string) => Promise<void>
  onSaveMemory: (note: string) => Promise<void>
  onGetPlaylists: () => Promise<MusicPlaylist[]>
  onRefreshLibrary: () => Promise<MusicPlaylist[]>
  onGetPlaylistTracks: (playlistId: string) => Promise<MusicTrack[]>
  onPlayUri: (uri: string, contextUri?: string, queueUris?: string[]) => Promise<void>
}

export function PlayerCard({ playback, messages, memories, onToggle, onCommand, onSetPlaybackMode, onSend, onSaveMemory, onGetPlaylists, onRefreshLibrary, onGetPlaylistTracks, onPlayUri }: Props) {
  const [view, setView] = useState<View>('playlists')
  const [controlBusy, setControlBusy] = useState<'previous' | 'toggle' | 'next' | 'memory' | 'mode' | null>(null)
  const [feedback, setFeedback] = useState('')
  const playbackMode: PlaybackMode = playback.shuffle ? 'shuffle' : playback.repeatMode

  async function runControl(action: typeof controlBusy, task: () => Promise<void>) {
    if (controlBusy) return
    setControlBusy(action); setFeedback('')
    try { await task() }
    catch (error) { setFeedback(error instanceof Error ? error.message : '操作失败') }
    finally { setControlBusy(null) }
  }

  async function saveMoment() {
    await runControl('memory', async () => {
      await onSaveMemory('')
      setFeedback('已保存到「瞬间」')
      setView('moments')
    })
  }

  async function cyclePlaybackMode() {
    const modes: PlaybackMode[] = ['off', 'shuffle', 'context', 'track']
    const nextMode = modes[(modes.indexOf(playbackMode) + 1) % modes.length]
    await runControl('mode', () => onSetPlaybackMode(nextMode))
  }

  return <section className="card" aria-label="Mori 音乐伙伴">
    <header className="card-header"><strong>Mori</strong><span className="status-dot" title={playback.isPlaying ? '正在陪听' : '已暂停'} /></header>
    <nav className="feature-tabs" aria-label="Mori 功能">
      <Tab active={view === 'playlists'} icon={<MusicIcon />} label="歌单" onClick={() => setView('playlists')} />
      <Tab active={view === 'chat'} icon={<ChatIcon />} label="对话" onClick={() => setView('chat')} />
      <Tab active={view === 'moments'} icon={<SparkleIcon />} label="瞬间" onClick={() => setView('moments')} />
    </nav>

    <main className="card-content">
      {view === 'playlists' && <PlaylistPanel playback={playback} getPlaylists={onGetPlaylists} refreshLibrary={onRefreshLibrary} getPlaylistTracks={onGetPlaylistTracks} playUri={onPlayUri} />}
      {view === 'chat' && <ChatPanel messages={messages} onSend={onSend} />}
      {view === 'moments' && <MomentPanel memories={memories} />}
    </main>

    {(feedback || playback.error) && <p className={`control-feedback ${playback.error ? 'error' : ''}`}>{feedback || playback.error}</p>}
    <footer className="now-playing">
      <PlaybackProgress playback={playback} />
      <div className="now-track">
        <span className={`now-disc ${playback.isPlaying ? 'spinning' : ''}`}>
          {playback.track?.artwork ? <img src={playback.track.artwork} alt="" /> : <span className="now-placeholder" />}
          <span className="disc-note">♪</span>
        </span>
        <span><strong>{playback.track?.title ?? '等待音乐'}</strong><small>{playback.track?.artist || '从歌单选择一首歌'}</small></span>
      </div>
      <button type="button" className={`moment-control ${controlBusy === 'memory' ? 'busy' : ''}`} onClick={() => void saveMoment()} aria-label="记录音乐瞬间">✦</button>
      <button type="button" disabled={Boolean(controlBusy)} onClick={() => void runControl('previous', () => onCommand('previous'))} aria-label="上一首">|‹</button>
      <button type="button" className="primary" disabled={Boolean(controlBusy)} onClick={() => void runControl('toggle', onToggle)} aria-label={playback.isPlaying ? '暂停' : '播放'}>{controlBusy === 'toggle' ? '…' : playback.isPlaying ? 'Ⅱ' : '▶'}</button>
      <button type="button" disabled={Boolean(controlBusy)} onClick={() => void runControl('next', () => onCommand('next'))} aria-label="下一首">›|</button>
      <div className="playback-mode-control">
        <button type="button" className={playbackMode !== 'off' ? 'active' : ''} disabled={Boolean(controlBusy)} onClick={() => void cyclePlaybackMode()} aria-label={`${modeLabel(playbackMode)}，点击切换`} title={`${modeLabel(playbackMode)}，点击切换`}>
          <ModeIcon mode={playbackMode} />
        </button>
      </div>
    </footer>
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

function ModeIcon({ mode }: { mode: PlaybackMode }) {
  if (mode === 'shuffle' || mode === 'off') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h2.5c4 0 5 10 9 10H20M17 14l3 3-3 3M4 17h2.5c1.5 0 2.6-1.4 3.7-3M14 7h6M17 4l3 3-3 3" /></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />{mode === 'track' && <text x="12" y="14.5">1</text>}</svg>
}

function PlaybackProgress({ playback }: { playback: PlaybackState }) {
  const [progress, setProgress] = useState(playback.progressMs)
  const duration = playback.durationMs || playback.track?.durationMs || 0

  useEffect(() => {
    setProgress(playback.progressMs)
    if (!playback.isPlaying || !duration) return
    const timer = window.setInterval(() => setProgress((value) => Math.min(duration, value + 1_000)), 1_000)
    return () => window.clearInterval(timer)
  }, [playback.progressMs, playback.isPlaying, playback.track?.uri, duration])

  const percentage = duration ? Math.min(100, Math.max(0, progress / duration * 100)) : 0
  return <div className="playback-progress" role="progressbar" aria-label="歌曲播放进度" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.min(progress, duration)}>
    <span style={{ width: `${percentage}%` }} />
  </div>
}

function modeLabel(mode: PlaybackMode) {
  if (mode === 'shuffle') return '播放模式：歌曲随机'
  if (mode === 'context') return '播放模式：歌单循环'
  if (mode === 'track') return '播放模式：单曲循环'
  return '播放模式：顺序播放'
}
