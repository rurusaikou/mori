const highlights = [
  { title: '心情记录', desc: '感受、影响因素与当下音乐' },
  { title: '文字聊天', desc: '根据心情推荐歌曲' },
  { title: '安静陪伴', desc: '环境音与低打扰陪听' },
  { title: '共同记忆', desc: '把每首歌和心情记下来' },
]

export function PrototypeIntro() {
  return (
    <aside className="hidden max-w-xs lg:block">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Mobile prototype</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance">Mori</h1>
      <p className="mt-3 leading-relaxed text-muted-foreground">
        一个陪你听歌、聊天、记录心情的 AI 伙伴。在右侧手机中点击体验完整流程。
      </p>
      <ul className="mt-8 flex flex-col gap-4">
        {highlights.map((h) => (
          <li key={h.title} className="flex gap-3">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span>
              <span className="block text-sm font-medium">{h.title}</span>
              <span className="block text-sm text-muted-foreground">{h.desc}</span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
