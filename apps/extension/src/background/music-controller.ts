/**
 * 作用：管理 Extension 内唯一的播放状态，协调 MusicProvider、状态持久化与跨标签广播。
 * 输入：来自 Service Worker 的播放命令、播放模式、Spotify Host 播放事件。
 * 输出：更新后的 PlaybackState、Provider 调用结果，以及发送给各标签页的播放状态消息。
 */
import { SpotifyMusicProvider } from '../providers/spotify/spotify-provider'
import { INITIAL_PLAYBACK_STATE, type MusicProvider, type PlaybackMode, type PlaybackState } from '@mori/domain'
import type { PlaybackHostEvent, TabMessage } from '../shared/messages'
import { broadcastTabMessage } from '../shared/tab-messaging'
import { extensionStorage } from '../storage/extension-storage'
import { logInfo } from './logger'

export class MusicController {
  readonly provider: MusicProvider = new SpotifyMusicProvider()
  // The controller owns the canonical snapshot. Returning or broadcasting clones prevents UI
  // consumers from mutating state without persistence and cross-tab synchronization.
  #state: PlaybackState = { ...INITIAL_PLAYBACK_STATE }
  #loggedTrackUri: string | null = null

  get state() { return structuredClone(this.#state) }

  async restore() {
    const [saved, token] = await Promise.all([extensionStorage.getPlayback(), extensionStorage.getToken()])
    // Session snapshots may outlive a manual token removal or an extension update. Authentication
    // state wins so the UI never advertises a controllable player without credentials.
    this.#state = token ? { ...INITIAL_PLAYBACK_STATE, ...(saved ?? {}) } : { ...INITIAL_PLAYBACK_STATE }
    if (this.#state.error) this.#state.error = readablePlaybackError(new Error(this.#state.error))
  }

  async connect() {
    await this.provider.connect()
    await this.update({ availability: 'ready', error: null })
    logInfo('spotify', 'authorization_connected')
  }

  async disconnect() {
    await this.provider.disconnect()
    await this.replace({ ...INITIAL_PLAYBACK_STATE, availability: 'needs-auth' })
    logInfo('spotify', 'authorization_disconnected')
  }

  async toggle() {
    await this.runProviderCommand(() => this.provider.toggle(this.#state), { refreshDelayMs: 800 })
  }

  async command(command: 'next' | 'previous') {
    await this.runProviderCommand(() => this.provider[command](), { refreshDelayMs: 800 })
  }

  async setPlaybackMode(mode: PlaybackMode) {
    await this.runProviderCommand(
      () => this.provider.setPlaybackMode(mode),
      {
        refreshDelayMs: 500,
        onSuccess: () => this.update({
          shuffle: mode === 'shuffle',
          repeatMode: mode === 'context' ? 'context' : mode === 'track' ? 'track' : 'off',
        }),
      },
    )
  }

  getUserPlaylists() { return this.provider.getUserPlaylists() }

  getPlaylistTracks(playlistId: string) { return this.provider.getPlaylistTracks(playlistId) }

  hasLibraryCache(playlistId?: string) { return this.provider.hasLibraryCache(playlistId) }

  refreshLibrary() { return this.provider.refreshLibrary() }

  getPreferenceTracks() { return this.provider.getPreferenceTracks() }

  async playUri(uri: string, contextUri?: string, queueUris?: string[]) {
    await this.runProviderCommand(
      () => this.provider.playUri(uri, contextUri, queueUris),
      { refreshDelayMs: 800 },
    )
  }

  async handleHostEvent(event: PlaybackHostEvent) {
    if (event.type === 'ready') {
      logInfo('spotify', 'playback_host_ready')
      return this.update({ availability: 'ready', error: null })
    }
    if (event.type === 'not_ready') return this.update({ availability: 'provider-unavailable', error: 'Mori Spotify 设备暂时离线' })
    if (event.type === 'error') {
      const availability = event.kind === 'account_error' ? 'needs-premium' : event.kind === 'autoplay_failed' ? 'autoplay-blocked' : 'provider-unavailable'
      return this.update({ availability, error: event.message })
    }
    const track = event.track ? {
      uri: event.track.uri,
      title: event.track.name,
      artist: event.track.artists?.map((artist) => artist.name).join('、') || '',
      artwork: event.track.album?.images?.[0]?.url,
      durationMs: event.duration,
    } : null
    return this.update({ availability: 'ready', isPlaying: !event.paused, track, progressMs: event.position, durationMs: event.duration, error: null })
  }

  private async replace(state: PlaybackState) {
    this.#state = state
    this.logCurrentTrack()
    await this.persistAndBroadcast()
  }

  private async update(patch: Partial<PlaybackState>) {
    this.#state = { ...this.#state, ...patch }
    this.logCurrentTrack()
    await this.persistAndBroadcast()
  }

  private logCurrentTrack() {
    const track = this.#state.track
    // Spotify SDK emits a paused snapshot while a newly initialized device restores its previous
    // context. It is not a second play action, so only log a track after Spotify confirms playback.
    if (!this.#state.isPlaying) { this.#loggedTrackUri = null; return }
    if (!track?.uri || track.uri === this.#loggedTrackUri) return
    this.#loggedTrackUri = track.uri
    logInfo('playback', 'track_changed', { uri: track.uri, title: track.title, artist: track.artist, durationMs: track.durationMs, isPlaying: this.#state.isPlaying })
  }

  private async runProviderCommand(
    command: () => Promise<void>,
    options: { refreshDelayMs?: number; onSuccess?: () => Promise<void> } = {},
  ) {
    // Every provider write must clear stale errors and map failures through the same availability
    // boundary; otherwise identical Spotify failures produce different UI states by command.
    await this.update({ error: null })
    try {
      await command()
      await options.onSuccess?.()
      // Spotify Web API can lag behind accepted commands. Delayed refresh also covers fallback
      // devices, which do not emit Mori SDK events. Service workers use the global timer.
      if (options.refreshDelayMs !== undefined) {
        setTimeout(() => void this.refreshFromProvider(), options.refreshDelayMs)
      }
    } catch (error) {
      const message = readablePlaybackError(error)
      await this.update({ availability: playbackAvailabilityFor(message), error: message })
      throw error
    }
  }

  private async persistAndBroadcast() {
    await extensionStorage.setPlayback(this.#state)
    const message: TabMessage = { type: 'MORI_PLAYBACK_STATE', state: this.state }
    await broadcastTabMessage(message)
  }

  private async refreshFromProvider() {
    try {
      const state = await this.provider.getPlaybackState()
      await this.replace(state)
    } catch {
      // The command result remains authoritative; a delayed Web API refresh is best-effort only.
    }
  }
}

function readablePlaybackError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Spotify 播放失败'
  if (message.includes('message channel closed') || message.includes('asynchronous response')) {
    return 'Mori 播放服务刚刚重新加载，请再点击一次。'
  }
  if (message.includes('Receiving end does not exist')) {
    return 'Mori 播放服务正在恢复，请稍后再试。'
  }
  return message
}

function playbackAvailabilityFor(message: string): PlaybackState['availability'] {
  if (message.includes('Premium')) return 'needs-premium'
  if (message.includes('设备') || message.includes('device')) return 'needs-device'
  if (message.includes('登录') || message.includes('授权')) return 'needs-auth'
  return 'provider-unavailable'
}
