import type { ConversationMessage, MusicMemory, PlaybackMode, PlaybackState } from '@mori/domain'
import type { PlaybackHostCommand, PlaybackHostEvent, PlaybackHostPayload } from '@mori/contracts/playback-host'

export type { PlaybackHostEvent, SpotifySdkTrack } from '@mori/contracts/playback-host'

export type RuntimeRequest =
  | { type: 'MORI_GET_STATE' }
  | { type: 'MORI_GET_PRESENCE_STATE' }
  | { type: 'MORI_SAVE_POSITION'; position: { x: number; y: number } }
  | { type: 'MORI_CONNECT_SPOTIFY' }
  | { type: 'MORI_DISCONNECT_SPOTIFY' }
  | { type: 'MORI_TOGGLE_PLAYBACK' }
  | { type: 'MORI_PLAYBACK_COMMAND'; command: 'next' | 'previous' }
  | { type: 'MORI_SET_PLAYBACK_MODE'; mode: PlaybackMode }
  | { type: 'MORI_GET_PLAYLISTS' }
  | { type: 'MORI_REFRESH_LIBRARY' }
  | { type: 'MORI_GET_PLAYLIST_TRACKS'; playlistId: string }
  | { type: 'MORI_PLAY_URI'; uri: string; contextUri?: string; queueUris?: string[] }
  | { type: 'MORI_GET_COMPANION_DATA' }
  | { type: 'MORI_SEND_MESSAGE'; text: string }
  | { type: 'MORI_SAVE_MEMORY'; note: string }
  | { type: 'PLAYBACK_EVENT'; event: PlaybackHostEvent }

export type TabMessage =
  | { type: 'MORI_SET_VISIBILITY'; visible: boolean }
  | { type: 'MORI_PLAYBACK_STATE'; state: PlaybackState }
  | { type: 'MORI_COMPANION_DATA'; messages: ConversationMessage[]; memories: MusicMemory[] }

export type PlaybackHostRequest = {
  target: 'offscreen'
  type: PlaybackHostCommand
  // hostUrl configures the Extension-owned iframe and is intentionally not part of the
  // cross-origin host protocol. Only the short-lived token crosses that boundary.
  payload?: PlaybackHostPayload & { hostUrl?: string }
}

export type RuntimeResponse<T = unknown> = { ok: true; result: T } | { ok: false; error: string }
