import { DEFAULT_PLAYBACK_HOST_URL, STORAGE_KEYS } from '../shared/constants'
import type { ConversationMessage, MusicMemory, MusicPlaylist, MusicTrack, PlaybackState } from '@mori/domain'

export type SpotifyToken = { accessToken: string; refreshToken?: string; expiresAt: number; scope: string }
export type PresencePosition = { x: number; y: number }
export type SpotifyLibraryCache = {
  version: 3
  playlists?: { fetchedAt: number; data: MusicPlaylist[] }
  tracks: Record<string, { fetchedAt: number; data: MusicTrack[] }>
}

async function localGet<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key)
  return (result[key] as T | undefined) ?? fallback
}

export const extensionStorage = {
  // Keep every key behind this adapter. The service worker additionally marks both Chrome
  // stores TRUSTED_CONTEXTS so content scripts cannot retrieve OAuth or companion data.
  getClientId: () => localGet(STORAGE_KEYS.clientId, ''),
  setClientId: (value: string) => chrome.storage.local.set({ [STORAGE_KEYS.clientId]: value }),
  getToken: () => localGet<SpotifyToken | null>(STORAGE_KEYS.token, null),
  setToken: (value: SpotifyToken) => chrome.storage.local.set({ [STORAGE_KEYS.token]: value }),
  removeToken: () => chrome.storage.local.remove(STORAGE_KEYS.token),
  getTestUri: () => localGet(STORAGE_KEYS.testUri, ''),
  setTestUri: (value: string) => chrome.storage.local.set({ [STORAGE_KEYS.testUri]: value }),
  getPlaybackHostUrl: () => localGet(STORAGE_KEYS.playbackHostUrl, DEFAULT_PLAYBACK_HOST_URL),
  setPlaybackHostUrl: (value: string) => chrome.storage.local.set({ [STORAGE_KEYS.playbackHostUrl]: value }),
  getPresenceEnabled: () => localGet(STORAGE_KEYS.presenceEnabled, false),
  setPresenceEnabled: (value: boolean) => chrome.storage.local.set({ [STORAGE_KEYS.presenceEnabled]: value }),
  getPosition: () => localGet<PresencePosition | null>(STORAGE_KEYS.position, null),
  setPosition: (value: PresencePosition) => chrome.storage.local.set({ [STORAGE_KEYS.position]: value }),
  getConversation: () => localGet<ConversationMessage[]>(STORAGE_KEYS.conversation, []),
  setConversation: (value: ConversationMessage[]) => chrome.storage.local.set({ [STORAGE_KEYS.conversation]: value }),
  getMemories: () => localGet<MusicMemory[]>(STORAGE_KEYS.memories, []),
  setMemories: (value: MusicMemory[]) => chrome.storage.local.set({ [STORAGE_KEYS.memories]: value }),
  async getPlayback(): Promise<PlaybackState | null> {
    // Playback is a session snapshot, not a durable preference. Spotify remains the source of
    // truth after a browser restart, while local/session preferences survive separately.
    const result = await chrome.storage.session.get(STORAGE_KEYS.playback)
    return (result[STORAGE_KEYS.playback] as PlaybackState | undefined) ?? null
  },
  setPlayback: (value: PlaybackState) => chrome.storage.session.set({ [STORAGE_KEYS.playback]: value }),
  async getLibraryCache(): Promise<SpotifyLibraryCache> {
    const result = await chrome.storage.session.get(STORAGE_KEYS.libraryCache)
    const cache = result[STORAGE_KEYS.libraryCache] as SpotifyLibraryCache | undefined
    // Cache v3 guarantees that playlist accessibility was checked before the list was shown.
    // Ignore older session data so unverified playlists cannot render as enabled buttons.
    return cache?.version === 3 ? cache : { version: 3, tracks: {} }
  },
  setLibraryCache: (value: SpotifyLibraryCache) => chrome.storage.session.set({ [STORAGE_KEYS.libraryCache]: value }),
  removeLibraryCache: () => chrome.storage.session.remove(STORAGE_KEYS.libraryCache),
}
