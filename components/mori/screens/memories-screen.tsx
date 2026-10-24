'use client'

import { useState } from 'react'
import { HeartPulse, MessageCircle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { memories, memoryFilters, type Memory, type MemoryType } from '@/lib/mori-data'
import { Cover, PlayButton } from '../primitives'

export function MemoriesScreen() {
  const [filter, setFilter] = useState<'all' | MemoryType>('all')
  const visible = memories.filter((m) => filter === 'all' || m.type === filter)
  const groups = visible.reduce<Record<string, Memory[]>>((acc, m) => {
    ;(acc[m.date] ??= []).push(m)
    return acc
  }, {})

  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-6">
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
        {Object.entries(groups).map(([date, items]) => (
          <section key={date} className="mb-5" aria-labelledby={`date-${date}`}>
            <h2 id={`date-${date}`} className="mb-2.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {date}
            </h2>
            <ol className="flex flex-col gap-2.5">
              {items.map((m) => (
                <li key={m.id}>
                  <MemoryCard memory={m} />
                </li>
              ))}
            </ol>
          </section>
        ))}
        {visible.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">这里还没有记忆，和 Mori 一起创造吧。</p>
        )}
      </div>
    </div>
  )
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
