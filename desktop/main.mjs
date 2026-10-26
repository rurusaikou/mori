import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

const desktopDir = path.dirname(fileURLToPath(import.meta.url))
const rendererUrl = process.env.MORI_DESKTOP_URL ?? 'http://127.0.0.1:3210'

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#120e24',
    title: 'Mori',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(desktopDir, 'preload.mjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.MORI_DESKTOP_SCREENSHOT) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await window.webContents.capturePage()
        await writeFile(process.env.MORI_DESKTOP_SCREENSHOT, image.toPNG())
        app.quit()
      }, 800)
    })
  }
  void window.loadURL(rendererUrl)
}

app.whenReady().then(() => {
  app.setName('Mori')
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => app.quit())
