'use client'

import { useState } from 'react'
import { ChevronRight, Music2, ShieldCheck, Trash2 } from 'lucide-react'
import { clearSpotifyTrackCache, setKeepSpotifyTrackCache, shouldKeepSpotifyTrackCache } from '@/lib/spotify-track-cache'
import { useMori } from '../mori-context'
import { Switch, TopBar } from '../primitives'

function levelLabel(value: number, labels: [string, string, string]) {
  if (value < 34) return labels[0]
  if (value < 67) return labels[1]
  return labels[2]
}

export function SettingsScreen() {
  const { navigate, showToast } = useMori()
  const [responseLength, setResponseLength] = useState(45)
  const [initiative, setInitiative] = useState(50)
  const [toggles, setToggles] = useState({ moodMusic: true, greeting: true, quietHours: true })
  const [keepMusicCache, setKeepMusicCache] = useState(() => shouldKeepSpotifyTrackCache())

  const sliders = [
    { id: 'responseLength', label: '回复长度', value: responseLength, set: setResponseLength, text: levelLabel(responseLength, ['简短', '适中', '详细']) },
    {
      id: 'initiative',
      label: '主动开启话题',
      value: initiative,
      set: setInitiative,
      text: levelLabel(initiative, ['较少', '适中', '较多']),
    },
  ]

  const switches = [
    { key: 'moodMusic', label: '根据心情推荐音乐', desc: '聊天时自动挑选合适的歌' },
    { key: 'greeting', label: '每日问候', desc: '每天 21:00 打个招呼' },
    { key: 'quietHours', label: '安静时段', desc: '23:00 – 07:00 不主动打扰' },
  ] as const

  return (
    <div className="flex h-full flex-col">
      <TopBar title="陪伴偏好" />
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6 pt-5">
        <h2 className="mb-2.5 px-1 text-xs font-medium text-muted-foreground">相处方式</h2>
        <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card">
          {sliders.map((s) => (
            <div key={s.id} className="px-4 py-3.5">
              <div className="flex items-center justify-between">
                <label htmlFor={s.id} className="text-sm font-medium">
                  {s.label}
                </label>
                <span className="text-xs text-primary">{s.text}</span>
              </div>
              <input
                id={s.id}
                type="range"
                min={0}
                max={100}
                value={s.value}
                aria-valuetext={s.text}
                onChange={(e) => s.set(Number(e.target.value))}
                className="mt-3 w-full accent-primary"
              />
            </div>
          ))}
          {switches.map(({ key, label, desc }) => (
            <div key={key} className="flex items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch
                label={label}
                checked={toggles[key]}
                onCheckedChange={(v) => setToggles((t) => ({ ...t, [key]: v }))}
              />
            </div>
          ))}
        </div>

        <h2 className="mb-2.5 mt-6 px-1 text-xs font-medium text-muted-foreground">缓存管理</h2>
        <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">保留音乐缓存</p><p className="mt-0.5 text-xs text-muted-foreground">减少重复读取 Spotify 歌单</p></div>
            <Switch label="保留音乐缓存" checked={keepMusicCache} onCheckedChange={(value) => { setKeepMusicCache(value); setKeepSpotifyTrackCache(value); showToast(value ? '将保留音乐缓存' : '已关闭并清理音乐缓存') }} />
          </div>
          <SettingsLink icon={Trash2} title="立即清理音乐缓存" desc="不会删除歌单或收听记忆" onClick={() => { clearSpotifyTrackCache(); showToast('音乐缓存已清理') }} />
        </div>

        <h2 className="mb-2.5 mt-6 px-1 text-xs font-medium text-muted-foreground">账号与数据</h2>
        <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card">
          <SettingsLink icon={Music2} title="连接我的音乐" desc="Spotify · 网易云音乐 · QQ 音乐" onClick={() => navigate('connect')} />
          <SettingsLink
            icon={ShieldCheck}
            title="记忆与隐私"
            desc="随时查看和管理"
            onClick={() => showToast('所有记忆都由你确认和管理')}
          />
        </div>
      </div>
    </div>
  )
}

function SettingsLink({
  icon: Icon,
  title,
  desc,
  onClick,
}: {
  icon: typeof Music2
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{desc}</span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  )
}
