'use client'

import { useState } from 'react'
import { ArrowUp, MessageCircle, Settings2 } from 'lucide-react'
import { Mascot } from '../mascot'
import { useMori } from '../mori-context'
import { IconButton } from '../primitives'

export function HomeScreen() {
  const { navigate } = useMori()
  const [message, setMessage] = useState('')

  function openChat() {
    const value = message.trim()
    if (value) sessionStorage.setItem('mori.pending-chat', value)
    navigate('chat')
  }

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

      <div className="relative flex justify-center pb-10 pt-16">
        <Mascot scale={1.18} />
      </div>

      <div className="relative text-center">
        <h2 className="text-xl font-semibold">晚上好，Luyang</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">我会一直在这里陪着你。</p>
      </div>

      <section className="relative mt-8 rounded-3xl border border-white/10 bg-card/75 p-4 shadow-lg shadow-black/10 backdrop-blur-xl">
        <button type="button" onClick={() => navigate('chat')} className="flex w-full items-center gap-3 text-left">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/20 text-primary"><MessageCircle className="size-[18px]" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">和 Mori 聊聊</span><span className="block text-xs text-muted-foreground">随时都可以告诉我</span></span>
          <span className="text-xs text-primary">展开</span>
        </button>
        <div className="mt-4 flex items-end gap-2">
          <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-b from-[#f0d8ff] to-[#9560dd] text-xs font-bold text-[#5a3288]">M</span>
          <p className="rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2.5 text-sm leading-relaxed">今晚过得怎么样？我在听。</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); openChat() }} className="mt-4 flex items-center gap-1 rounded-full border border-border bg-background/45 p-1 focus-within:border-primary/60">
          <label htmlFor="home-chat-input" className="sr-only">给 Mori 发消息</label>
          <input id="home-chat-input" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="和 Mori 说点什么…" autoComplete="off" className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground" />
          <button type="submit" disabled={!message.trim()} aria-label="发送给 Mori" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"><ArrowUp className="size-5" /></button>
        </form>
      </section>
    </div>
  )
}
