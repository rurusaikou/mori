const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('moriDesktop', {
  // 只允许打开产品定义的窗口，渲染层不能构造任意 BrowserWindow 或 IPC channel。
  openWindow: (type) => {
    if (!['player', 'presence', 'conversation'].includes(type)) return Promise.reject(new Error('Unsupported window type'))
    return ipcRenderer.invoke('window:open', type)
  },
  closeCurrentWindow: () => ipcRenderer.invoke('window:close-current'),
  music: {
    getState: () => ipcRenderer.invoke('music:get-state'),
    command: (command, payload) => {
      const allowed = ['play', 'pause', 'previous', 'next', 'seek', 'volume', 'shuffle', 'repeat', 'queue', 'activate', 'deactivate']
      if (!allowed.includes(command)) return Promise.reject(new Error('Unsupported music command'))
      return ipcRenderer.invoke('music:command', command, payload)
    },
    onState: (listener) => {
      const handler = (_event, state) => listener(state)
      ipcRenderer.on('music:state', handler)
      return () => ipcRenderer.removeListener('music:state', handler)
    },
  },
})
