import { EventEmitter } from 'node:events'

const OPEN = 1

export class SoloistAdapter extends EventEmitter {
  #socket = null
  #endpoint = null
  #manuallyClosed = false
  #reconnectTimer = null

  get connected() {
    return this.#socket?.readyState === OPEN
  }

  async connect(endpoint) {
    const url = new URL(endpoint)
    // Soloist's API has no authentication or Origin protection; Mori must never connect to a network-exposed endpoint.
    if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      throw new Error('Soloist WebSocket 必须绑定到本机回环地址')
    }
    this.#endpoint = url.toString()
    this.#manuallyClosed = false
    await this.#open()
  }

  async #open() {
    if (!this.#endpoint || this.connected) return
    const WebSocketImpl = globalThis.WebSocket
    if (!WebSocketImpl) throw new Error('当前 Electron 主进程不支持 WebSocket')
    await new Promise((resolve, reject) => {
      const socket = new WebSocketImpl(this.#endpoint)
      this.#socket = socket
      const fail = () => reject(new Error('无法连接 Soloist 本机服务'))
      socket.addEventListener('open', () => {
        socket.removeEventListener('error', fail)
        this.emit('connected')
        resolve()
      }, { once: true })
      socket.addEventListener('error', fail, { once: true })
      socket.addEventListener('message', (event) => this.#receive(event.data))
      socket.addEventListener('close', () => {
        if (this.#socket === socket) this.#socket = null
        this.emit('disconnected')
        if (!this.#manuallyClosed) this.#scheduleReconnect()
      })
    })
  }

  #receive(payload) {
    try {
      const event = JSON.parse(String(payload))
      if (event && typeof event.type === 'string') this.emit('event', event)
    } catch {
      this.emit('protocol-error', new Error('Soloist 返回了无法解析的消息'))
    }
  }

  #scheduleReconnect() {
    clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = setTimeout(() => void this.#open().catch((error) => this.emit('connection-error', error)), 2_000)
  }

  command(command, fields = {}) {
    if (!this.connected) throw new Error('Soloist 尚未连接')
    this.#socket.send(JSON.stringify({ type: 'command', command, ...fields }))
  }

  disconnect() {
    this.#manuallyClosed = true
    clearTimeout(this.#reconnectTimer)
    this.#socket?.close()
    this.#socket = null
  }
}
