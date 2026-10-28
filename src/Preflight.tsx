import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CornerUpLeft, CornerUpRight, Flag, Map, MoveUpRight, Pause, Play, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { getTrackGuide, GUIDE_TRACKS, type GuideCorner, type GuidePoint, type GuideTrack } from './trackGuide'

const pointString = (points: GuidePoint[]) => points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function advice(corner: GuideCorner) {
  if (corner.character === 'tight') {
    return 'Brake firmly while straight, stay wide on approach and delay turn-in. Aim for a late apex, then unwind the wheel and build throttle toward the exit.'
  }
  if (corner.character === 'medium') {
    return 'Finish most braking before turn-in and release smoothly. Take one clean apex, then let the car use the outside of the track as you accelerate.'
  }
  return 'Protect momentum with one smooth arc. Use only the lift or braking needed for confidence, avoid a second steering correction, and let the car flow to the exit.'
}

function makeSpeedProfile(points: GuidePoint[], trackLength: number) {
  const mapLength = points.reduce((length, point, index) => {
    const next = points[(index + 1) % points.length]
    return length + Math.hypot(next.x - point.x, next.y - point.y)
  }, 0)
  const metersPerMapUnit = trackLength / mapLength
  return points.map((point, index) => {
    const before = points[(index - 1 + points.length) % points.length]
    const after = points[(index + 1) % points.length]
    const ax = point.x - before.x
    const ay = point.y - before.y
    const bx = after.x - point.x
    const by = after.y - point.y
    const angle = Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
    const sampleSpacing = Math.hypot(bx, by) * metersPerMapUnit
    const curvature = Math.abs(angle) / Math.max(sampleSpacing, 0.001)
    const cornerSpeed = Math.sqrt(1.25 * 9.81 / Math.max(curvature, 0.0001)) * 3.6
    return clamp(cornerSpeed, 90, 285)
  })
}

function blendLineColor(brake: number, throttle: number) {
  const mix = throttle / Math.max(1, brake + throttle)
  const start = [239, 78, 80]
  const end = [52, 199, 89]
  return `rgb(${start.map((value, index) => Math.round(value + (end[index] - value) * mix)).join(',')})`
}

function pointAtProgress(points: GuidePoint[], progress: number) {
  const position = progress * points.length
  const index = Math.floor(position) % points.length
  const next = (index + 1) % points.length
  const fraction = position - Math.floor(position)
  return {
    x: points[index].x + (points[next].x - points[index].x) * fraction,
    y: points[index].y + (points[next].y - points[index].y) * fraction,
    heading: Math.atan2(points[next].y - points[index].y, points[next].x - points[index].x) * 180 / Math.PI,
  }
}

function cornerAtProgress(corners: GuideCorner[], progress: number, sampleCount: number) {
  const position = progress * sampleCount
  return corners.findIndex((corner) => corner.startIndex <= corner.endIndex
    ? position >= corner.startIndex && position <= corner.endIndex
    : position >= corner.startIndex || position <= corner.endIndex)
}

function SimGauge({ speed, gear, throttle, brake, running, progress, onToggle, onRestart, onSeek, playRate, onPlayRate }: {
  speed: number
  gear: number
  throttle: number
  brake: number
  running: boolean
  progress: number
  onToggle: () => void
  onRestart: () => void
  onSeek: (progress: number) => void
  playRate: number
  onPlayRate: (rate: number) => void
}) {
  const angle = (210 + clamp(speed, 0, 285) / 285 * 120) * Math.PI / 180
  const needle = { x: 50 + 34 * Math.cos(angle), y: 58 + 34 * Math.sin(angle) }

  return <div className="preflight-sim">
    <div className="sim-gauge-wrap">
      <div className="sim-gauge" role="img" aria-label={`Simulated speed ${Math.round(speed)} kilometers per hour`}>
        <svg viewBox="0 0 100 74" aria-hidden="true">
          <path d="M 17 58 A 36 36 0 0 1 83 58" className="sim-gauge-track" />
          <path d="M 17 58 A 36 36 0 0 1 50 22" className="sim-gauge-green" />
          <path d="M 50 22 A 36 36 0 0 1 83 58" className="sim-gauge-red" />
          <line x1="50" y1="58" x2={needle.x} y2={needle.y} className="sim-gauge-needle" />
          <circle cx="50" cy="58" r="3" className="sim-gauge-hub" />
        </svg>
        <div className="sim-gauge-readout"><b>{Math.round(speed)}</b><small>KM/H</small></div>
      </div>
      <div className="sim-gear"><small>GEAR</small><b>{gear}</b></div>
    </div>
    <div className="sim-inputs">
      <div className="sim-input-row"><span>BRAKE</span><div className="sim-input-track"><i className="sim-brake" style={{ width: `${brake}%` }} /></div><b>{Math.round(brake)}%</b></div>
      <div className="sim-input-row"><span>THROTTLE</span><div className="sim-input-track"><i className="sim-throttle" style={{ width: `${throttle}%` }} /></div><b>{Math.round(throttle)}%</b></div>
      <label className="sim-progress">LAP
        <input aria-label="Simulation lap progress" type="range" min="0" max="1000" value={Math.round(progress * 1000)}
          onChange={(event) => onSeek(Number(event.target.value) / 1000)} />
        <small>{(progress * 100).toFixed(0)}%</small>
      </label>
    </div>
    <div className="sim-actions">
      <strong>SIMULATION <small>ESTIMATED PACE</small></strong>
      <button onClick={onToggle} aria-label={running ? 'Pause simulation' : 'Start simulation'} title={running ? 'Pause' : 'Start'}>
        {running ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button onClick={onRestart} aria-label="Restart simulation" title="Restart"><RotateCcw size={15} /></button>
      <select aria-label="Simulation playback speed" value={playRate} onChange={(event) => onPlayRate(Number(event.target.value))}>
        <option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option>
      </select>
    </div>
  </div>
}

export default function Preflight() {
  const [track, setTrack] = useState<GuideTrack>('Monza')
  const [selected, setSelected] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState(0)
  const [throttle, setThrottle] = useState(0)
  const [brake, setBrake] = useState(0)
  const [playRate, setPlayRate] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const vehicleSpeed = useRef(0)
  const simulatedDistance = useRef(0)
  const mapDrag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const guide = useMemo(() => getTrackGuide(track), [track])
  const speedProfile = useMemo(() => makeSpeedProfile(guide.racingLine, guide.lengthMeters), [guide])
  const racingSegments = useMemo(() => guide.racingLine.map((point, index) => {
    const lookAhead = Math.max(1, Math.round(75 / guide.lengthMeters * speedProfile.length))
    let target = speedProfile[index]
    for (let offset = 1; offset <= lookAhead; offset += 1) {
      target = Math.min(target, speedProfile[(index + offset) % speedProfile.length] + offset * 0.35)
    }
    const brake = clamp((speedProfile[index] - target - 2) * 5, 0, 100)
    const throttle = clamp((target - speedProfile[index] + 2) * 4, 0, 100)
    const next = guide.racingLine[(index + 1) % guide.racingLine.length]
    return {
      color: blendLineColor(brake, throttle),
      points: `${point.x.toFixed(1)},${point.y.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`,
    }
  }), [guide, speedProfile])
  const mapGeometry = useMemo(() => ({
    road: pointString([...guide.leftEdge, ...guide.rightEdge.slice().reverse()]),
    leftBoundary: pointString([...guide.leftEdge, guide.leftEdge[0]]),
    rightBoundary: pointString([...guide.rightEdge, guide.rightEdge[0]]),
    centerline: pointString([...guide.centerline, guide.centerline[0]]),
    corners: guide.corners.map((corner) => pointString(corner.line)),
  }), [guide])
  const cornerLabels = useMemo(() => {
    const center = guide.centerline.reduce((sum, point) => ({ x: sum.x + point.x / guide.centerline.length, y: sum.y + point.y / guide.centerline.length }), { x: 0, y: 0 })
    return guide.corners.map((corner) => {
      const index = corner.apexIndex
      const before = guide.centerline[(index - 2 + guide.centerline.length) % guide.centerline.length]
      const after = guide.centerline[(index + 2) % guide.centerline.length]
      const trackCenter = guide.centerline[index]
      const length = Math.hypot(after.x - before.x, after.y - before.y) || 1
      let nx = -(after.y - before.y) / length
      let ny = (after.x - before.x) / length
      if (nx * (trackCenter.x - center.x) + ny * (trackCenter.y - center.y) < 0) { nx = -nx; ny = -ny }
      const width = Math.max(
        Math.hypot(guide.leftEdge[index].x - trackCenter.x, guide.leftEdge[index].y - trackCenter.y),
        Math.hypot(guide.rightEdge[index].x - trackCenter.x, guide.rightEdge[index].y - trackCenter.y),
      )
      const offset = width + 20
      return { x: corner.points.apex.x + nx * offset, y: corner.points.apex.y + ny * offset }
    })
  }, [guide])
  const active = guide.corners[selected] ?? guide.corners[0]
  const carPoint = useMemo(() => pointAtProgress(guide.racingLine, progress), [guide.racingLine, progress])

  const seek = (next: number) => {
    setPlaying(false)
    const position = clamp(next, 0, 0.999)
    simulatedDistance.current = position * guide.lengthMeters
    vehicleSpeed.current = 0
    setSpeed(0)
    setThrottle(0)
    setBrake(0)
    setProgress(position)
  }

  const chooseTrack = (next: GuideTrack) => {
    setPlaying(false)
    setTrack(next)
    setSelected(0)
    setRotation(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    simulatedDistance.current = 0
    vehicleSpeed.current = 0
    setProgress(0)
    setSpeed(0)
    setThrottle(0)
    setBrake(0)
  }

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previousTime = 0
    const tick = (time: number) => {
      if (previousTime === 0) previousTime = time
      const elapsed = Math.min((time - previousTime) / 1000, 0.08) * playRate
      previousTime = time
      const index = Math.floor(simulatedDistance.current / guide.lengthMeters * speedProfile.length) % speedProfile.length
      const lookAhead = Math.max(1, Math.round(75 / guide.lengthMeters * speedProfile.length))
      let target = speedProfile[index]
      for (let offset = 1; offset <= lookAhead; offset += 1) {
        target = Math.min(target, speedProfile[(index + offset) % speedProfile.length] + offset * 0.35)
      }

      const currentSpeed = vehicleSpeed.current
      const braking = currentSpeed > target + 3 ? clamp(30 + (currentSpeed - target) * 3, 0, 100) : 0
      const accelerating = braking > 0 ? 0 : clamp(35 + (target - currentSpeed) * 1.8, 20, 100)
      vehicleSpeed.current = clamp(currentSpeed + (accelerating * 0.045 - braking * 0.09) * elapsed * 3.6, 0, 285)
      simulatedDistance.current += vehicleSpeed.current / 3.6 * elapsed
      if (simulatedDistance.current >= guide.lengthMeters) {
        simulatedDistance.current %= guide.lengthMeters
        vehicleSpeed.current = 0
      }

      const nextProgress = simulatedDistance.current / guide.lengthMeters
      setProgress(nextProgress)
      setSpeed(vehicleSpeed.current)
      setThrottle(accelerating)
      setBrake(braking)
      const nextCorner = cornerAtProgress(guide.corners, nextProgress, guide.racingLine.length)
      if (nextCorner >= 0) setSelected((previous) => previous === nextCorner ? previous : nextCorner)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [guide, playRate, playing, speedProfile])

  if (!active) return <div className="preflight-empty">No track geometry is available for this circuit.</div>

  const changeZoom = (amount: number) => setZoom((value) => clamp(value + amount, 0.8, 4))
  const onMapPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest('.preflight-corner')) return
    mapDrag.current = { x: event.clientX, y: event.clientY, ox: pan.x, oy: pan.y, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onMapPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const origin = mapDrag.current
    if (!origin) return
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (!origin.moved && Math.hypot(dx, dy) < 4) return
    origin.moved = true
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = 1000 / Math.max(1, Math.min(rect.width, rect.height))
    setPan({ x: origin.ox + dx * scale, y: origin.oy + dy * scale })
  }
  const onMapPointerUp = () => {
    suppressClick.current = Boolean(mapDrag.current?.moved)
    mapDrag.current = null
    if (suppressClick.current) window.setTimeout(() => { suppressClick.current = false }, 0)
  }

  return <div className="preflight">
    <header className="preflight-head">
      <div>
        <p className="preflight-kicker"><Map size={14} /> TRACK BRIEFING</p>
        <h1>Pre-flight</h1>
        <p>Get familiar with the corner sequence before you drive.</p>
      </div>
      <label className="preflight-select">TRACK
        <select value={track} onChange={(event) => chooseTrack(event.target.value as GuideTrack)}>
          {GUIDE_TRACKS.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>
    </header>

    <div className="preflight-layout">
      <div className="preflight-map-card">
        <div className="preflight-map-title"><span>{track}</span><small>{guide.corners.length} turns · {guide.lengthMeters.toFixed(0)} m sourced layout</small></div>
        <div className="preflight-map-viewport">
          <div className="preflight-map-controls" aria-label="Map controls">
            <button onClick={() => changeZoom(0.25)} title="Zoom in" aria-label="Zoom in"><ZoomIn size={15} /></button>
            <button onClick={() => changeZoom(-0.25)} title="Zoom out" aria-label="Zoom out"><ZoomOut size={15} /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setRotation((value) => value - 15)} title="Rotate counterclockwise" aria-label="Rotate map counterclockwise"><RotateCcw size={15} /></button>
            <button onClick={() => setRotation((value) => value + 15)} title="Rotate clockwise" aria-label="Rotate map clockwise"><RotateCw size={15} /></button>
            <button onClick={() => { setZoom(1); setRotation(0) }} title="Reset map view" aria-label="Reset map view"><Map size={15} /></button>
          </div>
          <svg className="preflight-map" viewBox="0 0 1000 1000" role="img" aria-label={`${track} turn-by-turn map`}
            onPointerDown={onMapPointerDown} onPointerMove={onMapPointerMove} onPointerUp={onMapPointerUp}
            onPointerCancel={() => { mapDrag.current = null }}
            onClick={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation() } }}
            onWheel={(event) => { event.preventDefault(); changeZoom(event.deltaY < 0 ? 0.15 : -0.15) }}>
            <defs>
              <linearGradient id="preflight-turn-gradient"
                x1={active.line[0]?.x ?? active.points.approach.x}
                y1={active.line[0]?.y ?? active.points.approach.y}
                x2={active.line[active.line.length - 1]?.x ?? active.points.exit.x}
                y2={active.line[active.line.length - 1]?.y ?? active.points.exit.y}
                gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ef4e50" />
                <stop offset="38%" stopColor="#ff8a80" />
                <stop offset="58%" stopColor="#f0ad50" />
                <stop offset="78%" stopColor="#a9e36e" />
                <stop offset="100%" stopColor="#34c759" />
              </linearGradient>
            </defs>
            <g transform={`translate(${pan.x} ${pan.y}) translate(500 500) rotate(${rotation}) scale(${zoom}) translate(-500 -500)`}>
              <polygon points={mapGeometry.road} className="preflight-road" />
              <polyline points={mapGeometry.leftBoundary} className="preflight-boundary" />
              <polyline points={mapGeometry.rightBoundary} className="preflight-boundary" />
              <polyline points={mapGeometry.centerline} className="preflight-center" />
              {racingSegments.map((segment, index) => <polyline key={`race-${index}`} points={segment.points}
                className="preflight-racing-line" style={{ stroke: segment.color }} />)}
              {guide.corners.map((corner, index) => <polyline key={`line-${corner.number}`}
                points={mapGeometry.corners[index]}
                className={`preflight-racing-line-active${index === selected ? ' active' : ''}`}
                stroke={index === selected ? 'url(#preflight-turn-gradient)' : undefined} />)}
              {guide.corners.map((corner, index) => <g key={corner.number} className={`preflight-corner${index === selected ? ' active' : ''}`}
                onClick={() => {
                  if (suppressClick.current) return
                  setSelected(index)
                  seek(corner.startIndex / 1200)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelected(index)
                    seek(corner.startIndex / 1200)
                  }
                }}
                role="button" tabIndex={0} aria-label={`Select corner ${corner.number}`}>
                <rect x={cornerLabels[index].x - 14} y={cornerLabels[index].y - 14} width="28" height="28" className="preflight-corner-hit" />
                <text x={cornerLabels[index].x} y={cornerLabels[index].y} textAnchor="middle" dominantBaseline="central">{corner.number}</text>
              </g>)}
              <g transform={`translate(${carPoint.x} ${carPoint.y}) rotate(${carPoint.heading})`} className="preflight-car">
                <circle r="13" />
                <path d="M -5 -7 L 8 0 L -5 7 Z" />
              </g>
            </g>
          </svg>
          <span className="preflight-wheel-hint">Drag to pan · Scroll to zoom · Use arrows to rotate</span>
        </div>
        <div className="preflight-line-legend">
          <span className="brake-color">Braking</span><i /><span className="accelerate-color">Acceleration</span>
          <span className="line-legend-note">Estimated reference line</span>
        </div>
        <SimGauge speed={speed} gear={Math.max(1, Math.min(6, Math.floor(speed / 42) + 1))}
          throttle={throttle} brake={brake} running={playing} progress={progress}
          onToggle={() => setPlaying((value) => !value)}
          onRestart={() => { setPlaying(false); seek(0) }}
          onSeek={seek} playRate={playRate} onPlayRate={setPlayRate} />
        <p className="preflight-caveat">The simulation estimates pace and inputs from line curvature; it is illustrative, not an ACC vehicle model, telemetry, setup recommendation, or braking reference.</p>
      </div>

      <aside className="preflight-guide">
        <div className="preflight-guide-title"><div><Flag size={16} /><b>Corner guide</b></div><span>{selected + 1} / {guide.corners.length}</span></div>
        <div className="preflight-active">
          <div className="preflight-turn-heading">
            <span className="preflight-number">{String(active.number).padStart(2, '0')}</span>
            <div><h2>Turn {active.number}</h2><p>{active.character} {active.direction}</p></div>
            {active.direction === 'left' ? <CornerUpLeft size={20} /> : <CornerUpRight size={20} />}
          </div>
          <p>{advice(active)}</p>
          <div className="preflight-steps">
            <span><b>1 · Approach</b> Set the car wide and brake before turning.</span>
            <span><b>2 · Apex</b> Clip the inside of the reference line without pinching the exit.</span>
            <span><b>3 · Exit</b> Unwind steering and progressively use the track-out.</span>
          </div>
        </div>
        <div className="preflight-corner-list">
          {guide.corners.map((corner, index) => <button key={corner.number}
            className={`preflight-corner-row${index === selected ? ' active' : ''}`}
            onClick={() => { setSelected(index); seek(corner.startIndex / 1200) }}>
            <b>{String(corner.number).padStart(2, '0')}</b>
            <span>Turn {corner.number}<small>{corner.character} {corner.direction}</small></span>
            <MoveUpRight size={14} />
          </button>)}
        </div>
      </aside>
    </div>
  </div>
}
