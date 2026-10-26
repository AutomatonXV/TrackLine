import type { LapTrace } from './useLiveRun'

export interface RefTrace { speeds: number[]; throttles: number[]; brakes: number[]; metersPerSample: number }
export interface Zone { a: number; b: number; loss: number; lines: string[]; fromLast: boolean }

const SEGMENTS = 24
const MIN_LOSS = 0.05
const MAX_ZONES = 4
const BRAKE_ON = 15
const THROTTLE_ON = 60
const LEAD_IN = 10

type Series = (number | null)[]

const first = (values: Series, from: number, to: number, test: (value: number) => boolean) => {
  for (let i = Math.max(0, from); i <= to; i += 1) { const value = values[i]; if (value != null && test(value)) return i }
  return -1
}
const extreme = (values: Series, from: number, to: number, pick: 'min' | 'max') => {
  let best = pick === 'min' ? Infinity : -Infinity
  let at = -1
  for (let i = Math.max(0, from); i <= to; i += 1) {
    const value = values[i]
    if (value == null) continue
    if (pick === 'min' ? value < best : value > best) { best = value; at = i }
  }
  return { value: best, at }
}

// Explains in plain words where the driver lost time between samples a and b.
export function explain(ref: RefTrace, mine: LapTrace, a: number, b: number): string[] {
  const m = ref.metersPerSample
  const from = a - LEAD_IN
  const found: string[] = []

  const refBrake = first(ref.brakes, from, b, (v) => v >= BRAKE_ON)
  const myBrake = first(mine.brakes, from, b, (v) => v >= BRAKE_ON)
  const refPeak = extreme(ref.brakes, from, b, 'max').value
  const myPeak = extreme(mine.brakes, from, b, 'max').value
  if (refBrake >= 0 && myBrake < 0 && refPeak >= 30) found.push('Lifted instead of braking where the reference brakes')
  else if (refBrake >= 0 && myBrake >= 0) {
    const early = (refBrake - myBrake) * m
    if (early >= 8) found.push(`Braked ${Math.round(early)} m too early`)
    else if (myPeak < refPeak - 12) found.push(`Brake pressure low: ${Math.round(myPeak)}% vs ${Math.round(refPeak)}%`)
    else if (myPeak > refPeak + 15) found.push(`Over-braking: ${Math.round(myPeak)}% vs ${Math.round(refPeak)}%`)
  }

  const refMin = extreme(ref.speeds, a, b, 'min')
  const myMin = extreme(mine.speeds, a, b, 'min')
  if (refMin.at >= 0 && myMin.at >= 0 && refMin.value - myMin.value >= 3) {
    found.push(`Min speed ${Math.round(refMin.value - myMin.value)} km/h low (${Math.round(myMin.value)} vs ${Math.round(refMin.value)})`)
  }

  if (refMin.at >= 0 && myMin.at >= 0) {
    const refGo = first(ref.throttles, refMin.at, b, (v) => v >= THROTTLE_ON)
    const myGo = first(mine.throttles, myMin.at, b, (v) => v >= THROTTLE_ON)
    if (refGo >= 0 && myGo >= 0 && (myGo - refGo) * m >= 10) found.push(`Late on throttle by ${Math.round((myGo - refGo) * m)} m`)
    else if (refGo >= 0 && myGo < 0) found.push('Never got back to full throttle here')
  }

  let flat = 0
  let lifted = 0
  for (let i = a; i <= b; i += 1) {
    const mineThrottle = mine.throttles[i]
    if (ref.throttles[i] >= 90 && mineThrottle != null) { flat += 1; if (mineThrottle < 70) lifted += 1 }
  }
  if (flat >= 4 && lifted / flat > 0.25) found.push(`Lifting where the reference is flat out (${Math.round(lifted * m)} m)`)

  if (!found.length) {
    let sum = 0
    let count = 0
    for (let i = a; i <= b; i += 1) {
      const speed = mine.speeds[i]
      if (speed != null) { sum += ref.speeds[i] - speed; count += 1 }
    }
    if (count && sum / count >= 2) found.push(`${Math.round(sum / count)} km/h slower on average through here`)
    else found.push('Small losses spread through this section')
  }
  return found.slice(0, 2)
}

// Slow stretches of the lap so far. A stretch is judged once the car has driven through it; until
// then the previous lap's verdict for that stretch stays on screen.
export function liveZones(ref: RefTrace, current: LapTrace, last: LapTrace | null, pos: number): Zone[] {
  const n = ref.speeds.length
  const edges = Array.from({ length: SEGMENTS + 1 }, (_, i) => Math.round(i * (n - 1) / SEGMENTS))
  const judged = edges.slice(0, -1).map((a, i) => {
    const b = edges[i + 1]
    const passed = pos * (n - 1) >= b
    const source = [passed ? current : null, last].find((trace) => trace && trace.deltas[a] != null && trace.deltas[b] != null)
    if (!source) return null
    return { a, b, loss: (source.deltas[b] as number) - (source.deltas[a] as number), source, fromLast: source === last && source !== current }
  })

  const zones: Zone[] = []
  for (let i = 0; i < judged.length; i += 1) {
    const segment = judged[i]
    if (!segment || segment.loss < MIN_LOSS) continue
    let end = i
    let loss = segment.loss
    while (end + 1 < judged.length) {
      const next = judged[end + 1]
      if (!next || next.loss < MIN_LOSS || next.source !== segment.source) break
      loss += next.loss
      end += 1
    }
    const b = judged[end]!.b
    zones.push({ a: segment.a, b, loss, lines: explain(ref, segment.source!, segment.a, b), fromLast: segment.fromLast })
    i = end
  }
  return zones.sort((p, q) => q.loss - p.loss).slice(0, MAX_ZONES)
}
