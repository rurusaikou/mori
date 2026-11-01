/**
 * 作用：展示并触发基于 Spotify 曲库的音乐偏好画像分析。
 * 输入：已保存的 MusicPreferenceProfile，以及读取和重新分析画像的异步回调。
 * 输出：音乐画像指标 React UI，并通过回调提交分析请求。
 */
import { useEffect, useState } from 'react'
import { describeMusicPreference, type MusicPreferenceAnalysisState, type MusicPreferenceProfile } from '@mori/domain'

type Props = {
  getState: () => Promise<MusicPreferenceAnalysisState>
  analyze: () => Promise<MusicPreferenceProfile>
}

export function MusicPreferencePanel({ getState, analyze }: Props) {
  const [profile, setProfile] = useState<MusicPreferenceProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
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

  return <section className="preference-panel" aria-label="音乐偏好">
    <div className="preference-hero"><span>◫</span><h2>你的声音轮廓</h2><p>{profile ? describeMusicPreference(profile) : '分析喜欢的歌曲和可读取歌单，看看你偏爱的声音。'}</p></div>
    {loading ? <p className="preference-status">正在读取音乐画像…</p> : profile ? <div className="preference-metrics">
      <Metric label="平均节奏" value={profile.averageBpm === null ? '—' : `${Math.round(profile.averageBpm)} BPM`} />
      <Metric label="能量" value={percent(profile.energy)} />
      <Metric label="律动感" value={percent(profile.danceability)} />
      <Metric label="明亮度" value={percent(profile.valence)} />
      <Metric label="原声感" value={percent(profile.acousticness)} />
      <Metric label="分析样本" value={`${profile.trackCount}/${profile.requestedCount} 首`} />
    </div> : <p className="preference-status">还没有音乐画像，首次分析会抽取 Spotify 去重曲库的 50%。</p>}
    {error && <p className="preference-error">{error}</p>}
    <button type="button" className="preference-analyze" disabled={loading || analyzing} onClick={() => void runAnalysis()}>{analyzing ? '分析中…' : profile ? '重新分析' : '开始分析'}</button>
  </section>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>
}

function percent(value: number | null) { return value === null ? '—' : `${Math.round(value * 100)}%` }
function messageFor(cause: unknown) { return cause instanceof Error ? cause.message : '音乐偏好分析失败' }
