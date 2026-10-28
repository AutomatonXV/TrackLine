import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CornerUpLeft, CornerUpRight, Flag, Map, MoveUpRight, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { getTrackGuide, GUIDE_TRACKS, type GuideCorner, type GuidePoint, type GuideTrack } from './trackGuide'
import { createRacingLineOptimizer, type RacingLineProgress } from './racingLineOptimizer'

const pointString = (points: GuidePoint[]) => points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const trackSeed = (track: string) => [...track].reduce((seed, character) => (seed * 31 + character.charCodeAt(0)) >>> 0, 7)
const lapTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`

function advice(corner: GuideCorner) {
  if (corner.character === 'tight') {
    return 'Brake firmly while straight, stay wide on approach and delay turn-in. Aim for a late apex, then unwind the wheel and build throttle toward the exit.'
  }
  if (corner.character === 'medium') {
    return 'Finish most braking before turn-in and release smoothly. Take one clean apex, then let the car use the outside of the track as you accelerate.'
  }
  return 'Protect momentum with one smooth arc. Use only the lift or braking needed for confidence, avoid a second steering correction, and let the car flow to the exit.'
}

function speedColor(speed: number, min: number, max: number) {
  const amount = clamp((speed - min) / Math.max(1, max - min), 0, 1)
  const red = [239, 78, 80]
  const yellow = [240, 173, 80]
  const green = [52, 199, 89]
  const start = amount < 0.5 ? red : yellow
  const end = amount < 0.5 ? yellow : green
  const blend = amount < 0.5 ? amount * 2 : (amount - 0.5) * 2
  return `rgb(${start.map((value, index) => Math.round(value + (end[index] - value) * blend)).join(',')})`
}

export default function Preflight() {
  const [track, setTrack] = useState<GuideTrack>('Monza')
  const [selected, setSelected] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [optimization, setOptimization] = useState<{ track: GuideTrack; result: RacingLineProgress } | null>(null)
  const mapDrag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const guide = useMemo(() => getTrackGuide(track), [track])
  const optimizer = useMemo(() => createRacingLineOptimizer(guide.optimizer, trackSeed(track)), [guide, track])
  const currentOptimization = optimization?.track === track ? optimization.result : optimizer.current()
  const racingSegments = useMemo(() => {
    const minSpeed = Math.min(...currentOptimization.speedsKmh)
    const maxSpeed = Math.max(...currentOptimization.speedsKmh)
    return currentOptimization.line.map((point, index) => {
      const next = currentOptimization.line[(index + 1) % currentOptimization.line.length]
      return {
        color: speedColor(currentOptimization.speedsKmh[index], minSpeed, maxSpeed),
        points: `${point.x.toFixed(1)},${point.y.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`,
      }
    })
  }, [currentOptimization])
  const candidatePoints = useMemo(() => pointString(currentOptimization.candidate), [currentOptimization])
  const mapGeometry = useMemo(() => ({
    road: pointString([...guide.leftEdge, ...guide.rightEdge.slice().reverse()]),
    leftBoundary: pointString([...guide.leftEdge, guide.leftEdge[0]]),
    rightBoundary: pointString([...guide.rightEdge, guide.rightEdge[0]]),
    centerline: pointString([...guide.centerline, guide.centerline[0]]),
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

  const chooseTrack = (next: GuideTrack) => {
    setTrack(next)
    setSelected(0)
    setRotation(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  useEffect(() => {
    setOptimization({ track, result: optimizer.current() })
    const timer = window.setInterval(() => {
      const result = optimizer.step()
      setOptimization({ track, result })
      if (result.complete) window.clearInterval(timer)
    }, 75)
    return () => window.clearInterval(timer)
  }, [optimizer, track])

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
        <div className="preflight-map-title">
          <span>{track}</span>
          <small>{guide.corners.length} turns · {guide.lengthMeters.toFixed(0)} m</small>
          <small className="preflight-optimizer-status" aria-live="polite">
            {currentOptimization.complete ? 'OPTIMIZED' : 'OPTIMIZING'} · {currentOptimization.iteration}/{currentOptimization.totalIterations}
            {' · '}score {lapTime(currentOptimization.estimatedLapSeconds)}
          </small>
        </div>
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
            <g transform={`translate(${pan.x} ${pan.y}) translate(500 500) rotate(${rotation}) scale(${zoom}) translate(-500 -500)`}>
              <polygon points={mapGeometry.road} className="preflight-road" />
              <polyline points={mapGeometry.leftBoundary} className="preflight-boundary" />
              <polyline points={mapGeometry.rightBoundary} className="preflight-boundary" />
              <polyline points={mapGeometry.centerline} className="preflight-center" />
              {!currentOptimization.complete && <polyline points={candidatePoints} className="preflight-racing-candidate" />}
              {racingSegments.map((segment, index) => <polyline key={`race-${index}`} points={segment.points}
                className="preflight-racing-line" style={{ stroke: segment.color }} />)}
              {guide.corners.map((corner, index) => <g key={corner.number} className={`preflight-corner${index === selected ? ' active' : ''}`}
                onClick={() => {
                  if (suppressClick.current) return
                  setSelected(index)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelected(index)
                  }
                }}
                role="button" tabIndex={0} aria-label={`Select corner ${corner.number}`}>
                <rect x={cornerLabels[index].x - 14} y={cornerLabels[index].y - 14} width="28" height="28" className="preflight-corner-hit" />
                <text x={cornerLabels[index].x} y={cornerLabels[index].y} textAnchor="middle" dominantBaseline="central">{corner.number}</text>
              </g>)}
            </g>
          </svg>
          <span className="preflight-wheel-hint">Drag to pan · Scroll to zoom · Use arrows to rotate</span>
        </div>
        <div className="preflight-line-legend">
          <span className="brake-color">Slower</span><i /><span className="accelerate-color">Faster</span>
          <span className="line-legend-note">Estimated speed through corners</span>
        </div>
        <p className="preflight-caveat">The line updates as a particle-swarm search tests track-width-constrained paths. Color shows estimated corner speed, not brake or throttle input; lap time is a relative optimization score, not an ACC prediction.</p>
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
            onClick={() => setSelected(index)}>
            <b>{String(corner.number).padStart(2, '0')}</b>
            <span>Turn {corner.number}<small>{corner.character} {corner.direction}</small></span>
            <MoveUpRight size={14} />
          </button>)}
        </div>
      </aside>
    </div>
  </div>
}
