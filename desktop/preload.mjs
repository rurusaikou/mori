import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('moriDesktop', {
  platform: process.platform,
  isDesktop: true,
})
