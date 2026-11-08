/** 概览只回答“我喜欢什么”，并把深度内容导航到独立 View。 */
import type { MusicPreferenceDimension, MusicPreferencePortrait, MusicPreferenceProfile } from '@mori/domain'

type Props = {
  profile: MusicPreferenceProfile | null
  portrait: MusicPreferencePortrait | null
  summary?: string
  loading: boolean
  analyzing: boolean
  error: string
  onAnalyze: () => Promise<void>
  onOpenDetail: () => void
}

export function MusicPreferenceOverview({ profile, portrait, summary, loading, analyzing, error, onAnalyze, onOpenDetail }: Props) {
  return <section className="preference-panel preference-view preference-view-overview" aria-label="音乐偏好概览">
    <MusicProfileSummary summary={summary} />
    {loading ? <p className="preference-status">正在读取音乐画像…</p> : profile && portrait ? <>
      <PreferenceSliders portrait={portrait} />
      <AnalysisSource profile={profile} onOpenDetail={onOpenDetail} />
    </> : <p className="preference-status">还没有音乐画像，首次分析会抽取 Spotify 去重曲库的 20%。</p>}
    {error && <p className="preference-error">{error}</p>}
    <button type="button" className="preference-analyze" disabled={loading || analyzing} onClick={() => void onAnalyze()}>{analyzing ? '分析中…' : <><RefreshIcon />{profile ? '重新分析' : '开始分析'}</>}</button>
  </section>
}

function MusicProfileSummary({ summary }: { summary?: string }) {
  return <div className="preference-portrait"><div className="preference-portrait-label"><SparklesIcon />你的音乐画像</div><p>{summary ?? '分析喜欢的歌曲和可读取歌单，让 Mori 慢慢理解你偏爱的声音。'}</p><PortraitWave /></div>
}

function PreferenceSliders({ portrait }: { portrait: MusicPreferencePortrait }) {
  return <><h2 className="preference-section-title"><span />你的听歌偏好</h2><div className="preference-list">
    <PreferenceRow title="节奏" preference={portrait.rhythmPreference} /><PreferenceRow title="能量" preference={portrait.energyPreference} />
    <PreferenceRow title="律动" preference={portrait.groovePreference} /><PreferenceRow title="情绪" preference={portrait.moodPreference} />
    <PreferenceRow title="声音" preference={portrait.soundPreference} />
  </div></>
}

function PreferenceRow({ title, preference }: { title: string; preference: MusicPreferenceDimension }) {
  return <div className="preference-row"><strong className="preference-row-title">{title}</strong><span className="preference-scale-track"><i style={{ width: `${preference.position * 100}%` }} /><b style={{ left: `${preference.position * 100}%` }} /></span><em className="preference-state">{preference.status}</em></div>
}

function AnalysisSource({ profile, onOpenDetail }: { profile: MusicPreferenceProfile; onOpenDetail: () => void }) {
  return <div className="preference-analysis-source"><span><InfoIcon />基于 {profile.trackCount} / {profile.requestedCount} 首歌曲的特征分析</span><button type="button" onClick={onOpenDetail}>详细分析 <b>›</b></button></div>
}

function SparklesIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.8c.7 4.7 2.6 6.6 7.2 7.2-4.6.7-6.5 2.6-7.2 7.2-.7-4.6-2.6-6.5-7.2-7.2 4.6-.6 6.5-2.5 7.2-7.2Z" /><path d="M19 2v4M21 4h-4" /></svg> }
function InfoIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></svg> }
function RefreshIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 8A7 7 0 0 1 18 6l2 2M17.9 16A7 7 0 0 1 6 18l-2-2" /></svg> }
function PortraitWave() { return <svg className="preference-portrait-wave" viewBox="0 0 120 48" fill="none" aria-hidden="true"><path d="M0 35c16-15 25 7 40-8s23-30 42-16 22 18 38 9" /></svg> }
