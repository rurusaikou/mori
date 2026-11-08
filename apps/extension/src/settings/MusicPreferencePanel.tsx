/** 加载音乐画像，并在概览与独立详细分析 View 之间编排共享数据。 */
import { useEffect, useState } from 'react'
import { deriveMusicPreferencePortrait, type MusicPreferenceAnalysisState, type MusicPreferenceProfile } from '@mori/domain'
import { MusicPreferenceDetail } from './MusicPreferenceDetail'
import { MusicPreferenceOverview } from './MusicPreferenceOverview'

export type MusicPreferenceView = 'overview' | 'detail'

type Props = {
  getState: () => Promise<MusicPreferenceAnalysisState>
  analyze: () => Promise<MusicPreferenceProfile>
  view: MusicPreferenceView
  onViewChange: (view: MusicPreferenceView) => void
}

export function MusicPreferencePanel({ getState, analyze, view, onViewChange }: Props) {
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
        setProfile(state.profile); setAnalyzing(state.status === 'analyzing'); setError(state.error ?? ''); setLoading(false)
        if (state.status === 'analyzing') timer = window.setTimeout(() => void refresh(), 1_000)
      } catch (cause) {
        if (active) { setError(messageFor(cause)); setLoading(false) }
      }
    }
    void refresh()
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer) }
  }, [getState])

  async function runAnalysis() {
    setAnalyzing(true); setError('')
    try { setProfile(await analyze()) }
    catch (cause) { setError(messageFor(cause)) }
    finally { setAnalyzing(false) }
  }

  const portrait = profile ? deriveMusicPreferencePortrait(profile) : null
  const summary = profile?.insight?.summary ?? profile?.portrait?.musicProfileSummary ?? portrait?.musicProfileSummary

  if (view === 'detail' && profile && portrait) return <MusicPreferenceDetail profile={profile} portrait={portrait} />
  return <MusicPreferenceOverview profile={profile} portrait={portrait} summary={summary} loading={loading} analyzing={analyzing} error={error} onAnalyze={runAnalysis} onOpenDetail={() => onViewChange('detail')} />
}

function messageFor(cause: unknown) { return cause instanceof Error ? cause.message : '音乐偏好分析失败' }
