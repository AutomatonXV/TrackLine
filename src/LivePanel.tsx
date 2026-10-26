import { useEffect, useState } from 'react'
import { Radio } from 'lucide-react'

const seconds = (value: number) => {
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value - minutes * 60).toFixed(3).padStart(6, '0')}`
}

export default function LivePanel() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<LiveStatus | null>(null)
  const [frame, setFrame] = useState<LiveFrame | null>(null)

  useEffect(() => {
    void window.fastrack.liveStatus().then(setStatus)
    return window.fastrack.onLiveStatus(setStatus)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    return window.fastrack.onLiveFrame(setFrame)
  }, [open])

  const save = (patch: Partial<LiveStatus['settings']>) => void window.fastrack.saveLiveSettings(patch).then(setStatus)
  const connected = Boolean(status?.connected)
  const lateral = frame?.lateral

  return <div className="live">
    <button className={`live-button${connected ? ' on' : ''}`} onClick={() => setOpen((value) => !value)} title="Live coaching">
      <Radio size={14} /> LIVE <i className="live-dot" />
    </button>
    {open && status && <div className="live-panel">
      <div className="live-head"><b>{connected ? 'ACC connected' : 'Waiting for ACC'}</b><span>{connected ? 'Streaming' : 'Start a session in ACC'}</span></div>
      {connected && <dl>
        <dt>Car</dt><dd>{status.car}</dd>
        <dt>Track</dt><dd>{status.track}</dd>
        <dt>Reference</dt><dd>{status.reference ? `${seconds(status.reference.lapTime)} · ${status.reference.name}` : status.referenceError || '—'}</dd>
        <dt>Line</dt><dd>{!status.reference ? '—' : status.calibrated ? 'Calibrated' : lateral?.status === 'calibrating' ? `Calibrating (${Math.round((lateral.progress ?? 0) * 100)}%)` : 'Calibrating — drive a full lap'}</dd>
        {frame?.state === 'active' && <><dt>Throttle</dt><dd>{Math.round(frame.throttle?.you ?? 0)}% vs {Math.round(frame.throttle?.ref ?? 0)}%</dd>
          <dt>Brake</dt><dd>{Math.round(frame.brake?.you ?? 0)}% vs {Math.round(frame.brake?.ref ?? 0)}%</dd></>}
      </dl>}
      {!connected && <button className="live-action" onClick={() => void window.fastrack.reconnectAcc().then(setStatus)}>Retry ACC connection</button>}
      {status.accError && <p className="live-warn">{status.accError}</p>}
      <label><input type="checkbox" checked={status.settings.hudEnabled} onChange={(event) => save({ hudEnabled: event.target.checked })} /> Show HUD (Ctrl+Alt+H)</label>
      <label>HUD mode
        <select value={status.settings.hudMode} onChange={(event) => save({ hudMode: event.target.value as 'overlay' | 'window' })}>
          <option value="overlay">Overlay on game (Borderless/Windowed)</option>
          <option value="window">Normal window (second monitor)</option>
        </select>
      </label>
      {status.settings.hudMode === 'overlay' && <button className="live-action" onClick={() => void window.fastrack.toggleHudEdit().then(setStatus)}>{status.hud.edit ? 'Lock HUD layout' : 'Edit HUD layout'} (Ctrl+Alt+E)</button>}
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
  </div>
}
