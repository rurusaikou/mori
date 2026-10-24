'use client'

import { useEffect, useRef, useState } from 'react'
import { BarChart3, Check, ChevronDown, LoaderCircle, Lock, MoreHorizontal, Music2, Pause, Play, RefreshCw, Repeat1, Repeat2, Settings2, Shuffle, SkipBack, SkipForward, Sparkles, Unplug } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSpotifyAccessToken, getSpotifyPlaylistItems, getSpotifySavedTracks, hasSpotifyLibraryScope, hasSpotifyPlaybackScopes, playSpotify, playSpotifyUris, setSpotifyRepeat, setSpotifyShuffle, startSpotifyLogin, transferSpotifyPlayback, type SpotifyPlaylist, type SpotifyTrack } from '@/lib/spotify'
import { describeMusicPreference, type MusicPreferenceProfile } from '@/lib/music-profile'
import { useMori } from '../mori-context'
import { Mascot } from '../mascot'
import { useSpotify } from '../spotify-context'

const otherServices = [
  { id: 'netease', name: '网易云音乐', desc: '待官方合作接入', tile: 'bg-[#e7463c] text-white' },
  { id: 'qq', name: 'QQ 音乐', desc: '待官方合作接入', tile: 'bg-[#f2c94c] text-[#413713]' },
]

export function ConnectScreen() {
  const { showToast } = useMori()
  const spotify = useSpotify()
  const [requested, setRequested] = useState<string[]>([])
  const [selectedCollection, setSelectedCollection] = useState<{ playlist: SpotifyPlaylist; savedTracks?: SpotifyTrack[] } | null>(null)
  const [profile, setProfile] = useState<MusicPreferenceProfile | null>(null)
  const [analyzingProfile, setAnalyzingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [savedTracks, setSavedTracks] = useState<SpotifyTrack[]>([])
  const [loadingSavedTracks, setLoadingSavedTracks] = useState(false)
  const readablePlaylists = spotify.playlists.filter((playlist) => playlist.owner?.id === spotify.user?.id || playlist.collaborative)
  const canReadSavedTracks = hasSpotifyLibraryScope()
  const orderedPlaylists = [...spotify.playlists].sort((a, b) => {
    const aReadable = a.owner?.id === spotify.user?.id || a.collaborative ? 1 : 0
    const bReadable = b.owner?.id === spotify.user?.id || b.collaborative ? 1 : 0
    if (aReadable !== bReadable) return bReadable - aReadable
    return (b.tracks?.total ?? b.items?.total ?? 0) - (a.tracks?.total ?? a.items?.total ?? 0)
  })

  useEffect(() => {
    localStorage.removeItem('mori.music-profile')
    localStorage.removeItem('mori.music-features')
    if (!spotify.user?.id) { setProfile(null); return }
    void fetch(`/api/music-profile?userId=${encodeURIComponent(spotify.user.id)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((result) => setProfile(result?.profile ?? null))
  }, [spotify.user?.id])

  useEffect(() => {
    if (!spotify.connected || !canReadSavedTracks) { setSavedTracks([]); if (!spotify.connected) setProfile(null); return }
    setLoadingSavedTracks(true)
    void getSpotifySavedTracks().then(setSavedTracks).catch((cause) => showToast(cause instanceof Error ? cause.message : '无法读取喜欢的歌曲')).finally(() => setLoadingSavedTracks(false))
  }, [spotify.connected, canReadSavedTracks, showToast])

  async function connect() {
    if (!spotify.configured) { showToast('请先在 .env.local 配置 Spotify Client ID'); return }
    try { await spotify.connect() } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Spotify 连接失败') }
  }

  async function analyzeMusicPreference() {
    setAnalyzingProfile(true)
    setProfileError(null)
    try {
      const unique = new Map<string, SpotifyTrack>()
      if (!canReadSavedTracks) throw new Error('请先授权 Mori 读取喜欢的歌曲')
      const savedTracks = await getSpotifySavedTracks(100)
      for (const track of savedTracks) {
        const key = track.external_ids?.isrc ?? `${track.name.toLowerCase()}::${track.artists[0]?.name.toLowerCase()}`
        if (key) unique.set(key, track)
      }
      for (const playlist of readablePlaylists) {
        if (unique.size >= 100) break
        const tracks = await getSpotifyPlaylistItems(playlist.id, 100 - unique.size)
        for (const track of tracks) {
          const key = track.external_ids?.isrc ?? `${track.name.toLowerCase()}::${track.artists[0]?.name.toLowerCase()}`
          if (key) unique.set(key, track)
        }
      }
      const tracks = [...unique.values()].slice(0, 100)
      if (!tracks.length) throw new Error('喜欢的歌曲及本人歌单中没有可以分析的歌曲')

      if (!spotify.user?.id) throw new Error('无法识别当前 Spotify 用户')
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
      setProfileError(message)
      showToast(message)
    } finally { setAnalyzingProfile(false) }
  }

  if (selectedCollection) {
    return <SpotifyPlaylistPlayer playlist={selectedCollection.playlist} initialTracks={selectedCollection.savedTracks} onBack={() => setSelectedCollection(null)} />
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start justify-between px-5 pb-3 pt-5">
        <div><h1 className="text-2xl font-semibold">我的音乐世界</h1><p className="mt-1 text-sm text-muted-foreground">歌单、收藏，以及我们一起听过的歌</p></div>
        <button type="button" aria-label="音乐服务设置" onClick={() => showToast('你可以在这里同步或解除音乐服务')} className="grid size-11 shrink-0 place-items-center rounded-full bg-white/[0.06] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Settings2 className="size-5" /></button>
      </header>
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-8">
        <div className="px-1 pb-3 pt-2"><h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">音乐服务</h2></div>
        <ul className="flex flex-col gap-2.5">
          <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
            <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#1db954] text-black"><Music2 className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium">Spotify {spotify.connected && <Check className="size-3.5 text-[#1db954]" />}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{spotify.user?.display_name ? `${spotify.user.display_name} · ${spotify.playlists.length} 个歌单` : '歌单、收藏与音乐偏好'}</p>
            </div>
            {spotify.connected ? (
              <button type="button" onClick={() => { spotify.disconnect(); showToast('已解除本机上的 Spotify 连接') }} className="grid size-9 place-items-center rounded-full bg-white/[0.06] text-muted-foreground" aria-label="解除 Spotify 连接"><Unplug className="size-4" /></button>
            ) : <button type="button" onClick={() => void connect()} className="h-9 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground">连接</button>}
          </li>
          {otherServices.map((service) => {
            const applied = requested.includes(service.id)
            return <li key={service.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 opacity-80">
              <span aria-hidden="true" className={cn('grid size-11 shrink-0 place-items-center rounded-xl', service.tile)}><Music2 className="size-5" /></span>
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{service.name}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{service.desc}</p></div>
              <button type="button" disabled={applied} onClick={() => { setRequested((items) => [...items, service.id]); showToast(`已记录你对 ${service.name} 的需求`) }} className="h-9 rounded-full bg-white/[0.08] px-3 text-xs disabled:text-muted-foreground">{applied ? '已申请' : '申请接入'}</button>
            </li>
          })}
        </ul>
        <p className="mt-4 flex gap-2 rounded-xl bg-white/[0.04] p-3 text-xs leading-relaxed text-muted-foreground"><Lock className="mt-0.5 size-3.5 shrink-0" />Mori 只请求读取歌单所需的权限，不会获得你的 Spotify 密码。解除连接会清除本机保存的授权令牌。</p>
        {spotify.connected && !canReadSavedTracks && <div className="mt-3 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/10 p-3"><div className="min-w-0 flex-1"><p className="text-xs font-medium">还没有“喜欢的歌曲”读取权限</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">重新授权后，音乐偏好会优先分析你收藏的歌曲。</p></div><button type="button" onClick={() => void startSpotifyLogin()} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#2b1c4a]">重新授权</button></div>}
        {spotify.connected && <section className="mt-5 rounded-3xl border border-primary/15 bg-linear-to-br from-primary/15 to-accent/5 p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/20 text-primary"><BarChart3 className="size-5" /></span>
            <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">我的音乐偏好</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{profile ? describeMusicPreference(profile) : '分析喜欢的歌曲和本人歌单，看看你偏爱的声音。'}</p></div>
            <button type="button" disabled={analyzingProfile || !canReadSavedTracks} onClick={() => void analyzeMusicPreference()} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">{analyzingProfile ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{analyzingProfile ? '分析中' : profile ? '重新分析' : '开始分析'}</button>
          </div>
          {profile && <div className="mt-4 grid grid-cols-3 gap-2">
            <PreferenceMetric label="平均节奏" value={profile.averageBpm === null ? '—' : `${Math.round(profile.averageBpm)} BPM`} />
            <PreferenceMetric label="能量" value={formatPercent(profile.energy)} />
            <PreferenceMetric label="律动感" value={formatPercent(profile.danceability)} />
            <PreferenceMetric label="明亮度" value={formatPercent(profile.valence)} />
            <PreferenceMetric label="原声感" value={formatPercent(profile.acousticness)} />
            <PreferenceMetric label="样本" value={`${profile.trackCount}/${profile.requestedCount} 首`} />
          </div>}
          {profileError && <p className="mt-3 rounded-xl bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-100">{profileError}</p>}
        </section>}
        <div className="mt-6 flex items-center justify-between px-1">
          <h3 className="text-sm font-semibold">来自 Spotify 的歌单</h3>
          {spotify.connected && <button type="button" disabled={spotify.loading} onClick={() => void spotify.sync()} className="flex items-center gap-1 text-xs text-primary disabled:opacity-50"><RefreshCw className={cn('size-3.5', spotify.loading && 'animate-spin')} />同步</button>}
        </div>
        {spotify.loading ? (
          <div className="grid place-items-center py-12 text-sm text-muted-foreground"><LoaderCircle className="mb-3 size-6 animate-spin" />正在同步歌单…</div>
        ) : spotify.error ? (
          <div className="mt-3 rounded-2xl border border-red-300/15 bg-red-400/5 p-4 text-sm text-red-200"><p>{spotify.error}</p><button type="button" onClick={() => void spotify.sync()} className="mt-3 text-xs underline">重新尝试</button></div>
        ) : spotify.connected ? (
          spotify.playlists.length ? <ul className="mt-3 flex flex-col gap-2">
            {canReadSavedTracks && <li className="animate-in fade-in slide-in-from-bottom-1">
              <button type="button" disabled={loadingSavedTracks || !savedTracks.length} onClick={() => setSelectedCollection({ playlist: { id: '__liked__', name: '喜欢的歌曲', description: '', owner: { id: spotify.user?.id, display_name: spotify.user?.display_name ?? null }, images: savedTracks[0]?.album.images?.[0] ? [{ ...savedTracks[0].album.images[0], width: null, height: null }] : undefined, items: { total: savedTracks.length } }, savedTracks })} className="flex w-full items-center gap-3 rounded-2xl bg-card p-2.5 pr-3 text-left transition-colors hover:bg-secondary disabled:opacity-60">
                <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-linear-to-br from-[#7c5bd6] to-[#d8b4fe] text-white shadow-md shadow-black/30"><Check className="size-5" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">喜欢的歌曲</span><span className="block truncate text-xs text-muted-foreground">{loadingSavedTracks ? '正在读取全部收藏…' : `${savedTracks.length} 首`} · Spotify 音乐库</span></span>
                <span className="text-xs text-primary">在 Mori 听</span>
              </button>
            </li>}
            {orderedPlaylists.map((playlist) => {
              const trackTotal = playlist.tracks?.total ?? playlist.items?.total
              const canReadItems = playlist.owner?.id === spotify.user?.id || playlist.collaborative
              const content = <>
                {playlist.images?.[0]?.url ? <img src={playlist.images[0].url} alt="" className="size-12 shrink-0 rounded-lg object-cover shadow-md shadow-black/30" /> : <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-white/10"><Music2 className="size-5" /></span>}
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{playlist.name || '未命名歌单'}</span><span className="block truncate text-xs text-muted-foreground">{trackTotal === undefined ? '曲目数未提供' : `${trackTotal} 首`} · {playlist.owner?.display_name ?? 'Spotify'}</span></span>
                <span className={cn('text-xs', canReadItems ? 'text-primary' : 'text-muted-foreground')}>{canReadItems ? '在 Mori 听' : '仅 Spotify 可听'}</span>
              </>
              return <li key={playlist.id} className="animate-in fade-in slide-in-from-bottom-1">
                <button type="button" onClick={() => canReadItems ? setSelectedCollection({ playlist }) : showToast('Spotify 仅允许 Mori 读取本人创建或参与协作的歌单')} className="flex w-full items-center gap-3 rounded-2xl bg-card p-2.5 pr-3 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</button>
              </li>
            })}
          </ul> : <p className="mt-3 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">这个 Spotify 账号暂时没有可显示的歌单</p>
        ) : <p className="mt-3 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">连接 Spotify 后，你的真实歌单会出现在这里</p>}
      </div>
    </div>
  )
}

function PreferenceMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-black/10 px-2 py-2.5 text-center"><p className="truncate text-[10px] text-muted-foreground">{label}</p><p className="mt-1 truncate text-xs font-semibold">{value}</p></div>
}

function formatPercent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function SpotifyPlaylistPlayer({ playlist, initialTracks, onBack }: { playlist: SpotifyPlaylist; initialTracks?: SpotifyTrack[]; onBack: () => void }) {
  const { navigate, showToast } = useMori()
  const spotifyUrl = playlist.external_urls?.spotify
  const [tracks, setTracks] = useState<SpotifyTrack[]>(initialTracks ?? [])
  const [loading, setLoading] = useState(!initialTracks)
  const [error, setError] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [playerState, setPlayerState] = useState<SpotifyPlaybackState | null>(null)
  const [progressMs, setProgressMs] = useState(0)
  const [panel, setPanel] = useState<'lyrics' | 'playlist'>('lyrics')
  const [shuffle, setShuffle] = useState(false)
  const [repeatMode, setRepeatMode] = useState<'off' | 'context' | 'track'>('off')
  const [updatingPlaybackMode, setUpdatingPlaybackMode] = useState<'shuffle' | 'repeat' | null>(null)
  const playerRef = useRef<SpotifyPlayer | null>(null)
  const canPlay = hasSpotifyPlaybackScopes()

  useEffect(() => {
    if (initialTracks) { setTracks(initialTracks); setLoading(false); return }
    void getSpotifyPlaylistItems(playlist.id).then(setTracks).catch((cause) => setError(cause instanceof Error ? cause.message : '无法读取歌单曲目')).finally(() => setLoading(false))
  }, [playlist.id, initialTracks])

  useEffect(() => {
    if (!canPlay) return
    const onReady = ({ device_id }: { device_id: string }) => {
      window.moriSpotifyDeviceId = device_id
      setDeviceId(device_id)
      void transferSpotifyPlayback(device_id).catch(() => undefined)
    }
    const onNotReady = () => setDeviceId(null)
    const onStateChanged = (state: SpotifyPlaybackState | null) => {
      setPlayerState(state)
      if (state) {
        setProgressMs(state.position)
        setShuffle(state.shuffle)
        setRepeatMode(state.repeat_mode === 2 ? 'track' : state.repeat_mode === 1 ? 'context' : 'off')
      }
    }
    const onAuthenticationError = ({ message }: { message: string }) => setError(message)
    const onAccountError = () => setError('Mori 内播放需要 Spotify Premium')
    const onPlaybackError = ({ message }: { message: string }) => setError(message)

    function observe(player: SpotifyPlayer) {
      playerRef.current = player
      setDeviceId(window.moriSpotifyDeviceId ?? null)
      player.addListener('ready', onReady)
      player.addListener('not_ready', onNotReady)
      player.addListener('player_state_changed', onStateChanged)
      player.addListener('authentication_error', onAuthenticationError)
      player.addListener('account_error', onAccountError)
      player.addListener('playback_error', onPlaybackError)
      void player.getCurrentState().then(onStateChanged)
    }

    function initialize() {
      if (!window.Spotify || playerRef.current) return
      if (window.moriSpotifyPlayer) { observe(window.moriSpotifyPlayer); return }
      const player = new window.Spotify.Player({ name: 'Mori 音乐伙伴', volume: 0.65, getOAuthToken: (callback) => { void getSpotifyAccessToken().then(callback) } })
      window.moriSpotifyPlayer = player
      observe(player)
      void player.connect()
    }
    if (window.Spotify) initialize()
    else {
      window.onSpotifyWebPlaybackSDKReady = initialize
      if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
        const script = document.createElement('script'); script.src = 'https://sdk.scdn.co/spotify-player.js'; script.async = true; document.body.appendChild(script)
      }
    }
    return () => {
      const player = playerRef.current
      if (!player) return
      player.removeListener('ready', onReady)
      player.removeListener('not_ready', onNotReady)
      player.removeListener('player_state_changed', onStateChanged)
      player.removeListener('authentication_error', onAuthenticationError)
      player.removeListener('account_error', onAccountError)
      player.removeListener('playback_error', onPlaybackError)
      playerRef.current = null
    }
  }, [canPlay])

  const currentUri = playerState?.track_window.current_track.uri
  const paused = playerState?.paused ?? true
  const currentTrack = playerState?.track_window.current_track
  const artwork = currentTrack?.album.images[0]?.url ?? playlist.images?.[0]?.url

  useEffect(() => {
    if (!playerState || playerState.paused) return
    let previous = Date.now()
    const timer = window.setInterval(() => {
      const now = Date.now()
      const elapsed = now - previous
      previous = now
      setProgressMs((position) => Math.min(playerState.duration, position + elapsed))
    }, 250)
    return () => window.clearInterval(timer)
  }, [playerState?.paused, playerState?.duration, currentUri])

  async function seek(position: number) {
    setProgressMs(position)
    try { await playerRef.current?.seek(position) } catch { setError('暂时无法跳转播放位置') }
  }
  async function playAt(index: number) {
    if (!deviceId) { setError('Mori 播放器还在连接 Spotify，请稍后再试'); return }
    try {
      if (initialTracks) {
        const chunkStart = Math.floor(index / 100) * 100
        await playSpotifyUris(deviceId, tracks.slice(chunkStart, chunkStart + 100).map((track) => track.uri), index - chunkStart)
      }
      else await playSpotify(deviceId, `spotify:playlist:${playlist.id}`, index)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '播放失败') }
  }

  async function toggleShuffle() {
    if (!deviceId) { showToast('播放器仍在连接 Spotify'); return }
    const next = !shuffle
    setUpdatingPlaybackMode('shuffle')
    try {
      await setSpotifyShuffle(deviceId, next)
      setShuffle(next)
      setError(null)
      showToast(next ? '已开启随机播放' : '已关闭随机播放')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '无法切换随机播放'
      setError(message)
      showToast(message)
    } finally { setUpdatingPlaybackMode(null) }
  }

  async function toggleRepeat() {
    if (!deviceId) { showToast('播放器仍在连接 Spotify'); return }
    const next = repeatMode === 'off' ? 'context' : repeatMode === 'context' ? 'track' : 'off'
    setUpdatingPlaybackMode('repeat')
    try {
      await setSpotifyRepeat(deviceId, next)
      setRepeatMode(next)
      setError(null)
      showToast(next === 'context' ? '已开启列表循环' : next === 'track' ? '已开启单曲循环' : '已关闭循环播放')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '无法切换循环播放'
      setError(message)
      showToast(message)
    } finally { setUpdatingPlaybackMode(null) }
  }

  return <div className="relative flex h-full flex-col overflow-hidden bg-[#17112d] md:-mt-11 md:h-[calc(100%+2.75rem)]">
    {artwork && <><img src={artwork} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-35 blur-3xl" /><div className="absolute inset-0 bg-linear-to-b from-[#eee9ff]/25 via-[#24193b]/65 to-[#120d24]" /></>}
    <header className="relative z-10 grid h-14 shrink-0 grid-cols-[44px_1fr_44px] items-center px-2 md:h-[6.25rem] md:pt-11">
      <button type="button" onClick={onBack} aria-label="返回歌单列表" className="grid size-11 place-items-center rounded-full"><ChevronDown className="size-6" /></button>
      <div className="min-w-0 text-center"><p className="truncate text-xs text-white/65">正在播放</p><h1 className="truncate text-sm font-semibold">{playlist.name || 'Spotify 歌单'}</h1></div>
      {spotifyUrl ? <a href={spotifyUrl} target="_blank" rel="noreferrer" aria-label="在 Spotify 中打开" className="grid size-11 place-items-center rounded-full"><MoreHorizontal className="size-5" /></a> : <span />}
    </header>

    <div className="no-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <div className="mx-auto mt-3 aspect-square w-[68%] max-w-64 overflow-hidden rounded-[28px] border border-white/25 bg-white/10 shadow-[0_24px_70px_rgba(20,10,45,.55)]">
        {artwork ? <img src={artwork} alt="当前歌曲封面" className="size-full object-cover" /> : <span className="grid size-full place-items-center"><Music2 className="size-12" /></span>}
      </div>

      <div className="mt-5 flex items-center gap-3"><div className="min-w-0 flex-1"><h2 className="truncate text-xl font-semibold">{currentTrack?.name ?? tracks[0]?.name ?? playlist.name}</h2><p className="mt-1 truncate text-sm text-white/65">{currentTrack?.artists.map((a) => a.name).join('、') ?? tracks[0]?.artists.map((a) => a.name).join('、') ?? playlist.owner?.display_name ?? 'Spotify'}</p></div><button type="button" onClick={() => navigate('chat')} aria-label="和 Mori 聊聊这首歌" className="relative grid size-16 shrink-0 place-items-center rounded-full bg-white/[0.07] ring-1 ring-white/15"><ListeningMori listening={!paused} /></button></div>

      <div className="mt-4"><input type="range" min={0} max={playerState?.duration ?? tracks[0]?.duration_ms ?? 1} value={progressMs} onChange={(event) => setProgressMs(Number(event.target.value))} onPointerUp={(event) => void seek(Number(event.currentTarget.value))} onKeyUp={(event) => void seek(Number(event.currentTarget.value))} aria-label="播放进度" className="mori-progress-slider block h-4 w-full cursor-pointer appearance-none bg-transparent" style={{ '--progress': `${Math.min(100, progressMs / (playerState?.duration ?? tracks[0]?.duration_ms ?? 1) * 100)}%` } as React.CSSProperties} /><div className="mt-0.5 flex justify-between text-[11px] text-white/60"><span>{formatDuration(progressMs)}</span><span>{formatDuration(playerState?.duration ?? tracks[0]?.duration_ms ?? 0)}</span></div></div>

      <div className="mt-3 flex items-center justify-between px-1">
        <button type="button" disabled={!deviceId || updatingPlaybackMode !== null} onClick={() => void toggleShuffle()} aria-label={shuffle ? '关闭随机播放' : '开启随机播放'} aria-pressed={shuffle} title={!deviceId ? '播放器连接后可用' : shuffle ? '关闭随机播放' : '开启随机播放'} className={cn('relative grid size-10 place-items-center rounded-full text-white/65 transition-all disabled:cursor-not-allowed disabled:opacity-35', shuffle && 'bg-primary/25 text-primary ring-1 ring-primary/45')}><Shuffle className={cn('size-5', updatingPlaybackMode === 'shuffle' && 'animate-pulse')} />{shuffle && <span className="absolute bottom-0.5 size-1 rounded-full bg-primary" />}</button>
        <button aria-label="上一首" onClick={() => void playerRef.current?.previousTrack()}><SkipBack className="size-6 fill-current" /></button>
        <button aria-label={paused ? '播放' : '暂停'} onClick={() => playerState ? void playerRef.current?.togglePlay() : void playAt(0)} className="grid size-14 place-items-center rounded-full bg-white text-[#2b1c4a] shadow-[0_0_30px_rgba(255,255,255,.35)]">{paused ? <Play className="ml-1 size-6 fill-current" /> : <Pause className="size-6 fill-current" />}</button>
        <button aria-label="下一首" onClick={() => void playerRef.current?.nextTrack()}><SkipForward className="size-6 fill-current" /></button>
        <button type="button" disabled={!deviceId || updatingPlaybackMode !== null} onClick={() => void toggleRepeat()} aria-label={repeatMode === 'off' ? '开启列表循环' : repeatMode === 'context' ? '切换为单曲循环' : '关闭循环播放'} aria-pressed={repeatMode !== 'off'} title={!deviceId ? '播放器连接后可用' : repeatMode === 'off' ? '开启列表循环' : repeatMode === 'context' ? '切换为单曲循环' : '关闭循环播放'} className={cn('relative grid size-10 place-items-center rounded-full text-white/65 transition-all disabled:cursor-not-allowed disabled:opacity-35', repeatMode !== 'off' && 'bg-primary/25 text-primary ring-1 ring-primary/45')}>{repeatMode === 'track' ? <Repeat1 className={cn('size-5', updatingPlaybackMode === 'repeat' && 'animate-pulse')} /> : <Repeat2 className={cn('size-5', updatingPlaybackMode === 'repeat' && 'animate-pulse')} />}{repeatMode !== 'off' && <span className="absolute bottom-0.5 size-1 rounded-full bg-primary" />}</button>
      </div>

      {!canPlay && <div className="mt-4 rounded-2xl border border-white/15 bg-white/10 p-3 text-xs"><p>重新授权播放权限后，才能在 Mori 内播放。</p><button type="button" onClick={() => void startSpotifyLogin()} className="mt-2 rounded-full bg-white px-3 py-1.5 font-semibold text-[#2b1c4a]">重新授权</button></div>}
      {error && <p className="mt-3 rounded-xl bg-red-400/10 px-3 py-2 text-xs text-red-100">{error}</p>}

      <section className="mt-5 rounded-3xl border border-white/15 bg-white/10 p-4 backdrop-blur-2xl">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-black/10 p-1">
          <button type="button" onClick={() => setPanel('lyrics')} className={cn('rounded-full px-3 py-2 text-xs transition-colors', panel === 'lyrics' ? 'bg-white text-[#392556] shadow-sm' : 'text-white/65')}>歌词</button>
          <button type="button" onClick={() => setPanel('playlist')} className={cn('rounded-full px-3 py-2 text-xs transition-colors', panel === 'playlist' ? 'bg-white text-[#392556] shadow-sm' : 'text-white/65')}>歌单</button>
        </div>
        {panel === 'lyrics' && <div className="py-7 text-center"><p className="text-sm font-medium">歌词暂未接入</p><p className="mx-auto mt-2 max-w-64 text-xs leading-relaxed text-white/55">Spotify 不向第三方开放歌词正文。接入有版权授权的歌词服务后，这里会显示同步歌词。</p></div>}
        {panel === 'playlist' && (loading ? <div className="grid place-items-center py-8"><LoaderCircle className="size-5 animate-spin" /></div> : tracks.length ? <ol className="mt-3 max-h-64 overflow-y-auto">{tracks.map((track,index) => <li key={`${track.uri}-${index}`}><button type="button" disabled={!canPlay} onClick={() => void playAt(index)} className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left', currentUri === track.uri && 'bg-white/10')}><span className="w-5 text-center text-xs text-white/50">{index+1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{track.name}</span><span className="block truncate text-xs text-white/50">{track.artists.map((artist) => artist.name).join('、')}</span></span><span className="text-xs text-white/50">{formatDuration(track.duration_ms)}</span></button></li>)}</ol> : <p className="py-7 text-center text-xs text-white/55">暂时无法读取这个歌单的曲目</p>)}
      </section>

      {tracks.length > 1 && <section className="mt-6"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">接下来播放</h3><button type="button" onClick={() => setPanel('playlist')} className="text-xs text-white/55">查看全部</button></div><div className="no-scrollbar flex gap-3 overflow-x-auto">{tracks.slice(1,5).map((track,index) => <button key={track.uri} onClick={() => void playAt(index+1)} className="w-24 shrink-0 text-left"><span className="grid aspect-square place-items-center overflow-hidden rounded-2xl bg-white/10">{track.album.images?.[0]?.url ? <img src={track.album.images[0].url} alt="" className="size-full object-cover" /> : <Music2 />}</span><span className="mt-2 block truncate text-xs font-medium">{track.name}</span><span className="block truncate text-[11px] text-white/50">{track.artists.map(a=>a.name).join('、')}</span></button>)}</div></section>}
      <p className="mt-5 text-center text-[10px] text-white/45">播放服务由 Spotify 提供 · Mori 内播放需要 Premium</p>
    </div>
  </div>
}

function ListeningMori({ listening }: { listening: boolean }) {
  return <span aria-hidden="true" className="relative grid size-16 place-items-center overflow-visible">
    {listening && <span className="absolute inset-1 rounded-full border border-primary/35 motion-safe:animate-ping" />}
    <span className={cn('absolute -bottom-1 flex h-3 items-end gap-0.5', listening && 'is-playing')}>
      <i className="mori-equalizer-bar h-1.5 w-0.5 rounded-full bg-white/90" />
      <i className="mori-equalizer-bar h-2.5 w-0.5 rounded-full bg-white" />
      <i className="mori-equalizer-bar h-2 w-0.5 rounded-full bg-white/90" />
    </span>
    <Mascot scale={0.38} mood={listening ? 'talking' : 'idle'} className="drop-shadow-[0_0_10px_rgba(190,150,255,.55)]" />
  </span>
}

function formatDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
