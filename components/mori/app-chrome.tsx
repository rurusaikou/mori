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
      className="relative z-40 grid h-[4.5rem] shrink-0 grid-cols-3 overflow-visible border border-white/10 bg-[#171229]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      {tabs.map(({ id, label, icon: Icon, mori }) => {
        const active = screen === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => navigate(id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative z-10 flex h-full flex-col items-center text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              mori ? 'justify-end gap-1 pb-5' : 'justify-center gap-1 pb-4',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {mori ? <MoriNavIcon active={active} /> : Icon ? <Icon className={cn('size-5', active && 'fill-primary/20')} strokeWidth={active ? 2.25 : 1.75} /> : null}
            {label}
          </button>
        )
      })}
      <span
        aria-hidden="true"
        className="absolute bottom-2 left-1/2 z-10 h-1 w-[108px] -translate-x-1/2 rounded-full bg-white/85"
      />
    </nav>
  )
}

function MoriNavIcon({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute -top-[23px] left-1/2 z-10 grid size-[52px] -translate-x-1/2 place-items-center rounded-full transition-[transform,box-shadow]',
        active && 'scale-105 shadow-[0_0_0_1px_rgba(226,205,255,0.7),0_0_22px_rgba(180,148,245,0.72)]',
      )}
    >
      <span className="relative grid size-[52px] place-items-center rounded-full bg-[radial-gradient(circle_at_46%_32%,#fffaff_0%,#e6c2ff_34%,#ad79f3_68%,#7448c5_100%)] shadow-[0_0_0_1px_rgba(210,183,255,0.5),0_0_18px_rgba(180,148,245,0.48)]">
        <span className="absolute left-[11px] top-[19px] size-1.5 rounded-full bg-[#56347f]" />
        <span className="absolute right-[11px] top-[19px] size-1.5 rounded-full bg-[#56347f]" />
        <span className="absolute left-1/2 top-[25px] h-1.5 w-3 -translate-x-1/2 rounded-b-full border-b-2 border-[#56347f]" />
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
    <div className="absolute inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom)+0.5rem)] z-40 flex items-center gap-3 overflow-hidden rounded-2xl border border-white/12 bg-linear-to-br from-white/[0.07] via-[#211733]/80 to-primary/[0.10] p-2 pr-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.13),0_10px_30px_rgba(8,4,20,0.32)] backdrop-blur-2xl backdrop-saturate-150 animate-in fade-in slide-in-from-bottom-2">
      <button
        type="button"
        onClick={() => { if (spotifyTrack) spotify.requestFullPlayer(); navigate(spotifyTrack ? 'connect' : 'quiet') }}
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
