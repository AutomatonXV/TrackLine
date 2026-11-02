import { useEffect, useState } from 'react'
import { CircleCheck, Upload, X } from 'lucide-react'

type Choice = { value: string; label: string }
type Question = { key: Exclude<keyof TuneAnswers, 'tyres'>; title: string; hint?: string; choices: Choice[] }
type Section = { title: string; caption: string; questions: Question[] }

const feel: Choice[] = [
  { value: 'ok', label: 'Fine' },
  { value: 'understeer', label: 'Front pushes wide' },
  { value: 'oversteer', label: 'Rear steps out' },
]

const sections: Section[] = [
  {
    title: 'Handling balance',
    caption: 'Pick what you noticed. Leave anything you are unsure about on “Fine”.',
    questions: [
      { key: 'entry', title: 'Turn-in and corner entry', choices: feel },
      { key: 'mid', title: 'Mid-corner (at the apex)', choices: feel },
      { key: 'exit', title: 'Corner exit (on throttle)', choices: feel },
      {
        key: 'speed', title: 'Where is the mid-corner problem worst?',
        hint: 'Only matters if you flagged mid-corner. High speed adjusts rear wing; low speed adds tips.',
        choices: [{ value: 'low', label: 'Slow corners' }, { value: 'high', label: 'Fast corners' }, { value: 'both', label: 'Everywhere' }],
      },
    ],
  },
  {
    title: 'Brakes',
    caption: 'Brake bias and cooling.',
    questions: [
      {
        key: 'braking', title: 'Under braking',
        choices: [{ value: 'ok', label: 'Fine' }, { value: 'rearLocks', label: 'Rear unstable / locks' }, { value: 'frontLocks', label: 'Front locks' }],
      },
      {
        key: 'brakeTemp', title: 'Brake temperatures',
        choices: [{ value: 'ok', label: 'In range' }, { value: 'hot', label: 'Too hot / fading' }, { value: 'cold', label: 'Too cold' }],
      },
    ],
  },
  {
    title: 'Platform and aero',
    caption: 'Kerbs, bumps and straight-line speed.',
    questions: [
      {
        key: 'kerbs', title: 'Over kerbs and bumps',
        choices: [{ value: 'ok', label: 'Fine' }, { value: 'unsettled', label: 'Car gets unsettled' }, { value: 'bottoming', label: 'Scraping / bottoming' }],
      },
      {
        key: 'straights', title: 'Straight-line speed vs. downforce',
        choices: [{ value: 'ok', label: 'Happy' }, { value: 'draggy', label: 'Too slow on straights' }, { value: 'needsDownforce', label: 'Need more downforce' }],
      },
    ],
  },
]

const wheelNames = ['FL', 'FR', 'RL', 'RR']

export default function TuneHelper({ car, track, setup, onSetup, onClose }: {
  car: string
  track: string
  setup: SetupSummary | null
  onSetup: (setup: SetupSummary) => void
  onClose: () => void
}) {
  const [answers, setAnswers] = useState<TuneAnswers>({})
  const [useTyres, setUseTyres] = useState(false)
  const [conditions, setConditions] = useState<'dry' | 'wet'>('dry')
  const [pressures, setPressures] = useState(['', '', '', ''])
  const [temps, setTemps] = useState(['', '', '', ''])
  const [spreads, setSpreads] = useState(['', ''])
  const [result, setResult] = useState<TuneResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState<SetupCandidates | null>(null)
  const [sourcePath, setSourcePath] = useState('')

  const loadCandidates = async () => {
    const next = await window.fastrack.setupCandidates({ car, track })
    setInfo(next)
    setSourcePath(next.selectedPath ?? '')
  }
  useEffect(() => { void loadCandidates() }, [car, track]) // eslint-disable-line react-hooks/exhaustive-deps

  const target = info && info.car ? { car: info.car, track: info.track } : null
  const changed = Object.entries(answers).filter(([key, value]) => key !== 'speed' && value !== 'ok').length > 0 || useTyres
  const choose = (key: Question['key'], value: string) =>
    setAnswers((current) => ({ ...current, [key]: current[key] === value ? undefined : value }))

  const importSetup = async () => {
    try {
      const selected = await window.fastrack.importSetup()
      if (selected) { onSetup(selected); setError(''); await loadCandidates() }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const build = async () => {
    const payload: TuneAnswers = { ...answers }
    if (useTyres) {
      const psi = pressures.map(Number)
      const celsius = temps.map(Number)
      if (psi.some((value, index) => !pressures[index].trim() || !Number.isFinite(value) || value < 20 || value > 40)
        || celsius.some((value, index) => !temps[index].trim() || !Number.isFinite(value) || value < 0 || value > 160)) {
        setError('Enter hot pressure (20–40 psi) and core temperature (0–160°C) for all four tyres, or switch the tyre check off.')
        return
      }
      const spread = (text: string) => (text.trim() ? Number(text) : undefined)
      payload.tyres = {
        pressuresPsi: psi, temperaturesC: celsius, conditions,
        frontSpreadC: spread(spreads[0]), rearSpreadC: spread(spreads[1]),
      }
    }
    setBusy(true)
    setError('')
    try {
      const next = await window.fastrack.tuneSetup({ car: target?.car ?? '', track: target?.track ?? '', answers: payload, sourcePath: sourcePath || undefined })
      setResult(next)
      onSetup(next.setup)
      await loadCandidates()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return <div className="feedback-backdrop">
    <section className="feedback-card tune-card" role="dialog" aria-modal="true" aria-labelledby="tune-title">
      <button className="feedback-close" onClick={onClose} title="Close"><X size={16} /></button>
      {result ? <>
        <div className="feedback-success"><CircleCheck size={26} /></div>
        <p className="feedback-kicker">NEW SETUP SAVED</p>
        <h2 id="tune-title">Your next test is ready</h2>
        {result.changes.length > 0 && <ul className="tune-list">{result.changes.map((line) => <li key={line}>{line}</li>)}</ul>}
        {result.skipped.length > 0 && <>
          <p className="tune-sub">Not applied</p>
          <ul className="tune-list muted">{result.skipped.map((line) => <li key={line}>{line}</li>)}</ul></>}
        {result.advice.length > 0 && <>
          <p className="tune-sub">Do these by hand in the garage</p>
          <ul className="tune-list">{result.advice.map((line) => <li key={line}>{line}</li>)}</ul></>}
        <p className="feedback-path">{result.setup.path}</p>
        <div className="feedback-actions">
          <button className="setup-icon" onClick={() => setResult(null)}>Tune again from this setup</button>
          <button className="feedback-primary" onClick={onClose}>Done</button>
        </div>
      </> : <>
        <p className="feedback-kicker">TUNE HELPER</p>
        <h2 id="tune-title">What does the car need?</h2>
        <p className="feedback-session">{target ? `${target.car} · ${target.track}` : 'No car selected'}</p>
        <p>Answer what you felt. Each answer maps to one conservative click, based on the ACC setup guides. A new copy is saved and your original stays untouched. Opposite answers cancel out.</p>
        {!target && <p className="live-warn">Import a setup (or connect to ACC) so Tune Helper knows the car and track.</p>}
        <div className="tune-base">
          <span className="tune-sub">BASE SETUP — WE COPY AND IMPROVE THIS ONE</span>
          {info && info.candidates.length > 0 ? <select value={sourcePath} onChange={(event) => setSourcePath(event.target.value)}>
            {info.candidates.map((entry) => <option key={entry.path} value={entry.path}>
              {entry.name} · {entry.track}{entry.sameTrack ? '' : ' (other track)'} · {new Date(entry.modified).toLocaleString()}
            </option>)}
          </select> : <p className="live-warn">{info?.error || 'No ACC setup found for this car. Import one below.'}</p>}
          <small>ACC does not report which setup is loaded, so the newest one for this car and track is preselected. Pick the one you are driving, or import a file. TrackLine-made copies appear here too, so tuning again builds on your last copy.</small>
        </div>
        {sections.map((section) => <div key={section.title} className="tune-section">
          <h3>{section.title}</h3>
          <p className="tune-caption">{section.caption}</p>
          {section.questions.map((question) => <div key={question.key} className="tune-question">
            <span>{question.title}</span>
            <div className="tune-choices" role="group" aria-label={question.title}>
              {question.choices.map((choice) => <button key={choice.value} type="button"
                className={answers[question.key] === choice.value ? 'selected' : ''}
                onClick={() => choose(question.key, choice.value)}>{choice.label}</button>)}
            </div>
            {question.hint && <small>{question.hint}</small>}
          </div>)}
        </div>)}
        <div className="tune-section">
          <h3>Tyres <small>(optional)</small></h3>
          <label className="tune-toggle"><input type="checkbox" checked={useTyres} onChange={(event) => setUseTyres(event.target.checked)} /> I have in-game hot pressures and temperatures</label>
          {useTyres && <div className="quiz-tyre-readings">
            <div className="quiz-conditions" role="group" aria-label="Track conditions">
              <span>CONDITIONS</span>
              <button className={conditions === 'dry' ? 'selected' : ''} onClick={() => setConditions('dry')}>Dry · target 26–27.2 psi</button>
              <button className={conditions === 'wet' ? 'selected' : ''} onClick={() => setConditions('wet')}>Wet · target 30–31 psi</button>
            </div>
            <div className="quiz-tyre-grid">
              {wheelNames.map((wheel, index) => <div key={wheel}>
                <b>{wheel}</b>
                <label>Pressure (psi)<input aria-label={`${wheel} pressure PSI`} type="number" min="20" max="40" step="0.1" value={pressures[index]}
                  onChange={(event) => setPressures((values) => values.map((value, current) => current === index ? event.target.value : value))} /></label>
                <label>Core temp (°C)<input aria-label={`${wheel} temperature Celsius`} type="number" min="0" max="160" step="1" value={temps[index]}
                  onChange={(event) => setTemps((values) => values.map((value, current) => current === index ? event.target.value : value))} /></label>
              </div>)}
            </div>
            <div className="quiz-tyre-grid tune-spreads">
              <div><label>Front inside − outside (°C)<input type="number" step="1" value={spreads[0]} onChange={(event) => setSpreads(([, rear]) => [event.target.value, rear])} /></label></div>
              <div><label>Rear inside − outside (°C)<input type="number" step="1" value={spreads[1]} onChange={(event) => setSpreads(([front]) => [front, event.target.value])} /></label></div>
            </div>
            <small>Pit-screen I/M/O temperatures. Guide limits: front ≤ 9°C, rear ≤ 5°C difference. Pressure changes are capped at ±1 psi and only for GT3 cars with temperatures in 70–100°C.</small>
          </div>}
        </div>
        {error && <p className="live-warn">{error}</p>}
        <div className="feedback-actions">
          <button className="setup-icon" onClick={() => void importSetup()}><Upload size={13} /> {setup ? 'Change base setup' : 'Import base setup'}</button>
          <button className="feedback-primary" onClick={() => void build()} disabled={!target || busy}>{busy ? 'Saving…' : changed ? 'Create tuned setup' : 'Save unchanged copy'}</button>
        </div>
        <p className="feedback-note">Test one tune at a time. Sources: Patagonia Sim Racing ACC parameter guide and Trinacria Sim Racing beginner guide.</p>
      </>}
    </section>
  </div>
}
