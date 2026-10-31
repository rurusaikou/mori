import { SpotifyMusicProvider } from '../providers/spotify/spotify-provider'
import { INITIAL_PLAYBACK_STATE, type PlaybackMode, type PlaybackState } from '@mori/domain'
import type { PlaybackHostEvent, TabMessage } from '../shared/messages'
import { extensionStorage } from '../storage/extension-storage'

export class MusicController {
  readonly provider = new SpotifyMusicProvider()
  #state: PlaybackState = { ...INITIAL_PLAYBACK_STATE }

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
  }

  async disconnect() {
    await this.provider.disconnect()
    await this.replace({ ...INITIAL_PLAYBACK_STATE, availability: 'needs-auth' })
  }

  async toggle() {
    await this.update({ error: null })
    try {
      await this.provider.toggle(this.#state)
      // Spotify Web API can take a moment to expose a newly transferred playback state.
      // A service worker has no `window`, so use the worker-global timer here.
      setTimeout(() => void this.refreshFromProvider(), 800)
    } catch (error) {
      const message = readablePlaybackError(error)
      await this.update({ availability: playbackAvailabilityFor(message), error: message })
      throw error
    }
  }

  async command(command: 'next' | 'previous') {
    await this.update({ error: null })
    try {
      await this.provider[command]()
      // Connect commands are accepted before Spotify exposes the new track through Web API.
      // Refresh later so fallback devices (which emit no Mori SDK event) still update the UI.
      setTimeout(() => void this.refreshFromProvider(), 800)
    } catch (error) {
      const message = readablePlaybackError(error)
      await this.update({ availability: playbackAvailabilityFor(message), error: message })
      throw error
    }
  }

  async setPlaybackMode(mode: PlaybackMode) {
    await this.update({ error: null })
    try {
      await this.provider.setPlaybackMode(mode)
      await this.update({ shuffle: mode === 'shuffle', repeatMode: mode === 'context' ? 'context' : mode === 'track' ? 'track' : 'off' })
      setTimeout(() => void this.refreshFromProvider(), 500)
    } catch (error) {
      const message = readablePlaybackError(error)
      await this.update({ availability: playbackAvailabilityFor(message), error: message })
      throw error
    }
  }

  getUserPlaylists() { return this.provider.getUserPlaylists() }

  getPlaylistTracks(playlistId: string) { return this.provider.getPlaylistTracks(playlistId) }

  refreshLibrary() { return this.provider.refreshLibrary() }

  async playUri(uri: string, contextUri?: string, queueUris?: string[]) {
    await this.update({ error: null })
    try {
      await this.provider.playUri(uri, contextUri, queueUris)
      setTimeout(() => void this.refreshFromProvider(), 800)
    } catch (error) {
      const message = readablePlaybackError(error)
      await this.update({ availability: playbackAvailabilityFor(message), error: message })
      throw error
    }
  }

  async handleHostEvent(event: PlaybackHostEvent) {
    if (event.type === 'ready') return this.update({ availability: 'ready', deviceId: event.deviceId, error: null })
    if (event.type === 'not_ready') return this.update({ availability: 'provider-unavailable', deviceId: null, error: 'Mori Spotify 设备暂时离线' })
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
    await this.persistAndBroadcast()
  }

  private async update(patch: Partial<PlaybackState>) {
    this.#state = { ...this.#state, ...patch }
    await this.persistAndBroadcast()
  }

  private async persistAndBroadcast() {
    await extensionStorage.setPlayback(this.#state)
    const message: TabMessage = { type: 'MORI_PLAYBACK_STATE', state: this.state }
    const tabs = await chrome.tabs.query({})
    await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id!, message)))
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
