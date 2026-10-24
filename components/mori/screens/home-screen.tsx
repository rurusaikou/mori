'use client'

import { ChevronRight, HeartPulse, MessageCircle, Moon, Music2, Settings2 } from 'lucide-react'
import { tracks } from '@/lib/mori-data'
import { Mascot } from '../mascot'
import { useMori } from '../mori-context'
import { IconButton, TrackCard } from '../primitives'

const modes = [
  { id: 'chat', title: '聊聊天', desc: '文字陪伴', icon: MessageCircle },
  { id: 'mood', title: '记录心情', desc: '留住此刻', icon: HeartPulse },
  { id: 'quiet', title: '安静陪伴', desc: '一起听歌', icon: Moon },
] as const

export function HomeScreen() {
  const { navigate } = useMori()

  return (
    <div className="no-scrollbar relative h-full overflow-y-auto px-5 pb-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-16 size-72 -translate-x-1/2 rounded-full bg-primary/25 blur-3xl"
      />

      <header className="relative flex items-start justify-between pt-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Mori</h1>
          <p className="mt-1 text-sm text-muted-foreground">陪你听歌，也陪你看世界。</p>
        </div>
        <IconButton label="陪伴偏好设置" onClick={() => navigate('settings')} className="bg-white/[0.06]">
          <Settings2 className="size-5" />
        </IconButton>
      </header>

      <div className="relative flex justify-center py-8">
        <Mascot scale={1.05} />
      </div>

      <div className="relative text-center">
        <h2 className="text-xl font-semibold">晚上好，Luyang</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">今天想和我一起做什么？</p>
      </div>

      <div className="relative mt-6 grid grid-cols-3 gap-2.5">
        {modes.map(({ id, title, desc, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => navigate(id)}
            className="flex min-w-0 flex-col items-center gap-1 rounded-2xl border border-border bg-card/70 px-2 py-4 backdrop-blur transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
          >
            <span className="mb-1 grid size-10 place-items-center rounded-full bg-primary/15 text-primary">
              <Icon className="size-5" />
            </span>
            <span className="text-sm font-medium">{title}</span>
            <span className="text-xs text-muted-foreground">{desc}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => navigate('mood')}
        className="relative mt-4 flex h-12 w-full items-center justify-center gap-1 rounded-full bg-linear-to-r from-primary via-[#f1e6ff] to-primary font-semibold text-primary-foreground shadow-[0_0_28px_rgba(210,160,255,0.35)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.99]"
      >
        记录此刻心情
        <ChevronRight className="size-4" />
      </button>

      <div className="relative mt-6 flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => navigate('connect')}
          className="flex items-center gap-3 rounded-2xl border border-border bg-card/80 p-2.5 pr-3 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary/20 text-primary">
            <Music2 className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">连接我的音乐</span>
            <span className="block truncate text-xs text-muted-foreground">Spotify · 网易云音乐 · QQ 音乐</span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <TrackCard track={tracks.eveningBreeze} label="上次听到" />
      </div>
    </div>
  )
}
