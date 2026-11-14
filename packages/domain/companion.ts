import type { MusicTrack } from './music'

export type ConversationMessage = {
  id: string
  role: 'user' | 'mori'
  text: string
  /** 客户端本地会话按自然日切分；可选用于兼容升级前已经保存的消息。 */
  createdAt?: string
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
