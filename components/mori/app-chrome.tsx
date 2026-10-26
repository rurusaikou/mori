'use client'

import { BatteryFull, Heart, Library, Pause, Play, Signal, Wifi } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScreenId } from '@/lib/mori-data'
import { useMori } from './mori-context'
import { Cover } from './primitives'
import { useSpotify } from './spotify-context'

export function StatusBar() {
  return (
    <div className="relative z-30 hidden h-11 shrink-0 items-center justify-between px-7 text-xs font-semibold md:flex" aria-hidden="true">
      <span>9:41</span>
      <span className="flex items-center gap-1.5">
        <Signal className="size-3.5" />
        <Wifi className="size-3.5" />
        <BatteryFull className="size-4" />
      </span>
    </div>
  )
}

const tabs: { id: ScreenId; label: string; icon?: typeof Library; mori?: boolean }[] = [
  { id: 'connect', label: '音乐集', icon: Library },
  { id: 'home', label: 'Mori', mori: true },
  { id: 'memories', label: '记忆', icon: Heart },
]

export function BottomNav() {
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

export function MiniPlayer() {
  const { currentTrack, isPlaying, togglePlay, navigate } = useMori()
  const spotify = useSpotify()
  const spotifyTrack = spotify.nowPlaying
  if (spotify.fullPlayerOpen) return null
  if (!spotifyTrack && !currentTrack) return null
  const title = spotifyTrack?.title ?? currentTrack?.title ?? ''
  const artist = spotifyTrack?.artist ?? currentTrack?.artist ?? ''
  const playing = spotifyTrack ? spotify.isPlaying : isPlaying
  return (
    <div className="absolute inset-x-5 bottom-5 z-40 flex items-center gap-3 overflow-hidden rounded-2xl border border-white/12 bg-linear-to-br from-white/[0.07] via-[#211733]/80 to-primary/[0.10] p-2 pr-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.13),0_10px_30px_rgba(8,4,20,0.32)] backdrop-blur-2xl backdrop-saturate-150 animate-in fade-in slide-in-from-bottom-2">
      <button
        type="button"
        onClick={() => {
          if (spotifyTrack) {
            // 必须在用户点击产生的手势中激活音频，否则 Safari 等浏览器会拦截 Web Playback SDK 的声音。
            void window.moriSpotifyPlayer?.activateElement().catch(() => undefined)
            spotify.requestFullPlayer()
          }
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
        onClick={() => spotifyTrack ? void spotify.togglePlayback() : togglePlay()}
        aria-label={playing ? '暂停' : '播放'}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
      </button>
      <span
        key={spotifyTrack?.uri ?? currentTrack?.id}
        aria-hidden="true"
        className={cn('absolute bottom-0 left-0 h-0.5 bg-primary', spotifyTrack ? 'transition-[width] duration-500' : 'right-0 origin-left motion-safe:animate-[mori-progress_180s_linear_forwards]')}
        style={{ width: spotifyTrack && spotify.durationMs ? `${Math.min(100, spotify.progressMs / spotify.durationMs * 100)}%` : undefined, animationPlayState: spotifyTrack ? undefined : playing ? 'running' : 'paused' }}
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
