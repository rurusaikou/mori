export type MusicConnectionStatus = 'unavailable' | 'starting' | 'pairing' | 'connected' | 'disconnected' | 'error'
export type PlaybackStatus = 'idle' | 'buffering' | 'playing' | 'paused'

export type MusicTrack = {
  uri: string; entityType: string; title: string; artists: string[]; artist: string
  album?: string; artwork?: string; durationMs: number
}
export type MusicQueueItem = { uid: string; source: 'context' | 'queue' | 'autoplay'; track: MusicTrack }
export type MusicState = {
  connectionStatus: MusicConnectionStatus; loggedIn: boolean; isActiveDevice: boolean; deviceName?: string
  track: MusicTrack | null; context: { uri: string; type: string; name?: string } | null
  playbackStatus: PlaybackStatus; isPlaying: boolean; durationMs: number; progressMs: number
  positionAnchor: { positionMs?: number; position_ms?: number; timestampMs?: number; timestamp_ms?: number; speed: number }
  volume: number; shuffle: boolean; repeat: 'off' | 'context' | 'track'
  queue: { previous: MusicQueueItem[]; upcoming: MusicQueueItem[] }
  availableActions: string[]; error: string | null
}
