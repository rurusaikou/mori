'use client'

import Image from 'next/image'
import { ChevronLeft, Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Track } from '@/lib/mori-data'
import { useMori } from './mori-context'

export function IconButton({
  label,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'grid size-11 place-items-center rounded-full text-foreground transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function TopBar({
  title,
  subtitle,
  online,
  action,
}: {
  title: string
  subtitle?: string
  online?: boolean
  action?: React.ReactNode
}) {
  const { back } = useMori()
  return (
    <header className="grid h-14 shrink-0 grid-cols-[44px_1fr_44px] items-center border-b border-border px-2">
      <IconButton label="返回" onClick={back}>
        <ChevronLeft className="size-6" />
      </IconButton>
      <div className="min-w-0 text-center">
        <h1 className="truncate text-[15px] font-semibold leading-tight">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            {online && <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />}
            {subtitle}
          </p>
        )}
      </div>
      {action ?? <span />}
    </header>
  )
}

export function Cover({ src, alt, size = 48, className }: { src: string; alt: string; size?: number; className?: string }) {
  return (
    <Image
      src={src || '/placeholder.svg'}
      alt={alt}
      width={size}
      height={size}
      className={cn('shrink-0 rounded-lg object-cover shadow-md shadow-black/30', className)}
      style={{ width: size, height: size }}
    />
  )
}

export function PlayButton({ track, className }: { track: Track; className?: string }) {
  const { currentTrack, isPlaying, togglePlay } = useMori()
  const active = currentTrack?.id === track.id && isPlaying
  return (
    <button
      type="button"
      onClick={() => togglePlay(track)}
      aria-label={active ? `暂停 ${track.title}` : `播放 ${track.title}`}
      aria-pressed={active}
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-primary-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95',
        className,
      )}
    >
      {active ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
    </button>
  )
}

export function TrackCard({ track, label, className }: { track: Track; label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border border-border bg-card/80 p-2.5 pr-3', className)}>
      <Cover src={track.cover} alt={`${track.title} 封面`} />
      <div className="min-w-0 flex-1">
        {label && <p className="text-xs text-muted-foreground">{label}</p>}
        <p className="truncate text-sm font-medium">{track.title}</p>
        <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
      </div>
      <PlayButton track={track} />
    </div>
  )
}

export function Switch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean
  onCheckedChange: (value: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        checked ? 'bg-primary' : 'bg-white/15',
      )}
    >
      <span
        className={cn(
          'absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </button>
  )
}
