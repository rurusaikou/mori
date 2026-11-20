export type PlaybackAvailability =
  | 'ready'
  | 'needs-auth'
  | 'needs-premium'
  | 'needs-device'
  | 'autoplay-blocked'
  | 'provider-unavailable'

export type PlaybackMode = 'off' | 'shuffle' | 'context' | 'track'

export type MusicTrack = {
  uri: string
  isrc?: string
  title: string
  artist: string
  artwork?: string
  durationMs: number
  isPlayable?: boolean
  /** 仅用于 Agent 本次候选溯源，不改变 Spotify 播放语义。 */
  catalogSource?: 'user_library' | 'spotify_search'
}

export type MusicPlaylist = {
  id: string
  uri: string
  name: string
  artwork?: string
  trackCount: number
  isAccessible?: boolean
}

export type PlaybackState = {
  availability: PlaybackAvailability
  isPlaying: boolean
  track: MusicTrack | null
  progressMs: number
  durationMs: number
  shuffle: boolean
  repeatMode: 'off' | 'context' | 'track'
  error: string | null
}

export type MusicProvider = {
  connect(): Promise<void>
  disconnect(): Promise<void>
  getPlaybackState(): Promise<PlaybackState>
  toggle(current: PlaybackState): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  seek(positionMs: number): Promise<void>
  setPlaybackMode(mode: PlaybackMode): Promise<void>
  getUserPlaylists(): Promise<MusicPlaylist[]>
  getPlaylistTracks(playlistId: string): Promise<MusicTrack[]>
  hasLibraryCache(playlistId?: string): Promise<boolean>
  refreshLibrary(): Promise<MusicPlaylist[]>
  /** queueUris 仅用于没有合法 context URI 的集合，并且首项必须是用户选中的 uri。 */
  playUri(uri: string, contextUri?: string, queueUris?: string[]): Promise<void>
  /** 返回完整、去重的可搜索个人曲库；不能只包含用户已经打开过的歌单。 */
  getSearchableLibraryTracks(): Promise<MusicTrack[]>
  getPreferenceTracks(): Promise<MusicTrack[]>
  searchTracks(query: string, limit?: number): Promise<MusicTrack[]>
}

export const INITIAL_PLAYBACK_STATE: PlaybackState = {
  availability: 'needs-auth',
  isPlaying: false,
  track: null,
  progressMs: 0,
  durationMs: 0,
  shuffle: false,
  repeatMode: 'off',
  error: null,
}
