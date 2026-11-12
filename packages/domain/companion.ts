import type { MusicTrack } from './music'

export type ConversationMessage = {
  id: string
  role: 'user' | 'mori'
  text: string
}

export type MusicMemory = {
  id: string
  createdAt: string
  note: string
  /** Optional for backward compatibility with Moments saved before mood selection existed. */
  mood?: MusicMood
  track: MusicTrack | null
}

export type MusicMood = 'calm' | 'happy' | 'healing' | 'moved' | 'nostalgic' | 'low'

export type MusicMomentInput = {
  mood: MusicMood
  note?: string
}
