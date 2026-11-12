/**
 * 作用：在真正写入 Moment 前收集用户主动选择的心情和可选短句。
 * 输入：提交、取消回调与保存状态。
 * 输出：无副作用的轻量 Dialog；只有确认后才把 MusicMomentInput 交给后台。
 */
import { useState } from 'react'
import type { MusicMomentInput, MusicMood } from '@mori/domain'

const moods: Array<{ value: MusicMood; icon: string; label: string }> = [
  { value: 'calm', icon: '◌', label: '平静' },
  { value: 'happy', icon: '☀', label: '开心' },
  { value: 'healing', icon: '♡', label: '治愈' },
  { value: 'moved', icon: '✦', label: '感动' },
  { value: 'nostalgic', icon: '◷', label: '怀念' },
  { value: 'low', icon: '☾', label: '低落' },
]

export function MomentComposer({ saving, onCancel, onConfirm }: { saving: boolean; onCancel: () => void; onConfirm: (input: MusicMomentInput) => Promise<void> }) {
  const [mood, setMood] = useState<MusicMood | null>(null)
  const [note, setNote] = useState('')
  return <div className="moment-composer-backdrop" onClick={(event) => event.stopPropagation()}>
    <section className="moment-composer" role="dialog" aria-modal="true" aria-labelledby="moment-composer-title">
      <header><span><b>✦</b><strong id="moment-composer-title">记录此刻</strong></span><button type="button" onClick={onCancel} disabled={saving} aria-label="取消记录">×</button></header>
      <p>此刻，你是什么心情？</p>
      <div className="moment-moods" role="group" aria-label="选择心情">
        {moods.map((item) => <button type="button" key={item.value} className={mood === item.value ? 'active' : ''} aria-pressed={mood === item.value} onClick={() => setMood(item.value)}><span>{item.icon}</span>{item.label}</button>)}
      </div>
      <input value={note} maxLength={80} onChange={(event) => setNote(event.target.value)} placeholder="想为这一刻留句话吗？（可选）" aria-label="此刻的记录" />
      <button type="button" className="moment-confirm" disabled={!mood || saving} onClick={() => mood && void onConfirm({ mood, note })}>{saving ? '正在保存…' : '记住这一刻'}</button>
    </section>
  </div>
}

export function moodLabel(mood?: MusicMood) {
  return moods.find((item) => item.value === mood)?.label
}
