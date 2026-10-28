'use client'

import { ChevronUp, Heart, Library, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScreenId } from '@/lib/mori-data'
import { useMori } from './mori-context'
import { Cover } from './primitives'
import { useSpotify } from './spotify-context'
import { Mascot } from './mascot'
import { useMusic } from './music-context'

const tabs: { id: ScreenId; label: string; icon?: typeof Library; mori?: boolean }[] = [
  { id: 'connect', label: '音乐集', icon: Library },
  { id: 'home', label: 'Mori', mori: true },
  { id: 'memories', label: '记忆', icon: Heart },
]

export function DesktopSidebar() {
  const { screen, navigate } = useMori()
  return (
    <nav
      aria-label="主导航"
      className="relative z-40 flex w-44 shrink-0 flex-col border-r border-white/10 bg-[#171229]/90 px-3 pb-4 pt-14 backdrop-blur-2xl"
    >
      <div className="mb-8 px-3"><p className="text-xl font-semibold tracking-tight">Mori</p><p className="mt-1 text-xs text-muted-foreground">音乐陪伴空间</p></div>
      {tabs.map(({ id, label, icon: Icon, mori }) => {
        const active = screen === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => navigate(id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative z-10 mb-1 flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-white/[0.05] hover:text-foreground',
            )}
          >
            {mori ? <MoriNavIcon active={active} /> : Icon ? <Icon className={cn('size-5', active && 'fill-primary/20')} strokeWidth={active ? 2.25 : 1.75} /> : null}
            <span>{label}</span>
          </button>
        )
      })}
      <p className="mt-auto px-3 text-[10px] leading-relaxed text-white/35">Spotify 提供音乐服务<br />Mori 提供陪伴与记忆</p>
    </nav>
  )
}

function MoriNavIcon({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative grid size-6 shrink-0 place-items-center rounded-full transition-[transform,box-shadow]',
        active && 'shadow-[0_0_12px_rgba(180,148,245,0.72)]',
      )}
    >
      <span className="relative grid size-6 place-items-center rounded-full bg-[radial-gradient(circle_at_46%_32%,#fffaff_0%,#e6c2ff_34%,#ad79f3_68%,#7448c5_100%)] shadow-[0_0_0_1px_rgba(210,183,255,0.5)]">
        <span className="absolute left-[5px] top-[9px] size-1 rounded-full bg-[#56347f]" />
        <span className="absolute right-[5px] top-[9px] size-1 rounded-full bg-[#56347f]" />
        <span className="absolute left-1/2 top-[12px] h-1 w-2 -translate-x-1/2 rounded-b-full border-b border-[#56347f]" />
      </span>
    </span>
  )
}

export function CompactPlayer({ onExpand }: { onExpand: () => void }) {
  const { currentTrack, isPlaying, togglePlay, navigate } = useMori()
  const music = useMusic()
  const track = music.track
  const playing = track ? music.isPlaying : isPlaying
  const title = track?.title ?? currentTrack?.title ?? '连接 Spotify，和 Mori 一起听'
  const artist = track?.artist ?? currentTrack?.artist ?? '点击展开完成连接'
  const artwork = track?.artwork ?? currentTrack?.cover
  const progress = track && music.durationMs ? music.progressMs / music.durationMs * 100 : 0

  const expandTo = (screen?: ScreenId) => {
    if (screen) navigate(screen)
    onExpand()
  }

  return (
    <div className="relative h-dvh overflow-hidden rounded-[18px] border border-white/15 bg-linear-to-br from-[#302452] via-[#1c1631] to-[#100c20] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_20px_60px_rgba(4,2,12,0.5)]">
      <div className="absolute inset-x-0 top-0 h-8 [-webkit-app-region:drag]" />
      <button type="button" onClick={() => expandTo()} aria-label="展开 Mori" className="absolute right-2.5 top-2 z-20 grid size-7 place-items-center rounded-lg text-white/55 transition hover:bg-white/10 hover:text-white [-webkit-app-region:no-drag]"><ChevronUp className="size-4" /></button>
      <div className="flex h-full items-center gap-2.5 px-3 pb-2.5 pt-8">
        <button type="button" onClick={() => expandTo(track ? 'connect' : 'home')} className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-white/5 shadow-lg shadow-black/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {artwork ? <img src={artwork} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center"><Mascot scale={0.42} /></span>}
        </button>
        <div className="w-0 min-w-0 flex-1 self-stretch pt-1">
          <button type="button" onClick={() => expandTo(track ? 'connect' : 'home')} className="block w-full text-left">
            <span className="block truncate text-[13px] font-semibold">{title}</span>
            <span className="mt-0.5 block truncate text-[11px] text-white/50">{artist}</span>
          </button>
          <input
            aria-label="播放进度"
            type="range"
            min={0}
            max={music.durationMs || 1}
            value={track ? Math.min(music.progressMs, music.durationMs || 1) : 0}
            disabled={!track || music.connectionStatus !== 'connected'}
            onChange={(event) => void music.seek(Number(event.target.value))}
            className="mori-compact-progress mt-2 block h-2 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default"
            style={{ '--progress': `${Math.min(100, progress)}%` } as React.CSSProperties}
          />
          <div className="mt-0.5 flex items-center justify-center gap-1.5">
            <button type="button" disabled={!track} onClick={() => void music.previous()} aria-label="上一首" className="grid size-7 place-items-center rounded-full text-white/65 hover:bg-white/10 hover:text-white disabled:opacity-25"><SkipBack className="size-3.5 fill-current" /></button>
            <button type="button" onClick={() => track ? void music.toggle() : currentTrack ? togglePlay() : expandTo('connect')} aria-label={playing ? '暂停' : '播放'} className="grid size-9 place-items-center rounded-full bg-white text-[#24173f] shadow-[0_0_18px_rgba(207,169,255,0.28)] active:scale-95">
              {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
            </button>
            <button type="button" disabled={!track} onClick={() => void music.next()} aria-label="下一首" className="grid size-7 place-items-center rounded-full text-white/65 hover:bg-white/10 hover:text-white disabled:opacity-25"><SkipForward className="size-3.5 fill-current" /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function MiniPlayer() {
  const { currentTrack, isPlaying, togglePlay, navigate } = useMori()
  const spotify = useSpotify()
  const music = useMusic()
  const spotifyTrack = music.track
  if (spotify.fullPlayerOpen) return null
  if (!spotifyTrack && !currentTrack) return null
  const title = spotifyTrack?.title ?? currentTrack?.title ?? ''
  const artist = spotifyTrack?.artist ?? currentTrack?.artist ?? ''
  const playing = spotifyTrack ? music.isPlaying : isPlaying
  return (
    <div className="absolute inset-x-5 bottom-5 z-40 flex items-center gap-3 overflow-hidden rounded-2xl border border-white/12 bg-linear-to-br from-white/[0.07] via-[#211733]/80 to-primary/[0.10] p-2 pr-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.13),0_10px_30px_rgba(8,4,20,0.32)] backdrop-blur-2xl backdrop-saturate-150 animate-in fade-in slide-in-from-bottom-2">
      <button
        type="button"
        onClick={() => {
          if (spotifyTrack) spotify.requestFullPlayer()
          navigate(spotifyTrack ? 'connect' : 'quiet')
        }}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        aria-label={spotifyTrack ? `返回 Spotify：${title}` : `打开安静陪伴：${title}`}
      >
        {spotifyTrack ? <img src={spotifyTrack.artwork || '/placeholder.svg'} alt="" className={cn('size-10 shrink-0 rounded-lg object-cover shadow-md shadow-black/30', playing && 'motion-safe:animate-pulse')} /> : <Cover src={currentTrack!.cover} alt="" size={40} className={cn(playing && 'motion-safe:animate-pulse')} />}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {playing ? 'Mori 正在陪你听' : '已暂停'} · {artist}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => spotifyTrack ? void music.toggle() : togglePlay()}
        aria-label={playing ? '暂停' : '播放'}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
      </button>
      <span
        key={spotifyTrack?.uri ?? currentTrack?.id}
        aria-hidden="true"
        className={cn('absolute bottom-0 left-0 h-0.5 bg-primary', spotifyTrack ? 'transition-[width] duration-500' : 'right-0 origin-left motion-safe:animate-[mori-progress_180s_linear_forwards]')}
        style={{ width: spotifyTrack && music.durationMs ? `${Math.min(100, music.progressMs / music.durationMs * 100)}%` : undefined, animationPlayState: spotifyTrack ? undefined : playing ? 'running' : 'paused' }}
      />
    </div>
  )
}

export function Toast() {
  const { toast } = useMori()
  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-28 z-50 flex justify-center px-6">
      {toast && (
        <p
          key={toast.id}
          className="rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2"
        >
          {toast.message}
        </p>
      )}
    </div>
  )
}
