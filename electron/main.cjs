const electron = require('electron')
const { app, BrowserWindow, dialog, ipcMain } = electron
const fs = require('node:fs')
const path = require('node:path')
const { discoverFiles, parseLap } = require('./telemetry.cjs')
const { createLive } = require('./live.cjs')
const { parseSetup, findSetupTemplate, createSetupVariant } = require('./setup.cjs')

let live = null

let mainWindow
const statePath = () => path.join(app.getPath('userData'), 'fastrack-data.json')

function readState() {
  try { return { bestSectors: {}, importedPaths: [], setupFeedbackQueue: [], ...JSON.parse(fs.readFileSync(statePath(), 'utf8')) } }
  catch { return { overrides: {}, bestSectors: {}, importedPaths: [], setupFeedbackQueue: [] } }
}

function writeState(state) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8')
}

function defaultMotecFolder() {
  return path.join(app.getPath('documents'), 'Assetto Corsa Competizione', 'MoTeC')
}

function dialogFolder() {
  const acc = path.join(app.getPath('documents'), 'Assetto Corsa Competizione')
  const motec = defaultMotecFolder()
  return fs.existsSync(motec) ? motec : fs.existsSync(acc) ? acc : app.getPath('documents')
}

function setupFolder() {
  const folder = path.join(app.getPath('documents'), 'Assetto Corsa Competizione', 'Setups')
  return fs.existsSync(folder) ? folder : app.getPath('documents')
}

function defaultReferencePath() {
  return path.join(__dirname, '../Assets/Reference_Monza_720SEVO_MoTeC/monza-mclaren_720s_gt3_evo-10-2023.06.29-19.52.41.ld')
}

function summary(filePath) {
  try {
    const lap = parseLap(filePath)
    return {
      id: filePath, path: filePath, name: path.basename(filePath), car: lap.car, track: lap.track,
      date: lap.date, lapTime: lap.lapTime, hasSidecar: lap.hasSidecar,
      lapTimes: lap.lapTimes, fastestLapIndex: lap.fastestLapIndex,
    }
  } catch (error) {
    return { id: filePath, path: filePath, name: path.basename(filePath), car: 'Unreadable log', track: error.message, date: '', lapTime: 0, hasSidecar: false, error: true }
  }
}

function allLaps() {
  const state = readState()
  const referencePath = defaultReferencePath()
  const reference = fs.existsSync(referencePath) ? [summary(referencePath)] : []
  const results = [...discoverFiles(defaultMotecFolder()), ...state.importedPaths.filter((filePath) => fs.existsSync(filePath)).map(summary), ...reference]
  return [...new Map(results.map((lap) => [lap.path, lap])).values()].sort((a, b) => b.date.localeCompare(a.date))
}

function loadRenderer(win, route = '') {
  if (app.isPackaged) win.loadFile(path.join(__dirname, '../dist/index.html'), route ? { hash: route } : undefined)
  else win.loadURL(`http://127.0.0.1:5173/${route ? `#${route}` : ''}`)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1520, height: 980, minWidth: 1000, minHeight: 700,
    backgroundColor: '#101314', title: 'Fastrack | ACC Telemetry', autoHideMenuBar: true,
    icon: path.join(__dirname, '../Assets/FasTrackIcon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  loadRenderer(mainWindow)
  mainWindow.on('closed', () => { mainWindow = null; app.quit() })
}

app.whenReady().then(() => {
  ipcMain.handle('laps:discover', () => allLaps())
  ipcMain.handle('laps:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import MoTeC lap', defaultPath: dialogFolder(), properties: ['openFile', 'multiSelections'], filters: [{ name: 'MoTeC logs', extensions: ['ld'] }] })
    if (result.canceled) return []
    const state = readState()
    state.importedPaths = [...new Set([...state.importedPaths, ...result.filePaths])]
    writeState(state)
    return result.filePaths.map(summary)
  })
  ipcMain.handle('laps:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Open MoTeC lap', defaultPath: dialogFolder(), properties: ['openFile'], filters: [{ name: 'MoTeC logs', extensions: ['ld'] }] })
    return result.canceled || !result.filePaths[0] ? null : summary(result.filePaths[0])
  })
  ipcMain.handle('laps:library', () => discoverFiles(defaultMotecFolder()))
  ipcMain.handle('laps:describe', (_event, filePath) => {
    if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.ld') return null
    return summary(filePath)
  })
  ipcMain.handle('laps:load', (_event, filePath, lapIndex) => {
    if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.ld') throw new Error('Only MoTeC .ld files can be loaded.')
    return parseLap(filePath, lapIndex)
  })
  ipcMain.handle('setup:get', () => {
    const setupPath = readState().setupPath
    if (!setupPath) return { setup: null, error: '' }
    try { return { setup: parseSetup(setupPath), error: '' } }
    catch (error) { return { setup: null, error: error.message } }
  })
  ipcMain.handle('setup:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import ACC setup',
      defaultPath: setupFolder(),
      properties: ['openFile'],
      filters: [{ name: 'ACC setup files', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const setup = parseSetup(result.filePaths[0])
    const state = readState()
    state.setupPath = result.filePaths[0]
    writeState(state)
    return setup
  })
  ipcMain.handle('setup:clear', () => {
    const state = readState()
    delete state.setupPath
    writeState(state)
  })
  ipcMain.handle('setup:pending-feedback', () => readState().setupFeedbackQueue[0] || null)
  ipcMain.handle('setup:submit-feedback', (_event, { sessionId, issue, tyres }) => {
    const state = readState()
    const feedback = state.setupFeedbackQueue.find((entry) => entry.id === sessionId)
    if (!feedback) throw new Error('This session feedback has already been completed.')
    const setupsRoot = setupFolder()
    const sourcePath = findSetupTemplate({
      setupsRoot,
      car: feedback.car,
      track: feedback.track,
      preferredPath: state.setupPath,
    })
    if (!sourcePath) throw new Error(`No ACC setup was found for ${feedback.car}. Import a setup for this car, then try again.`)
    const result = createSetupVariant({
      sourcePath,
      setupsRoot,
      car: feedback.car,
      track: feedback.track,
      issue,
      tyres,
    })
    state.setupPath = result.setup.path
    state.setupFeedbackQueue = state.setupFeedbackQueue.filter((entry) => entry.id !== sessionId)
    writeState(state)
    return result
  })
  ipcMain.handle('setup:dismiss-feedback', (_event, sessionId) => {
    const state = readState()
    state.setupFeedbackQueue = state.setupFeedbackQueue.filter((entry) => entry.id !== sessionId)
    writeState(state)
  })
  ipcMain.handle('preferences:get', () => {
    const state = readState()
    return {
      preferredPath: state.preferredPath === undefined
        ? (fs.existsSync(defaultReferencePath()) ? defaultReferencePath() : '')
        : state.preferredPath,
      preferredLapIndex: Number.isInteger(state.preferredLapIndex) ? state.preferredLapIndex : undefined,
      overrides: state.overrides || {},
    }
  })
  ipcMain.handle('preferences:save', (_event, preferences) => {
    const state = readState()
    state.preferredPath = preferences.preferredPath || ''
    state.preferredLapIndex = Number.isInteger(preferences.preferredLapIndex) ? preferences.preferredLapIndex : 0
    state.overrides = preferences.overrides || {}
    writeState(state)
    return { preferredPath: state.preferredPath, preferredLapIndex: state.preferredLapIndex, overrides: state.overrides }
  })
  ipcMain.handle('sectors:get', () => readState().bestSectors)
  ipcMain.handle('sectors:save', (_event, entry) => {
    const state = readState()
    const key = `${entry.track}|${entry.car}`
    const current = state.bestSectors[key] || [Infinity, Infinity, Infinity]
    state.bestSectors[key] = current.map((value, index) => Math.min(value, Number(entry.sectors[index]) || Infinity))
    writeState(state)
    return state.bestSectors
  })
  createWindow()
  live = createLive({
    electron, readState, writeState, library: allLaps, parseLap, loadRenderer,
    preloadPath: path.join(__dirname, 'preload.cjs'), getMainWindow: () => mainWindow,
  })
  live.start()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('will-quit', () => { if (live) live.stop() })

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })