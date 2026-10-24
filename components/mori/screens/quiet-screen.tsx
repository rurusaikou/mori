'use client'

import { useState } from 'react'
import { Moon, Pause, Play, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ambientSounds, tracks } from '@/lib/mori-data'
import { Mascot } from '../mascot'
import { useMori } from '../mori-context'
import { TopBar } from '../primitives'

export function QuietScreen() {
  const { navigate, currentTrack, isPlaying, togglePlay, showToast } = useMori()
  const [ambient, setAmbient] = useState<(typeof ambientSounds)[number]>('夜雨')

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_50%_45%,rgba(142,106,160,0.4),transparent_45%)]">
      <TopBar title="安静陪伴" subtitle="低打扰模式" />

      <div className="no-scrollbar flex flex-1 flex-col items-center overflow-y-auto px-6 pt-8 text-center">
        <Moon className="size-7 fill-[#f0d7ff] text-[#f0d7ff] drop-shadow-[0_0_12px_rgba(232,198,255,0.8)]" aria-hidden="true" />
        <h2 className="mt-4 text-2xl font-semibold">安静陪伴中</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          我在这里，
          <br />
          陪你静静地听着。
        </p>

        <Mascot mood="sleepy" scale={0.95} className="my-10" />

        <p className="text-sm text-foreground/85" aria-live="polite">
          {currentTrack ? `${isPlaying ? '正在播放' : '已暂停'} · ${currentTrack.title}` : '还没有播放音乐'}
        </p>

        <fieldset className="mt-5 w-full">
          <legend className="mb-2.5 text-xs text-muted-foreground">环境音</legend>
          <div className="flex justify-center gap-2">
            {ambientSounds.map((sound) => (
              <button
                key={sound}
                type="button"
                aria-pressed={ambient === sound}
                onClick={() => {
                  setAmbient(sound)
                  showToast(`环境音已切换为「${sound}」`)
                }}
                className={cn(
                  'rounded-full px-3.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  ambient === sound ? 'bg-primary text-primary-foreground' : 'bg-white/[0.08] hover:bg-white/[0.12]',
                )}
              >
                {sound}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex shrink-0 justify-center gap-4 px-6 pb-10 pt-6">
        <button
          type="button"
          onClick={() => togglePlay(currentTrack ? undefined : tracks.eveningBreeze)}
          className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-white/10 text-sm font-medium transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
          {isPlaying ? '暂停音乐' : '播放音乐'}
        </button>
        <button
          type="button"
          onClick={() => navigate('home')}
          className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-white/10 text-sm font-medium transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
          结束陪伴
        </button>
      </div>
    </div>
  )
}
