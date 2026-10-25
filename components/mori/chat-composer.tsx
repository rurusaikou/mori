'use client'

import { ArrowUp, Music2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  className,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      className={cn('flex items-center gap-1 rounded-full border border-white/15 bg-[#17112d]/55 p-1.5 shadow-inner backdrop-blur-xl focus-within:border-primary/60', className)}
    >
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center text-primary"><Music2 className="size-5" /></span>
      <label htmlFor="mori-chat-input" className="sr-only">给 Mori 发消息</label>
      <input
        id="mori-chat-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault()
        }}
        placeholder="和 Mori 说点什么…"
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-white/45"
      />
      <button
        type="submit"
        aria-label="发送给 Mori"
        disabled={!value.trim() || disabled}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        <ArrowUp className="size-5" />
      </button>
    </form>
  )
}
