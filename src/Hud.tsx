import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import './hud.css'

const SIZE = 300
const C = SIZE / 2
const RING = 130
const GHOST = 109
const WARN_R = 145
const OFF_LIMIT = 15
const FAR_LIMIT = 40
const ORANGE = '#ff8c1a'
const RPM_WARN = 0.9
const RPM_REDLINE = 0.96

const DEMO: LiveFrame = {
  state: 'active',
  speedKmh: 187,
  gear: 5,
  rpm: 6900,
  maxRpm: 7700,
  throttle: { you: 72, ref: 88 },
  brake: { you: 35, ref: 60, warn: 80 },
}

type Side = 'left' | 'right'

// Each half circle runs from 6 o'clock (0%) up its own side to 12 o'clock (100%).
function point(side: Side, t: number, radius: number) {
  const angle = ((side === 'right' ? 90 - t * 180 : 90 + t * 180) * Math.PI) / 180
  return { x: C + radius * Math.cos(angle), y: C + radius * Math.sin(angle) }
}

function arc(side: Side, t: number, radius: number) {
  if (t < 0.005) return ''
  const end = point(side, Math.min(t, 1), radius)
  return `M${C} ${C + radius} A${radius} ${radius} 0 0 ${side === 'right' ? 0 : 1} ${end.x} ${end.y}`
}

// Keeps a warning on screen briefly after the trigger window ends so the eye can catch it.
function useHeld(value: number | undefined, holdMs = 700) {
  const [held, setHeld] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (value && value > 0) {
      setHeld(value)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { timer.current = undefined; setHeld(0) }, holdMs)
    }
  }, [value, holdMs])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return held
}

function useLive() {
  const [frame, setFrame] = useState<LiveFrame | null>(null)
  const [status, setStatus] = useState<LiveStatus | null>(null)
  useEffect(() => {
    void window.fastrack.liveStatus().then(setStatus)
    const offFrame = window.fastrack.onLiveFrame(setFrame)
    const offStatus = window.fastrack.onLiveStatus(setStatus)
    return () => { offFrame(); offStatus() }
  }, [])
  return { frame, status }
}

function PedalArc({ side, reading, color, showReference }: { side: Side; reading: PedalReading; color: string; showReference: boolean }) {
  const you = Math.max(0, Math.min(1, reading.you / 100))
  const ref = Math.max(0, Math.min(1, reading.ref / 100))
  const gap = Math.abs(reading.you - reading.ref)
  const off = gap > OFF_LIMIT
  if (showReference) color = blend(color, gap)
  const tickInner = point(side, ref, RING - 15)
  const tickOuter = point(side, ref, RING + 11)
  const knob = point(side, you, RING)
  return <g>
    <path d={arc(side, 1, RING)} className="hud-arc-bg" />
    {showReference && <path d={arc(side, ref, GHOST)} className="hud-arc-ghost" />}
    <path d={arc(side, you, RING)} className="hud-arc-fill" style={{ stroke: color }} />
    {showReference && <line x1={tickInner.x} y1={tickInner.y} x2={tickOuter.x} y2={tickOuter.y} className={`hud-ideal${off ? ' off' : ''}`} />}
    {you > 0.01 && <circle cx={knob.x} cy={knob.y} r="9" className="hud-knob" style={{ fill: color }} />}
  </g>
}

function WarnArc({ side, warn, color }: { side: Side; warn?: number; color: string }) {
  if (!warn || warn < 1) return null
  const tip = point(side, Math.min(1, warn / 100), WARN_R)
  return <g className="hud-warn">
    <path d={arc(side, Math.min(1, warn / 100), WARN_R)} pathLength={1} className="hud-warn-arc" style={{ stroke: color }} />
    <circle cx={tip.x} cy={tip.y} r="6" style={{ fill: color }} />
  </g>
}

const gearLabel = (gear: number) => (gear === 0 ? 'R' : gear === 1 ? 'N' : String(gear - 1))

const RPM_R = 86
const RPM_START = 215
const RPM_SWEEP = 110

function rpmPoint(t: number, radius: number) {
  const angle = ((RPM_START + t * RPM_SWEEP) * Math.PI) / 180
  return { x: C + radius * Math.cos(angle), y: C + radius * Math.sin(angle) }
}

function rpmArc(t: number) {
  if (t < 0.005) return ''
  const start = rpmPoint(0, RPM_R)
  const end = rpmPoint(Math.min(t, 1), RPM_R)
  return `M${start.x} ${start.y} A${RPM_R} ${RPM_R} 0 0 1 ${end.x} ${end.y}`
}

function RpmArc({ rpm, maxRpm }: { rpm: number; maxRpm: number }) {
  if (!(maxRpm > 0)) return null
  const t = Math.max(0, Math.min(1, rpm / maxRpm))
  const level = t >= RPM_REDLINE ? 'red' : t >= RPM_WARN ? 'yellow' : 'normal'
  const marker = (at: number) => ({ a: rpmPoint(at, RPM_R - 9), b: rpmPoint(at, RPM_R + 9) })
  const warn = marker(RPM_WARN)
  return <g>
    <path d={rpmArc(1)} className="hud-rpm-bg" />
    <path d={rpmArc(t)} className={`hud-rpm-fill ${level}`} />
    <line x1={warn.a.x} y1={warn.a.y} x2={warn.b.x} y2={warn.b.y} className="hud-rpm-mark" />
  </g>
}

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

// Full colour when the driver matches the reference, blending to orange as the gap approaches FAR_LIMIT.
function blend(color: string, gap: number) {
  const mix = Math.max(0, Math.min(1, gap / FAR_LIMIT))
  const from = hexToRgb(color)
  const to = hexToRgb(ORANGE)
  return `rgb(${from.map((value, index) => Math.round(value + (to[index] - value) * mix)).join(',')})`
}

function tireColor(temperature: number) {
  if (temperature < 60) return '#3fc8ff'
  if (temperature < 100) return '#34c759'
  if (temperature < 115) return '#ffd60a'
  return '#ff3b30'
}

function TireTile({ label, x, y, pressure, temperature }: { label: string; x: number; y: number; pressure?: number; temperature?: number }) {
  const color = temperature == null ? '#465052' : tireColor(temperature)
  const barWidth = temperature == null ? 0 : Math.max(2, Math.min(42, (temperature - 40) / 80 * 42))
  return <g>
    <rect x={x} y={y} width="78" height="34" rx="5" className="hud-tire-tile" />
    <text x={x + 7} y={y + 12} className="hud-tire-label">{label}</text>
    <rect x={x + 30} y={y + 6} width="42" height="5" rx="2.5" className="hud-tire-temp-bg" />
    <rect x={x + 30} y={y + 6} width={barWidth} height="5" rx="2.5" fill={color} />
    <text x={x + 7} y={y + 26} className="hud-tire-pressure">{pressure == null ? '—' : pressure.toFixed(1)} PSI</text>
    {temperature != null && <title>{label}: {temperature.toFixed(0)}°C core temperature</title>}
  </g>
}

export function HudGauge({ frame, showReference = true }: { frame: LiveFrame | null; showReference?: boolean }) {
  const shown = frame?.state === 'active' ? frame : null
  const message = frame?.state === 'noReference' ? 'No reference lap\nfor this car and track' : frame?.state === 'paused' ? 'Paused' : 'Waiting for ACC'
  const throttle = shown?.throttle ?? { you: 0, ref: 0 }
  const brake = shown?.brake ?? { you: 0, ref: 0 }
  const brakeWarn = useHeld(brake.warn)
  const throttleWarn = useHeld(throttle.warn)
  const tyres = shown?.tyres
  const fuel = shown?.fuelLiters
  const fuelBlocks = fuel == null ? 0 : Math.min(10, Math.floor(fuel / 5))

  return <svg className="hud-gauge" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
    aria-label={shown ? `Speed ${Math.round(shown.speedKmh ?? 0)} kilometers per hour` : message.replace('\n', ' ')}>
    <circle cx={C} cy={C} r="150" className="hud-disk" />
    {shown ? <>
      <g transform={`translate(${C} ${C}) scale(.78) translate(-${C} -${C})`}>
        <text x={C} y={C + 48} textAnchor="middle" className="hud-gear">{shown.gear == null ? '—' : gearLabel(shown.gear)}</text>
        <PedalArc side="left" reading={brake} color="#ff3b30" showReference={showReference} />
        <PedalArc side="right" reading={throttle} color="#34c759" showReference={showReference} />
        {showReference && <>
          <WarnArc side="left" warn={brakeWarn} color={blend('#ff3b30', Math.abs(brake.you - brake.ref))} />
          <WarnArc side="right" warn={throttleWarn} color={blend('#34c759', Math.abs(throttle.you - throttle.ref))} />
        </>}
        <RpmArc rpm={shown.rpm ?? 0} maxRpm={shown.maxRpm ?? 0} />
        <g textAnchor="middle">
          <text x={C} y={226} className="hud-speed">{Math.round(shown.speedKmh ?? 0)}</text>
          <text x={C} y={240} className="hud-small">KM/H</text>
        </g>
      </g>
      {fuel != null && Number.isFinite(fuel) && <>
        <text x={C} y="9" textAnchor="middle" className="hud-fuel-label">FUEL {fuel.toFixed(1)} L</text>
        {Array.from({ length: 10 }, (_, index) => <rect key={index} x={105 + index * 9} y="13" width="7" height="4" rx="1"
          className={index < fuelBlocks ? (fuel < 10 ? 'hud-fuel-block low' : 'hud-fuel-block filled') : 'hud-fuel-block'} />)}
      </>}
      {tyres && [0, 1, 2, 3].map((index) => <TireTile key={index} label={['FL', 'FR', 'RL', 'RR'][index]}
        x={index % 2 === 0 ? 8 : 214} y={index < 2 ? 22 : 244}
        pressure={tyres.pressuresPsi[index]} temperature={tyres.coreTempsC[index]} />)}
    </> : <>
      <path d={arc('left', 1, RING)} className="hud-arc-bg" />
      <path d={arc('right', 1, RING)} className="hud-arc-bg" />
      {message.split('\n').map((line, index) => <text key={line} x={C} y={C + index * 18} textAnchor="middle" className="hud-small">{line}</text>)}
    </>}
  </svg>
}

export default function Hud() {
  const { frame, status } = useLive()
  const [scale, setScale] = useState(1)
  const grip = useRef<{ x: number; width: number } | null>(null)
  const edit = Boolean(status?.hud.edit)
  const windowed = status?.settings.hudMode === 'window'
  const showReference = status?.settings.coachMarkers !== false
  const shownFrame = frame?.state === 'active' ? frame : edit ? DEMO : frame

  useEffect(() => {
    document.documentElement.classList.add('hud-page')
    const resize = () => setScale(Math.min(window.innerWidth, window.innerHeight) / SIZE)
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    grip.current = { x: event.screenX, width: window.innerWidth }
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (grip.current) void window.fastrack.resizeHud(grip.current.width + event.screenX - grip.current.x)
  }

  return <div className={`hud-root${edit ? ' editing' : ''}${windowed ? ' windowed' : ''}`} style={{ width: SIZE, height: SIZE, transform: `scale(${scale})` }}>
    <HudGauge frame={shownFrame} showReference={showReference} />
    {edit && <div className="hud-grip" onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={() => { grip.current = null }} />}
  </div>
}
