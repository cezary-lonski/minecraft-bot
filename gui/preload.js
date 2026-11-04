// Most miedzy oknem (index.html) a procesem glownym - okno nie ma bezposredniego dostepu do Node.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridge', {
  profiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfile: p => ipcRenderer.invoke('profiles:save', p),
  deleteProfile: id => ipcRenderer.invoke('profiles:delete', id),
  memory: id => ipcRenderer.invoke('profiles:memory', id),
  start: id => ipcRenderer.invoke('bot:start', id),
  stop: id => ipcRenderer.invoke('bot:stop', id),
  command: (id, text) => ipcRenderer.invoke('bot:command', id, text),
  running: () => ipcRenderer.invoke('bot:running'),
  version: () => ipcRenderer.invoke('app:version'),
  appSettings: () => ipcRenderer.invoke('app:settings'),
  saveAppSettings: s => ipcRenderer.invoke('app:saveSettings', s),
  openDataDir: id => ipcRenderer.invoke('app:dataDir', id),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  on: (channel, cb) => {
    if (!['log', 'status', 'bot-state', 'update', 'team'].includes(channel)) return
    ipcRenderer.on(channel, (e, data) => cb(data))
  }
})
