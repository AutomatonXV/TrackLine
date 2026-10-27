import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Activity, ChevronLeft, ChevronRight, Crosshair, FileUp, Map, Navigation, Minus, Pause, Play, Plus, TriangleAlert, X } from 'lucide-react'
import { fitToTrack, hasTrackModel } from './trackMap'
import { sectorMarkers } from './data/sectors'
import LivePanel from './LivePanel'
import Preflight from './Preflight'
import { indexAtTime, useLiveRun } from './useLiveRun'
import './app.css'

const N = 480
const SLOW = '#ff3b30'
const FAST = '#34c759'
const NEUTRAL = '#9aa0aa'
const tracks = ['Monza', 'Spa-Francorchamps', 'Nürburgring GP']
const cars = ['McLaren 720S GT3 Evo', 'Nissan GT-R Nismo GT3']

type SlotKey = 'ref' | 'mine'
interface Slot { summary: LapSummary; lapIndex: number; lap: ParsedLap | null; error?: string }
interface Proj extends LapSample { px: number; py: number }

function seconds(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '--:--.---'
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value - minutes * 60).toFixed(3).padStart(6, '0')}`
}

const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(3)}s`

function normalizedName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function trackLabel(name: string) {
  const normalized = normalizedName(name)
  if (normalized.includes('nurburgring')) return 'Nürburgring GP'
  if (normalized.includes('spa')) return 'Spa-Francorchamps'
  if (normalized.includes('monza')) return 'Monza'
  return tracks.find((track) => normalizedName(track) === normalized) || name
}

function carLabel(name: string) {
  const normalized = normalizedName(name)
  if (normalized.includes('mclaren') || normalized.includes('720')) return cars[0]
  if (normalized.includes('nissan') || normalized.includes('gtr') || normalized.includes('gt r')) return cars[1]
  return cars.find((car) => normalizedName(car) === normalized) || name
}

const identity = (summary: LapSummary) => ({ car: carLabel(summary.car), track: trackLabel(summary.track) })

function interpolate(samples: LapSample[], ratio: number): LapSample {
  if (!samples.length) return { distance: 0, time: 0, speed: 0, throttle: 0, brake: 0, x: null, y: null }
  const firstDistance = samples[0].distance
  const lastDistance = samples[samples.length - 1].distance
  let lower: number
  let upper: number
  let amount: number
  if (lastDistance > firstDistance) {
    const target = firstDistance + (lastDistance - firstDistance) * ratio
    upper = 1
    while (upper < samples.length - 1 && samples[upper].distance < target) upper += 1
    lower = upper - 1
    amount = (target - samples[lower].distance) / Math.max(0.000001, samples[upper].distance - samples[lower].distance)
  } else {
    const position = ratio * (samples.length - 1)
    lower = Math.floor(position)
    upper = Math.min(samples.length - 1, lower + 1)
    amount = position - lower
  }
  amount = Math.max(0, Math.min(1, amount))
  const first = samples[lower]
  const second = samples[upper]
  const mix = (a: number, b: number) => a + (b - a) * amount
  return {
    distance: mix(first.distance, second.distance), time: mix(first.time, second.time),
    speed: mix(first.speed, second.speed), throttle: mix(first.throttle, second.throttle),
    brake: mix(first.brake, second.brake),
    x: first.x == null || second.x == null ? null : mix(first.x, second.x),
    y: first.y == null || second.y == null ? null : mix(first.y, second.y),
  }
}

// Resampled by distance so index i is the same place on track for every lap.
const resample = (lap: ParsedLap) => Array.from({ length: N }, (_, index) => interpolate(lap.samples, index / (N - 1)))

// Rotates the trace so the opening straight always points the same direction,
// which keeps the map orientation identical between logs of the same track.
function orient(points: LapSample[], source: ParsedLap['positionSource']) {
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null
  let xs = points.map((point) => point.x as number)
  const ys = points.map((point) => point.y as number)
  if (source === 'measured' && Math.max(...ys.map(Math.abs)) <= 90 && Math.max(...xs.map(Math.abs)) <= 180) {
    const scale = Math.cos((ys.reduce((sum, value) => sum + value, 0) / ys.length) * Math.PI / 180)
    xs = xs.map((value) => value * scale)
  }
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9)
  let k = 1
  while (k < 60 && Math.hypot(xs[k] - xs[0], ys[k] - ys[0]) < extent * 0.05) k += 1
  const heading = Math.atan2(ys[k] - ys[0], xs[k] - xs[0])
  const cos = Math.cos(-heading)
  const sin = Math.sin(-heading)
  return xs.map((x, index) => {
    const dx = x - xs[0]
    const dy = ys[index] - ys[0]
    return { x: xs[0] + dx * cos - dy * sin, y: ys[0] + dx * sin + dy * cos }
  })
}

function fracAtTime(points: LapSample[], time: number, lo: number, hi: number) {
  const target = Math.min(time, points[hi].time)
  let low = lo
  let high = hi
  while (low < high) {
    const middle = (low + high) >> 1
    if (points[middle].time >= target) high = middle
    else low = middle + 1
  }
  if (low <= lo) return lo
  const span = points[low].time - points[low - 1].time
  return low - 1 + (span > 0 ? (target - points[low - 1].time) / span : 0)
}

function lerpAt<T>(values: T[], fraction: number, read: (value: T) => number) {
  const lower = Math.max(0, Math.min(values.length - 1, Math.floor(fraction)))
  const upper = Math.min(values.length - 1, lower + 1)
  return read(values[lower]) + (read(values[upper]) - read(values[lower])) * (fraction - lower)
}

const polyline = (points: Proj[] | null, from: number, to: number) =>
  points ? points.slice(from, to + 1).map((point) => `${point.px.toFixed(1)},${point.py.toFixed(1)}`).join(' ') : ''

function Chart({ title, field, refPoints, minePoints, from, to, mineColor, refFrac, mineFrac, onScrub }: {
  title: string; field: 'throttle' | 'brake' | 'speed'; refPoints: LapSample[] | null; minePoints: LapSample[] | null
  from: number; to: number; mineColor: string; refFrac: number; mineFrac: number; onScrub: (index: number) => void
}) {
  const span = Math.max(1, to - from)
  const read = (point: LapSample) => field === 'speed' ? point.speed * 3.6 : point[field]
  const peak = Math.max(0, ...[refPoints, minePoints].flatMap((points) => points ? points.slice(from, to + 1).map(read) : []))
  const top = field === 'speed' ? Math.max(50, Math.ceil(peak / 50) * 50) : 100
  const step = field === 'speed' ? (top > 250 ? 100 : 50) : 50
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, index) => index * step)
  const unit = field === 'speed' ? 'km/h' : '%'
  const valueAt = (points: LapSample[] | null, fraction: number) => points ? Math.round(lerpAt(points, fraction, read)) : null
  const scrub = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
    onScrub(Math.round(from + fraction * span))
  }
  const path = (points: LapSample[] | null) => points
    ? points.slice(from, to + 1).map((point, index) => `${(index / span) * 300},${100 - Math.max(0, Math.min(top, read(point))) / top * 100}`).join(' ')
    : ''
  const cursor = (fraction: number) => ((fraction - from) / span) * 300
  const base = refPoints ?? minePoints
  return <div className="chart">
    <div className="chart-title">
      <span>{title} <em>{unit}</em></span>
      <small>
        {refPoints && <b style={{ color: '#fff' }}>{valueAt(refPoints, refFrac)} </b>}
        {minePoints && <b style={{ color: mineColor }}>{valueAt(minePoints, mineFrac)} </b>}
        {base ? `${Math.round(base[from].distance)}–${Math.round(base[to].distance)} m` : ''}
      </small>
    </div>
    <div className="chart-body">
      <div className="chart-axis">{ticks.map((value) => <span key={value} style={{ bottom: `${value / top * 100}%` }}>{value}</span>)}</div>
      <svg viewBox="0 0 300 100" preserveAspectRatio="none"
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); scrub(event) }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) scrub(event) }}>
        {ticks.map((value) => <line key={value} x1="0" x2="300" y1={100 - value / top * 100} y2={100 - value / top * 100} className="chart-grid" />)}
        <polyline points={path(refPoints)} className="chart-line" style={{ stroke: '#ffffff' }} />
        <polyline points={path(minePoints)} className="chart-line" style={{ stroke: mineColor }} />
        {refPoints && <line x1={cursor(refFrac)} x2={cursor(refFrac)} y1="0" y2="100" className="chart-cursor" style={{ stroke: '#ffffff' }} />}
        {minePoints && <line x1={cursor(mineFrac)} x2={cursor(mineFrac)} y1="0" y2="100" className="chart-cursor" style={{ stroke: mineColor }} />}
      </svg>
    </div>
  </div>
}

// Label that keeps a constant screen size while the map zooms.
function Tag({ x, y, nx, ny, zoom, lines }: { x: number; y: number; nx: number; ny: number; zoom: number; lines: { text: string; cls?: string }[] }) {
  const width = Math.max(...lines.map((line) => line.text.length)) * 7 + 12
  const height = lines.length * 15 + 6
  // The box sits fully on the outward side of the anchor so it never covers the track.
  const dx = nx * 10 - width * (1 - nx) / 2
  const dy = ny * 10 - height * (1 - ny) / 2
  return <g transform={`translate(${x} ${y}) scale(${1 / zoom}) translate(${dx} ${dy})`} pointerEvents="none">
    <rect className="tag-bg" x="0" y="0" width={width} height={height} rx="4" />
    {lines.map((line, i) => <text key={i} className={`tag-text ${line.cls ?? ''}`} x="6" y={15 + i * 15} fontSize="12">{line.text}</text>)}
  </g>
}

// Track-up chase view: the map rotates so the focus car always points up.
function Minimap({ edges, refGeo, mineGeo, refFrac, mineFrac, segments, mineColor, unitsPerMeter, onClose }: {
  edges: { left: string; right: string } | null; refGeo: Proj[] | null; mineGeo: Proj[] | null; refFrac: number; mineFrac: number
  segments: { key: number; points: string; color: string }[] | null; mineColor: string; unitsPerMeter: number; onClose: () => void
}) {
  const [size, setSize] = useState({ w: 150, h: 165 })
  const [zoom, setZoom] = useState(1)
  const resize = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const focus = mineGeo ?? refGeo
  const fraction = mineGeo ? mineFrac : refFrac
  if (!focus) return null
  const x = (points: Proj[], f: number) => lerpAt(points, f, (point) => point.px)
  const y = (points: Proj[], f: number) => lerpAt(points, f, (point) => point.py)
  const heading = Math.atan2(y(focus, fraction + 3) - y(focus, fraction - 3), x(focus, fraction + 3) - x(focus, fraction - 3)) * 180 / Math.PI
  const cx = x(focus, fraction)
  const cy = y(focus, fraction)
  // Perpendicular distance from the car to the nearest stretch of an edge.
  const gap = (edge: string) => {
    const pts = edge.split(' ').map((pair) => pair.split(',').map(Number))
    let best = Infinity
    for (let i = 1; i < pts.length; i += 1) {
      const [ax, ay] = pts[i - 1]
      const [bx, by] = pts[i]
      const dx = bx - ax
      const dy = by - ay
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / Math.max(dx * dx + dy * dy, 1e-9)))
      best = Math.min(best, Math.hypot(ax + dx * t - cx, ay + dy * t - cy))
    }
    return best
  }
  const trackMetres = edges ? Math.max(6, (gap(edges.left) + gap(edges.right)) / unitsPerMeter) : 14
  const W = size.w
  const H = size.h - 22
  // At zoom 1 the track is wider than the window, so the cars fill the view.
  const scale = W * 0.5 / (trackMetres * unitsPerMeter) * zoom
  const px = (value: number) => value / scale
  const carWidth = 2 * unitsPerMeter
  const nudge = (factor: number) => setZoom((value) => Math.max(0.25, Math.min(8, value * factor)))
  return <div className="minimap" style={{ width: size.w, height: size.h }}>
    <div className="minimap-head">
      <span>TRACK-UP</span>
      <span className="mini-tools">
        <button aria-label="Zoom in" onClick={() => nudge(1.25)}><Plus size={12} /></button>
        <button aria-label="Zoom out" onClick={() => nudge(0.8)}><Minus size={12} /></button>
        <button aria-label="Reset zoom" title="Reset zoom" onClick={() => setZoom(1)}><Crosshair size={12} /></button>
        <button aria-label="Close track-up view" onClick={onClose}><X size={12} /></button>
      </span>
    </div>
    <svg viewBox={`0 0 ${W} ${H}`} onWheel={(event) => nudge(event.deltaY < 0 ? 1.12 : 0.89)}>
      <g transform={`translate(${W / 2} ${H * 0.7}) rotate(${-90 - heading}) scale(${scale}) translate(${-cx} ${-cy})`}>
        {edges && <>
          <path d={`M${edges.left}Z M${edges.right}Z`} className="track-fill" fillRule="evenodd" />
          <polyline points={edges.left} className="mini-edge" style={{ strokeWidth: px(1.5) }} />
          <polyline points={edges.right} className="mini-edge" style={{ strokeWidth: px(1.5) }} />
        </>}
        {refGeo && <polyline points={polyline(refGeo, 0, N - 1)} className="mini-line" style={{ stroke: '#fff', strokeWidth: carWidth, opacity: .55 }} />}
        {mineGeo && (segments
          ? segments.map((segment) => <polyline key={segment.key} points={segment.points} className="mini-line" style={{ stroke: segment.color, strokeWidth: carWidth, opacity: .55 }} />)
          : <polyline points={polyline(mineGeo, 0, N - 1)} className="mini-line" style={{ stroke: NEUTRAL, strokeWidth: carWidth, opacity: .55 }} />)}
        {refGeo && <circle cx={x(refGeo, refFrac)} cy={y(refGeo, refFrac)} r={carWidth / 2} fill="#fff" stroke="#101314" strokeWidth={px(1)} />}
        {mineGeo && <circle cx={x(mineGeo, mineFrac)} cy={y(mineGeo, mineFrac)} r={carWidth / 2} fill={mineColor} stroke="#101314" strokeWidth={px(1)} />}
      </g>
    </svg>
    <div className="mini-resize" title="Drag to resize"
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); resize.current = { x: event.clientX, y: event.clientY, w: size.w, h: size.h } }}
      onPointerMove={(event) => {
        const start = resize.current
        if (!start) return
        setSize({ w: Math.max(100, Math.min(700, start.w - (event.clientX - start.x))), h: Math.max(110, Math.min(700, start.h + (event.clientY - start.y))) })
      }}
      onPointerUp={() => { resize.current = null }} />
  </div>
}

function SlotCard({ label, swatch, slot, onPick, onClear, onLap, onDropFiles }: {
  label: string; swatch: string; slot: Slot | null; onPick: () => void; onClear: () => void; onLap: (index: number) => void; onDropFiles: (files: File[]) => void
}) {
  const key = label === 'REFERENCE' ? 'ref' : 'mine'
  const [over, setOver] = useState(false)
  const hasFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes('Files')
  if (!slot) return <button data-slot={key} className={`slot slot-empty ${over ? 'over' : ''}`} onClick={onPick}
    onDragOver={(event) => { if (hasFiles(event)) { event.preventDefault(); setOver(true) } }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => { if (!hasFiles(event)) return; event.preventDefault(); setOver(false); onDropFiles(Array.from(event.dataTransfer.files)) }}>
    <i style={{ background: swatch }} /><span><small>{label}</small><b>Open or drop .ld file</b></span><FileUp size={15} /></button>
  const count = Math.max(1, slot.summary.lapTimes?.length || 1)
  return <div className="slot" data-slot={key}>
    <i style={{ background: swatch }} />
    <span className="slot-copy"><small>{label}</small><b title={slot.summary.path}>{slot.summary.name}</b></span>
    <div className="stepper">
      {count > 1 && <button aria-label="Previous lap" disabled={slot.lapIndex <= 0} onClick={() => onLap(slot.lapIndex - 1)}><ChevronLeft size={13} /></button>}
      <span>{count > 1 ? `LAP ${slot.lapIndex + 1}/${count}` : 'LAP'}<small>{seconds(slot.summary.lapTimes?.[slot.lapIndex] ?? slot.summary.lapTime)}</small></span>
      {count > 1 && <button aria-label="Next lap" disabled={slot.lapIndex >= count - 1} onClick={() => onLap(slot.lapIndex + 1)}><ChevronRight size={13} /></button>}
    </div>
    <button className="slot-action" title={`Replace ${label.toLowerCase()}`} onClick={onPick}><FileUp size={14} /></button>
    <button className="slot-action" title={`Clear ${label.toLowerCase()}`} onClick={onClear}><X size={14} /></button>
  </div>
}

export default function App() {
  const [preflight, setPreflight] = useState(false)
  const [slots, setSlots] = useState<Record<SlotKey, Slot | null>>({ ref: null, mine: null })
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null)
  const [picks, setPicks] = useState<number[]>([])
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState({ x: 0, y: 0 })
  const [playT, setPlayT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [showLoss, setShowLoss] = useState(false)
  const [pane, setPane] = useState(360)
  const paneDrag = useRef<{ x: number; w: number } | null>(null)
  const [showMini, setShowMini] = useState(true)
  const svgRef = useRef<SVGSVGElement>(null)
  const groupRef = useRef<SVGGElement>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean; handle: number | null; car: boolean } | null>(null)
  const timeRef = useRef(0)

  const ref = slots.ref?.lap ?? null
  const mine = slots.mine?.lap ?? null

  const loadSlot = async (key: SlotKey, summary: LapSummary, lapIndex: number) => {
    setSlots((current) => ({ ...current, [key]: { summary, lapIndex, lap: null } }))
    const update = (patch: Partial<Slot>) => setSlots((current) => {
      const slot = current[key]
      return slot && slot.summary.path === summary.path && slot.lapIndex === lapIndex ? { ...current, [key]: { ...slot, ...patch } } : current
    })
    try { update({ lap: await window.fastrack.loadLap(summary.path, lapIndex) }) }
    catch { update({ error: 'This lap could not be read.' }) }
  }

  const acceptSummary = (key: SlotKey, summary: LapSummary) => {
    if (summary.error) { setNotice({ title: "This file can't be read", body: `${summary.name} isn't a usable MoTeC log: ${summary.track}` }); return }
    const other = slots[key === 'ref' ? 'mine' : 'ref']
    if (other) {
      const a = identity(summary)
      const b = identity(other.summary)
      const wrongCar = a.car !== b.car
      const wrongTrack = a.track !== b.track
      if (wrongCar || wrongTrack) {
        const which = key === 'ref' ? 'reference' : 'my'
        const title = wrongCar && wrongTrack ? 'Different car and track' : wrongCar ? 'Different cars' : 'Different tracks'
        const detail = wrongCar && wrongTrack
          ? `The ${which} lap is ${a.car} at ${a.track}, but the other lap is ${b.car} at ${b.track}.`
          : wrongCar
            ? `The ${which} lap is the ${a.car}, but the other lap is the ${b.car}. Both laps must use the same car.`
            : `The ${which} lap was set at ${a.track}, but the other lap was set at ${b.track}. Both laps must be on the same track.`
        setNotice({ title, body: `${detail} Clear the other lap first if you want to switch.` })
        return
      }
    }
    setNotice(null)
    setPicks([])
    void loadSlot(key, summary, summary.fastestLapIndex ?? 0)
  }

  const pickSlot = async (key: SlotKey) => {
    const summary = await window.fastrack.pickLap()
    if (summary) acceptSummary(key, summary)
  }

  const dropOnSlot = async (key: SlotKey, files: File[]) => {
    const file = files.find((item) => item.name.toLowerCase().endsWith('.ld'))
    if (!file) { setNotice({ title: 'Wrong file type', body: 'Only MoTeC .ld files can be dropped here.' }); return }
    const summary = await window.fastrack.describeLap(window.fastrack.pathForFile(file))
    if (!summary) { setNotice({ title: "This file can't be read", body: `${file.name} could not be opened.` }); return }
    acceptSummary(key, summary)
  }

  const useFastestAsReference = async () => {
    const mineSlot = slots.mine
    if (!mineSlot) return
    const want = identity(mineSlot.summary)
    const library = await window.fastrack.library()
    const matches = library.filter((lap) => {
      if (lap.error || !(lap.lapTime > 0)) return false
      const id = identity(lap)
      return id.car === want.car && id.track === want.track
    })
    if (!matches.length) {
      setNotice({ title: 'No reference found', body: `No ${want.car} laps at ${want.track} were found in Documents\\Assetto Corsa Competizione\\MoTeC.` })
      return
    }
    acceptSummary('ref', matches.reduce((a, b) => b.lapTime < a.lapTime ? b : a))
  }

  // Keeps Electron from navigating to a file that is dropped outside a slot.
  useEffect(() => {
    const stop = (event: globalThis.DragEvent) => event.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop) }
  }, [])

  const clearSlot = (key: SlotKey) => { setSlots((current) => ({ ...current, [key]: null })); setPicks([]); setNotice(null) }
  const changeLap = (key: SlotKey, lapIndex: number) => { const slot = slots[key]; if (slot) void loadSlot(key, slot.summary, lapIndex) }

  const refPoints = useMemo(() => ref ? resample(ref) : null, [ref])
  const minePoints = useMemo(() => mine ? resample(mine) : null, [mine])

  // While ACC is feeding data, the reference for the live car and track is loaded automatically.
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null)
  useEffect(() => {
    void window.fastrack.liveStatus().then(setLiveStatus)
    return window.fastrack.onLiveStatus(setLiveStatus)
  }, [])
  const liveRef = liveStatus?.connected ? liveStatus.reference : null
  useEffect(() => {
    if (!liveRef) return undefined
    if (slots.ref?.summary.path === liveRef.path && slots.ref.lapIndex === liveRef.lapIndex) return undefined
    let cancelled = false
    void window.fastrack.describeLap(liveRef.path).then((summary) => { if (summary && !cancelled) void loadSlot('ref', summary, liveRef.lapIndex) })
    return () => { cancelled = true }
  }, [liveRef?.path, liveRef?.lapIndex])
  const liveOn = Boolean(liveRef && refPoints && slots.ref?.summary.path === liveRef.path && slots.ref.lapIndex === liveRef.lapIndex)
  const refTimes = useMemo(() => refPoints ? refPoints.map((point) => point.time - refPoints[0].time) : null, [refPoints])
  const live = useLiveRun(liveOn, refTimes)

  const geo = useMemo(() => {
    const source = (slots.ref ?? slots.mine)?.summary
    const trackName = source ? identity(source).track : ''
    const needsFit = [ref, mine].some((lap) => lap?.positionSource === 'estimated')
    const fitted = needsFit && hasTrackModel(trackName)
      ? fitToTrack(trackName, [
        refPoints && refPoints.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? refPoints.map((p) => ({ x: p.x as number, y: p.y as number })) : null,
        minePoints && minePoints.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? minePoints.map((p) => ({ x: p.x as number, y: p.y as number })) : null,
      ])
      : null
    const oriented = fitted ? fitted.laps : [
      refPoints && orient(refPoints, ref?.positionSource ?? 'measured'),
      minePoints && orient(minePoints, mine?.positionSource ?? 'measured'),
    ]
    const all = [...oriented.flatMap((points) => points || []), ...(fitted ? [...fitted.left, ...fitted.right] : [])]
    if (all.length < 2) return { ref: null, mine: null, edges: null, fitted: false }
    const minX = Math.min(...all.map((point) => point.x))
    const maxX = Math.max(...all.map((point) => point.x))
    const minY = Math.min(...all.map((point) => point.y))
    const maxY = Math.max(...all.map((point) => point.y))
    const span = Math.max(maxX - minX, maxY - minY, 1e-9)
    const xOffset = (1000 - 900 * (maxX - minX) / span) / 2
    const yOffset = (1000 - 900 * (maxY - minY) / span) / 2
    const build = (points: LapSample[] | null, placed: { x: number; y: number }[] | null): Proj[] | null => points && placed
      ? points.map((point, index) => ({ ...point, px: xOffset + (placed[index].x - minX) / span * 900, py: yOffset + (maxY - placed[index].y) / span * 900 }))
      : null
    const project = (points: { x: number; y: number }[]) => points.map((p) => `${(xOffset + (p.x - minX) / span * 900).toFixed(1)},${(yOffset + (maxY - p.y) / span * 900).toFixed(1)}`).join(' ')
    const edges = fitted ? { left: project([...fitted.left, fitted.left[0]]), right: project([...fitted.right, fitted.right[0]]) } : null
    return { ref: build(refPoints, oriented[0]), mine: build(minePoints, oriented[1]), edges, fitted: !!fitted }
  }, [refPoints, minePoints, ref, mine, slots])

  const trackKey = slots.ref || slots.mine ? identity((slots.ref ?? slots.mine)!.summary).track : ''

  const edgePts = useMemo(() => {
    const parse = (edge: string | undefined) => edge ? edge.split(' ').map((pair) => pair.split(',').map(Number)) : []
    return { left: parse(geo.edges?.left), right: parse(geo.edges?.right) }
  }, [geo.edges])

  const analysis = useMemo(() => {
    if (!refPoints || !minePoints) return null
    const delta = refPoints.map((point, index) => minePoints[index].time - point.time)
    const bounds = [0, ...sectorMarkers(trackKey)].map((marker) => Math.round(marker * (N - 1)))
    const losses = bounds.slice(0, -1).map((a, index) => {
      const b = bounds[index + 1]
      return { a, b, loss: delta[b] - delta[a] }
    })
    const fineBounds = Array.from({ length: 21 }, (_, i) => Math.round(i * (N - 1) / 20))
    const hotspots = fineBounds.slice(0, -1)
      .map((a, i) => ({ a, b: fineBounds[i + 1], loss: delta[fineBounds[i + 1]] - delta[a] }))
      .filter((segment) => segment.loss > 0.02)
      .sort((p, q) => q.loss - p.loss)
      .slice(0, 4)
    return { delta, total: delta[N - 1], hotspots, losses: losses.map((segment) => ({ ...segment, severe: segment.loss > 0.05 })) }
  }, [refPoints, minePoints, trackKey])

  const section = picks.length === 2 ? { a: Math.min(...picks), b: Math.max(...picks) } : null
  const range = section ?? { a: 0, b: N - 1 }
  const startRef = refPoints ? refPoints[range.a].time : 0
  const startMine = minePoints ? minePoints[range.a].time : 0
  const duration = Math.max(refPoints ? refPoints[range.b].time - startRef : 0, minePoints ? minePoints[range.b].time - startMine : 0)
  const playRefFrac = refPoints ? fracAtTime(refPoints, startRef + playT, range.a, range.b) : range.a
  const playMineFrac = minePoints ? fracAtTime(minePoints, startMine + playT, range.a, range.b) : range.a
  // Live: I sit at my lap position on the reference line; the ghost is where the reference was at my lap time.
  const liveFrac = live ? live.pos * (N - 1) : 0
  const ghostFrac = live && live.lapTime != null && refTimes ? indexAtTime(refTimes, live.lapTime) : liveFrac
  const refFrac = live ? ghostFrac : playRefFrac
  const mineFrac = live ? liveFrac : playMineFrac
  const liveDelta = live ? live.delta : analysis ? lerpAt(analysis.delta, refFrac, (value) => value) : null
  const mineColor = liveDelta != null && liveDelta > 0.005 ? SLOW : liveDelta != null && liveDelta < -0.005 ? FAST : NEUTRAL
  // Each stretch of my line is green where I gain on the reference and red where I lose.
  const mineSegments = useMemo(() => {
    const W = 6
    if (live && geo.ref) {
      const path = geo.ref
      const deltas = live.deltas
      const segments: { key: number; points: string; color: string }[] = []
      for (let i = 0; i < N - 1; i += 1) {
        if (deltas[i] == null || deltas[i + 1] == null) continue
        let lo = Math.max(0, i - W)
        while (lo < i && deltas[lo] == null) lo += 1
        let hi = Math.min(N - 1, i + 1 + W)
        while (hi > i + 1 && deltas[hi] == null) hi -= 1
        const change = (deltas[hi] as number) - (deltas[lo] as number)
        segments.push({ key: i, points: `${path[i].px.toFixed(1)},${path[i].py.toFixed(1)} ${path[i + 1].px.toFixed(1)},${path[i + 1].py.toFixed(1)}`, color: change > 0 ? SLOW : FAST })
      }
      return segments
    }
    if (!analysis || !geo.mine) return null
    const mineGeo = geo.mine
    return mineGeo.slice(0, -1).map((point, i) => {
      const lo = Math.max(0, i - W)
      const hi = Math.min(N - 1, i + 1 + W)
      return { key: i, points: `${point.px.toFixed(1)},${point.py.toFixed(1)} ${mineGeo[i + 1].px.toFixed(1)},${mineGeo[i + 1].py.toFixed(1)}`, color: analysis.delta[hi] - analysis.delta[lo] > 0 ? SLOW : FAST }
    })
  }, [analysis, geo.mine, geo.ref, live])

  const seek = (time: number) => { timeRef.current = time; setPlayT(time) }
  useEffect(() => { seek(0); setPlaying(false) }, [range.a, range.b, refPoints, minePoints])
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      timeRef.current = Math.min(duration, timeRef.current + (now - last) / 1000 * rate)
      last = now
      setPlayT(timeRef.current)
      if (timeRef.current >= duration) { setPlaying(false); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, rate, duration])

  const togglePlay = () => {
    if (!playing && timeRef.current >= duration) seek(0)
    setPlaying((value) => !value)
  }

  const baseGeo = geo.ref ?? geo.mine
  const unitsPerMeter = (() => {
    const lap = refPoints ?? minePoints
    if (!baseGeo || !lap) return 0.1
    let units = 0
    for (let i = 1; i < baseGeo.length; i += 1) units += Math.hypot(baseGeo[i].px - baseGeo[i - 1].px, baseGeo[i].py - baseGeo[i - 1].py)
    return units / Math.max(1, lap[N - 1].distance - lap[0].distance)
  })()
  const sectionStats = section && (refPoints || minePoints) ? (() => {
    const time = (points: LapSample[] | null) => points ? points[section.b].time - points[section.a].time : 0
    const minSpeed = (points: LapSample[] | null) => points ? Math.min(...points.slice(section.a, section.b + 1).map((point) => point.speed)) * 3.6 : 0
    return { ref: time(refPoints), mine: time(minePoints), refMin: minSpeed(refPoints), mineMin: minSpeed(minePoints) }
  })() : null

  // Point on the track with its outward normal (away from the circuit's middle) and half width, in map units.
  const frameAt = (fraction: number) => {
    if (!baseGeo) return null
    const i = Math.max(0, Math.min(N - 1, Math.round(fraction)))
    const p = baseGeo[i]
    const a = baseGeo[Math.max(0, i - 2)]
    const b = baseGeo[Math.min(N - 1, i + 2)]
    const len = Math.hypot(b.px - a.px, b.py - a.py) || 1
    let nx = -(b.py - a.py) / len
    let ny = (b.px - a.px) / len
    const mx = baseGeo.reduce((sum, q) => sum + q.px, 0) / N
    const my = baseGeo.reduce((sum, q) => sum + q.py, 0) / N
    if (nx * (p.px - mx) + ny * (p.py - my) < 0) { nx = -nx; ny = -ny }
    const near = (pts: number[][]) => pts.reduce((best, e) => Math.min(best, Math.hypot(e[0] - p.px, e[1] - p.py)), Infinity)
    const hw = edgePts.left.length ? Math.max(near(edgePts.left), near(edgePts.right)) : 7 * unitsPerMeter
    return { x: p.px, y: p.py, nx, ny, hw }
  }
  const sectorEnds = sectorMarkers(trackKey)
  const canvasScale = () => {
    const rect = svgRef.current?.getBoundingClientRect()
    return rect ? 1000 / Math.max(1, Math.min(rect.width, rect.height)) : 1
  }
  const nearestIndex = (clientX: number, clientY: number) => {
    const matrix = groupRef.current?.getScreenCTM()
    if (!matrix || !baseGeo) return null
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    let nearest = -1
    let best = Infinity
    baseGeo.forEach((candidate, index) => {
      const distance = Math.hypot(candidate.px - point.x, candidate.py - point.y)
      if (distance < best) { best = distance; nearest = index }
    })
    return nearest < 0 ? null : { index: nearest, distance: best }
  }
  // Moves both cars to the moment the lead lap reaches the given sample index.
  const seekIndex = (index: number) => {
    const lead = refPoints ?? minePoints
    if (!lead) return
    const clamped = Math.max(range.a, Math.min(range.b, index))
    setPlaying(false)
    seek(Math.max(0, Math.min(duration, lead[clamped].time - (refPoints ? startRef : startMine))))
  }
  const scrubToPoint = (clientX: number, clientY: number) => {
    const hit = nearestIndex(clientX, clientY)
    if (hit) seekIndex(hit.index)
  }
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const target = event.target as Element
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle')
    drag.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y, moved: false, handle: handle == null ? null : Number(handle), car: !!target.closest('[data-car]') }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (drag.current.car) scrubToPoint(event.clientX, event.clientY)
  }
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const origin = drag.current
    if (!origin) return
    if (origin.car) { origin.moved = true; scrubToPoint(event.clientX, event.clientY); return }
    if (origin.handle != null) {
      const hit = nearestIndex(event.clientX, event.clientY)
      if (!hit) return
      origin.moved = true
      setPicks((current) => {
        const other = current[1 - origin.handle!]
        if (other == null || Math.abs(other - hit.index) < 3) return current
        const next = [...current]
        next[origin.handle!] = hit.index
        return next
      })
      return
    }
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (!origin.moved && Math.hypot(dx, dy) < 5) return
    origin.moved = true
    const scale = canvasScale()
    setView({ x: origin.ox + dx * scale, y: origin.oy + dy * scale })
  }
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const origin = drag.current
    drag.current = null
    if (!origin || origin.moved || origin.handle != null || origin.car) return
    const hit = nearestIndex(event.clientX, event.clientY)
    if (!hit || hit.distance > 80 / zoom) return
    setPicks((current) => {
      if (current.length !== 1) return [hit.index]
      return Math.abs(current[0] - hit.index) < 3 ? current : [current[0], hit.index]
    })
  }

  const hasLaps = Boolean(ref || mine)
  const noPosition = hasLaps && !baseGeo
  const tracksLabel = slots.ref || slots.mine ? identity((slots.ref ?? slots.mine)!.summary) : null
  const loading = [slots.ref, slots.mine].some((slot) => slot && !slot.lap && !slot.error)
  const slotError = slots.ref?.error || slots.mine?.error
  const maxLoss = analysis ? Math.max(0.05, ...analysis.losses.map((segment) => Math.abs(segment.loss))) : 1

  return <main className="app">
    <header className="bar">
      <div className="brand"><span className="brand-mark"><Activity size={16} strokeWidth={2.5} /></span><span className="brand-word">TrackLine</span></div>
      <SlotCard label="MY LAP" swatch={mineColor} slot={slots.mine} onPick={() => void pickSlot('mine')} onClear={() => clearSlot('mine')} onLap={(index) => changeLap('mine', index)} onDropFiles={(files) => void dropOnSlot('mine', files)} />
      <SlotCard label="REFERENCE" swatch="#ffffff" slot={slots.ref} onPick={() => void pickSlot('ref')} onClear={() => clearSlot('ref')} onLap={(index) => changeLap('ref', index)} onDropFiles={(files) => void dropOnSlot('ref', files)} />
      {slots.mine && !slots.ref && <button className="use-fastest" onClick={() => void useFastestAsReference()}>Use my fastest as reference</button>}
      <button className={`preflight-toggle${preflight ? ' active' : ''}`} onClick={() => setPreflight((value) => !value)}><Map size={14} /> {preflight ? 'LAP ANALYSIS' : 'PRE-FLIGHT'}</button>
      <div className="session">{tracksLabel ? <><b>{tracksLabel.track}</b><span>{tracksLabel.car}</span></> : <span>No laps open</span>}</div>
      <LivePanel />
    </header>

    <section className="stage" style={{ '--pane': `${pane}px`, '--chart-h': `${Math.round(pane * 0.28)}px` } as CSSProperties}>
      {preflight ? <Preflight /> : <>
      <svg ref={svgRef} className="map" viewBox="0 0 1000 1000" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null }}
        onWheel={(event) => setZoom((value) => Math.max(0.6, Math.min(20, value * (event.deltaY < 0 ? 1.12 : 0.89))))}>
        <g ref={groupRef} transform={`translate(${view.x} ${view.y}) translate(500 500) scale(${zoom}) translate(-500 -500)`}>
          {geo.edges && <><path d={`M${geo.edges.left}Z M${geo.edges.right}Z`} className="track-fill" fillRule="evenodd" /><polyline points={geo.edges.left} className="track-edge" /><polyline points={geo.edges.right}           className="track-edge" /></>}
          {showLoss && analysis && geo.ref && analysis.hotspots.map((segment) => <polyline key={segment.a} points={polyline(geo.ref, segment.a, segment.b)} className="loss-line" />)}
          {section && baseGeo && <polyline points={polyline(baseGeo, section.a, section.b)} className="section-line" />}
          {geo.ref && <polyline points={polyline(geo.ref, 0, N - 1)} className="line-ref" />}
          {mineSegments
            ? mineSegments.map((segment) => <polyline key={segment.key} points={segment.points} className="line-mine" style={{ stroke: segment.color }} />)
            : geo.mine && <polyline points={polyline(geo.mine, 0, N - 1)} className="line-mine" style={{ stroke: NEUTRAL }} />}
          {baseGeo && <g className="start-mark" transform={`translate(${baseGeo[0].px} ${baseGeo[0].py})`}>
            <line x1="0" y1="0" x2="0" y2="-46" />
            <rect x="0" y="-46" width="36" height="24" className="flag-bg" />
            {[0, 1, 2, 3, 4, 5].flatMap((col) => [0, 1, 2].map((row) => (col + row) % 2 === 0 ? <rect key={`${col}-${row}`} x={col * 6} y={-46 + row * 8} width="6" height="8" className="flag-dark" /> : null))}
          </g>}
          {baseGeo && picks.map((index, order) => <g key={order} data-handle={order} className="pick-mark"><circle cx={baseGeo[index].px} cy={baseGeo[index].py} r="13" /><text x={baseGeo[index].px} y={baseGeo[index].py + 5}>{order ? 'B' : 'A'}</text></g>)}
          {geo.ref && <g data-car="ref" className="car"><circle className="car-hit" cx={lerpAt(geo.ref, refFrac, (point) => point.px)} cy={lerpAt(geo.ref, refFrac, (point) => point.py)} r={16 / zoom} /><circle className="car-dot" cx={lerpAt(geo.ref, refFrac, (point) => point.px)} cy={lerpAt(geo.ref, refFrac, (point) => point.py)} r={4.5 / zoom} fill="#ffffff" /></g>}
          {live && geo.ref && <g className="car"><circle className="car-dot" cx={lerpAt(geo.ref, mineFrac, (point) => point.px)} cy={lerpAt(geo.ref, mineFrac, (point) => point.py)} r={5.5 / zoom} fill={mineColor} /></g>}
          {geo.mine && <g data-car="mine" className="car"><circle className="car-hit" cx={lerpAt(geo.mine, mineFrac, (point) => point.px)} cy={lerpAt(geo.mine, mineFrac, (point) => point.py)} r={16 / zoom} /><circle className="car-dot" cx={lerpAt(geo.mine, mineFrac, (point) => point.px)} cy={lerpAt(geo.mine, mineFrac, (point) => point.py)} r={4.5 / zoom} fill={mineColor} /></g>}
          {baseGeo && sectorEnds.slice(0, -1).map((marker, i) => {
            const f = frameAt(marker * (N - 1))
            return f && <line key={`b${i}`} className="sector-line" x1={f.x - f.nx * f.hw * 1.15} y1={f.y - f.ny * f.hw * 1.15} x2={f.x + f.nx * f.hw * 1.15} y2={f.y + f.ny * f.hw * 1.15} />
          })}
          {baseGeo && [0, ...sectorEnds].slice(0, -1).map((start, i) => {
            const f = frameAt((start + sectorEnds[i]) / 2 * (N - 1))
            const loss = analysis?.losses[i]?.loss
            return f && <Tag key={`s${i}`} zoom={zoom} x={f.x + f.nx * f.hw * 1.15} y={f.y + f.ny * f.hw * 1.15} nx={f.nx} ny={f.ny}
              lines={[{ text: `SECTOR ${i + 1}` }, ...(loss != null ? [{ text: signed(loss), cls: loss > 0 ? 'slow' : 'fast' }] : [])]} />
          })}
          {live && (() => {
            const f = frameAt(mineFrac)
            return f && <Tag zoom={zoom} x={f.x + f.nx * f.hw * 1.15} y={f.y + f.ny * f.hw * 1.15} nx={f.nx} ny={f.ny}
              lines={[{ text: `${Math.round(live.speed)} km/h` }, ...(live.delta != null ? [{ text: `Δ ${signed(live.delta)}`, cls: live.delta > 0.005 ? 'slow' : live.delta < -0.005 ? 'fast' : '' }] : [])]} />
          })()}
          {geo.mine && minePoints && (() => {
            const f = frameAt(mineFrac)
            return f && <Tag zoom={zoom} x={f.x + f.nx * f.hw * 1.15} y={f.y + f.ny * f.hw * 1.15} nx={f.nx} ny={f.ny}
              lines={[{ text: `${Math.round(lerpAt(minePoints, mineFrac, (point) => point.speed * 3.6))} km/h` }, ...(liveDelta != null ? [{ text: `Δ ${signed(liveDelta)}`, cls: liveDelta > 0.005 ? 'slow' : liveDelta < -0.005 ? 'fast' : '' }] : [])]} />
          })()}
        </g>
      </svg>

      {!hasLaps && <div className="empty"><strong>Open a reference lap and your lap</strong><span>Both must be the same vehicle on the same track.</span></div>}
      {loading && <div className="empty small">Reading telemetry…</div>}
      {noPosition && !loading && <div className="map-note">No usable position or yaw-rate channels in this log.</div>}
      {slotError && <div className="notice">{slotError}</div>}
      {notice && <div className="modal-backdrop" onClick={() => setNotice(null)}>
        <div className="modal" role="alertdialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <h3><TriangleAlert size={18} /> {notice.title}</h3>
          <p>{notice.body}</p>
          <button autoFocus onClick={() => setNotice(null)}>OK</button>
        </div>
      </div>}

      {showMini && baseGeo && <Minimap edges={geo.edges} refGeo={geo.ref} mineGeo={live ? geo.ref : geo.mine} refFrac={refFrac} mineFrac={mineFrac} segments={mineSegments} mineColor={mineColor} unitsPerMeter={unitsPerMeter} onClose={() => setShowMini(false)} />}

      <div className="map-tools">
        <button className={`wide ${showLoss ? 'active' : ''}`} disabled={!analysis} title={analysis ? 'Highlight the smallest stretches where you lose the most time' : 'Open both laps to find time loss'} onClick={() => setShowLoss((value) => !value)}><TriangleAlert size={14} /> TIME LOSS</button>
        <button title="Zoom in" onClick={() => setZoom((value) => Math.min(20, value * 1.2))}><Plus size={15} /></button>
        <button title="Zoom out" onClick={() => setZoom((value) => Math.max(0.6, value / 1.2))}><Minus size={15} /></button>
        <button title="Reset view" onClick={() => { setZoom(1); setView({ x: 0, y: 0 }) }}><Crosshair size={15} /></button>
        <button className={`wide ${showMini ? 'active' : ''}`} title="Track-up view" onClick={() => setShowMini((value) => !value)}><Navigation size={14} /> TRACK-UP</button>
        {picks.length > 0 && <button className="wide" onClick={() => setPicks([])}><X size={14} /> CLEAR SECTION</button>}
      </div>

      {live && <div className="playbar">
        <span className="playhint">LIVE</span>
        <span className="clock">{live.lapTime != null ? seconds(live.lapTime) : 'Delta starts after the next line crossing'}</span>
        {live.delta != null && <span className={`live-delta ${live.delta > 0.005 ? 'slow' : live.delta < -0.005 ? 'fast' : ''}`}>{signed(live.delta)}</span>}
        <span className="playhint">REF {seconds(ref?.lapTime ?? 0)}</span>
      </div>}
      {hasLaps && !live && <div className="playbar">
        <button className="play" onClick={togglePlay} disabled={duration <= 0}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <input type="range" min={0} max={Math.max(duration, 0.01)} step={0.01} value={playT} onChange={(event) => { setPlaying(false); seek(Number(event.target.value)) }} />
        <span className="clock">{playT.toFixed(2)} / {duration.toFixed(2)}s</span>
        <select value={rate} onChange={(event) => setRate(Number(event.target.value))}>{[0.25, 0.5, 1, 2, 4].map((value) => <option key={value} value={value}>{value}×</option>)}</select>
        {liveDelta != null && <span className={`live-delta ${liveDelta > 0.005 ? 'slow' : liveDelta < -0.005 ? 'fast' : ''}`}>{signed(liveDelta)}</span>}
        <span className="playhint">{section ? 'SECTION' : 'FULL LAP'}</span>
      </div>}

      <aside className="overlay">
        <div className="pane-grip" title="Drag to resize"
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); paneDrag.current = { x: event.clientX, w: pane } }}
          onPointerMove={(event) => { const start = paneDrag.current; if (start) setPane(Math.max(300, Math.min(Math.round(window.innerWidth * 0.7), start.w - (event.clientX - start.x)))) }}
          onPointerUp={() => { paneDrag.current = null }} />
        {showLoss && analysis && <div className="block">
          <div className="block-title"><span>BIGGEST LOSSES (5% OF LAP EACH)</span></div>
          {analysis.hotspots.length ? <div className="hot-list">{analysis.hotspots.map((segment) =>
            <button key={segment.a} className="hot-row" onClick={() => setPicks([segment.a, segment.b])}><span>{Math.round(segment.a / (N - 1) * 100)}–{Math.round(segment.b / (N - 1) * 100)}%</span><b className="slow" style={{ background: 'none' }}>{signed(segment.loss)}</b></button>)}</div>
            : <p className="hint">No stretch loses more than 0.02s.</p>}
        </div>}
        <div className="block delta-head">
          <div><small>LAP DELTA</small><strong className={analysis ? (analysis.total > 0 ? 'slow' : 'fast') : ''}>{analysis ? signed(analysis.total) : '—'}</strong></div>
          <div className="times"><span><i style={{ background: '#fff' }} />{seconds(ref?.lapTime ?? 0)}</span><span><i style={{ background: mineColor }} />{seconds(mine?.lapTime ?? 0)}</span></div>
        </div>

        <div className="block">
          <div className="block-title"><span>TIME LOST PER SECTOR</span></div>
          {analysis ? <div className="loss-list">{analysis.losses.map((segment, index) =>
            <button key={segment.a} className={`loss-row ${segment.severe ? 'severe' : ''} ${section && section.a === segment.a && section.b === segment.b ? 'chosen' : ''}`} onClick={() => setPicks([segment.a, segment.b])}>
              <span className="loss-n">S{index + 1}</span>
              <span className="loss-bar"><b className={segment.loss > 0 ? 'slow' : 'fast'} style={{ width: `${Math.min(100, Math.abs(segment.loss) / maxLoss * 100)}%` }} /></span>
              <span className="loss-v">{signed(segment.loss)}</span>
            </button>)}</div> : <p className="hint">Open both laps to see where time is lost. Severe segments are flagged when they lose clearly more than the lap's typical rate.</p>}
        </div>

        <div className="block">
          <div className="block-title"><span>{section ? 'SECTION A → B' : 'FULL LAP'}</span></div>
          {section && sectionStats ? <div className="stats">
            <span>REF<b>{sectionStats.ref.toFixed(3)}s</b></span>
            <span>ME<b>{sectionStats.mine.toFixed(3)}s</b></span>
            {refPoints && minePoints && <span>Δ<b className={sectionStats.mine - sectionStats.ref > 0 ? 'slow' : 'fast'}>{signed(sectionStats.mine - sectionStats.ref)}</b></span>}
            <span>MIN SPD REF<b>{sectionStats.refMin.toFixed(0)} km/h</b></span>
            <span>MIN SPD ME<b>{sectionStats.mineMin.toFixed(0)} km/h</b></span>
          </div> : <p className="hint">{picks.length === 1 ? 'Click a second point on the track.' : 'Click two points on the track (or a segment above) to isolate a section.'}</p>}
        </div>

        <Chart title="SPEED" field="speed" refPoints={refPoints} minePoints={minePoints} from={range.a} to={range.b} mineColor={mineColor} refFrac={refFrac} mineFrac={mineFrac} onScrub={seekIndex} />
        <Chart title="THROTTLE" field="throttle" refPoints={refPoints} minePoints={minePoints} from={range.a} to={range.b} mineColor={mineColor} refFrac={refFrac} mineFrac={mineFrac} onScrub={seekIndex} />
        <Chart title="BRAKE" field="brake" refPoints={refPoints} minePoints={minePoints} from={range.a} to={range.b} mineColor={mineColor} refFrac={refFrac} mineFrac={mineFrac} onScrub={seekIndex} />
      </aside>
      </>}
    </section>
  </main>
}
