'use client'

import { Music2, Pause, Play, Settings2 } from 'lucide-react'
import { Mascot } from '../mascot'
import { useMori } from '../mori-context'
import { IconButton } from '../primitives'
import { useSpotify } from '../spotify-context'
import { ChatComposer } from '../chat-composer'

export function HomeScreen() {
  const { navigate, chatMessages, chatDraft, setChatDraft, chatTyping, sendChatMessage, currentTrack, isPlaying, togglePlay } = useMori()
  const spotify = useSpotify()
  const latestMoriMessage = [...chatMessages].reverse().find((message) => message.role === 'bot')
  const homeTrack = spotify.nowPlaying ?? currentTrack
  const homeArtwork = spotify.nowPlaying?.artwork ?? currentTrack?.cover
  const homeTrackPlaying = spotify.nowPlaying ? spotify.isPlaying : isPlaying

  function openChat() {
    navigate('chat')
  }

  function sendFromHome() {
    if (!chatDraft.trim() || chatTyping) return
    sendChatMessage(chatDraft)
    navigate('chat')
  }

  function openPlayer() {
    if (spotify.nowPlaying) spotify.requestFullPlayer()
    navigate('connect')
  }

  function toggleCurrentTrack() {
    if (spotify.nowPlaying) void spotify.togglePlayback()
    else togglePlay()
  }

  return (
    <div className="no-scrollbar relative h-full overflow-y-auto pb-3">
      <header className="relative z-10 flex items-start justify-between px-5 pt-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Mori</h1>
          <p className="mt-1 text-sm text-muted-foreground">陪你听歌，也陪你看世界。</p>
        </div>
        <IconButton label="陪伴偏好设置" onClick={() => navigate('settings')} className="bg-white/[0.06]">
          <Settings2 className="size-5" />
        </IconButton>
      </header>

      <div className="relative z-10 flex justify-center pb-5 pt-20">
        <Mascot scale={1.32} className="drop-shadow-[0_18px_35px_rgba(83,43,150,0.5)]" />
      </div>

      <div className="relative z-10 text-center">
        <h2 className="text-2xl font-semibold">晚上好，Luyang</h2>
        <p className="mt-1.5 text-base text-white/65">今晚也一起听会儿歌吧。</p>
      </div>

      <div className="relative z-10 mt-5 px-5">
        <article className="flex items-center gap-3 rounded-3xl border border-white/15 bg-[#21183c]/65 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_16px_35px_rgba(5,2,18,0.25)] backdrop-blur-2xl">
          <button type="button" onClick={openPlayer} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            {homeArtwork ? <img src={homeArtwork} alt="" className="size-16 shrink-0 rounded-2xl object-cover shadow-lg shadow-black/30" /> : <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary"><Music2 className="size-6" /></span>}
            <span className="min-w-0 flex-1"><span className="mb-1 block text-xs text-white/55">{homeTrack ? 'Mori 正在陪你听' : '当前音乐'}</span><span className="block truncate text-lg font-semibold">{homeTrack?.title ?? '去音乐集选一首歌'}</span><span className="mt-0.5 block truncate text-sm text-white/55">{homeTrack?.artist ?? 'Spotify'}</span></span>
          </button>
          {homeTrack && <button type="button" onClick={toggleCurrentTrack} aria-label={homeTrackPlaying ? '暂停' : '播放'} className="grid size-12 shrink-0 place-items-center rounded-full border border-white/15 bg-black/15 text-white shadow-inner">{homeTrackPlaying ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}</button>}
        </article>

        <button type="button" onClick={() => openChat()} className="mt-3 flex items-center gap-3 text-left">
          <span className="grid size-12 shrink-0 place-items-center rounded-full border border-white/15 bg-primary/15"><Mascot scale={0.32} /></span>
          <span className="rounded-3xl rounded-bl-lg bg-linear-to-r from-primary/25 to-white/[0.08] px-5 py-3.5 text-sm text-white/90 shadow-lg shadow-black/10">{latestMoriMessage?.role === 'bot' ? latestMoriMessage.text : ''}</span>
        </button>

        <ChatComposer value={chatDraft} onChange={setChatDraft} onSubmit={sendFromHome} disabled={chatTyping} className="mt-3" />
      </div>
    </div>
  )
}
