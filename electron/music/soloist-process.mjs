import { spawn } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'

export class SoloistProcess {
  #child = null
  #startError = null
  #dataDir
  #cacheDir

  constructor({ userDataDir }) {
    this.#dataDir = path.join(userDataDir, 'soloist')
    this.#cacheDir = path.join(userDataDir, 'soloist-cache')
  }

  async start({ executable, apiKey, deviceName = 'Mori' }) {
    if (!executable || !apiKey) return null
    await Promise.all([mkdir(this.#dataDir, { recursive: true }), mkdir(this.#cacheDir, { recursive: true })])
    // Soloist 在异常退出后可能留下旧端口；先清理发现文件，避免新进程尚未就绪时误连上一次的端点。
    await Promise.all([
      rm(path.join(this.#dataDir, 'ws.addr'), { force: true }),
      rm(path.join(this.#dataDir, 'ws.port'), { force: true }),
    ])
    // Never use a shell here: the API key is a secret and must be passed as one process argument without interpolation.
    this.#startError = null
    this.#child = spawn(executable, [
      '--device-name', deviceName,
      '--api-key', apiKey,
      '--data-dir', this.#dataDir,
      '--cache-dir', this.#cacheDir,
      '--ws', '127.0.0.1:0',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    this.#child.once('error', (error) => { this.#startError = error; this.#child = null })
    this.#child.stderr?.on('data', () => undefined)
    this.#child.once('exit', (code) => {
      this.#child = null
      if (code === 10) process.emitWarning('Spotify Soloist build has expired')
    })
    return this.#waitForEndpoint()
  }

  async #waitForEndpoint() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (this.#startError) throw new Error(`无法启动 Soloist：${this.#startError.message}`)
      if (!this.#child) throw new Error('Soloist 启动失败')
      try {
        const [address, port] = await Promise.all([
          readFile(path.join(this.#dataDir, 'ws.addr'), 'utf8'),
          readFile(path.join(this.#dataDir, 'ws.port'), 'utf8'),
        ])
        return `ws://${address.trim()}:${port.trim()}`
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    throw new Error('Soloist 本机服务启动超时')
  }

  stop() {
    this.#child?.kill('SIGTERM')
    this.#child = null
  }
}
