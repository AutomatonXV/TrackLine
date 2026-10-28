const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('fastrack', {
  pathForFile: (file) => webUtils.getPathForFile(file),
  describeLap: (filePath) => ipcRenderer.invoke('laps:describe', filePath),
  library: () => ipcRenderer.invoke('laps:library'),
  discover: () => ipcRenderer.invoke('laps:discover'),
  pickLap: () => ipcRenderer.invoke('laps:pick'),
  importLap: () => ipcRenderer.invoke('laps:import'),
  loadLap: (filePath, lapIndex) => ipcRenderer.invoke('laps:load', filePath, lapIndex),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  savePreferences: (preferences) => ipcRenderer.invoke('preferences:save', preferences),
  getBestSectors: () => ipcRenderer.invoke('sectors:get'),
  saveBestSectors: (entry) => ipcRenderer.invoke('sectors:save', entry),
  getSetup: () => ipcRenderer.invoke('setup:get'),
  importSetup: () => ipcRenderer.invoke('setup:import'),
  clearSetup: () => ipcRenderer.invoke('setup:clear'),
  getPendingSetupFeedback: () => ipcRenderer.invoke('setup:pending-feedback'),
  submitSetupFeedback: (sessionId, issue, tyres) => ipcRenderer.invoke('setup:submit-feedback', { sessionId, issue, tyres }),
  dismissSetupFeedback: (sessionId) => ipcRenderer.invoke('setup:dismiss-feedback', sessionId),
  onSetupFeedback: (callback) => {
    const handler = (_event, feedback) => callback(feedback)
    ipcRenderer.on('setup:feedback', handler)
    return () => ipcRenderer.removeListener('setup:feedback', handler)
  },
  liveStatus: () => ipcRenderer.invoke('live:status'),
  reconnectAcc: () => ipcRenderer.invoke('live:reconnect'),
  saveLiveSettings: (patch) => ipcRenderer.invoke('live:settings', patch),
  toggleHudEdit: () => ipcRenderer.invoke('live:toggleEdit'),
  resizeHud: (width) => ipcRenderer.invoke('live:resizeHud', width),
  onLiveFrame: (callback) => {
    const handler = (_event, frame) => callback(frame)
    ipcRenderer.on('live:frame', handler)
    return () => ipcRenderer.removeListener('live:frame', handler)
  },
  onLiveStatus: (callback) => {
    const handler = (_event, status) => callback(status)
    ipcRenderer.on('live:status', handler)
    return () => ipcRenderer.removeListener('live:status', handler)
  },
})