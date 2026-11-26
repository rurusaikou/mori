import type { MusicTrack } from '@mori/domain'

type MusicRequest = { type: 'music_request'; intent: 'SEARCH' | 'RECOMMEND' }
type PlaybackControl = { type: 'playback_control'; command: 'PAUSE' | 'RESUME' | 'NEXT' | 'PREVIOUS' }
export function completedActionResponse(action: MusicRequest | PlaybackControl, track: MusicTrack | null): string
