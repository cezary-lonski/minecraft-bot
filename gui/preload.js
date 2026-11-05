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
  // kreator budowli i wlasne komendy
  blocks: () => ipcRenderer.invoke('designer:blocks'),
  designs: () => ipcRenderer.invoke('designs:list'),
  saveDesign: spec => ipcRenderer.invoke('designs:save', spec),
  deleteDesign: key => ipcRenderer.invoke('designs:delete', key),
  commands: () => ipcRenderer.invoke('commands:list'),
  saveCommand: c => ipcRenderer.invoke('commands:save', c),
  deleteCommand: key => ipcRenderer.invoke('commands:delete', key),
  // skiny botow
  skinInfo: id => ipcRenderer.invoke('skin:info', id),
  skinSlot: name => ipcRenderer.invoke('skin:slot', name),
  skinImport: id => ipcRenderer.invoke('skin:import', id),
  skinRemove: id => ipcRenderer.invoke('skin:remove', id),
  skinOpenPacks: () => ipcRenderer.invoke('skin:openPacks'),
  // asystent AI
  aiHasKey: () => ipcRenderer.invoke('ai:hasKey'),
  aiSetKey: (key, provider) => ipcRenderer.invoke('ai:setKey', key, provider),
  aiKeys: () => ipcRenderer.invoke('ai:keys'),
  aiSetProvider: p => ipcRenderer.invoke('ai:setProvider', p),
  aiChat: (text, botId) => ipcRenderer.invoke('ai:chat', text, botId),
  aiReset: () => ipcRenderer.invoke('ai:reset'),
  on: (channel, cb) => {
    if (!['log', 'status', 'bot-state', 'update', 'team', 'ai-event', 'designs-changed', 'commands-changed'].includes(channel)) return
    ipcRenderer.on(channel, (e, data) => cb(data))
  }
})
