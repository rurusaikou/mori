'use client'

import { useState } from 'react'
import { ArrowUp, Music2, Pause, Play, Settings2 } from 'lucide-react'
import { Mascot } from '../mascot'
import { useMori } from '../mori-context'
import { IconButton } from '../primitives'
import { useSpotify } from '../spotify-context'

export function HomeScreen() {
  const { navigate } = useMori()
  const spotify = useSpotify()
  const [message, setMessage] = useState('')

  function openChat() {
    const value = message.trim()
    if (value) sessionStorage.setItem('mori.pending-chat', value)
    navigate('chat')
  }

  function openPlayer() {
    if (spotify.nowPlaying) spotify.requestFullPlayer()
    navigate('connect')
  }

  return (
    <div className="no-scrollbar relative h-full overflow-y-auto pb-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[31rem] overflow-hidden">
        <img src="/mori-home-night.png" alt="" className="size-full object-cover object-[center_42%] opacity-75" />
        <span className="absolute inset-0 bg-linear-to-b from-[#151331]/10 via-[#17112d]/10 to-[#17112d]" />
        <span className="absolute inset-x-0 top-0 h-28 bg-linear-to-b from-[#1d1941]/80 to-transparent" />
      </div>

      <header className="relative z-10 flex items-start justify-between px-5 pt-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Mori</h1>
          <p className="mt-1 text-sm text-muted-foreground">陪你听歌，也陪你看世界。</p>
        </div>
        <IconButton label="陪伴偏好设置" onClick={() => navigate('settings')} className="bg-white/[0.06]">
          <Settings2 className="size-5" />
        </IconButton>
      </header>

      <div className="relative z-10 flex justify-center pb-7 pt-28">
        <Mascot scale={1.42} className="drop-shadow-[0_18px_35px_rgba(83,43,150,0.5)]" />
      </div>

      <div className="relative z-10 text-center">
        <h2 className="text-2xl font-semibold">晚上好，Luyang</h2>
        <p className="mt-1.5 text-base text-white/65">今晚也一起听会儿歌吧。</p>
      </div>

      <div className="relative z-10 mt-8 px-5">
        <article className="flex items-center gap-3 rounded-3xl border border-white/15 bg-[#21183c]/65 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_16px_35px_rgba(5,2,18,0.25)] backdrop-blur-2xl">
          <button type="button" onClick={openPlayer} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            {spotify.nowPlaying?.artwork ? <img src={spotify.nowPlaying.artwork} alt="" className="size-16 shrink-0 rounded-2xl object-cover shadow-lg shadow-black/30" /> : <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary"><Music2 className="size-6" /></span>}
            <span className="min-w-0 flex-1"><span className="mb-1 block text-xs text-white/55">{spotify.nowPlaying ? 'Mori 正在陪你听' : '当前音乐'}</span><span className="block truncate text-lg font-semibold">{spotify.nowPlaying?.title ?? '去音乐集选一首歌'}</span><span className="mt-0.5 block truncate text-sm text-white/55">{spotify.nowPlaying?.artist ?? 'Spotify'}</span></span>
          </button>
          {spotify.nowPlaying && <button type="button" onClick={() => void spotify.togglePlayback()} aria-label={spotify.isPlaying ? '暂停' : '播放'} className="grid size-12 shrink-0 place-items-center rounded-full border border-white/15 bg-black/15 text-white shadow-inner">{spotify.isPlaying ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}</button>}
        </article>

        <button type="button" onClick={() => navigate('chat')} className="mt-5 flex items-center gap-3 text-left">
          <span className="grid size-12 shrink-0 place-items-center rounded-full border border-white/15 bg-primary/15"><Mascot scale={0.32} /></span>
          <span className="rounded-3xl rounded-bl-lg bg-linear-to-r from-primary/25 to-white/[0.08] px-5 py-3.5 text-sm text-white/90 shadow-lg shadow-black/10">今晚过得怎么样？我在听。</span>
        </button>

        <form onSubmit={(event) => { event.preventDefault(); openChat() }} className="mt-4 flex items-center gap-1 rounded-full border border-white/15 bg-[#17112d]/55 p-1.5 shadow-inner backdrop-blur-xl focus-within:border-primary/60">
          <span aria-hidden="true" className="grid size-10 place-items-center text-primary"><Music2 className="size-5" /></span>
          <label htmlFor="home-chat-input" className="sr-only">给 Mori 发消息</label>
          <input id="home-chat-input" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="和 Mori 说点什么…" autoComplete="off" className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-white/45" />
          <button type="submit" disabled={!message.trim()} aria-label="发送给 Mori" className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_0_18px_rgba(178,132,241,0.28)] disabled:opacity-40"><ArrowUp className="size-5" /></button>
        </form>
      </div>
    </div>
  )
}
