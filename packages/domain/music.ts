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
  title: string
  artist: string
  artwork?: string
  durationMs: number
  isPlayable?: boolean
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
  setPlaybackMode(mode: PlaybackMode): Promise<void>
  getUserPlaylists(): Promise<MusicPlaylist[]>
  getPlaylistTracks(playlistId: string): Promise<MusicTrack[]>
  hasLibraryCache(playlistId?: string): Promise<boolean>
  refreshLibrary(): Promise<MusicPlaylist[]>
  playUri(uri: string, contextUri?: string, queueUris?: string[]): Promise<void>
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
