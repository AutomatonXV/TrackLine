import { useMemo, useState } from 'react'
import { CornerUpLeft, CornerUpRight, Flag, Map, MoveUpRight } from 'lucide-react'
import { getTrackGuide, GUIDE_TRACKS, type GuideCorner, type GuidePoint, type GuideTrack } from './trackGuide'

const pointString = (points: GuidePoint[]) => points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

function advice(corner: GuideCorner) {
  if (corner.character === 'tight') {
    return 'Brake firmly while straight, stay wide on approach and delay turn-in. Aim for a late apex, then unwind the wheel and build throttle toward the exit.'
  }
  if (corner.character === 'medium') {
    return 'Finish most braking before turn-in and release smoothly. Take one clean apex, then let the car use the outside of the track as you accelerate.'
  }
  return 'Protect momentum with one smooth arc. Use only the lift or braking needed for confidence, avoid a second steering correction, and let the car flow to the exit.'
}

function marker(point: GuidePoint, label: string) {
  return <g key={label} className={`preflight-marker marker-${label.toLowerCase()}`} transform={`translate(${point.x} ${point.y})`}>
    <circle r={label === 'A' ? 13 : 10} />
    <text textAnchor="middle" dominantBaseline="central">{label}</text>
  </g>
}

export default function Preflight() {
  const [track, setTrack] = useState<GuideTrack>('Monza')
  const [selected, setSelected] = useState(0)
  const guide = useMemo(() => getTrackGuide(track), [track])
  const active = guide.corners[selected] ?? guide.corners[0]

  const chooseTrack = (next: GuideTrack) => {
    setTrack(next)
    setSelected(0)
  }

  if (!active) return <div className="preflight-empty">No track geometry is available for this circuit.</div>

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
        <svg className="preflight-map" viewBox="0 0 1000 1000" role="img" aria-label={`${track} turn-by-turn map`}>
          <polygon points={pointString([...guide.leftEdge, ...guide.rightEdge.slice().reverse()])} className="preflight-road" />
          <polyline points={pointString([...guide.leftEdge, guide.leftEdge[0]])} className="preflight-boundary" />
          <polyline points={pointString([...guide.rightEdge, guide.rightEdge[0]])} className="preflight-boundary" />
          <polyline points={pointString([...guide.centerline, guide.centerline[0]])} className="preflight-center" />
          <polyline points={pointString([...guide.racingLine, guide.racingLine[0]])} className="preflight-racing-line" />
          {guide.corners.map((corner, index) => <polyline key={`line-${corner.number}`}
            points={pointString(corner.line)}
            className={`preflight-racing-line-active${index === selected ? ' active' : ''}`} />)}
          {guide.corners.map((corner, index) => <g key={corner.number} className={`preflight-corner${index === selected ? ' active' : ''}`}
            onClick={() => setSelected(index)} role="button" aria-label={`Select corner ${corner.number}`}>
            <circle cx={corner.points.apex.x} cy={corner.points.apex.y} r={index === selected ? 18 : 14} className="preflight-corner-hit" />
            <text x={corner.points.apex.x} y={corner.points.apex.y} textAnchor="middle" dominantBaseline="central">{corner.number}</text>
          </g>)}
          {marker(active.points.approach, 'B')}
          {marker(active.points.turnIn, 'T')}
          {marker(active.points.apex, 'A')}
          {marker(active.points.exit, 'E')}
        </svg>
        <div className="preflight-legend">
          <span><i className="legend-brake">B</i> Plan braking / slowdown</span>
          <span><i className="legend-turn">T</i> Turn-in</span>
          <span><i className="legend-apex">A</i> Approximate apex</span>
          <span><i className="legend-exit">E</i> Track-out</span>
        </div>
        <p className="preflight-caveat">The green route is TUMFTM’s minimum-curvature optimized reference line, not an ACC car-specific setup. Corner grouping and approach, turn-in, apex, and exit markers are estimated from that route—not braking distances or roadside boards. Source quality varies by venue; verify the layout and conditions in ACC.</p>
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
            <span><b>2 · Apex</b> Clip the inside marker without pinching the exit.</span>
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
