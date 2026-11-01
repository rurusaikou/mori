/**
 * 作用：加载并展示 Spotify 歌单和歌曲，处理缓存提示、刷新与歌曲播放选择。
 * 输入：当前 PlaybackState，以及读取缓存、歌单、歌曲和播放 URI 的异步回调。
 * 输出：歌单 React UI，以及通过 playUri/refreshLibrary 等回调发出的用户操作。
 */
import { useEffect, useState } from 'react'
import type { MusicPlaylist, MusicTrack, PlaybackState } from '@mori/domain'

type Props = {
  playback: PlaybackState
  getPlaylists: () => Promise<MusicPlaylist[]>
  hasLibraryCache: (playlistId?: string) => Promise<boolean>
  refreshLibrary: () => Promise<MusicPlaylist[]>
  getPlaylistTracks: (playlistId: string) => Promise<MusicTrack[]>
  playUri: (uri: string, contextUri?: string, queueUris?: string[]) => Promise<void>
}

export function PlaylistPanel({ playback, getPlaylists, hasLibraryCache, refreshLibrary, getPlaylistTracks, playUri }: Props) {
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([])
  const [tracks, setTracks] = useState<MusicTrack[] | null>(null)
  const [activePlaylist, setActivePlaylist] = useState<MusicPlaylist | null>(null)
  const [title, setTitle] = useState('播放列表')
  const [loading, setLoading] = useState(true)
  const [showLoading, setShowLoading] = useState(false)
  const [error, setError] = useState('')
  // A play request is acknowledged before DRM/device setup finishes. Keep the selected row in a
  // pending state until the broadcast track matches it or the controller publishes an error.
  const [requestedUri, setRequestedUri] = useState<string | null>(null)
  function beginLoading(readingSpotify: boolean) {
    setLoading(true)
    // Cache reads are intentionally silent; show a network loading message only when the Provider
    // reports that no session cache exists and the user is actually waiting on Spotify.
    setShowLoading(readingSpotify)
  }

  function finishLoading() {
    setLoading(false)
    setShowLoading(false)
  }

  useEffect(() => {
    // Load once per panel mount. The parent supplies an inline callback whose identity can change
    // on playback broadcasts; depending on it would refetch the entire library on every event.
    void (async () => {
      beginLoading(!await hasLibraryCache())
      try { setPlaylists(await getPlaylists()) }
      catch (reason) { setError(reason instanceof Error ? reason.message : '无法读取 Spotify 歌单') }
      finally { finishLoading() }
    })()
  }, [])

  useEffect(() => {
    if (playback.error || (requestedUri && playback.track?.uri === requestedUri)) setRequestedUri(null)
  }, [playback.error, playback.track?.uri, requestedUri])

  async function openPlaylist(playlist: MusicPlaylist) {
    if (playlist.isAccessible === false) return
    beginLoading(!await hasLibraryCache(playlist.id)); setError(''); setTitle(playlist.name); setActivePlaylist(playlist)
    try { setTracks(await getPlaylistTracks(playlist.id)) }
    catch (reason) {
      if (reason instanceof Error && /forbidden|not available|not found/i.test(reason.message)) {
        setPlaylists((items) => items.map((item) => item.id === playlist.id ? { ...item, isAccessible: false } : item))
        setTracks(null); setActivePlaylist(null); setTitle('播放列表'); setError('')
      } else setError(reason instanceof Error ? reason.message : '无法读取歌单歌曲')
    }
    finally { finishLoading() }
  }

  async function playTrack(track: MusicTrack) {
    setRequestedUri(track.uri); setError('')
    const isLikedTracks = activePlaylist?.uri === 'spotify:collection:tracks'
    const playableUris = tracks?.filter((item) => item.isPlayable !== false).map((item) => item.uri) ?? []
    const selectedIndex = playableUris.indexOf(track.uri)
    // Saved Tracks is not a valid Spotify context_uri. Build a URI queue starting at the selected
    // track so it can still play and advance, while ordinary playlists keep their native context.
    const queueUris = isLikedTracks && selectedIndex >= 0 ? [...playableUris.slice(selectedIndex), ...playableUris.slice(0, selectedIndex)] : undefined
    try { await playUri(track.uri, isLikedTracks ? undefined : activePlaylist?.uri, queueUris) }
    catch (reason) { setRequestedUri(null); setError(reason instanceof Error ? reason.message : '无法播放这首歌曲') }
  }

  async function refresh() {
    beginLoading(true); setError(''); setTracks(null); setActivePlaylist(null); setTitle('播放列表')
    try { setPlaylists(await refreshLibrary()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法刷新 Spotify 歌单') }
    finally { finishLoading() }
  }

  return <section className="feature-view" aria-label="Spotify 播放列表">
    <header className="panel-header">
      {tracks && <button type="button" className="back-button" onClick={() => { setTracks(null); setActivePlaylist(null); setTitle('播放列表'); setError('') }} aria-label="返回歌单">‹</button>}
      <strong>{title}</strong>
      {!tracks && <button type="button" className="refresh-button" disabled={loading} onClick={() => void refresh()} aria-label="刷新歌单" title="刷新歌单">↻</button>}
    </header>
    {showLoading && <p className="list-status">正在从 Spotify 同步…</p>}
    {error && <p className="list-status error">{error}</p>}
    {!loading && !error && <div className="media-list">
      {tracks
        ? tracks.map((track) => {
          const playable = track.isPlayable !== false
          return <button type="button" disabled={!playable} className={`media-item ${requestedUri === track.uri ? 'requested' : ''} ${playable ? '' : 'unavailable'}`} key={track.uri} onClick={() => void playTrack(track)}>
            <MediaArtwork src={track.artwork} />
            <span><strong>{track.title}</strong><small>{!playable ? '当前地区或账号不可播放' : requestedUri === track.uri ? '正在连接播放设备…' : track.artist}</small></span>
          </button>
        })
        : playlists.map((playlist) => <button type="button" disabled={playlist.isAccessible === false} className={`media-item ${playlist.isAccessible === false ? 'unavailable' : ''}`} key={playlist.id} onClick={() => void openPlaylist(playlist)}>
            <MediaArtwork src={playlist.artwork} />
            <span><strong>{playlist.name}</strong><small>{playlist.isAccessible === false ? 'Spotify 不允许读取此歌单' : `${playlist.trackCount} 首歌曲`}</small></span>
          </button>)}
      {!tracks && !playlists.length && <p className="list-status">还没有可显示的 Spotify 歌单</p>}
      {tracks && !tracks.length && <p className="list-status">这个歌单没有可播放的歌曲</p>}
    </div>}
  </section>
}

function MediaArtwork({ src }: { src?: string }) {
  return src ? <img src={src} alt="" /> : <span className="media-placeholder">♪</span>
}
