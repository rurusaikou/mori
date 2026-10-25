'use client'

import { useEffect, useRef, useState } from 'react'
import { BarChart3, Check, ChevronDown, LoaderCircle, Lock, MoreHorizontal, Music2, Pause, Play, RefreshCw, Repeat1, Repeat2, Shuffle, SkipBack, SkipForward, Unplug } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSpotifyAccessToken, getSpotifyPlaylistItems, getSpotifySavedTracks, hasSpotifyLibraryScope, hasSpotifyPlaybackScopes, playSpotify, playSpotifyUris, setSpotifyRepeat, setSpotifyShuffle, startSpotifyLogin, transferSpotifyPlayback, type SpotifyPlaylist, type SpotifyTrack } from '@/lib/spotify'
import { clearSpotifyTrackCache, loadSpotifyTrackCache, readSpotifyTrackCache, shouldKeepSpotifyTrackCache } from '@/lib/spotify-track-cache'
import { useMori } from '../mori-context'
import { Mascot } from '../mascot'
import { useSpotify } from '../spotify-context'

const otherServices = [
  { id: 'netease', name: '网易云音乐', desc: '待官方合作接入', tile: 'bg-[#e7463c] text-white' },
  { id: 'qq', name: 'QQ 音乐', desc: '待官方合作接入', tile: 'bg-[#f2c94c] text-[#413713]' },
]

type MusicCollection = { playlist: SpotifyPlaylist; savedTracks?: SpotifyTrack[] }
type PlaybackSelection = { collection: MusicCollection; tracks: SpotifyTrack[]; startIndex: number; resumeExisting?: boolean }
// ConnectScreen 会随标签切换卸载，保留最近队列才能从迷你播放器恢复完整播放页。
let lastPlaybackSelection: PlaybackSelection | null = null

export function ConnectScreen() {
  const { navigate, showToast } = useMori()
  const spotify = useSpotify()
  const [requested, setRequested] = useState<string[]>([])
  const [selectedCollection, setSelectedCollection] = useState<MusicCollection | null>(null)
  const [playback, setPlayback] = useState<PlaybackSelection | null>(null)
  const [savedTracks, setSavedTracks] = useState<SpotifyTrack[]>([])
  const [loadingSavedTracks, setLoadingSavedTracks] = useState(false)
  const [playlistCacheProgress, setPlaylistCacheProgress] = useState({ completed: 0, total: 0 })
  const playlistCacheRunRef = useRef('')
  const readablePlaylists = spotify.playlists.filter((playlist) => playlist.owner?.id === spotify.user?.id || playlist.collaborative)
  const readablePlaylistSignature = readablePlaylists.map((playlist) => `${playlist.id}:${playlist.tracks?.total ?? playlist.items?.total ?? 0}`).join('|')
  const canReadSavedTracks = hasSpotifyLibraryScope()
  const orderedPlaylists = [...spotify.playlists].sort((a, b) => {
    const aReadable = a.owner?.id === spotify.user?.id || a.collaborative ? 1 : 0
    const bReadable = b.owner?.id === spotify.user?.id || b.collaborative ? 1 : 0
    if (aReadable !== bReadable) return bReadable - aReadable
    return (b.tracks?.total ?? b.items?.total ?? 0) - (a.tracks?.total ?? a.items?.total ?? 0)
  })

  useEffect(() => {
    if (!spotify.connected || !canReadSavedTracks) { setSavedTracks([]); setLoadingSavedTracks(false); return }
    const cacheKey = `saved:${spotify.user?.id ?? 'me'}`
    const cached = readSpotifyTrackCache(cacheKey)
    if (cached) { setSavedTracks(cached); setLoadingSavedTracks(false); return }
    setLoadingSavedTracks(true)
    void loadSpotifyTrackCache(cacheKey, () => getSpotifySavedTracks()).then(setSavedTracks).catch((cause) => showToast(cause instanceof Error ? cause.message : '无法读取喜欢的歌曲')).finally(() => setLoadingSavedTracks(false))
  }, [spotify.connected, spotify.user?.id, canReadSavedTracks, showToast])

  useEffect(() => {
    if (!spotify.connected || !spotify.user?.id) {
      playlistCacheRunRef.current = ''
      setPlaylistCacheProgress({ completed: 0, total: 0 })
      return
    }

    const runKey = `${spotify.user.id}:${readablePlaylistSignature}`
    if (playlistCacheRunRef.current === runKey) return
    playlistCacheRunRef.current = runKey
    const pending = readablePlaylists.filter((playlist) => !readSpotifyTrackCache(`playlist:${playlist.id}`))
    if (!pending.length) {
      setPlaylistCacheProgress({ completed: 0, total: 0 })
      return
    }

    let cursor = 0
    let completed = 0
    setPlaylistCacheProgress({ completed: 0, total: pending.length })

    // 限制两个并发 worker，避免大量歌单连接后同时触发 Spotify 限流。
    async function worker() {
      while (true) {
        const playlist = pending[cursor++]
        if (!playlist) return
        try {
          const cacheKey = `playlist:${playlist.id}`
          await loadSpotifyTrackCache(cacheKey, () => getSpotifyPlaylistItems(playlist.id))
        } catch {
          // 单个歌单失败不应中断其他歌单的缓存。
        } finally {
          completed += 1
          setPlaylistCacheProgress({ completed, total: pending.length })
        }
      }
    }

    void Promise.all(Array.from({ length: Math.min(2, pending.length) }, () => worker()))
  }, [spotify.connected, spotify.user?.id, readablePlaylistSignature])

  async function connect() {
    if (!spotify.configured) { showToast('请先在 .env.local 配置 Spotify Client ID'); return }
    try { await spotify.connect() } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Spotify 连接失败') }
  }

  function openLikedSongs() {
    if (loadingSavedTracks) { showToast('喜欢的歌曲仍在同步'); return }
    if (!savedTracks.length) { showToast('还没有可播放的喜欢歌曲'); return }
    setSelectedCollection({ playlist: { id: '__liked__', name: '喜欢的歌曲', description: '', owner: { id: spotify.user?.id, display_name: spotify.user?.display_name ?? null }, images: savedTracks[0]?.album.images?.[0] ? [{ ...savedTracks[0].album.images[0], width: null, height: null }] : undefined, items: { total: savedTracks.length } }, savedTracks })
  }

  function likedCollection(): MusicCollection {
    return { playlist: { id: '__liked__', name: '喜欢的歌曲', description: '', owner: { id: spotify.user?.id, display_name: spotify.user?.display_name ?? null }, images: savedTracks[0]?.album.images?.[0] ? [{ ...savedTracks[0].album.images[0], width: null, height: null }] : undefined, items: { total: savedTracks.length } }, savedTracks }
  }

  function startPlayback(selection: PlaybackSelection) {
    lastPlaybackSelection = selection
    setPlayback(selection)
  }

  function openCurrentPlayback() {
    const current = spotify.nowPlaying
    if (!current) { openLikedSongs(); return }
    let selection = lastPlaybackSelection?.tracks.some((track) => track.uri === current.uri) ? lastPlaybackSelection : null
    if (!selection) {
      const savedIndex = savedTracks.findIndex((track) => track.uri === current.uri)
      if (savedIndex >= 0) selection = { collection: likedCollection(), tracks: savedTracks, startIndex: savedIndex }
    }
    if (!selection) {
      for (const playlist of readablePlaylists) {
        const tracks = readSpotifyTrackCache(`playlist:${playlist.id}`)
        const index = tracks?.findIndex((track) => track.uri === current.uri) ?? -1
        if (tracks && index >= 0) { selection = { collection: { playlist }, tracks, startIndex: index }; break }
      }
    }
    if (!selection) {
      const track: SpotifyTrack = { id: current.uri, uri: current.uri, name: current.title, duration_ms: spotify.durationMs, artists: [{ name: current.artist }], album: { name: '', images: current.artwork ? [{ url: current.artwork }] : [] } }
      const playlist: SpotifyPlaylist = { id: '__now_playing__', name: '正在播放', description: '', images: current.artwork ? [{ url: current.artwork, width: null, height: null }] : undefined, items: { total: 1 } }
      selection = { collection: { playlist, savedTracks: [track] }, tracks: [track], startIndex: 0 }
    }
    const currentIndex = selection.tracks.findIndex((track) => track.uri === current.uri)
    setPlayback({ ...selection, startIndex: currentIndex >= 0 ? currentIndex : selection.startIndex, resumeExisting: true })
  }

  useEffect(() => {
    if (!spotify.fullPlayerRequested) return
    spotify.consumeFullPlayerRequest()
    openCurrentPlayback()
  }, [spotify.fullPlayerRequested, spotify.consumeFullPlayerRequest])

  if (playback) {
    return <SpotifyPlaylistPlayer playlist={playback.collection.playlist} initialTracks={playback.tracks} useUris={Boolean(playback.collection.savedTracks)} initialIndex={playback.startIndex} resumeExisting={playback.resumeExisting} onBack={() => setPlayback(null)} />
  }

  if (selectedCollection) {
    return <SpotifyCollectionDetail collection={selectedCollection} onBack={() => setSelectedCollection(null)} onPlay={(tracks, startIndex) => startPlayback({ collection: selectedCollection, tracks, startIndex })} />
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start justify-between px-5 pb-3 pt-5">
        <div><h1 className="text-2xl font-semibold">我的音乐世界</h1><p className="mt-1 text-sm text-muted-foreground">歌单、收藏，以及我们一起听过的歌</p></div>
        <button type="button" aria-label={spotify.nowPlaying ? `返回正在播放：${spotify.nowPlaying.title}` : '进入喜欢的歌曲'} onClick={openCurrentPlayback} disabled={!spotify.connected} className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/20 text-primary transition-colors hover:bg-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{spotify.nowPlaying?.artwork ? <><img src={spotify.nowPlaying.artwork} alt="" className={cn('absolute inset-0 size-full rounded-full object-cover opacity-75', spotify.isPlaying && 'motion-safe:animate-[spin_8s_linear_infinite]')} /><span className="absolute inset-0 bg-black/25" /><Play className="relative ml-0.5 size-4 fill-current text-white" /></> : <Play className="ml-0.5 size-5 fill-current" />}</button>
      </header>
      <div className="mori-mini-safe-scroll no-scrollbar flex-1 overflow-y-auto px-4">
        <div className="px-1 pb-3 pt-2"><h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">音乐服务</h2></div>
        <ul className="flex flex-col gap-2.5">
          <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
            <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#1db954] text-black"><Music2 className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium">Spotify {spotify.connected && <Check className="size-3.5 text-[#1db954]" />}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{spotify.user?.display_name ? `${spotify.user.display_name} · ${spotify.playlists.length} 个歌单` : '歌单、收藏与音乐偏好'}</p>
            </div>
            {spotify.connected ? (
              <button type="button" onClick={() => { if (!shouldKeepSpotifyTrackCache()) clearSpotifyTrackCache(); spotify.disconnect(); showToast(shouldKeepSpotifyTrackCache() ? '已解除连接，音乐缓存已保留' : '已解除连接并清理音乐缓存') }} className="grid size-9 place-items-center rounded-full bg-white/[0.06] text-muted-foreground" aria-label="解除 Spotify 连接"><Unplug className="size-4" /></button>
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
        {spotify.connected && <button type="button" onClick={() => navigate('music-profile')} className="mt-5 flex w-full items-center gap-3 rounded-2xl border border-primary/15 bg-linear-to-br from-primary/15 to-accent/5 p-4 text-left transition-colors hover:border-primary/30">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/20 text-primary"><BarChart3 className="size-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">我的音乐偏好</span><span className="mt-1 block text-xs text-muted-foreground">查看节奏、能量与情绪特征</span></span>
          <ChevronDown className="size-5 -rotate-90 text-muted-foreground" />
        </button>}
        <div className="mt-6 flex items-center justify-between px-1">
          <div><h3 className="text-sm font-semibold">来自 Spotify 的歌单</h3>{playlistCacheProgress.total > 0 && playlistCacheProgress.completed < playlistCacheProgress.total && <p className="mt-0.5 text-[10px] text-muted-foreground">正在缓存歌单 {playlistCacheProgress.completed}/{playlistCacheProgress.total}</p>}</div>
          {spotify.connected && <button type="button" disabled={spotify.loading} onClick={() => void spotify.sync()} className="flex items-center gap-1 text-xs text-primary disabled:opacity-50"><RefreshCw className={cn('size-3.5', spotify.loading && 'animate-spin')} />同步</button>}
        </div>
        {spotify.loading || (playlistCacheProgress.total > 0 && playlistCacheProgress.completed < playlistCacheProgress.total) ? (
          <div className="grid place-items-center py-12 text-sm text-muted-foreground"><LoaderCircle className="mb-3 size-6 animate-spin" />{spotify.loading ? '正在同步歌单…' : `正在缓存歌曲 ${playlistCacheProgress.completed}/${playlistCacheProgress.total}`}</div>
        ) : spotify.error ? (
          <div className="mt-3 rounded-2xl border border-red-300/15 bg-red-400/5 p-4 text-sm text-red-200"><p>{spotify.error}</p><button type="button" onClick={() => void spotify.sync()} className="mt-3 text-xs underline">重新尝试</button></div>
        ) : spotify.connected ? (
          spotify.playlists.length ? <ul className="mt-3 flex flex-col gap-2">
            {canReadSavedTracks && <li className="animate-in fade-in slide-in-from-bottom-1">
              <button type="button" disabled={loadingSavedTracks || !savedTracks.length} onClick={openLikedSongs} className="flex w-full items-center gap-3 rounded-2xl bg-card p-2.5 pr-3 text-left transition-colors hover:bg-secondary disabled:opacity-60">
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

function SpotifyCollectionDetail({ collection, onBack, onPlay }: { collection: MusicCollection; onBack: () => void; onPlay: (tracks: SpotifyTrack[], startIndex: number) => void }) {
  const cacheKey = collection.savedTracks ? null : `playlist:${collection.playlist.id}`
  const initialCachedTracks = collection.savedTracks ?? (cacheKey ? readSpotifyTrackCache(cacheKey) : null)
  const [tracks, setTracks] = useState<SpotifyTrack[]>(initialCachedTracks ?? [])
  const [loading, setLoading] = useState(!initialCachedTracks)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (collection.savedTracks || initialCachedTracks) return
    void loadSpotifyTrackCache(`playlist:${collection.playlist.id}`, () => getSpotifyPlaylistItems(collection.playlist.id)).then(setTracks).catch((cause) => setError(cause instanceof Error ? cause.message : '无法读取歌单曲目')).finally(() => setLoading(false))
  }, [collection, initialCachedTracks])

  return <div className="flex h-full flex-col bg-[#17112d] md:-mt-11 md:h-[calc(100%+2.75rem)] md:pt-11">
    <header className="flex h-14 shrink-0 items-center gap-2 px-2">
      <button type="button" onClick={onBack} aria-label="返回歌单列表" className="grid size-11 place-items-center rounded-full"><ChevronDown className="size-6 rotate-90" /></button>
      <div className="min-w-0 flex-1"><p className="text-xs text-white/55">歌单</p><h1 className="truncate text-sm font-semibold">{collection.playlist.name}</h1></div>
      {tracks.length > 0 && <button type="button" onClick={() => onPlay(tracks, 0)} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">播放全部</button>}
    </header>
    <div className="mori-mini-safe-scroll no-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
      <div className="flex items-center gap-4 py-5">
        <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/10">{collection.playlist.images?.[0]?.url ? <img src={collection.playlist.images[0].url} alt="" className="size-full object-cover" /> : <Music2 className="size-7" />}</span>
        <div className="min-w-0"><h2 className="truncate text-xl font-semibold">{collection.playlist.name}</h2><p className="mt-1 text-sm text-white/55">{loading ? '正在读取曲目…' : `${tracks.length} 首歌曲`}</p></div>
      </div>
      {loading ? <div className="grid place-items-center py-16 text-sm text-white/55"><LoaderCircle className="mb-3 size-6 animate-spin" />正在加载歌单…</div> : error ? <p className="rounded-2xl bg-red-400/10 p-4 text-sm text-red-100">{error}</p> : tracks.length ? <ol className="flex flex-col gap-1">{tracks.map((track, index) => <li key={`${track.uri}-${index}`}><button type="button" onClick={() => onPlay(tracks, index)} className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-white/[0.07]"><span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/10">{track.album.images?.[0]?.url ? <img src={track.album.images[0].url} alt="" className="size-full object-cover" /> : <Music2 className="size-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{track.name}</span><span className="mt-0.5 block truncate text-xs text-white/50">{track.artists.map((artist) => artist.name).join('、')}</span></span><span className="text-xs text-white/45">{formatDuration(track.duration_ms)}</span><Play className="size-4 fill-current text-primary" /></button></li>)}</ol> : <p className="py-16 text-center text-sm text-white/50">这个歌单中没有可显示的歌曲</p>}
    </div>
  </div>
}

function SpotifyPlaylistPlayer({ playlist, initialTracks, useUris = false, initialIndex = 0, resumeExisting = false, onBack }: { playlist: SpotifyPlaylist; initialTracks?: SpotifyTrack[]; useUris?: boolean; initialIndex?: number; resumeExisting?: boolean; onBack: () => void }) {
  const { navigate, showToast } = useMori()
  const spotify = useSpotify()
  const spotifyUrl = playlist.external_urls?.spotify
  const [tracks, setTracks] = useState<SpotifyTrack[]>(initialTracks ?? [])
  const [loading, setLoading] = useState(!initialTracks)
  const [error, setError] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [playerState, setPlayerState] = useState<SpotifyPlaybackState | null>(null)
  const [progressMs, setProgressMs] = useState(0)
  const [trackRhythm, setTrackRhythm] = useState<{ bpm: number | null; energy: number | null; danceability: number | null } | null>(null)
  const [panel, setPanel] = useState<'lyrics' | 'playlist'>('lyrics')
  const [shuffle, setShuffle] = useState(false)
  const [repeatMode, setRepeatMode] = useState<'off' | 'context' | 'track'>('off')
  const [updatingPlaybackMode, setUpdatingPlaybackMode] = useState<'shuffle' | 'repeat' | null>(null)
  const playerRef = useRef<SpotifyPlayer | null>(null)
  const startedRef = useRef(false)
  const listeningSessionRef = useRef<{ id: string; uri: string; startedAt: string; listenedMs: number; lastTickAt: number } | null>(null)
  const progressRef = useRef(0)
  const canPlay = hasSpotifyPlaybackScopes()

  useEffect(() => {
    spotify.setFullPlayerOpen(true)
    return () => spotify.setFullPlayerOpen(false)
  }, [spotify.setFullPlayerOpen])

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
      spotify.updatePlayback(state)
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
  }, [canPlay, spotify.updatePlayback])

  const currentUri = playerState?.track_window.current_track.uri
  const paused = playerState?.paused ?? true
  const currentTrack = playerState?.track_window.current_track
  const artwork = currentTrack?.album.images[0]?.url ?? playlist.images?.[0]?.url
  progressRef.current = progressMs

  useEffect(() => {
    const isrc = tracks.find((track) => track.uri === currentUri)?.external_ids?.isrc
    if (!isrc) { setTrackRhythm(null); return }
    let active = true
    void fetch(`/api/music-features?isrc=${encodeURIComponent(isrc)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (active) setTrackRhythm(result?.feature ? { bpm: result.feature.bpm, energy: result.feature.energy, danceability: result.feature.danceability } : null) })
      .catch(() => { if (active) setTrackRhythm(null) })
    return () => { active = false }
  }, [currentUri, tracks])

  useEffect(() => {
    if (!spotify.user?.id || !currentUri || !currentTrack || paused) return
    if (listeningSessionRef.current?.uri !== currentUri) {
      listeningSessionRef.current = { id: crypto.randomUUID(), uri: currentUri, startedAt: new Date().toISOString(), listenedMs: 0, lastTickAt: Date.now() }
    } else {
      listeningSessionRef.current.lastTickAt = Date.now()
    }

    const sourceTrack = tracks.find((track) => track.uri === currentUri)
    const persist = () => {
      const session = listeningSessionRef.current
      if (!session || session.uri !== currentUri) return
      const now = Date.now()
      session.listenedMs += Math.max(0, now - session.lastTickAt)
      session.lastTickAt = now
      const durationMs = playerState?.duration ?? sourceTrack?.duration_ms ?? 0
      const positionMs = Math.min(durationMs || progressRef.current, progressRef.current)
      void fetch('/api/listening-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          userId: spotify.user?.id,
          event: {
            sessionId: session.id,
            spotifyUri: currentUri,
            isrc: sourceTrack?.external_ids?.isrc,
            title: currentTrack.name,
            artist: currentTrack.artists.map((artist) => artist.name).join('、'),
            album: sourceTrack?.album.name,
            artwork,
            startedAt: session.startedAt,
            updatedAt: new Date(now).toISOString(),
            listenedMs: session.listenedMs,
            positionMs,
            durationMs,
            completed: durationMs > 0 && positionMs >= durationMs - 5_000,
          },
        }),
      }).catch(() => undefined)
    }

    // 周期写入兼顾崩溃恢复与请求数量；暂停、切歌和卸载时由 cleanup 补写最后一段。
    const timer = window.setInterval(persist, 5_000)
    return () => {
      window.clearInterval(timer)
      persist()
    }
  }, [spotify.user?.id, currentUri, paused])

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
      if (useUris) {
        const chunkStart = Math.floor(index / 100) * 100
        await playSpotifyUris(deviceId, tracks.slice(chunkStart, chunkStart + 100).map((track) => track.uri), index - chunkStart)
      }
      else await playSpotify(deviceId, `spotify:playlist:${playlist.id}`, index)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '播放失败') }
  }

  useEffect(() => {
    if (resumeExisting) { startedRef.current = true; return }
    if (!deviceId || !tracks.length || startedRef.current) return
    startedRef.current = true
    void playAt(initialIndex)
  }, [deviceId, tracks.length, initialIndex, resumeExisting])

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

      <div className="mt-5 flex items-center gap-3"><div className="min-w-0 flex-1"><h2 className="truncate text-xl font-semibold">{currentTrack?.name ?? tracks[0]?.name ?? playlist.name}</h2><p className="mt-1 truncate text-sm text-white/65">{currentTrack?.artists.map((a) => a.name).join('、') ?? tracks[0]?.artists.map((a) => a.name).join('、') ?? playlist.owner?.display_name ?? 'Spotify'}</p></div><button type="button" onClick={() => navigate('chat')} aria-label="和 Mori 聊聊这首歌" className="relative grid size-16 shrink-0 place-items-center rounded-full bg-white/[0.07] ring-1 ring-white/15"><ListeningMori listening={!paused} rhythm={trackRhythm} /></button></div>

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

function ListeningMori({ listening, rhythm }: { listening: boolean; rhythm: { bpm: number | null; energy: number | null; danceability: number | null } | null }) {
  // BPM 只控制周期，energy/danceability 决定振幅；无特征时保守地表现为低强度律动。
  const energy = Math.min(1, Math.max(0, rhythm?.energy ?? 0.25))
  const danceability = Math.min(1, Math.max(0, rhythm?.danceability ?? 0.3))
  const intensity = energy * 0.72 + danceability * 0.28
  const secondsPerBeat = 60 / Math.min(200, Math.max(55, rhythm?.bpm ?? 96))
  const beatDuration = secondsPerBeat * (intensity < 0.42 ? 2 : 1)
  const low = 0.16 + intensity * 0.08
  const middle = 0.24 + intensity * 0.34
  const high = 0.34 + intensity * 0.66
  const style = { '--mori-beat-duration': `${beatDuration}s`, '--mori-eq-low': low, '--mori-eq-mid': middle, '--mori-eq-high': high } as React.CSSProperties
  return <span aria-hidden="true" className="relative grid size-16 place-items-center overflow-visible" style={style}>
    {listening && <span className="mori-listening-aura absolute inset-1 rounded-full border border-primary/30" style={{ animationDuration: `${Math.max(1.8, beatDuration * 3)}s` }} />}
    <span className={cn('absolute -bottom-1 flex h-3 items-end gap-[2px]', listening && 'is-playing')}>
      {[0.72, 0.38, 0.08, 0.52, 0.22].map((phase, bar) => <i key={bar} className="mori-equalizer-bar h-3 w-[2px] origin-bottom rounded-full bg-white/90" style={{ animationDelay: `${-beatDuration * phase}s` }} />)}
    </span>
    <Mascot scale={0.38} mood={listening ? 'talking' : 'idle'} className="drop-shadow-[0_0_10px_rgba(190,150,255,.55)]" />
  </span>
}

function formatDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
