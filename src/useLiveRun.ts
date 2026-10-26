import { useEffect, useState } from 'react'

const PUBLISH_MS = 50

export interface LiveRun {
  pos: number
  speed: number
  // Seconds into the current timed lap; null until the car has crossed the line once.
  lapTime: number | null
  // Seconds ahead (negative) or behind (positive) the reference at this point; null while untimed.
  delta: number | null
  // Delta recorded per reference sample for the current lap, so the driven line can be coloured.
  deltas: (number | null)[]
  speeds: (number | null)[]
  throttles: (number | null)[]
  brakes: (number | null)[]
  // The previous completed lap, kept so its notes stay on the map until this lap passes the same place.
  last: LapTrace | null
}

export interface LapTrace {
  deltas: (number | null)[]
  speeds: (number | null)[]
  throttles: (number | null)[]
  brakes: (number | null)[]
}

const lerp = (values: number[], fraction: number) => {
  const lower = Math.max(0, Math.min(values.length - 1, Math.floor(fraction)))
  const upper = Math.min(values.length - 1, lower + 1)
  return values[lower] + (values[upper] - values[lower]) * (fraction - lower)
}

// Follows the live ACC frames against the reference's elapsed-time table (one entry per map sample).
export function useLiveRun(active: boolean, refTimes: number[] | null): LiveRun | null {
  const [run, setRun] = useState<LiveRun | null>(null)

  useEffect(() => {
    if (!active || !refTimes) { setRun(null); return undefined }
    const n = refTimes.length
    const blank = () => new Array<number | null>(n).fill(null)
    let deltas = blank()
    let speeds = blank()
    let throttles = blank()
    let brakes = blank()
    let last: LapTrace | null = null
    let lastPos = -1
    let base: number | null = null
    let lastPublish = 0
    const off = window.fastrack.onLiveFrame((frame) => {
      if (frame.state !== 'active' || frame.pos == null || frame.lapMs == null) return
      const pos = frame.pos
      const lapMs = frame.lapMs
      if (lastPos > 0.9 && pos < 0.1) {
        // The game's clock either restarts at the line or has been running since the session began.
        if (base != null) last = { deltas, speeds, throttles, brakes }
        base = lapMs >= 10000 ? lapMs : 0
        deltas = blank(); speeds = blank(); throttles = blank(); brakes = blank()
      } else if (lastPos >= 0 && Math.abs(pos - lastPos) > 0.3) {
        // Teleport (pit exit, session restart): the lap in progress is no longer valid.
        base = null
        deltas = blank(); speeds = blank(); throttles = blank(); brakes = blank()
      }
      lastPos = pos
      const lapTime = base == null ? null : (lapMs - base) / 1000
      const fraction = pos * (n - 1)
      const delta = lapTime == null ? null : lapTime - lerp(refTimes, fraction)
      if (delta != null) {
        const slot = Math.round(fraction)
        deltas[slot] = delta
        speeds[slot] = frame.speedKmh ?? 0
        throttles[slot] = frame.throttle?.you ?? 0
        brakes[slot] = frame.brake?.you ?? 0
      }
      const now = performance.now()
      if (now - lastPublish < PUBLISH_MS) return
      lastPublish = now
      setRun({ pos, speed: frame.speedKmh ?? 0, lapTime, delta, deltas: deltas.slice(), speeds: speeds.slice(), throttles: throttles.slice(), brakes: brakes.slice(), last })
    })
    return () => { off(); setRun(null) }
  }, [active, refTimes])

  return run
}

// Reference sample index whose elapsed time equals the given lap time.
export function indexAtTime(refTimes: number[], time: number) {
  let low = 0
  let high = refTimes.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (refTimes[middle] >= time) high = middle
    else low = middle + 1
  }
  if (low === 0) return 0
  const span = refTimes[low] - refTimes[low - 1]
  return low - 1 + (span > 0 ? Math.min(1, (time - refTimes[low - 1]) / span) : 0)
}
