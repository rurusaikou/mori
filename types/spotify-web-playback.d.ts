interface Window {
  Spotify?: {
    Player: new (options: {
      name: string
      getOAuthToken: (callback: (token: string) => void) => void
      volume?: number
    }) => SpotifyPlayer
  }
  onSpotifyWebPlaybackSDKReady?: () => void
  moriSpotifyPlayer?: SpotifyPlayer
  moriSpotifyDeviceId?: string
}

interface SpotifyPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  togglePlay(): Promise<void>
  nextTrack(): Promise<void>
  previousTrack(): Promise<void>
  seek(positionMs: number): Promise<void>
  getCurrentState(): Promise<SpotifyPlaybackState | null>
  addListener(event: 'ready', callback: (data: { device_id: string }) => void): boolean
  addListener(event: 'not_ready', callback: (data: { device_id: string }) => void): boolean
  addListener(event: 'player_state_changed', callback: (state: SpotifyPlaybackState | null) => void): boolean
  addListener(event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error', callback: (data: { message: string }) => void): boolean
  removeListener(event: 'ready' | 'not_ready' | 'player_state_changed' | 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error', callback?: (...args: any[]) => void): boolean
}

interface SpotifyPlaybackState {
  paused: boolean
  shuffle: boolean
  repeat_mode: number
  position: number
  duration: number
  track_window: { current_track: { id: string; uri: string; name: string; artists: { name: string }[]; album: { images: { url: string }[] } } }
}
