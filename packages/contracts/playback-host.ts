/**
 * Protocol shared by the Extension offscreen bridge and the HTTPS Playback Host.
 * Keep this module free of Chrome, DOM and React dependencies so both bundles can import it.
 */
export const OFFSCREEN_MESSAGE_SOURCE = 'mori-offscreen' as const
export const PLAYBACK_HOST_MESSAGE_SOURCE = 'mori-playback-host' as const

export type PlaybackHostCommand = 'PLAYER_INIT' | 'PLAYER_ACTIVATE' | 'PLAYER_SET_VOLUME'

export type PlaybackHostPayload = {
  token?: string
  volume?: number
}

export type SpotifySdkTrack = {
  uri: string
  name: string
  artists?: { name: string }[]
  album?: { images?: { url: string }[] }
}

export type PlaybackHostEvent =
  | { type: 'ready' }
  | { type: 'not_ready' }
  | { type: 'error'; kind: string; message: string }
  | { type: 'state'; paused: boolean; position: number; duration: number; track: SpotifySdkTrack | null }

export type PlaybackHostFrameRequest = {
  source: typeof OFFSCREEN_MESSAGE_SOURCE
  id: string
  type: PlaybackHostCommand
  payload?: PlaybackHostPayload
}

