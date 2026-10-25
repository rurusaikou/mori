'use client'

import { useEffect, useRef } from 'react'
import { HeartPulse } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMori } from '../mori-context'
import { IconButton, TopBar, TrackCard } from '../primitives'
import { useSpotify } from '../spotify-context'
import { ChatComposer } from '../chat-composer'

const quickReplies = ['再推荐一首歌', '我想安静一会儿', '今天其实还不错']

export function ChatScreen() {
  const { navigate, currentTrack, chatMessages, chatDraft, setChatDraft, chatTyping, sendChatMessage } = useMori()
  const spotify = useSpotify()
  const logRef = useRef<HTMLDivElement>(null)
  const listeningTitle = spotify.nowPlaying?.title ?? currentTrack?.title

  useEffect(() => {
    const el = logRef.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [chatMessages, chatTyping])

  return (
    <div className="flex h-full flex-col">
      <TopBar
        title="Mori"
        subtitle={listeningTitle ? `♫ 和你一起听 · ${listeningTitle}` : undefined}
        action={
          <IconButton label="记录此刻心情" onClick={() => navigate('mood')}>
            <HeartPulse className="size-5" />
          </IconButton>
        }
      />

      <div ref={logRef} className="no-scrollbar flex-1 overflow-y-auto px-4 py-5" role="log" aria-label="对话记录">
        <p className="mb-5 text-center text-xs text-muted-foreground">今晚</p>
        <ul className="flex flex-col gap-3">
          {chatMessages.map((m) => (
            <li key={m.id} className="animate-in fade-in slide-in-from-bottom-1">
              {m.role === 'song' ? (
                <TrackCard track={m.track} label="Mori 为你推荐" className="ml-9 bg-secondary" />
              ) : (
                <Bubble role={m.role} text={m.text} />
              )}
            </li>
          ))}
          {chatTyping && (
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
              onClick={() => sendChatMessage(q)}
              disabled={chatTyping}
              className="shrink-0 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-foreground/90 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
        <ChatComposer value={chatDraft} onChange={setChatDraft} onSubmit={() => sendChatMessage(chatDraft)} disabled={chatTyping} />
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
