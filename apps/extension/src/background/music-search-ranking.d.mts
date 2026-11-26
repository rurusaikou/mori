import type { MusicTrack } from '@mori/domain'

export function rankTextMatches(tracks: MusicTrack[], query: string): MusicTrack[]
export function exactSearchMatches(tracks: MusicTrack[], query: string): MusicTrack[]
export function normalizeMusicSearchText(value: string): string
