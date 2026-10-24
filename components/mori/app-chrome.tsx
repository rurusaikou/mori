'use client'

import { BatteryFull, Heart, Library, Pause, Play, Signal, Wifi } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScreenId } from '@/lib/mori-data'
import { useMori } from './mori-context'
import { Cover } from './primitives'

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
  { id: 'chat', label: 'Mori', mori: true },
  { id: 'memories', label: '记忆', icon: Heart },
]

export function BottomNav() {
  const { screen, navigate } = useMori()
  return (
    <nav
      aria-label="主导航"
      className="relative z-40 grid shrink-0 grid-cols-3 overflow-visible border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
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
              'relative flex h-[4.5rem] flex-col items-center justify-center gap-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {mori ? <MoriNavIcon active={active} /> : Icon ? <Icon className={cn('size-5', active && 'fill-primary/20')} strokeWidth={active ? 2.25 : 1.75} /> : null}
            {label}
          </button>
        )
      })}
    </nav>
  )
}

function MoriNavIcon({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative -mt-7 mb-0.5 grid size-14 place-items-center rounded-full border-[3px] border-background bg-[radial-gradient(circle_at_46%_35%,#fff8ff,#d9adff_34%,#9363df_70%)] shadow-[0_0_22px_rgba(180,148,245,0.45)] transition-transform',
        active && 'scale-105 shadow-[0_0_28px_rgba(180,148,245,0.75)]',
      )}
    >
      <span className="absolute left-3 top-[22px] size-1.5 rounded-full bg-[#56347f]" />
      <span className="absolute right-3 top-[22px] size-1.5 rounded-full bg-[#56347f]" />
      <span className="mt-3 h-1.5 w-3 rounded-b-full border-b-2 border-[#56347f]" />
    </span>
  )
}

export function MiniPlayer() {
  const { currentTrack, isPlaying, togglePlay, navigate } = useMori()
  if (!currentTrack) return null
  return (
    <div className="relative mx-3 mb-2 flex shrink-0 items-center gap-3 overflow-hidden rounded-2xl border border-border bg-secondary/95 p-2 pr-2.5 shadow-lg shadow-black/30 animate-in fade-in slide-in-from-bottom-2">
      <button
        type="button"
        onClick={() => navigate('quiet')}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        aria-label={`打开安静陪伴：${currentTrack.title}`}
      >
        <Cover src={currentTrack.cover} alt="" size={40} className={cn(isPlaying && 'motion-safe:animate-pulse')} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{currentTrack.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {isPlaying ? 'Mori 正在陪你听' : '已暂停'} · {currentTrack.artist}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => togglePlay()}
        aria-label={isPlaying ? '暂停' : '播放'}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      >
        {isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
      </button>
      <span
        key={currentTrack.id}
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary motion-safe:animate-[mori-progress_180s_linear_forwards]"
        style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
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
