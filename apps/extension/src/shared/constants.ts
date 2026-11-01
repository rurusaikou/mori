/**
 * 作用：集中定义 Extension 使用的存储键、Spotify 权限和默认 Host 配置。
 * 输入：无运行时输入。
 * 输出：供其他模块导入的只读常量。
 */
export const STORAGE_KEYS = {
  clientId: 'mori.spotify.client-id',
  token: 'mori.spotify.token',
  playback: 'mori.playback.snapshot',
  position: 'mori.presence.position',
  presenceEnabled: 'mori.presence.enabled',
  testUri: 'mori.spotify.test-uri',
  playbackHostUrl: 'mori.spotify.playback-host-url',
  conversation: 'mori.conversation.messages',
  memories: 'mori.memories',
  libraryCache: 'mori.spotify.library-cache',
} as const

export const DEFAULT_PLAYBACK_HOST_URL = 'http://127.0.0.1:3210/playback-host/'

export const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-private',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
] as const
