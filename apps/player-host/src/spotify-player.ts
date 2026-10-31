import type { PlaybackHostEvent, SpotifySdkTrack } from '@mori/contracts/playback-host'

type PlayerError = { message?: string }
type SpotifyPlayer = {
  connect(): Promise<boolean>
  activateElement(): Promise<void>
  addListener(event: string, callback: (payload?: never) => void): void
  removeListener(event: string, callback: (payload?: never) => void): void
}
type SpotifyWindow = Window & typeof globalThis & {
  Spotify?: { Player: new (options: { name: string; getOAuthToken: (callback: (token: string) => void) => void; volume: number }) => SpotifyPlayer }
  onSpotifyWebPlaybackSDKReady?: () => void
}

export class SpotifyPlaybackDevice {
  #player: SpotifyPlayer | null = null
  #accessToken = ''
  #deviceId = ''
  #sdkPromise: Promise<void> | null = null

  constructor(private readonly emit: (event: PlaybackHostEvent) => void) {}

  async initialize(token: string) {
    this.#accessToken = token
    if (this.#player && this.#deviceId) return { deviceId: this.#deviceId }
    await this.#loadSdk()
    const Spotify = (window as SpotifyWindow).Spotify
    if (!Spotify) throw new Error('Spotify SDK 未创建 Player API')

    if (!this.#player) {
      this.#player = new Spotify.Player({ name: 'Mori', getOAuthToken: (callback) => callback(this.#accessToken), volume: 0.8 })
      this.#registerStateListeners(this.#player)
    }

    // A previous connect may have failed or the device may have gone not_ready. Always reconnect
    // when no device id exists instead of returning an empty id that can never recover.
    const ready = this.#waitForDevice(this.#player)
    void ready.catch(() => undefined)
    if (!await this.#player.connect()) throw new Error('Spotify Web Playback SDK 拒绝连接')
    this.#deviceId = await ready
    return { deviceId: this.#deviceId }
  }

  async activate() {
    if (!this.#player) throw new Error('Mori Playback Host 尚未初始化')
    await this.#player.activateElement()
  }

  #loadSdk() {
    if (this.#sdkPromise) return this.#sdkPromise
    this.#sdkPromise = new Promise<void>((resolve, reject) => {
      const spotifyWindow = window as SpotifyWindow
      if (spotifyWindow.Spotify) { resolve(); return }
      spotifyWindow.onSpotifyWebPlaybackSDKReady = resolve
      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true
      script.addEventListener('error', () => reject(new Error('Spotify SDK 加载失败，请检查 sdk.scdn.co')))
      document.head.append(script)
    }).catch((error) => {
      // Network/CSP failures are often transient. Clear the rejected cache so the next explicit
      // user action can load the SDK again rather than reusing a permanently failed promise.
      this.#sdkPromise = null
      throw error
    })
    return this.#sdkPromise
  }

  #waitForDevice(currentPlayer: SpotifyPlayer) {
    return new Promise<string>((resolve, reject) => {
      const failureEvents = ['initialization_error', 'authentication_error', 'account_error']
      const cleanup = () => {
        window.clearTimeout(timer)
        currentPlayer.removeListener('ready', onReady)
        for (const event of failureEvents) currentPlayer.removeListener(event, onFailure)
      }
      const onReady = (payload?: never) => {
        const id = (payload as { device_id?: string } | undefined)?.device_id
        if (!id) return
        cleanup(); resolve(id)
      }
      const onFailure = (payload?: never) => {
        cleanup(); reject(new Error((payload as PlayerError | undefined)?.message || 'Spotify 无法初始化 Mori 播放设备'))
      }
      const timer = window.setTimeout(() => { cleanup(); reject(new Error('Mori Playback Host 等待 Spotify 设备超时')) }, 20_000)
      currentPlayer.addListener('ready', onReady)
      for (const event of failureEvents) currentPlayer.addListener(event, onFailure)
    })
  }

  #registerStateListeners(currentPlayer: SpotifyPlayer) {
    currentPlayer.addListener('ready', (payload?: never) => {
      this.#deviceId = (payload as { device_id?: string } | undefined)?.device_id || ''
      this.emit({ type: 'ready', deviceId: this.#deviceId })
    })
    currentPlayer.addListener('not_ready', (payload?: never) => {
      const unavailableId = (payload as { device_id?: string } | undefined)?.device_id || this.#deviceId
      this.#deviceId = ''
      this.emit({ type: 'not_ready', deviceId: unavailableId })
    })
    currentPlayer.addListener('player_state_changed', (payload?: never) => {
      const state = payload as { paused: boolean; position: number; duration: number; track_window?: { current_track?: SpotifySdkTrack } } | undefined
      if (state) this.emit({ type: 'state', paused: state.paused, position: state.position, duration: state.duration, track: state.track_window?.current_track ?? null })
    })
    for (const kind of ['initialization_error', 'authentication_error', 'account_error', 'playback_error', 'autoplay_failed']) {
      currentPlayer.addListener(kind, (payload?: never) => this.emit({ type: 'error', kind, message: (payload as PlayerError | undefined)?.message || spotifyErrorMessage(kind) }))
    }
  }
}

function spotifyErrorMessage(kind: string) {
  if (kind === 'account_error') return 'Spotify Web Playback SDK 需要 Premium'
  if (kind === 'autoplay_failed') return '浏览器阻止了首次播放，请再次点击歌曲'
  if (kind === 'initialization_error') return 'Playback Host 无法初始化 Spotify DRM 播放器'
  if (kind === 'authentication_error') return 'Spotify 播放授权无效，请重新连接'
  return 'Spotify Web Playback SDK 出错'
}
