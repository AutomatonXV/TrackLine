import { useEffect, useState } from 'react'
import { Radio, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import TuneHelper from './TuneHelper'

const seconds = (value: number) => {
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value - minutes * 60).toFixed(3).padStart(6, '0')}`
}

const wheelNames = ['FL', 'FR', 'RL', 'RR']

export default function LivePanel() {
  const [open, setOpen] = useState(false)
  const [tuneOpen, setTuneOpen] = useState(false)
  const [status, setStatus] = useState<LiveStatus | null>(null)
  const [frame, setFrame] = useState<LiveFrame | null>(null)
  const [setup, setSetup] = useState<SetupSummary | null>(null)
  const [setupError, setSetupError] = useState('')
  const [setupBusy, setSetupBusy] = useState(false)

  useEffect(() => {
    void window.fastrack.liveStatus().then(setStatus)
    return window.fastrack.onLiveStatus(setStatus)
  }, [])

  useEffect(() => {
    void window.fastrack.getSetup().then(({ setup: saved, error }) => {
      setSetup(saved)
      setSetupError(error)
    }).catch((error: unknown) => {
      setSetupError(error instanceof Error ? error.message : String(error))
    })
  }, [])

  useEffect(() => {
    if (!open) return undefined
    return window.fastrack.onLiveFrame(setFrame)
  }, [open])

  const save = (patch: Partial<LiveStatus['settings']>) => void window.fastrack.saveLiveSettings(patch).then(setStatus)
  const importSetup = async () => {
    setSetupBusy(true)
    setSetupError('')
    try {
      const selected = await window.fastrack.importSetup()
      if (selected) setSetup(selected)
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error))
    } finally {
      setSetupBusy(false)
    }
  }
  const clearSetup = async () => {
    try {
      await window.fastrack.clearSetup()
      setSetup(null)
      setSetupError('')
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error))
    }
  }
  const connected = Boolean(status?.connected)
  const lateral = frame?.lateral

  return <div className="live">
    <div className="live-bar">
      <button className="live-button" onClick={() => setTuneOpen(true)} title="Build a new setup from a few questions">
        <SlidersHorizontal size={14} /> TUNE HELPER
      </button>
      <button className={`live-button${connected ? ' on' : ''}`} onClick={() => setOpen((value) => !value)} title="Live coaching">
        <Radio size={14} /> LIVE <i className="live-dot" />
      </button>
    </div>
    {open && status && <div className="live-panel">
      <div className="live-head"><b>{connected ? 'ACC connected' : 'Waiting for ACC'}</b><span>{connected ? 'Streaming' : 'Start a session in ACC'}</span></div>
      {connected && <dl>
        <dt>Car</dt><dd>{status.car}</dd>
        <dt>Track</dt><dd>{status.track}</dd>
        <dt>Reference</dt><dd>{status.reference ? `${seconds(status.reference.lapTime)} · ${status.reference.name}` : status.referenceError || '—'}</dd>
        <dt>Line</dt><dd>{!status.reference ? '—' : status.calibrated ? 'Calibrated' : lateral?.status === 'calibrating' ? `Calibrating (${Math.round((lateral.progress ?? 0) * 100)}%)` : 'Calibrating — drive a full lap'}</dd>
        {frame?.state === 'active' && frame.hasReference !== false && <><dt>Throttle</dt><dd>{Math.round(frame.throttle?.you ?? 0)}% vs {Math.round(frame.throttle?.ref ?? 0)}%</dd>
          <dt>Brake</dt><dd>{Math.round(frame.brake?.you ?? 0)}% vs {Math.round(frame.brake?.ref ?? 0)}%</dd></>}
      </dl>}
      {!connected && <button className="live-action" onClick={() => void window.fastrack.reconnectAcc().then(setStatus)}>Retry ACC connection</button>}
      {status.accError && <p className="live-warn">{status.accError}</p>}
      <section className="setup-section">
        <div className="setup-title"><b>Setup</b>
          <div>
            <button className="setup-icon" onClick={() => void importSetup()} disabled={setupBusy} title="Import ACC setup JSON"><Upload size={13} /> {setupBusy ? 'Loading…' : setup ? 'Change setup' : 'Import setup'}</button>
            {setup && <button className="setup-icon" onClick={() => void clearSetup()} title="Clear imported setup"><Trash2 size={13} /></button>}
          </div>
        </div>
        {setup && <p className="setup-summary">{setup.name} · {setup.car} · {setup.track}</p>}
        {setup && <><div className="setup-pressures">{wheelNames.map((wheel, index) =>
          <span key={wheel}>{wheel} <b>{setup.pressureValues[index]}</b></span>)}</div>
          <p className="live-hint">ACC native pressure values (car-specific encoding), not PSI.</p></>}
        {setupError && <p className="live-warn">{setupError}</p>}
      </section>
      <label><input type="checkbox" checked={status.settings.hudEnabled} onChange={(event) => save({ hudEnabled: event.target.checked })} /> Show HUD (Ctrl+Alt+H)</label>
      <label>HUD mode
        <select value={status.settings.hudMode} onChange={(event) => save({ hudMode: event.target.value as 'overlay' | 'window' })}>
          <option value="overlay">Overlay on game (Borderless/Windowed)</option>
          <option value="window">Normal window (second monitor)</option>
        </select>
      </label>
      {status.settings.hudMode === 'overlay' && <button className="live-action" onClick={() => void window.fastrack.toggleHudEdit().then(setStatus)}>{status.hud.edit ? 'Lock HUD layout' : 'Edit HUD layout'} (Ctrl+Alt+E)</button>}
      <label><input type="checkbox" checked={status.settings.coachMarkers} onChange={(event) => save({ coachMarkers: event.target.checked })} /> Show coaching reference markers</label>
      <label>HUD size ({status.settings.hudSize}px)
        <input type="range" min="180" max="600" step="10" value={status.settings.hudSize} onChange={(event) => save({ hudSize: Number(event.target.value) })} />
      </label>
      <label><input type="checkbox" checked={status.settings.swapLR} onChange={(event) => save({ swapLR: event.target.checked })} /> Swap left/right guidance</label>
      <label>Warning lead time (s)
        <input type="number" min="0.05" max="1" step="0.05" value={status.settings.leadSeconds} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0.05 && value <= 1) save({ leadSeconds: value }) }} />
      </label>
      <label>Text callout cooldown (s)
        <input type="number" min="1" max="2" step="0.5" value={status.settings.cooldownSeconds} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 1 && value <= 2) save({ cooldownSeconds: value }) }} />
      </label>
      <p className="live-hint">Overlays cannot draw above exclusive fullscreen. Set ACC to Borderless or Windowed, or use the normal-window mode.</p>
    </div>}
    {tuneOpen && <TuneHelper
      car={connected ? status?.car ?? '' : ''}
      track={connected ? status?.track ?? '' : ''}
      setup={setup}
      onSetup={setSetup}
      onClose={() => setTuneOpen(false)}
    />}
  </div>
}
