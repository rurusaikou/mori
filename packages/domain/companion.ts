import type { MusicTrack } from './music'

export type ConversationMessage = {
  id: string
  role: 'user' | 'mori'
  text: string
  createdAt: string
  trackUri?: string
}

export type MusicMemory = {
  id: string
  createdAt: string
  note: string
  track: MusicTrack | null
}
