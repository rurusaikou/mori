'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronLeft, Music2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tracks } from '@/lib/mori-data'
import { Mascot } from '../mascot'
import { useMori } from '../mori-context'
import { Cover } from '../primitives'

const feelings = ['平静', '满足', '轻松', '期待', '有力量', '无所谓', '疲惫', '焦虑', '孤单', '难过']
const influences = ['工作', '学习', '家人', '朋友', '关系', '健康', '睡眠', '天气', '旅行', '兴趣', '金钱', '当下发生的事']
const moodCopy = [
  { label: '很不舒服', color: '#7261b8' },
  { label: '有些低落', color: '#748bd2' },
  { label: '平平淡淡', color: '#9d8ac9' },
  { label: '感觉不错', color: '#d595bc' },
  { label: '非常愉快', color: '#f0b47f' },
]

export function MoodScreen() {
  const { back, navigate, showToast } = useMori()
  const [step, setStep] = useState(0)
  const [score, setScore] = useState(2)
  const [selectedFeelings, setSelectedFeelings] = useState<string[]>([])
  const [selectedInfluences, setSelectedInfluences] = useState<string[]>([])
  const [withMusic, setWithMusic] = useState(true)
  const mood = moodCopy[score]

  const title = useMemo(() => ['记录此刻', '它更像哪种感受？', '是什么影响了你？', '为此刻留一首歌'][step], [step])
  const toggle = (value: string, list: string[], set: (next: string[]) => void) =>
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value])

  function next() {
    if (step === 3) {
      showToast(`已记录：${mood.label}${selectedFeelings.length ? ` · ${selectedFeelings.join('、')}` : ''}`)
      navigate('memories')
      return
    }
    setStep((s) => s + 1)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_36%,rgba(180,148,245,0.18),transparent_42%)]">
      <header className="grid h-16 shrink-0 grid-cols-[48px_1fr_48px] items-center px-2">
        <button type="button" aria-label="上一步" onClick={() => (step ? setStep(step - 1) : back())} className="grid size-11 place-items-center rounded-full bg-white/[0.06]">
          <ChevronLeft className="size-6" />
        </button>
        <div className="text-center">
          <p className="text-[11px] tracking-[0.18em] text-muted-foreground">心 情 记 录</p>
          <p className="mt-1 text-xs text-primary">{step + 1} / 4</p>
        </div>
        <button type="button" aria-label="关闭" onClick={() => navigate('home')} className="grid size-11 place-items-center rounded-full bg-white/[0.06]">
          <X className="size-5" />
        </button>
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-4 pt-3">
        <h1 className="text-balance text-center text-2xl font-semibold leading-snug">{title}</h1>

        {step === 0 && (
          <div className="flex flex-col items-center pt-7">
            <MoodOrb color={mood.color} score={score} />
            <p className="mt-7 text-xl font-semibold">{mood.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">不用解释，先选一个最接近的感觉。</p>
            <label className="sr-only" htmlFor="mood-range">心情强度</label>
            <input id="mood-range" type="range" min={0} max={4} value={score} onChange={(e) => setScore(Number(e.target.value))} className="mt-10 w-full accent-primary" />
            <div className="mt-2 flex w-full justify-between text-xs text-muted-foreground"><span>很不舒服</span><span>非常愉快</span></div>
          </div>
        )}

        {step === 1 && (
          <div className="pt-6">
            <MoodSummary mood={mood.label} color={mood.color} />
            <p className="mb-3 mt-8 text-sm text-muted-foreground">可以选择多个</p>
            <ChipGrid values={feelings} selected={selectedFeelings} onToggle={(v) => toggle(v, selectedFeelings, setSelectedFeelings)} />
          </div>
        )}

        {step === 2 && (
          <div className="pt-6">
            <MoodSummary mood={mood.label} color={mood.color} detail={selectedFeelings.join('、')} />
            <p className="mb-3 mt-8 text-sm text-muted-foreground">哪些事情最影响此刻？可以跳过。</p>
            <ChipGrid values={influences} selected={selectedInfluences} onToggle={(v) => toggle(v, selectedInfluences, setSelectedInfluences)} />
          </div>
        )}

        {step === 3 && (
          <div className="pt-6">
            <MoodSummary mood={mood.label} color={mood.color} detail={[...selectedFeelings, ...selectedInfluences].join(' · ')} />
            <div className="mt-8 rounded-3xl border border-border bg-card/85 p-4">
              <div className="flex items-center gap-2"><Music2 className="size-4 text-primary" /><h2 className="text-sm font-medium">把正在听的歌留在这段心情里</h2></div>
              <button type="button" onClick={() => setWithMusic(!withMusic)} className={cn('mt-4 flex w-full items-center gap-3 rounded-2xl border p-3 text-left', withMusic ? 'border-primary/60 bg-primary/10' : 'border-border')}>
                <Cover src={tracks.eveningBreeze.cover} alt="晚风封面" size={48} />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">晚风</span><span className="text-xs text-muted-foreground">YOASOBI · 此刻正在播放</span></span>
                <span className={cn('grid size-6 place-items-center rounded-full border', withMusic && 'border-primary bg-primary text-primary-foreground')}>{withMusic && <Check className="size-3.5" />}</span>
              </button>
            </div>
            <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">这条记录只属于你。Mori 会在你允许时，把它加入共同记忆。</p>
          </div>
        )}
      </div>

      <div className="shrink-0 px-5 pb-7 pt-3">
        <button type="button" onClick={next} className="h-13 w-full rounded-full bg-primary font-semibold text-primary-foreground shadow-[0_0_28px_rgba(180,148,245,0.3)]">
          {step === 3 ? '保存心情' : '下一步'}
        </button>
      </div>
    </div>
  )
}

function MoodOrb({ color, score }: { color: string; score: number }) {
  return <div aria-hidden="true" className="relative grid size-52 place-items-center"><span className="absolute inset-0 rounded-[44%_56%_51%_49%] opacity-30 blur-xl transition-colors" style={{ background: color }} /><span className="absolute size-40 rounded-[48%_52%_45%_55%] border border-white/30 transition-all duration-500" style={{ background: `radial-gradient(circle at 44% 40%, #fff, ${color} 22%, ${color}99 48%, transparent 72%)`, transform: `rotate(${score * 18}deg) scale(${0.92 + score * 0.035})` }} /><span className="relative"><Mascot mood={score < 2 ? 'sleepy' : 'idle'} scale={0.55} /></span></div>
}

function MoodSummary({ mood, color, detail }: { mood: string; color: string; detail?: string }) {
  return <div className="flex items-center gap-4 rounded-2xl bg-white/[0.05] p-3"><span className="size-14 shrink-0 rounded-full" style={{ background: `radial-gradient(circle at 40% 35%,#fff,${color} 38%,transparent 72%)` }} /><span><span className="block text-lg font-semibold">{mood}</span>{detail && <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>}</span></div>
}

function ChipGrid({ values, selected, onToggle }: { values: string[]; selected: string[]; onToggle: (value: string) => void }) {
  return <div className="flex flex-wrap gap-2.5">{values.map((value) => <button key={value} type="button" aria-pressed={selected.includes(value)} onClick={() => onToggle(value)} className={cn('rounded-full border px-4 py-2.5 text-sm transition-colors', selected.includes(value) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-white/[0.06] text-foreground/90')}>{value}</button>)}</div>
}
