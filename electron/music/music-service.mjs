import { EventEmitter } from 'node:events'
import { normalizeContext, normalizeEntity, normalizeQueue } from './soloist-normalizer.mjs'

const initialState = () => ({
  connectionStatus: 'unavailable', loggedIn: false, isActiveDevice: false, deviceName: undefined,
  track: null, context: null, playbackStatus: 'idle', isPlaying: false,
  durationMs: 0, progressMs: 0, positionAnchor: { positionMs: 0, timestampMs: 0, speed: 0 },
  volume: 0, shuffle: false, repeat: 'off', queue: { previous: [], upcoming: [] },
  availableActions: [], error: null,
})

export class MusicService extends EventEmitter {
  #adapter
  #state = initialState()

  constructor(adapter) {
    super()
    this.#adapter = adapter
    adapter.on('connected', () => {
      this.#merge({ connectionStatus: 'connected', error: null })
      adapter.command('get_auth_state')
    })
    adapter.on('disconnected', () => this.#merge({ connectionStatus: 'disconnected' }))
    adapter.on('connection-error', (error) => this.#merge({ connectionStatus: 'error', error: error.message }))
    adapter.on('protocol-error', (error) => this.#merge({ error: error.message }))
    adapter.on('event', (event) => this.#handleEvent(event))
  }

  getState() { return structuredClone(this.#state) }

  async connect(endpoint) {
    this.#merge({ connectionStatus: 'starting', error: null })
    try { await this.#adapter.connect(endpoint) }
    catch (error) { this.#merge({ connectionStatus: 'error', error: error instanceof Error ? error.message : 'Soloist 连接失败' }); throw error }
  }

  setUnavailable(error = null) {
    this.#merge({ connectionStatus: 'unavailable', error })
  }

  setError(error) {
    this.#merge({ connectionStatus: 'error', error: error instanceof Error ? error.message : String(error) })
  }

  disconnect() {
    this.#adapter.disconnect()
    this.#state = initialState()
    this.#publish()
  }

  command(command, payload = {}) {
    switch (command) {
      case 'play': return this.#adapter.command('play', payload.uri ? { uri: payload.uri } : {})
      case 'pause': return this.#adapter.command('pause')
      case 'previous': return this.#adapter.command('skip_prev')
      case 'next': return this.#adapter.command('skip_next')
      case 'seek': return this.#adapter.command('seek', { position_ms: payload.positionMs })
      case 'volume': return this.#adapter.command('set_volume', { volume: payload.volume })
      case 'shuffle': return this.#adapter.command('set_shuffle', { enabled: payload.enabled })
      case 'repeat': {
        const mode = payload.mode ?? 'off'
        this.#adapter.command('set_repeat_track', { enabled: mode === 'track' })
        return this.#adapter.command('set_repeat_context', { enabled: mode === 'context' })
      }
      case 'queue': return this.#adapter.command('get_queue', { limit: payload.limit ?? 0 })
      case 'activate': return this.#adapter.command('activate')
      case 'deactivate': return this.#adapter.command('deactivate')
      default: throw new Error(`Unsupported music command: ${command}`)
    }
  }

  #handleEvent(event) {
    switch (event.type) {
      case 'auth_state':
        this.#merge({ loggedIn: Boolean(event.logged_in), isActiveDevice: Boolean(event.is_active), deviceName: event.device_name, connectionStatus: event.logged_in ? 'connected' : 'pairing' })
        if (event.logged_in) { this.#adapter.command('get_state'); this.#adapter.command('get_queue', { limit: 0 }) }
        break
      case 'playback_state': {
        const track = normalizeEntity(event.item)
        this.#merge({
          track, context: normalizeContext(event.context), playbackStatus: event.status ?? 'idle', isPlaying: event.status === 'playing',
          durationMs: track?.durationMs ?? 0, progressMs: event.position?.position_ms ?? 0,
          positionAnchor: event.position ?? { positionMs: 0, timestampMs: 0, speed: 0 }, volume: event.volume ?? 0,
          isActiveDevice: Boolean(event.is_active), shuffle: Boolean(event.options?.shuffle), repeat: event.options?.repeat ?? 'off',
          availableActions: Object.keys(event.available_actions ?? {}),
        })
        break
      }
      case 'track_changed': {
        const track = normalizeEntity(event.item)
        this.#merge({ track, durationMs: track?.durationMs ?? 0 })
        break
      }
      case 'playback_changed': this.#merge({ playbackStatus: event.status, isPlaying: event.status === 'playing' }); break
      case 'position_sync': this.#merge({ positionAnchor: event.position, progressMs: event.position?.position_ms ?? 0 }); break
      case 'volume_changed': this.#merge({ volume: event.volume ?? 0 }); break
      case 'device_changed': this.#merge({ isActiveDevice: Boolean(event.is_active), deviceName: event.device_name }); break
      case 'context_changed': this.#merge({ context: normalizeContext(event.context) }); break
      case 'options_changed': this.#merge({ shuffle: Boolean(event.options?.shuffle), repeat: event.options?.repeat ?? 'off' }); break
      case 'queue_changed': this.#merge({ queue: normalizeQueue(event) }); break
      case 'error': this.#merge({ error: event.message ?? 'Soloist command failed' }); break
    }
  }

  #merge(patch) { this.#state = { ...this.#state, ...patch }; this.#publish() }
  #publish() { this.emit('state', this.getState()) }
}
