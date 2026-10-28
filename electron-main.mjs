import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MusicService } from './electron/music/music-service.mjs'
import { SoloistAdapter } from './electron/music/soloist-adapter.mjs'
import { SoloistProcess } from './electron/music/soloist-process.mjs'
import { WindowManager } from './electron/window-manager.mjs'

const projectDir = path.dirname(fileURLToPath(import.meta.url))
// Next 只为自己的进程读取 .env.local；Soloist 凭据必须在 Electron 主进程中单独加载，且不会暴露到渲染层。
try { process.loadEnvFile(path.join(projectDir, '.env.local')) } catch (error) {
  if (error?.code !== 'ENOENT') console.warn('Unable to load .env.local:', error instanceof Error ? error.message : error)
}

const rendererUrl = process.env.MORI_RENDERER_URL ?? 'http://127.0.0.1:3210'
const musicService = new MusicService(new SoloistAdapter())
let soloistProcess
let windowManager

ipcMain.handle('window:open', (_event, type) => windowManager?.open(type) ? undefined : Promise.reject(new Error('Unsupported window type')))
ipcMain.handle('window:close-current', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
ipcMain.handle('music:get-state', () => musicService.getState())
ipcMain.handle('music:command', (_event, command, payload) => musicService.command(command, payload))

musicService.on('state', (state) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('music:state', state)
})

app.whenReady().then(async () => {
  app.setName('Mori')
  windowManager = new WindowManager({ rendererUrl, preload: path.join(projectDir, 'electron-preload.cjs'), userDataDir: app.getPath('userData') })
  await windowManager.restore()
  windowManager.openInitialWindows()

  soloistProcess = new SoloistProcess({ userDataDir: app.getPath('userData') })
  const executable = process.env.MORI_SOLOIST_PATH?.trim()
  const apiKey = process.env.MORI_SOLOIST_API_KEY?.trim()
  if (!executable || !apiKey) {
    musicService.setUnavailable('缺少 MORI_SOLOIST_PATH 或 MORI_SOLOIST_API_KEY')
  } else {
    // 播放进程独立于任一窗口，关闭聊天窗口不会中断音乐或共享状态。
    void soloistProcess.start({ executable, apiKey, deviceName: 'Mori' })
      .then((endpoint) => endpoint ? musicService.connect(endpoint) : musicService.setUnavailable('Soloist 未配置'))
      .catch((error) => { console.error('Soloist startup failed:', error); musicService.setError(error) })
  }
  app.on('activate', () => windowManager.openInitialWindows())
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  musicService.disconnect()
  soloistProcess?.stop()
  windowManager?.closeAll()
})
