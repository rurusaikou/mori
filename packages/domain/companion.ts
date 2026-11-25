import type { MusicTrack } from './music'

export type ConversationMessage = {
  id: string
  role: 'user' | 'mori'
  text: string
  /** 客户端本地会话按自然日切分；可选用于兼容升级前已经保存的消息。 */
  createdAt?: string
  /** 消息产生时 Spotify 的真实播放上下文，不代表这句话正在讨论该歌曲。 */
  playbackTrack?: MusicTrack | null
  /** Context Assembly 已解析的本轮讨论对象，用于短期 conversationFocus。 */
  discussionTrack?: MusicTrack | null
  /** v0.7 旧缓存兼容字段；新消息不再写入。 */
  track?: MusicTrack | null
}

export type ConversationEntity = { id: string; label: string; kind: 'PERSON' | 'PLACE' | 'OBJECT' | 'OTHER' }
export type ConversationFact = { subject: string; relation: string; object: string; evidence: string; confidence: number }
export type ConversationState = {
  activeTopic: string | null
  entities: ConversationEntity[]
  facts: ConversationFact[]
  lastUserMessage: string | null
  lastAssistantMessage: string | null
  unresolvedContext: string | null
}

export const EMPTY_CONVERSATION_STATE: ConversationState = {
  activeTopic: null,
  entities: [],
  facts: [],
  lastUserMessage: null,
  lastAssistantMessage: null,
  unresolvedContext: null,
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
