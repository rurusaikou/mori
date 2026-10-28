'use client'

import { useEffect } from 'react'
import { ListMusic, MessageCircle, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { Mascot } from './mascot'
import { useMusic } from './music-context'
import { ChatScreen } from './screens/chat-screen'

export type DesktopWindowType = 'player' | 'presence' | 'conversation'

function openWindow(type: DesktopWindowType) {
  return window.moriDesktop?.openWindow(type)
}

export function PlayerWindow() {
  const music = useMusic()
  const track = music.track
  const progress = music.durationMs ? Math.min(100, music.progressMs / music.durationMs * 100) : 0
  const run = (action: () => Promise<void>) => void action().catch(() => undefined)

  return <div className="flex h-dvh flex-col overflow-hidden bg-linear-to-br from-[#342650]/96 via-[#211833]/98 to-[#130f24]/98 px-5 pb-4 pt-10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.14)]">
    <div className="absolute inset-x-0 top-0 h-8 [-webkit-app-region:drag]" />
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/15 bg-white/[.06] shadow-[0_14px_35px_rgba(6,3,18,.45)]">
        {track?.artwork ? <img src={track.artwork} alt="" className="size-full object-cover" /> : <Mascot scale={0.58} />}
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1"><h1 className="truncate text-lg font-semibold">{track?.title ?? '等待音乐'}</h1><p className="mt-1 truncate text-sm text-white/55">{track?.artist || music.error || 'Soloist 连接后显示当前歌曲'}</p></div>
          <button type="button" onClick={() => void openWindow('conversation')} aria-label="打开对话" className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[.07] text-white/60 hover:text-white"><MessageCircle className="size-4" /></button>
        </div>
        <input type="range" min={0} max={music.durationMs || 1} value={Math.min(music.progressMs, music.durationMs || 1)} disabled={!track} onChange={(event) => run(() => music.seek(Number(event.target.value)))} aria-label="播放进度" className="mori-compact-progress mt-4 block h-3 w-full appearance-none bg-transparent" style={{ '--progress': `${progress}%` } as React.CSSProperties} />
        <div className="mt-2 flex items-center justify-between">
          <button type="button" disabled={!track} onClick={() => run(music.previous)} aria-label="上一首" className="grid size-8 place-items-center disabled:opacity-25"><SkipBack className="size-4 fill-current" /></button>
          <button type="button" disabled={!track || music.connectionStatus !== 'connected'} onClick={() => run(music.toggle)} aria-label={music.isPlaying ? '暂停' : '播放'} className="grid size-11 place-items-center rounded-full bg-white text-[#2d1c4c] shadow-[0_0_24px_rgba(210,170,255,.35)] disabled:opacity-40">{music.isPlaying ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}</button>
          <button type="button" disabled={!track} onClick={() => run(music.next)} aria-label="下一首" className="grid size-8 place-items-center disabled:opacity-25"><SkipForward className="size-4 fill-current" /></button>
          <div className="ml-2 flex min-w-0 flex-1 items-center gap-2"><Volume2 className="size-4 text-white/45" /><input type="range" min={0} max={1} step={0.01} value={music.volume} onChange={(event) => run(() => music.setVolume(Number(event.target.value)))} aria-label="音量" className="min-w-0 flex-1 accent-[#b494f5]" /></div>
        </div>
      </div>
    </div>
    <div className="mt-3 flex items-center justify-between text-[11px] text-white/40"><span>{connectionLabel(music.connectionStatus, music.loggedIn)}</span><button type="button" onClick={() => void openWindow('conversation')} className="flex items-center gap-1.5 hover:text-white/75"><ListMusic className="size-3.5" />Mori</button></div>
  </div>
}

export function PresenceWindow() {
  const music = useMusic()
  useEffect(() => {
    document.documentElement.classList.add('mori-transparent-window')
    document.body.classList.add('mori-transparent-window')
    return () => { document.documentElement.classList.remove('mori-transparent-window'); document.body.classList.remove('mori-transparent-window') }
  }, [])
  return <div className="relative grid h-dvh place-items-center overflow-hidden bg-transparent [-webkit-app-region:drag]">
    <button type="button" onClick={() => void openWindow('conversation')} aria-label="打开与 Mori 的对话" className="group relative grid size-40 place-items-center rounded-full bg-transparent [-webkit-app-region:no-drag]">
      <span className={music.isPlaying ? 'mori-presence-aura absolute inset-3 rounded-full bg-primary/15 blur-xl' : 'absolute inset-4 rounded-full bg-primary/10 blur-xl'} />
      <Mascot scale={1.08} mood={music.isPlaying ? 'talking' : 'idle'} className="transition-transform group-hover:scale-[1.03]" />
      <span className="absolute bottom-0 rounded-full border border-white/10 bg-[#211733]/75 px-3 py-1 text-[11px] text-white/65 backdrop-blur-xl">{music.isPlaying ? '正在听歌…' : 'Mori'}</span>
    </button>
  </div>
}

export function ConversationWindow() {
  return <div className="h-dvh overflow-hidden bg-linear-to-b from-[#251d41]/98 to-[#130f24]/98 pt-8 text-white">
    <div className="absolute inset-x-0 top-0 h-8 [-webkit-app-region:drag]" />
    <ChatScreen />
  </div>
}

function connectionLabel(status: string, loggedIn: boolean) {
  if (status === 'starting') return '正在启动 Soloist'
  if (status === 'pairing' || (status === 'connected' && !loggedIn)) return '请在 Spotify 中选择 Mori'
  if (status === 'connected') return 'Soloist 已连接'
  if (status === 'error') return 'Soloist 启动失败'
  return 'Soloist 未就绪'
}
