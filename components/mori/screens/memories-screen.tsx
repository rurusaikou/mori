'use client'

import { useEffect, useState } from 'react'
import { HeartPulse, LoaderCircle, MessageCircle, Music2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { memories, memoryFilters, type Memory, type MemoryType } from '@/lib/mori-data'
import { Cover, PlayButton } from '../primitives'
import { useSpotify } from '../spotify-context'

type ListeningEvent = { sessionId: string; updatedAt: string; listenedMs: number; positionMs: number; durationMs: number; completed: boolean }
type ListeningTrackHistory = { spotifyUri: string; isrc?: string; title: string; artist: string; artwork?: string; playCount: number; totalListenedMs: number; lastPlayedAt: string; timeline: ListeningEvent[] }
type ListeningMemory = Pick<ListeningTrackHistory, 'spotifyUri' | 'title' | 'artist' | 'artwork' | 'playCount' | 'totalListenedMs'> & { updatedAt: string }

export function MemoriesScreen() {
  const spotify = useSpotify()
  const [filter, setFilter] = useState<'all' | MemoryType>('all')
  const [listeningMemories, setListeningMemories] = useState<ListeningMemory[]>([])
  const [loadingListening, setLoadingListening] = useState(false)
  const visible = memories.filter((m) => m.type !== 'music' && (filter === 'all' || m.type === filter))
  const groups = visible.reduce<Record<string, Memory[]>>((acc, m) => {
    ;(acc[m.date] ??= []).push(m)
    return acc
  }, {})
  const visibleListening = filter === 'all' || filter === 'music' ? listeningMemories : []
  const listeningGroups = visibleListening.reduce<Record<string, ListeningMemory[]>>((acc, memory) => {
    ;(acc[formatMemoryDate(memory.updatedAt)] ??= []).push(memory)
    return acc
  }, {})

  useEffect(() => {
    if (!spotify.user?.id) { setListeningMemories([]); return }
    setLoadingListening(true)
    void fetch(`/api/listening-history?userId=${encodeURIComponent(spotify.user.id)}`)
      .then(async (response) => response.ok ? response.json() as Promise<{ history: ListeningTrackHistory[] }> : { history: [] })
      .then(({ history }) => setListeningMemories(aggregateListeningHistory(history)))
      .finally(() => setLoadingListening(false))
  }, [spotify.user?.id])

  return (
    <div className="mori-mini-safe-scroll no-scrollbar h-full overflow-y-auto">
      <header className="px-5 pb-4 pt-5">
        <h1 className="text-2xl font-semibold">我们的记忆</h1>
        <p className="mt-1 text-sm text-muted-foreground">每一首歌，都有属于你的时刻</p>
      </header>

      <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pb-5" role="group" aria-label="筛选记忆">
        {memoryFilters.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'shrink-0 rounded-full px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              filter === f.id ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground/85 hover:bg-secondary',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-4">
        {Object.entries(listeningGroups).map(([date, items]) => (
          <section key={`listening-${date}`} className="mb-5" aria-labelledby={`listening-date-${date}`}>
            <h2 id={`listening-date-${date}`} className="mb-2.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{date}</h2>
            <ol className="flex flex-col gap-2.5">{items.map((memory) => <li key={memory.spotifyUri}><ListeningMemoryCard memory={memory} /></li>)}</ol>
          </section>
        ))}
        {Object.entries(groups).map(([date, items]) => (
          <section key={date} className="mb-5" aria-labelledby={`date-${date}`}>
            {!listeningGroups[date] && <h2 id={`date-${date}`} className="mb-2.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{date}</h2>}
            <ol className="flex flex-col gap-2.5">
              {items.map((m) => (
                <li key={m.id}>
                  <MemoryCard memory={m} />
                </li>
              ))}
            </ol>
          </section>
        ))}
        {loadingListening && visibleListening.length === 0 && <div className="grid place-items-center py-12 text-sm text-muted-foreground"><LoaderCircle className="mb-3 size-5 animate-spin" />正在读取一起听过的歌…</div>}
        {!loadingListening && visible.length === 0 && visibleListening.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">这里还没有记忆，和 Mori 一起创造吧。</p>
        )}
      </div>
    </div>
  )
}

function ListeningMemoryCard({ memory }: { memory: ListeningMemory }) {
  return <article className="flex gap-3 rounded-2xl border border-border bg-card p-3">
    {memory.artwork ? <img src={memory.artwork} alt={`${memory.title} 封面`} className="size-[52px] shrink-0 rounded-lg object-cover shadow-md shadow-black/30" /> : <span className="grid size-[52px] shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"><Music2 className="size-5" /></span>}
    <div className="min-w-0 flex-1">
      <h3 className="truncate text-sm font-medium">{memory.title}<span className="ml-1.5 text-xs font-normal text-muted-foreground">{memory.artist}</span></h3>
      <p className="mt-1 text-sm leading-relaxed text-foreground/75">和 Mori 一起听过 {memory.playCount} 次 · 累计 {formatListeningDuration(memory.totalListenedMs)}</p>
      <time dateTime={memory.updatedAt} className="mt-1.5 block text-xs text-muted-foreground">{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(memory.updatedAt))}</time>
    </div>
  </article>
}

function formatMemoryDate(value: string) {
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return '今天'
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date)
}

function formatListeningDuration(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 1) return `${Math.max(1, Math.round(milliseconds / 1000))} 秒`
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`
}

function aggregateListeningHistory(history: ListeningTrackHistory[]) {
  // Spotify URI 可能因专辑版本不同而变化；展示层按歌名和歌手合并，再以 sessionId 去重。
  const groups = new Map<string, { track: ListeningTrackHistory; sessions: Map<string, ListeningEvent> }>()
  for (const track of history) {
    const normalizedTitle = track.title.normalize('NFKC').trim().toLocaleLowerCase()
    const normalizedArtist = track.artist.normalize('NFKC').trim().toLocaleLowerCase()
    const key = `${normalizedTitle}::${normalizedArtist}`
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, { track, sessions: new Map(track.timeline.map((event) => [event.sessionId, event])) })
      continue
    }
    for (const event of track.timeline) {
      const previous = existing.sessions.get(event.sessionId)
      if (!previous || Date.parse(event.updatedAt) > Date.parse(previous.updatedAt)) existing.sessions.set(event.sessionId, event)
    }
    if (Date.parse(track.lastPlayedAt) > Date.parse(existing.track.lastPlayedAt)) existing.track = track
  }
  return [...groups.values()].map(({ track, sessions }) => {
    const events = [...sessions.values()]
    return {
      spotifyUri: track.spotifyUri,
      title: track.title,
      artist: track.artist,
      artwork: track.artwork,
      playCount: events.length || track.playCount,
      totalListenedMs: events.length ? events.reduce((total, event) => total + event.listenedMs, 0) : track.totalListenedMs,
      updatedAt: events.length ? events.reduce((latest, event) => Date.parse(event.updatedAt) > Date.parse(latest) ? event.updatedAt : latest, events[0].updatedAt) : track.lastPlayedAt,
    }
  }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

function MemoryCard({ memory }: { memory: Memory }) {
  return (
    <article className="flex gap-3 rounded-2xl border border-border bg-card p-3">
      {memory.track ? (
        <Cover src={memory.track.cover} alt={`${memory.track.title} 封面`} size={52} />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'grid size-[52px] shrink-0 place-items-center rounded-lg',
            memory.type === 'chat' ? 'bg-primary/15 text-primary' : 'bg-accent/15 text-accent',
          )}
        >
          {memory.type === 'chat' ? <MessageCircle className="size-5" /> : memory.type === 'mood' ? <HeartPulse className="size-5" /> : <Sparkles className="size-5" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">
          {memory.title}
          {memory.track && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{memory.track.artist}</span>}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-foreground/75">{memory.note}</p>
        <time className="mt-1.5 block text-xs text-muted-foreground">{memory.time}</time>
      </div>
      {memory.track && <PlayButton track={memory.track} className="size-9 self-center" />}
    </article>
  )
}
