'use client'

import { useEffect, useState } from 'react'
import { BarChart3, ChevronLeft, LoaderCircle, Sparkles } from 'lucide-react'
import { describeMusicPreference, type MusicPreferenceProfile } from '@/lib/music-profile'
import { getSpotifyPlaylistItems, getSpotifySavedTracks, hasSpotifyLibraryScope, type SpotifyTrack } from '@/lib/spotify'
import { useMori } from '../mori-context'
import { useSpotify } from '../spotify-context'

export function MusicProfileScreen() {
  const { back, showToast } = useMori()
  const spotify = useSpotify()
  const [profile, setProfile] = useState<MusicPreferenceProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canAnalyze = spotify.connected && hasSpotifyLibraryScope()

  useEffect(() => {
    if (!spotify.user?.id) { setProfile(null); setLoading(false); return }
    setLoading(true)
    void fetch(`/api/music-profile?userId=${encodeURIComponent(spotify.user.id)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((result) => setProfile(result?.profile ?? null))
      .finally(() => setLoading(false))
  }, [spotify.user?.id])

  async function analyze() {
    setAnalyzing(true)
    setError(null)
    try {
      if (!canAnalyze || !spotify.user?.id) throw new Error('请先连接 Spotify 并授权读取喜欢的歌曲')
      const unique = new Map<string, SpotifyTrack>()
      for (const track of await getSpotifySavedTracks(100)) addTrack(unique, track)
      const readable = spotify.playlists.filter((playlist) => playlist.owner?.id === spotify.user?.id || playlist.collaborative)
      for (const playlist of readable) {
        if (unique.size >= 100) break
        for (const track of await getSpotifyPlaylistItems(playlist.id, 100 - unique.size)) addTrack(unique, track)
      }
      const tracks = [...unique.values()].slice(0, 100)
      if (!tracks.length) throw new Error('喜欢的歌曲及本人歌单中没有可以分析的歌曲')
      const response = await fetch('/api/music-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: spotify.user.id, tracks: tracks.map((track) => ({ isrc: track.external_ids?.isrc, title: track.name, artist: track.artists[0]?.name ?? '' })) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? '音乐偏好分析失败')
      setProfile(result.profile)
      showToast(`已分析 ${result.profile.trackCount} 首歌曲`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '音乐偏好分析失败'
      setError(message)
      showToast(message)
    } finally { setAnalyzing(false) }
  }

  return <div className="flex h-full flex-col">
    <header className="flex h-14 shrink-0 items-center gap-2 px-2">
      <button type="button" onClick={back} aria-label="返回音乐集" className="grid size-11 place-items-center rounded-full"><ChevronLeft className="size-6" /></button>
      <div><p className="text-xs text-muted-foreground">音乐画像</p><h1 className="text-sm font-semibold">我的音乐偏好</h1></div>
    </header>
    <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-8">
      <section className="mt-3 rounded-3xl border border-primary/20 bg-linear-to-br from-primary/20 to-accent/5 p-5">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/20 text-primary"><BarChart3 className="size-6" /></span>
        <h2 className="mt-4 text-xl font-semibold">你的声音轮廓</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{profile ? describeMusicPreference(profile) : '分析喜欢的歌曲和本人歌单，看看你偏爱的声音。'}</p>
        {loading ? <div className="grid place-items-center py-12 text-sm text-muted-foreground"><LoaderCircle className="mb-3 size-6 animate-spin" />正在读取音乐画像…</div> : profile ? <div className="mt-5 grid grid-cols-2 gap-3">
          <Metric label="平均节奏" value={profile.averageBpm === null ? '—' : `${Math.round(profile.averageBpm)} BPM`} />
          <Metric label="能量" value={percent(profile.energy)} />
          <Metric label="律动感" value={percent(profile.danceability)} />
          <Metric label="明亮度" value={percent(profile.valence)} />
          <Metric label="原声感" value={percent(profile.acousticness)} />
          <Metric label="分析样本" value={`${profile.trackCount}/${profile.requestedCount} 首`} />
        </div> : <p className="mt-6 rounded-2xl bg-black/10 p-4 text-sm text-muted-foreground">还没有音乐画像，首次分析后会保存在服务器。</p>}
        {error && <p className="mt-4 rounded-xl bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-100">{error}</p>}
        <button type="button" disabled={loading || analyzing || !canAnalyze} onClick={() => void analyze()} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{analyzing ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{analyzing ? '分析中…' : profile ? '重新分析' : '开始分析'}</button>
      </section>
      <p className="mt-4 px-2 text-xs leading-relaxed text-muted-foreground">歌曲特征按 ISRC 复用；重新分析时只会请求尚未缓存的歌曲特征，并更新你的偏好画像。</p>
    </div>
  </div>
}

function addTrack(target: Map<string, SpotifyTrack>, track: SpotifyTrack) {
  const key = track.external_ids?.isrc ?? `${track.name.toLowerCase()}::${track.artists[0]?.name.toLowerCase()}`
  if (key) target.set(key, track)
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-black/10 px-3 py-4 text-center"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1.5 font-semibold">{value}</p></div>
}

function percent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}
