import type { MusicMemory } from '@mori/domain'

export function MomentPanel({ memories }: { memories: MusicMemory[] }) {
  return <section className="feature-view moment-panel" aria-label="音乐瞬间">
    {memories.length ? <div className="moment-list">
      {memories.map((memory) => <article className="moment-card" key={memory.id}>
        <time>{formatDate(memory.createdAt)}</time>
        <div className="moment-track">
          {memory.track?.artwork ? <img src={memory.track.artwork} alt="" /> : <span className="media-placeholder">✦</span>}
          <span><strong>{memory.track?.title ?? '音乐瞬间'}</strong><small>{memory.track?.artist || '和 Mori 一起记住'}</small></span>
        </div>
        <p>{memory.note}</p>
      </article>)}
    </div> : <div className="empty-state"><span>✦</span><strong>还没有音乐瞬间</strong><p>播放歌曲时点击底部的瞬间按钮，Mori 会替你记住。</p></div>}
  </section>
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
