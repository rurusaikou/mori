'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, HeartPulse, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tracks, type Track } from '@/lib/mori-data'
import { useMori } from '../mori-context'
import { IconButton, TopBar, TrackCard } from '../primitives'

type Message =
  | { id: string; role: 'bot' | 'me'; text: string }
  | { id: string; role: 'song'; track: Track }

const initialMessages: Message[] = [
  { id: 'a', role: 'bot', text: '有什么想和我聊的吗？' },
  { id: 'b', role: 'me', text: '我有点累。\n也许音乐会让我好受一点。' },
  { id: 'c', role: 'bot', text: '嗯…我在听。要不要先听一首歌？' },
  { id: 'd', role: 'song', track: tracks.maybe },
]

const quickReplies = ['再推荐一首歌', '我想安静一会儿', '今天其实还不错']

function replyTo(text: string): Message[] {
  const id = String(Date.now())
  if (/歌|音乐|听/.test(text)) {
    return [
      { id: `${id}-t`, role: 'bot', text: '这首很适合现在的夜晚，我陪你一起听。' },
      { id: `${id}-s`, role: 'song', track: tracks.eveningBreeze },
    ]
  }
  if (/安静|累|休息/.test(text)) {
    return [{ id, role: 'bot', text: '好，那我们就安静地待一会儿。想说话的时候，我一直都在。' }]
  }
  return [{ id, role: 'bot', text: '我在。我们可以慢慢说，也可以先听一会儿歌。' }]
}

export function ChatScreen() {
  const { navigate } = useMori()
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = logRef.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, typing])

  useEffect(() => () => {
    if (replyTimer.current) clearTimeout(replyTimer.current)
  }, [])

  useEffect(() => {
    const pending = sessionStorage.getItem('mori.pending-chat')
    if (!pending) return
    sessionStorage.removeItem('mori.pending-chat')
    send(pending)
  }, [])

  function send(text: string) {
    const value = text.trim()
    if (!value || typing) return
    setMessages((prev) => [...prev, { id: `me-${Date.now()}`, role: 'me', text: value }])
    setInput('')
    setTyping(true)
    replyTimer.current = setTimeout(() => {
      setMessages((prev) => [...prev, ...replyTo(value)])
      setTyping(false)
    }, 900)
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        title="Mori"
        subtitle="在线"
        online
        action={
          <IconButton label="记录此刻心情" onClick={() => navigate('mood')}>
            <HeartPulse className="size-5" />
          </IconButton>
        }
      />

      <div ref={logRef} className="no-scrollbar flex-1 overflow-y-auto px-4 py-5" role="log" aria-label="对话记录">
        <p className="mb-5 text-center text-xs text-muted-foreground">今晚 21:37</p>
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.id} className="animate-in fade-in slide-in-from-bottom-1">
              {m.role === 'song' ? (
                <TrackCard track={m.track} label="Mori 为你推荐" className="ml-9 bg-secondary" />
              ) : (
                <Bubble role={m.role} text={m.text} />
              )}
            </li>
          ))}
          {typing && (
            <li className="flex items-end gap-2" aria-label="Mori 正在输入">
              <BotAvatar />
              <span className="flex gap-1 rounded-2xl rounded-bl-md bg-secondary px-4 py-3.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-1.5 rounded-full bg-foreground/70 motion-safe:animate-[mori-typing_1.2s_ease-in-out_infinite]"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
            </li>
          )}
        </ul>
      </div>

      <div className="shrink-0 px-3 pb-3">
        <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
          {quickReplies.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              disabled={typing}
              className="shrink-0 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-foreground/90 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
          className="flex items-center gap-1 rounded-full border border-border bg-card p-1 focus-within:border-primary/60"
        >
          <IconButton label="更多功能" className="size-10 text-muted-foreground">
            <Plus className="size-5" />
          </IconButton>
          <label htmlFor="chat-input" className="sr-only">
            输入消息
          </label>
          <input
            id="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
            }}
            placeholder="和 Mori 聊聊…"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            aria-label="发送"
            disabled={!input.trim() || typing}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <ArrowUp className="size-5" />
          </button>
        </form>
      </div>
    </div>
  )
}

function BotAvatar() {
  return (
    <span
      aria-hidden="true"
      className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-b from-[#f0d8ff] to-[#9560dd] text-xs font-bold text-[#5a3288]"
    >
      M
    </span>
  )
}

function Bubble({ role, text }: { role: 'bot' | 'me'; text: string }) {
  const mine = role === 'me'
  return (
    <div className={cn('flex items-end gap-2', mine && 'justify-end')}>
      {!mine && <BotAvatar />}
      <p
        className={cn(
          'max-w-[78%] whitespace-pre-line px-3.5 py-2.5 text-sm leading-relaxed',
          mine
            ? 'rounded-2xl rounded-br-md bg-linear-to-br from-[#9c72df] to-[#7352b6] text-white'
            : 'rounded-2xl rounded-bl-md bg-secondary',
        )}
      >
        <span className="sr-only">{mine ? '我：' : 'Mori：'}</span>
        {text}
      </p>
    </div>
  )
}
