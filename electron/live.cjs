const { AccReader } = require('./acc.cjs')
const { Coach } = require('./coach.cjs')
const { pickFastest, buildTable } = require('./reference.cjs')
const { SessionRecorder } = require('./session-recorder.cjs')

const HUD_ASPECT = 1
const HUD_SIZE = 300
const DEFAULT_SETTINGS = { hudEnabled: true, hudMode: 'overlay', coachMarkers: true, swapLR: false, leadSeconds: 0.25, voiceEnabled: true, voiceVolume: 0.8, cooldownSeconds: 1.5 }
const SEND_INTERVAL_MS = 30

function createLive({ electron, readState, writeState, library, parseLap, preloadPath, loadRenderer, getMainWindow }) {
  const { BrowserWindow, globalShortcut, ipcMain, screen } = electron
  const reader = new AccReader()
  const coach = new Coach()
  const sessionRecorder = new SessionRecorder()
  let hud = null
  let editMode = false
  let saveTimer = null
  let lastSent = 0
  let context = { car: '', track: '' }
  let reference = null
  let referenceError = ''
  let accError = ''

  const settings = () => ({ ...DEFAULT_SETTINGS, ...(readState().live || {}) })
  const update = (patch) => {
    const state = readState()
    state.live = { ...(state.live || {}), ...patch }
    writeState(state)
  }

  function status() {
    const current = settings()
    return {
      connected: reader.connected,
      car: context.car,
      track: context.track,
      reference: reference ? { path: reference.path, name: reference.name, lapTime: reference.lapTime, lapIndex: reference.lapIndex } : null,
      referenceError,
      accError,
      calibrated: Boolean(coach.cal && coach.cal.rms <= 40),
      settings: { hudEnabled: current.hudEnabled, hudMode: current.hudMode, coachMarkers: current.coachMarkers, swapLR: current.swapLR, leadSeconds: current.leadSeconds, voiceEnabled: current.voiceEnabled, voiceVolume: current.voiceVolume, cooldownSeconds: current.cooldownSeconds, hudSize: hud && !hud.isDestroyed() ? hud.getBounds().width : (current.hudBounds?.width ?? HUD_SIZE) },
      hud: { visible: Boolean(hud && !hud.isDestroyed() && hud.isVisible()), edit: editMode },
    }
  }

  function broadcast(channel, payload) {
    for (const win of [getMainWindow(), hud]) if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  const sendStatus = () => broadcast('live:status', status())

  function saveFeedback(feedback) {
    if (!feedback) return
    const state = readState()
    state.setupFeedbackQueue = [...(state.setupFeedbackQueue || []), feedback]
    writeState(state)
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('setup:feedback', feedback)
  }

  function finishSession(now = Date.now()) { saveFeedback(sessionRecorder.finish(now)) }

  function selectReference(frame) {
    context = { car: frame.carModel, track: frame.track }
    reference = null
    referenceError = ''
    coach.setReference(null)
    const pick = pickFastest(library(), frame.carModel, frame.track)
    if (!pick) { referenceError = 'No library lap matches this car and track.'; return }
    try {
      const lap = parseLap(pick.path, pick.lapIndex)
      const table = buildTable(lap)
      if (!table) throw new Error('Reference lap has no usable distance data.')
      reference = { ...pick, calibrationKey: `${pick.path}#${pick.lapIndex}` }
      coach.setReference(table)
      const saved = (settings().calibrations || {})[reference.calibrationKey]
      if (saved) coach.setCalibration(saved)
    } catch (error) {
      referenceError = error.message
    }
  }

  coach.onCalibrated = (cal) => {
    if (!reference) return
    update({ calibrations: { ...(settings().calibrations || {}), [reference.calibrationKey]: cal } })
    sendStatus()
  }
  coach.onHand = (rightIsCounterClockwise) => update({ rightIsCounterClockwise })

  reader.on('error', (error) => { accError = error.message })
  reader.on('connection', (connected) => {
    if (!connected) { finishSession(); context = { car: '', track: '' }; reference = null; referenceError = ''; coach.setReference(null) }
    syncHud()
    sendStatus()
  })
  reader.on('frame', (frame) => {
    if (frame.status === 'live') saveFeedback(sessionRecorder.update(frame, frame.t))
    else if (frame.status !== 'pause') finishSession(frame.t)
    if (frame.carModel !== context.car || frame.track !== context.track) {
      selectReference(frame)
      syncHud()
      sendStatus()
    }
    const now = Date.now()
    const output = coach.update(frame, now)
    if (!output.cue && now - lastSent < SEND_INTERVAL_MS) return
    lastSent = now
    broadcast('live:frame', {
      ...output,
      tyres: { pressuresPsi: frame.tyrePressuresPsi, coreTempsC: frame.tyreCoreTempsC },
      t: now,
    })
  })

  function defaultBounds() {
    const { workArea } = screen.getPrimaryDisplay()
    const width = HUD_SIZE
    const height = Math.round(width * HUD_ASPECT)
    return { width, height, x: Math.round(workArea.x + (workArea.width - width) / 2), y: Math.round(workArea.y + workArea.height - height - 60) }
  }

  function saveBounds() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { if (hud && !hud.isDestroyed()) update({ hudBounds: hud.getBounds() }) }, 300)
  }

  function createHud() {
    const overlay = settings().hudMode === 'overlay'
    const saved = settings().hudBounds
    const squareEnough = saved && Math.abs(saved.width / saved.height - HUD_ASPECT) < 0.05
    const bounds = squareEnough ? saved : defaultBounds()
    hud = new BrowserWindow({
      ...bounds, show: false, title: 'Fastrack HUD', frame: !overlay, transparent: overlay,
      backgroundColor: overlay ? '#00000000' : '#101314', hasShadow: false, resizable: !overlay, skipTaskbar: overlay,
      focusable: !overlay, alwaysOnTop: overlay, autoHideMenuBar: true, minWidth: 180, minHeight: 180,
      webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    if (overlay) {
      hud.setAlwaysOnTop(true, 'screen-saver')
      hud.setIgnoreMouseEvents(true)
    }
    hud.on('move', saveBounds)
    hud.on('resize', saveBounds)
    hud.on('closed', () => { hud = null; editMode = false; sendStatus() })
    loadRenderer(hud, '/hud')
  }

  function destroyHud() {
    if (hud && !hud.isDestroyed()) hud.destroy()
    hud = null
    editMode = false
  }

  function applyEditMode() {
    if (!hud || hud.isDestroyed() || settings().hudMode !== 'overlay') return
    hud.setIgnoreMouseEvents(!editMode)
    hud.setFocusable(editMode)
  }

  // The overlay follows the connection: shown while ACC is feeding data (or while editing its layout).
  function syncHud() {
    const wanted = settings().hudEnabled && (reader.connected || editMode)
    if (!wanted) { if (hud && !hud.isDestroyed() && hud.isVisible()) hud.hide(); return }
    if (!hud) createHud()
    if (!hud.isVisible()) hud.showInactive()
    if (settings().hudMode === 'overlay') hud.setAlwaysOnTop(true, 'screen-saver')
  }

  function toggleEdit() {
    editMode = !editMode
    if (editMode && !settings().hudEnabled) update({ hudEnabled: true })
    syncHud()
    applyEditMode()
    sendStatus()
  }

  function toggleVisible() {
    const enabled = !settings().hudEnabled
    update({ hudEnabled: enabled })
    if (!enabled) editMode = false
    syncHud()
    sendStatus()
  }

  function saveSettings(patch) {
    const next = {}
    if (typeof patch.hudEnabled === 'boolean') next.hudEnabled = patch.hudEnabled
    if (patch.hudMode === 'overlay' || patch.hudMode === 'window') next.hudMode = patch.hudMode
    if (typeof patch.coachMarkers === 'boolean') next.coachMarkers = patch.coachMarkers
    if (typeof patch.swapLR === 'boolean') next.swapLR = patch.swapLR
    if (Number.isFinite(patch.leadSeconds)) next.leadSeconds = Math.max(0.05, Math.min(1, patch.leadSeconds))
    if (typeof patch.voiceEnabled === 'boolean') next.voiceEnabled = patch.voiceEnabled
    if (Number.isFinite(patch.voiceVolume)) next.voiceVolume = Math.max(0, Math.min(1, patch.voiceVolume))
    if (Number.isFinite(patch.cooldownSeconds)) next.cooldownSeconds = Math.max(1, Math.min(2, patch.cooldownSeconds))
    if (Number.isFinite(patch.hudSize)) {
      const size = Math.round(Math.max(180, Math.min(900, patch.hudSize)))
      if (hud && !hud.isDestroyed()) {
        const bounds = hud.getBounds()
        hud.setBounds({ x: bounds.x, y: bounds.y, width: size, height: Math.round(size * HUD_ASPECT) })
      } else if (settings().hudBounds) {
        update({ hudBounds: { ...settings().hudBounds, width: size, height: Math.round(size * HUD_ASPECT) } })
      }
    }
    const modeChanged = next.hudMode && next.hudMode !== settings().hudMode
    update(next)
    coach.setSwap(settings().swapLR)
    coach.setLead(settings().leadSeconds)
    coach.setCooldown(settings().cooldownSeconds)
    if (modeChanged) { destroyHud(); update({ hudBounds: undefined }) }
    if (!settings().hudEnabled) editMode = false
    syncHud()
    sendStatus()
    return status()
  }

  function start() {
    const savedHand = settings().rightIsCounterClockwise
    if (typeof savedHand === 'boolean') coach.setHand(savedHand)
    coach.setSwap(settings().swapLR)
    coach.setLead(settings().leadSeconds)
    coach.setCooldown(settings().cooldownSeconds)
    ipcMain.handle('live:status', () => status())
    ipcMain.handle('live:reconnect', () => { accError = ''; reader.reconnect(); return status() })
    ipcMain.handle('live:settings', (_event, patch) => saveSettings(patch || {}))
    ipcMain.handle('live:toggleEdit', () => { toggleEdit(); return status() })
    ipcMain.handle('live:resizeHud', (_event, width) => {
      if (!hud || hud.isDestroyed() || !Number.isFinite(width)) return
      const w = Math.round(Math.max(180, Math.min(900, width)))
      const bounds = hud.getBounds()
      hud.setBounds({ x: bounds.x, y: bounds.y, width: w, height: Math.round(w * HUD_ASPECT) })
    })
    globalShortcut.register('CommandOrControl+Alt+H', toggleVisible)
    globalShortcut.register('CommandOrControl+Alt+E', toggleEdit)
    reader.start()
  }

  function stop() {
    globalShortcut.unregisterAll()
    finishSession()
    reader.stop()
    clearTimeout(saveTimer)
  }

  return { start, stop, status }
}

module.exports = { createLive, HUD_ASPECT }
