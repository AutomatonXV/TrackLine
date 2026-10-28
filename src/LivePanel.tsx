import { useEffect, useRef, useState } from 'react'
import { CircleCheck, Gauge, MoveRight, Radio, RotateCcw, Trash2, Upload, X } from 'lucide-react'

const seconds = (value: number) => {
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value - minutes * 60).toFixed(3).padStart(6, '0')}`
}

const wheelNames = ['FL', 'FR', 'RL', 'RR']
const quizIssues: { key: SetupIssue; title: string; caption: string; icon: typeof MoveRight }[] = [
  { key: 'entryUndersteer', title: 'Front pushes wide', caption: 'Understeer on corner entry', icon: MoveRight },
  { key: 'entryOversteer', title: 'Rear steps out', caption: 'Oversteer on corner entry', icon: RotateCcw },
  { key: 'midUndersteer', title: 'Won’t hold the line', caption: 'Understeer mid-corner', icon: MoveRight },
  { key: 'midOversteer', title: 'Rear rotates too much', caption: 'Oversteer mid-corner', icon: RotateCcw },
  { key: 'exitUndersteer', title: 'Runs wide under power', caption: 'Understeer on corner exit', icon: MoveRight },
  { key: 'exitOversteer', title: 'Rear spins on exit', caption: 'Oversteer under acceleration', icon: RotateCcw },
  { key: 'brakingStability', title: 'Unstable under braking', caption: 'Not enough confidence slowing down', icon: Gauge },
  { key: 'tyrePressure', title: 'Tyre pressure or temperature', caption: 'Enter the in-game readings for a pressure check', icon: Gauge },
  { key: 'balanced', title: 'Felt balanced', caption: 'Save an unchanged baseline copy', icon: CircleCheck },
]
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const normalizeTrack = (value: string) => {
  const track = normalize(value)
  if (track.startsWith('nurburgring')) return 'nurburgring'
  if (track.startsWith('spa')) return 'spa'
  return track
}

function setupMatches(setup: SetupSummary, car: string, track: string) {
  return normalize(setup.car) === normalize(car) && normalizeTrack(setup.track) === normalizeTrack(track)
}

export default function LivePanel() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<LiveStatus | null>(null)
  const [frame, setFrame] = useState<LiveFrame | null>(null)
  const [setup, setSetup] = useState<SetupSummary | null>(null)
  const [setupError, setSetupError] = useState('')
  const [setupBusy, setSetupBusy] = useState(false)
  const [feedback, setFeedback] = useState<SetupFeedback | null>(null)
  const [feedbackIssue, setFeedbackIssue] = useState<SetupIssue | null>(null)
  const [feedbackPressures, setFeedbackPressures] = useState(['', '', '', ''])
  const [feedbackTemperatures, setFeedbackTemperatures] = useState(['', '', '', ''])
  const [feedbackConditions, setFeedbackConditions] = useState<'dry' | 'wet'>('dry')
  const [feedbackResult, setFeedbackResult] = useState<SetupVariant | null>(null)
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [feedbackError, setFeedbackError] = useState('')
  const pressureHistory = useRef<{ at: number; values: number[] }[]>([])

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
    let active = true
    const show = (next: SetupFeedback | null) => {
      if (!active || !next) return
      setFeedback(next)
      setFeedbackIssue(null)
      setFeedbackPressures(['', '', '', ''])
      setFeedbackTemperatures(['', '', '', ''])
      setFeedbackConditions('dry')
      setFeedbackResult(null)
      setFeedbackError('')
    }
    void window.fastrack.getPendingSetupFeedback().then(show).catch((error: unknown) => {
      setFeedbackError(error instanceof Error ? error.message : String(error))
    })
    const off = window.fastrack.onSetupFeedback(show)
    return () => { active = false; off() }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    pressureHistory.current = []
    return window.fastrack.onLiveFrame((nextFrame) => {
      const pressures = nextFrame.tyres?.pressuresPsi
      const now = performance.now()
      const previous = pressureHistory.current.at(-1)
      if (pressures?.length === 4 && pressures.every((value) => Number.isFinite(value) && value > 0)
        && (!previous || now - previous.at >= 900)) {
        pressureHistory.current.push({ at: now, values: pressures })
      }
      pressureHistory.current = pressureHistory.current.filter(({ at }) => now - at <= 8000)
      setFrame(nextFrame)
    })
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
  const saveFeedback = async () => {
    if (!feedback || !feedbackIssue) return
    const tyres = feedbackIssue === 'tyrePressure' ? {
      pressuresPsi: feedbackPressures.map(Number),
      temperaturesC: feedbackTemperatures.map(Number),
      conditions: feedbackConditions,
    } : undefined
    if (tyres && (tyres.pressuresPsi.some((value, index) => !feedbackPressures[index].trim() || !Number.isFinite(value) || value < 20 || value > 40)
      || tyres.temperaturesC.some((value, index) => !feedbackTemperatures[index].trim() || !Number.isFinite(value) || value < 0 || value > 160))) {
      setFeedbackError('Enter an in-game pressure (20–40 psi) and temperature (0–160°C) for all four tyres.')
      return
    }
    setFeedbackBusy(true)
    setFeedbackError('')
    try {
      const result = await window.fastrack.submitSetupFeedback(feedback.id, feedbackIssue, tyres)
      setFeedbackResult(result)
      setSetup(result.setup)
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : String(error))
    } finally {
      setFeedbackBusy(false)
    }
  }
  const finishFeedback = async (dismiss = false) => {
    if (!feedback) return
    try {
      if (dismiss) await window.fastrack.dismissSetupFeedback(feedback.id)
      const next = await window.fastrack.getPendingSetupFeedback()
      setFeedback(next)
      setFeedbackIssue(null)
      setFeedbackResult(null)
      setFeedbackError('')
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : String(error))
    }
  }
  const connected = Boolean(status?.connected)
  const lateral = frame?.lateral
  const tyres = frame?.tyres
  const nissanReference = feedback && normalize(feedback.car) === 'nissangtrgt32018'
    && normalizeTrack(feedback.track) === 'monza'
  const matchingSetup = Boolean(setup && connected && status && setupMatches(setup, status.car, status.track))
  const tyresWarm = Boolean(tyres && tyres.coreTempsC.length === 4 && tyres.coreTempsC.every((temp) => Number.isFinite(temp) && temp >= 80))
  const pressureSamples = pressureHistory.current
  const tyresStable = pressureSamples.length >= 6
    && pressureSamples.at(-1)!.at - pressureSamples[0].at >= 5000
    && wheelNames.every((_, index) => {
      const readings = pressureSamples.map(({ values }) => values[index])
      return Math.max(...readings) - Math.min(...readings) <= 0.3
    })

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
      <section className="setup-section">
        <div className="setup-title"><b>Setup feedback</b>
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
        {connected && <div className="setup-telemetry">
          <b>Live tyres</b>
          {tyres ? <div className="tyre-grid">{wheelNames.map((wheel, index) => {
            const pressure = tyres.pressuresPsi[index]
            const temp = tyres.coreTempsC[index]
            const valid = Number.isFinite(pressure) && Number.isFinite(temp) && pressure > 0
            const suggestedDelta = Math.max(-1, Math.min(1, 26.6 - pressure))
            const suggestion = valid && tyresWarm && tyresStable && matchingSetup
              ? pressure < 26 ? `Next run: +${suggestedDelta.toFixed(1)} psi starting pressure` : pressure > 27.2 ? `Next run: ${suggestedDelta.toFixed(1)} psi starting pressure` : 'In dry target range'
              : null
            return <div key={wheel} className="tyre-cell">
              <b>{wheel}</b>
              <span>{valid ? `${pressure.toFixed(1)} psi` : '—'}</span>
              <small>{valid ? `${Math.round(temp)}°C core` : 'No reading'}</small>
              {setup && <small>ACC value {setup.pressureValues[index]}</small>}
              {suggestion && <small className="tyre-advice">{suggestion}</small>}
            </div>
          })}</div> : <p className="live-hint">Waiting for ACC tyre telemetry.</p>}
          {tyres && !matchingSetup && <p className="live-hint">Import a setup for this exact car and track to get next-run pressure suggestions.</p>}
          {tyres && matchingSetup && !tyresWarm && <p className="live-hint">Wait until all tyre core temperatures reach 80°C before using pressure guidance.</p>}
          {tyres && matchingSetup && tyresWarm && !tyresStable && <p className="live-hint">Waiting for pressures to stabilize (at least 5 seconds of readings within 0.3 psi).</p>}
          <p className="live-hint">Dry baseline: 26–27.2 psi hot. Suggestions estimate a small starting-pressure change for the next run; confirm conditions and the car’s current ACC target. Core temperatures are not tread-surface readings, so they cannot guide camber.</p>
        </div>}
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
    {feedback && <div className="feedback-backdrop">
      <section className="feedback-card" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <button className="feedback-close" onClick={() => void finishFeedback(true)} title="Skip this session"><X size={16} /></button>
        {feedbackResult ? <>
          <div className="feedback-success"><CircleCheck size={26} /></div>
          <p className="feedback-kicker">SETUP SAVED</p>
          <h2 id="feedback-title">Your next test is ready</h2>
          <p>{feedbackResult.change}. {feedbackResult.description}</p>
          <p className="feedback-path">{feedbackResult.setup.path}</p>
          <button className="feedback-primary" onClick={() => void finishFeedback()}>Done</button>
        </> : <>
          <p className="feedback-kicker">POST-SESSION SETUP QUIZ</p>
          <h2 id="feedback-title">How did the {feedback.car} feel?</h2>
          <p className="feedback-session">{feedback.track} · {Math.floor(feedback.durationSeconds / 60)} min · {feedback.completedLaps} completed laps · max {feedback.maxSpeedKmh} km/h</p>
          <p>Where in the corner did you notice the main handling issue? We’ll save a separate copy with one small change; your original stays untouched.</p>
          {nissanReference && <p className="nissan-reference">
            Nissan GT-R 2018 reference: a community setup labelled ACC v1.10 for Monza lists raw setup values of front/rear anti-roll bar 4/2, brake bias 36 and differential preload 0. This is a track-specific comparison, not a universal target; your imported setup remains the starting point.
            {' '}<a href="https://github.com/Lon3035/ACC_Setups/blob/11f41f9bba08e4ed39566e2be6ac893651e2f09b/nissan_gt_r_gt3_2018/monza/FRI3_GTR18_BASE_v1.10.json" target="_blank" rel="noreferrer">View the community v1.10 reference</a>.
          </p>}
          <div className="feedback-options">
            {quizIssues.map(({ key, icon: Icon, title, caption }) =>
              <button key={key} className={`feedback-option${feedbackIssue === key ? ' selected' : ''}`} onClick={() => setFeedbackIssue(key)}>
                <Icon size={22} /><b>{title}</b><small>{caption}</small>
              </button>)}
          </div>
          {feedbackIssue === 'tyrePressure' && <div className="quiz-tyre-readings">
            <div className="quiz-conditions" role="group" aria-label="Track conditions">
              <span>CONDITIONS</span>
              <button className={feedbackConditions === 'dry' ? 'selected' : ''} onClick={() => setFeedbackConditions('dry')}>Dry · GT3 target 26–27.2 psi</button>
              <button className={feedbackConditions === 'wet' ? 'selected' : ''} onClick={() => setFeedbackConditions('wet')}>Wet · GT3 target 30–31 psi</button>
            </div>
            <p>Enter the in-game hot pressure and tyre temperature shown for each wheel. Temperatures help flag when pressure is not the only issue.</p>
            <div className="quiz-tyre-grid">
              {wheelNames.map((wheel, index) => <div key={wheel}>
                <b>{wheel}</b>
                <label>Pressure (psi)<input aria-label={`${wheel} in-game pressure PSI`} type="number" min="20" max="40" step="0.1" value={feedbackPressures[index]}
                  onChange={(event) => setFeedbackPressures((values) => values.map((value, current) => current === index ? event.target.value : value))} /></label>
                <label>Temp (°C)<input aria-label={`${wheel} in-game temperature Celsius`} type="number" min="0" max="160" step="1" value={feedbackTemperatures[index]}
                  onChange={(event) => setFeedbackTemperatures((values) => values.map((value, current) => current === index ? event.target.value : value))} /></label>
              </div>)}
            </div>
            <small>GT3 pressure changes are capped at ±1 psi per tyre and use the imported setup’s native pressure increments. Other car classes are saved without pressure changes because their native pressure scale may differ. If any tyre is outside 70–100°C, TrackLine also skips pressure changes and recommends checking warm-up/conditions first.</small>
          </div>}
          {feedbackError && <p className="live-warn">{feedbackError}</p>}
          <div className="feedback-actions">
            <button className="setup-icon" onClick={() => void importSetup()}>Import setup for this car</button>
            <button className="feedback-primary" onClick={() => void saveFeedback()} disabled={!feedbackIssue || feedbackBusy}>{feedbackBusy ? 'Saving…' : 'Create next setup'}</button>
          </div>
          <p className="feedback-note">One conservative change at a time. This is a starting point, not a telemetry diagnosis—test it and keep whichever setup feels better.</p>
          <button className="feedback-skip" onClick={() => void finishFeedback(true)}>Skip this session</button>
        </>}
      </section>
    </div>}
  </div>
}
