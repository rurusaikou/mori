/**
 * 作用：渲染 Mori 应用内设置概览，并区分当前状态与规划功能。
 * 输入：当前 PlaybackState。
 * 输出：设置面板 React UI；不直接修改 OAuth 或 Host 技术配置。
 */
import type { MusicPreferenceAnalysisState, MusicPreferenceProfile } from '@mori/domain'
import type { ReactNode } from 'react'
import { MusicPreferencePanel } from './MusicPreferencePanel'

type Props = {
  spotifyConnected: boolean
  getMusicPreference: () => Promise<MusicPreferenceAnalysisState>
  analyzeMusicPreference: () => Promise<MusicPreferenceProfile>
  view: 'settings' | 'preference'
  onOpenPreference: () => void
}

export function SettingsPanel({ spotifyConnected, getMusicPreference, analyzeMusicPreference, view, onOpenPreference }: Props) {
  const spotifyStatus = spotifyConnected ? '已连接' : '尚未连接'

  if (view === 'preference') return <MusicPreferencePanel getState={getMusicPreference} analyze={analyzeMusicPreference} />

  return <section className="settings-panel" aria-label="Mori 设置">
    <SettingsGroup title="音乐服务">
      <SettingsRow title="Spotify" description={spotifyStatus} />
      <SettingsRow title="音乐品味" description="分析节奏、能量、律动与声音质感" onClick={onOpenPreference} />
    </SettingsGroup>
    <SettingsGroup title="数据与隐私">
      <SettingsRow title="数据管理" description="查看、导出或删除 Mori 数据" planned />
      <SettingsRow title="音乐瞬间" description="管理 Mori 替你保存的音乐记忆" planned />
    </SettingsGroup>
    <SettingsGroup title="关于">
      <SettingsRow title="Mori" description="浏览器里的 AI 音乐知音伙伴" />
    </SettingsGroup>
  </section>
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-group"><h2>{title}</h2><div>{children}</div></section>
}

function SettingsRow({ title, description, planned = false, onClick }: { title: string; description: string; planned?: boolean; onClick?: () => void }) {
  const content = <>
    <span><strong>{title}</strong><small>{description}</small></span>
    {planned ? <span className="settings-badge">规划中</span> : onClick ? <span className="settings-chevron">›</span> : null}
  </>
  return onClick ? <button type="button" className="settings-row settings-row-button" onClick={onClick}>{content}</button> : <div className="settings-row">{content}</div>
}
