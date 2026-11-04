/**
 * 作用：展示并触发基于 Spotify 曲库的音乐偏好画像分析。
 * 输入：已保存的 MusicPreferenceProfile，以及读取和重新分析画像的异步回调。
 * 输出：音乐画像指标 React UI，并通过回调提交分析请求。
 */
import { useEffect, useState } from 'react'
import { deriveMusicPreferencePortrait, type MusicPreferenceAnalysisState, type MusicPreferenceDimension, type MusicPreferenceProfile } from '@mori/domain'

type Props = {
  getState: () => Promise<MusicPreferenceAnalysisState>
  analyze: () => Promise<MusicPreferenceProfile>
}

export function MusicPreferencePanel({ getState, analyze }: Props) {
  const [profile, setProfile] = useState<MusicPreferenceProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let timer: number | undefined
    const refresh = async () => {
      try {
        const state = await getState()
        if (!active) return
        setProfile(state.profile)
        setAnalyzing(state.status === 'analyzing')
        setError(state.error ?? '')
        setLoading(false)
        // Poll only while a background task exists. Reopening this screen attaches to the same
        // task instead of submitting another analysis request.
        if (state.status === 'analyzing') timer = window.setTimeout(() => void refresh(), 1_000)
      } catch (cause) {
        if (active) { setError(messageFor(cause)); setLoading(false) }
      }
    }
    void refresh()
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer) }
  }, [])

  async function runAnalysis() {
    setAnalyzing(true); setError('')
    try { setProfile(await analyze()) }
    catch (cause) { setError(messageFor(cause)) }
    finally { setAnalyzing(false) }
  }

  // 五项刻度来自固定规则，保证同一组指标始终得到相同结果；LLM 只负责顶部叙事画像。
  const portrait = profile ? deriveMusicPreferencePortrait(profile) : null
  const profileSummary = profile?.insight?.summary ?? profile?.portrait?.musicProfileSummary ?? portrait?.musicProfileSummary

  return <section className="preference-panel" aria-label="音乐偏好">
    <div className="preference-portrait">
      <div className="preference-portrait-label"><SparklesIcon />你的音乐画像</div>
      <p>{profileSummary ?? '分析喜欢的歌曲和可读取歌单，让 Mori 慢慢理解你偏爱的声音。'}</p>
    </div>
    {loading ? <p className="preference-status">正在读取音乐画像…</p> : profile && portrait ? <>
      <h2 className="preference-section-title"><span />你的听歌偏好</h2>
      <div className="preference-list">
        <PreferenceRow icon={<RhythmIcon />} title="节奏偏好" low="更慢" high="更快" preference={portrait.rhythmPreference} />
        <PreferenceRow icon={<EnergyIcon />} title="能量偏好" low="更柔" high="更强" preference={portrait.energyPreference} />
        <PreferenceRow icon={<GrooveIcon />} title="律动偏好" low="更弱" high="更强" preference={portrait.groovePreference} />
        <PreferenceRow icon={<MoodIcon />} title="情绪偏好" low="更深" high="更明亮" preference={portrait.moodPreference} />
        <PreferenceRow icon={<SoundIcon />} title="声音偏好" low="人声" high="乐器" preference={portrait.soundPreference} />
      </div>
      <button type="button" className="preference-details-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)}>
        <span><InfoIcon />基于 {profile.trackCount} / {profile.requestedCount} 首歌曲的特征分析</span><strong>{detailsOpen ? '收起详细数据' : '查看详细数据'} <b>{detailsOpen ? '⌃' : '›'}</b></strong>
      </button>
      {detailsOpen && <div className="preference-details">
        <Metric label="平均节奏" value={profile.averageBpm === null ? '—' : `${Math.round(profile.averageBpm)} BPM`} />
        <Metric label="能量" value={percent(profile.energy)} />
        <Metric label="律动感" value={percent(profile.danceability)} />
        <Metric label="明亮度" value={percent(profile.valence)} />
        <Metric label="原声感" value={percent(profile.acousticness)} />
      </div>}
    </> : <p className="preference-status">还没有音乐画像，首次分析会抽取 Spotify 去重曲库的 20%。</p>}
    {error && <p className="preference-error">{error}</p>}
    <button type="button" className="preference-analyze" disabled={loading || analyzing} onClick={() => void runAnalysis()}>{analyzing ? '分析中…' : profile ? '重新分析' : '开始分析'}</button>
  </section>
}

function PreferenceRow({ icon, title, low, high, preference }: { icon: React.ReactNode; title: string; low: string; high: string; preference: MusicPreferenceDimension }) {
  return <div className="preference-row">
    <span className="preference-row-icon" aria-hidden="true">{icon}</span>
    <strong className="preference-row-title">{title}</strong>
    <span className="preference-scale">
      <span className="preference-scale-label">{low}</span>
      <span className="preference-scale-track"><i style={{ width: `${preference.position * 100}%` }} /><b style={{ left: `${preference.position * 100}%` }} /></span>
      <span className="preference-scale-label preference-scale-high">{high}</span>
    </span>
    <em className="preference-state">{preference.status}</em>
  </div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>
}

function percent(value: number | null) { return value === null ? '—' : `${Math.round(value * 100)}%` }
function messageFor(cause: unknown) { return cause instanceof Error ? cause.message : '音乐偏好分析失败' }

function SparklesIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.8c.7 4.7 2.6 6.6 7.2 7.2-4.6.7-6.5 2.6-7.2 7.2-.7-4.6-2.6-6.5-7.2-7.2 4.6-.6 6.5-2.5 7.2-7.2Z" /><path d="M19 2v4M21 4h-4" /></svg> }
function RhythmIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="M3 12h3l2-5 4 10 3-7 2 2h4" /></svg> }
function EnergyIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="m13.5 2-8 12h6l-1 8 8-12h-6l1-8Z" /></svg> }
function GrooveIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="M3 10v4M7.5 6.5v11M12 3.5v17M16.5 7v10M21 10v4" /></svg> }
function MoodIcon() { return <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></svg> }
function SoundIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="m15.5 3 5.5 5.5-2.5 2.5-1.7-1.7-5.1 5.1a4.5 4.5 0 1 1-2.1-2.1l5.1-5.1L13 5.5 15.5 3Z" /><circle cx="7.5" cy="16.5" r="1.4" /></svg> }
function InfoIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></svg> }
