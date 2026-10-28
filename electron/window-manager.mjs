import { BrowserWindow, screen, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const WINDOW_OPTIONS = {
  player: { width: 430, height: 220, minWidth: 390, minHeight: 200, title: 'Mori Player' },
  presence: { width: 196, height: 196, minWidth: 160, minHeight: 160, title: 'Mori Presence' },
  conversation: { width: 440, height: 680, minWidth: 380, minHeight: 520, title: 'Mori' },
}

export class WindowManager {
  #rendererUrl
  #preload
  #statePath
  #windows = new Map()
  #bounds = {}
  #saveTimer = null

  constructor({ rendererUrl, preload, userDataDir }) {
    this.#rendererUrl = rendererUrl
    this.#preload = preload
    this.#statePath = path.join(userDataDir, 'window-state.json')
  }

  async restore() {
    try {
      const parsed = JSON.parse(await readFile(this.#statePath, 'utf8'))
      if (parsed && typeof parsed === 'object') this.#bounds = parsed
    } catch {
      // 首次启动或状态文件损坏时使用安全的默认布局，不阻断桌面体验。
    }
  }

  get(type) { return this.#windows.get(type) ?? null }

  open(type, { show = true } = {}) {
    if (!WINDOW_OPTIONS[type]) return null
    const existing = this.get(type)
    if (existing && !existing.isDestroyed()) {
      if (show) { existing.show(); existing.focus() }
      return existing
    }

    const options = WINDOW_OPTIONS[type]
    const savedBounds = this.#validBounds(this.#bounds[type])
    const window = new BrowserWindow({
      ...options,
      ...(savedBounds ?? this.#defaultBounds(type, options)),
      show: false,
      backgroundColor: type === 'presence' ? '#00000000' : '#17112d',
      transparent: type === 'presence',
      frame: type !== 'presence',
      titleBarStyle: type === 'presence' ? undefined : 'hiddenInset',
      trafficLightPosition: type === 'presence' ? undefined : { x: 18, y: 18 },
      resizable: type !== 'presence',
      alwaysOnTop: type === 'presence',
      skipTaskbar: type === 'presence',
      webPreferences: { preload: this.#preload, contextIsolation: true, sandbox: true },
    })
    this.#windows.set(type, window)
    window.setVisibleOnAllWorkspaces(type === 'presence', { visibleOnFullScreen: true })
    window.on('move', () => this.#remember(type, window))
    window.on('resize', () => this.#remember(type, window))
    window.on('closed', () => this.#windows.delete(type))
    window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
    const url = new URL(this.#rendererUrl)
    url.searchParams.set('window', type)
    void window.loadURL(url.toString())
    if (show) window.once('ready-to-show', () => window.show())
    return window
  }

  openInitialWindows() {
    this.open('player')
    this.open('presence')
  }

  closeAll() {
    clearTimeout(this.#saveTimer)
    for (const window of this.#windows.values()) window.destroy()
    this.#windows.clear()
  }

  #remember(type, window) {
    if (window.isDestroyed()) return
    this.#bounds[type] = window.getBounds()
    clearTimeout(this.#saveTimer)
    this.#saveTimer = setTimeout(() => void writeFile(this.#statePath, JSON.stringify(this.#bounds, null, 2)), 250)
  }

  #validBounds(bounds) {
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return null
    const visible = screen.getAllDisplays().some(({ workArea }) => bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x && bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y)
    return visible ? bounds : null
  }

  #defaultBounds(type, options) {
    const { workArea } = screen.getPrimaryDisplay()
    if (type === 'player') return { x: workArea.x + 36, y: workArea.y + 56 }
    if (type === 'presence') return { x: workArea.x + Math.round((workArea.width - options.width) / 2), y: workArea.y + Math.round((workArea.height - options.height) / 2) }
    return { x: workArea.x + workArea.width - options.width - 48, y: workArea.y + 72 }
  }
}
