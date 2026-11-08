/** 独立详情 View：用 Data / Pattern / Meaning 三种表达解释同一份分析结果。 */
import { useState } from 'react'
import type { MusicPreferencePortrait, MusicPreferenceProfile } from '@mori/domain'

type DetailTab = 'data' | 'traits' | 'insight'
type Props = { profile: MusicPreferenceProfile; portrait: MusicPreferencePortrait }

export function MusicPreferenceDetail({ profile, portrait }: Props) {
  const [tab, setTab] = useState<DetailTab>('data')
  return <section className="preference-detail preference-view preference-view-detail" aria-label="音乐偏好详细分析">
    <DetailTabs value={tab} onChange={setTab} />
    <div className="preference-detail-scroll">
      {tab === 'data' && <MusicDataTab profile={profile} />}
      {tab === 'traits' && <ListeningTraitsTab profile={profile} portrait={portrait} />}
      {tab === 'insight' && <AIInterpretationTab profile={profile} portrait={portrait} />}
    </div>
  </section>
}

function DetailTabs({ value, onChange }: { value: DetailTab; onChange: (tab: DetailTab) => void }) {
  const tabs: Array<[DetailTab, string]> = [['data', '音乐数据'], ['traits', '听歌特征'], ['insight', 'AI 解读']]
  return <nav className="preference-detail-tabs" aria-label="详细分析分类">{tabs.map(([id, label]) => <button type="button" className={value === id ? 'active' : ''} aria-selected={value === id} onClick={() => onChange(id)} key={id}>{label}</button>)}</nav>
}

function MusicDataTab({ profile }: { profile: MusicPreferenceProfile }) {
  return <div className="detail-tab-content">
    <SectionHeading title="你的音乐数据" subtitle={`基于 ${profile.trackCount} / ${profile.requestedCount} 首歌曲的分析`} />
    <div className="music-metric-grid">
      <Metric label="平均节奏" value={profile.averageBpm === null ? '—' : `${Math.round(profile.averageBpm)} BPM`} />
      <Metric label="能量" value={percent(profile.energy)} /><Metric label="律动感" value={percent(profile.danceability)} />
      <Metric label="明亮度" value={percent(profile.valence)} /><Metric label="声学度" value={percent(profile.acousticness)} />
    </div>
    <section className="detail-reading-note"><h3>怎样理解这些数字？</h3><p>它们来自歌曲声音特征的整体平均，用来观察你的曲库更靠近哪种听感，而不是评价单首歌曲。</p></section>
  </div>
}

function ListeningTraitsTab({ profile, portrait }: Props) {
  const traits = profile.insight?.traits ?? [
    { name: '节奏偏好', description: portrait.rhythmPreference.description },
    { name: '能量感受', description: portrait.energyPreference.description },
    { name: '情绪倾向', description: portrait.moodPreference.description },
  ]
  return <div className="detail-tab-content">
    <SectionHeading title="你的听歌特征" subtitle={`从你的 ${profile.requestedCount} 首歌曲中，这些倾向出现得最明显。`} />
    <div className="listening-trait-list">
      {traits.slice(0, 3).map((trait, index) => <TraitRow key={`${trait.name}-${index}`} icon={['♪', '◇', '≋'][index]} title={trait.name} value={trait.description} />)}
      <TraitRow icon="↗" title="声音与节奏" value={`${portrait.soundPreference.status} · ${portrait.rhythmPreference.status} · ${portrait.groovePreference.status}`} />
    </div>
    <PreferenceFingerprint portrait={portrait} />
  </div>
}

function PreferenceFingerprint({ portrait }: { portrait: MusicPreferencePortrait }) {
  return <section className="preference-fingerprint"><h3>你的偏好组合</h3><div className="fingerprint-visual">
    <span className="fingerprint-keyword k1">{portrait.energyPreference.status}</span><span className="fingerprint-keyword k2">{portrait.soundPreference.status}</span>
    <span className="fingerprint-core">♪</span>
    <span className="fingerprint-keyword k3">{portrait.rhythmPreference.status}</span><span className="fingerprint-keyword k4">{portrait.moodPreference.status}情绪</span>
  </div></section>
}

function AIInterpretationTab({ profile, portrait }: Props) {
  const [feedback, setFeedback] = useState<'不像' | '有一点' | '很像' | null>(null)
  const conclusion = profile.insight?.keywords?.length ? profile.insight.keywords.slice(0, 2).join('，') : conclusionFor(portrait)
  const narrative = profile.insight?.listeningStyle ?? narrativeFor(profile)
  return <div className="detail-tab-content insight-tab">
    <section className="mori-insight"><h2>✦ Mori 的理解</h2><p>{narrative}</p><blockquote>“{conclusion}”<small>的音乐更容易打动你。</small></blockquote></section>
    <section className="reasoning-evidence"><h3><span />为什么这么判断？</h3>
      <Evidence value={percent(profile.energy)} label="能量" copy="你的音乐通常有比较明显的力量感。" />
      <Evidence value={profile.averageBpm === null ? '—' : `${Math.round(profile.averageBpm)} BPM`} label="平均节奏" copy="整体节奏保持推进，很少完全停滞。" />
      <Evidence value={percent(profile.danceability)} label="律动感" copy="你并不特别依赖强烈节拍获得刺激。" />
    </section>
    <section className="insight-conclusion"><span>✦</span><p>因此，你的偏好更接近：<strong>{reasoningConclusion(profile)}</strong></p></section>
    <section className="insight-feedback"><h3><span />这像你吗？</h3><div>{(['不像', '有一点', '很像'] as const).map((item) => <button type="button" className={feedback === item ? 'active' : ''} onClick={() => setFeedback(item)} key={item}>{item === '不像' ? '☹' : '☺'} {item}</button>)}</div>{feedback && <p>Mori 会参考你的反馈。</p>}</section>
  </div>
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) { return <header className="detail-section-heading"><h2><span />{title}</h2><p>{subtitle}</p></header> }
function Metric({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value}</strong></div> }
function TraitRow({ icon, title, value }: { icon: string; title: string; value: string }) { return <div className="listening-trait-row"><i>{icon}</i><span><strong>{title}</strong><small>{value}</small></span></div> }
function Evidence({ value, label, copy }: { value: string; label: string; copy: string }) { return <div className="evidence-row"><strong>{value}</strong><span>{label}</span><p>{copy}</p></div> }
function percent(value: number | null) { return value === null ? '—' : `${Math.round(value * 100)}%` }

function conclusionFor(portrait: MusicPreferencePortrait) {
  if (portrait.energyPreference.level === 'high' && portrait.groovePreference.level !== 'high') return '有推进感，但不吵闹'
  if (portrait.groovePreference.level === 'high') return '节拍鲜明，自然流动'
  return '层次清晰，留有呼吸感'
}
function narrativeFor(profile: MusicPreferenceProfile) {
  const energy = profile.energy ?? 0.5; const groove = profile.danceability ?? 0.5
  if (energy > 0.65 && groove < 0.5) return '你喜欢的似乎不是单纯的“热闹”。歌曲整体力量感偏高，节奏也在向前推进，但律动并没有一起升高。比起不断刺激，你可能更在意声音如何展开。'
  return '你常听的音乐没有只朝一个方向靠拢。不同强度与情绪可以同时存在，而真正稳定出现的，是你对声音层次和整体流动的关注。'
}
function reasoningConclusion(profile: MusicPreferenceProfile) {
  if ((profile.energy ?? 0.5) > (profile.danceability ?? 0.5) + 0.15) return '能量更多来自声音的层次与推进，而不只是节拍本身。'
  return '节奏、声音质感与情绪共同塑造听感，而不是由单一指标决定。'
}
