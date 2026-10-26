// Places dead-reckoned (speed + yaw rate) traces onto a surveyed track centerline.
// Centerline and widths: TUMFTM/racetrack-database (LGPL-3.0).
import monzaRaw from './data/monza-centerline.json'

export interface Pt { x: number; y: number }
export interface Fitted { laps: (Pt[] | null)[]; left: Pt[]; right: Pt[]; centre: Pt[]; shift: number }

interface Model { c: Pt[]; nx: number[]; ny: number[]; theta: number[]; right: number[]; left: number[]; count: number; length: number }
interface RawTrack { x: number[]; y: number[]; right: number[]; left: number[] }

const RAW: Record<string, RawTrack> = { Monza: monzaRaw }
const cache = new Map<string, Model>()

export const hasTrackModel = (track: string) => track in RAW

function buildModel(track: string): Model {
  const raw = RAW[track]
  const n = raw.x.length
  const seg = Array.from({ length: n }, (_, i) => Math.hypot(raw.x[(i + 1) % n] - raw.x[i], raw.y[(i + 1) % n] - raw.y[i]))
  const total = seg.reduce((a, b) => a + b, 0)
  const count = Math.round(total / 5)
  const c: Pt[] = []
  const right: number[] = []
  const left: number[] = []
  let at = 0
  let walked = 0
  for (let k = 0; k < count; k += 1) {
    const target = total * k / count
    while (walked + seg[at] < target) { walked += seg[at]; at = (at + 1) % n }
    const t = (target - walked) / Math.max(seg[at], 1e-9)
    const b = (at + 1) % n
    c.push({ x: raw.x[at] + (raw.x[b] - raw.x[at]) * t, y: raw.y[at] + (raw.y[b] - raw.y[at]) * t })
    right.push(raw.right[at] + (raw.right[b] - raw.right[at]) * t)
    left.push(raw.left[at] + (raw.left[b] - raw.left[at]) * t)
  }
  const nx: number[] = []
  const ny: number[] = []
  const theta: number[] = []
  for (let i = 0; i < count; i += 1) {
    const a = c[(i + count - 2) % count]
    const b = c[(i + 2) % count]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    nx.push(-(b.y - a.y) / len)
    ny.push((b.x - a.x) / len)
    theta.push(Math.atan2(b.y - a.y, b.x - a.x))
  }
  return { c, nx, ny, theta, right, left, count, length: total }
}

const getModel = (track: string) => {
  let model = cache.get(track)
  if (!model) { model = buildModel(track); cache.set(track, model) }
  return model
}

const wrap = (value: number, count: number) => ((value % count) + count) % count
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

function at(model: Model, index: number, offset: number): Pt {
  const base = Math.floor(index)
  const t = index - base
  const i = wrap(base, model.count)
  const j = wrap(base + 1, model.count)
  const a = model.c[i]
  const b = model.c[j]
  const nx = model.nx[i] + (model.nx[j] - model.nx[i]) * t
  const ny = model.ny[i] + (model.ny[j] - model.ny[i]) * t
  return { x: a.x + (b.x - a.x) * t + nx * offset, y: a.y + (b.y - a.y) * t + ny * offset }
}

function lowPass(values: number[], radius: number) {
  const n = values.length
  const prefix = [0]
  for (const v of values) prefix.push(prefix[prefix.length - 1] + v)
  return values.map((_, i) => {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(n - 1, i + radius)
    return (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1)
  })
}

// Heading of each trace point (radians), from central differences.
function headings(trace: Pt[]) {
  const n = trace.length
  const step = 3
  return trace.map((_, i) => {
    const a = trace[Math.max(0, i - step)]
    const b = trace[Math.min(n - 1, i + step)]
    return Math.atan2(b.y - a.y, b.x - a.x)
  })
}

interface Alignment { shift: number; mirrored: boolean; offset: number; score: number }

// Heading is immune to position drift, so the lap is aligned by matching its
// turn sequence against the surveyed centerline's tangent direction.
function align(model: Model, trace: Pt[], fixed?: { shift: number; mirrored: boolean }): Alignment {
  const n = trace.length
  const base = headings(trace)
  const picks = Array.from({ length: 160 }, (_, k) => Math.round(k * (n - 1) / 159))
  let best: Alignment = { shift: 0, mirrored: false, offset: 0, score: -1 }
  for (const mirrored of fixed ? [fixed.mirrored] : [false, true]) {
    const psi = base.map((h) => (mirrored ? -h : h))
    const shifts = fixed ? [fixed.shift] : Array.from({ length: model.count }, (_, s) => s)
    for (const shift of shifts) {
      let sx = 0
      let sy = 0
      for (const i of picks) {
        const diff = psi[i] - model.theta[wrap(Math.round(shift + model.count * i / (n - 1)), model.count)]
        sx += Math.cos(diff)
        sy += Math.sin(diff)
      }
      const score = Math.hypot(sx, sy) / picks.length
      if (score > best.score) best = { shift, mirrored, offset: Math.atan2(sy, sx), score }
    }
  }
  return best
}

// Lateral position from how far the car's heading departs from the track direction.
function lapPositions(model: Model, trace: Pt[], fit: Alignment): Pt[] {
  const n = trace.length
  const psi = headings(trace).map((h) => (fit.mirrored ? -h : h))
  const heading = psi.map((h, i) => wrapAngle(h - fit.offset - model.theta[wrap(Math.round(fit.shift + model.count * i / (n - 1)), model.count)]))
  const slow = lowPass(heading, Math.round(n / 8))
  const stepLength = model.length / (n - 1)
  const lateral: number[] = []
  let offset = 0
  for (let i = 0; i < n; i += 1) {
    offset += Math.sin(heading[i] - slow[i]) * stepLength
    lateral.push(offset)
  }
  const drift = lowPass(lateral, Math.round(n / 6))
  const centred = lateral.map((v, i) => v - drift[i])
  // Distribute any leftover so the lap finishes where it started.
  const gap = centred[n - 1] - centred[0]
  return centred.map((v, i) => {
    const index = fit.shift + model.count * i / (n - 1)
    const k = wrap(Math.round(index), model.count)
    const limited = Math.max(-model.right[k] * 0.9, Math.min(model.left[k] * 0.9, v - gap * i / (n - 1)))
    return at(model, index, limited)
  })
}

export function fitToTrack(track: string, traces: (Pt[] | null)[]): Fitted | null {
  if (!hasTrackModel(track)) return null
  const model = getModel(track)
  const present = traces.filter((t): t is Pt[] => !!t && t.length > 20)
  if (!present.length) return null

  const fits = new Map<Pt[], Alignment>()
  for (const t of present) fits.set(t, align(model, t))
  const best = present.reduce((a, b) => fits.get(b)!.score > fits.get(a)!.score ? b : a)
  const lead = fits.get(best)!
  if (lead.score < 0.6) return null

  // Every lap starts on the same line, so laps share the best-aligned lap's start.
  const results = traces.map((trace) => {
    if (!trace || trace.length <= 20) return null
    const fit = trace === best ? lead : align(model, trace, { shift: lead.shift, mirrored: lead.mirrored })
    return lapPositions(model, trace, fit)
  })

  // Rotate so the start/finish straight points along +x, matching the unmodelled view.
  const origin = model.c[wrap(lead.shift, model.count)]
  const ahead = model.c[wrap(lead.shift + 6, model.count)]
  const angle = -Math.atan2(ahead.y - origin.y, ahead.x - origin.x)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const turn = (p: Pt): Pt => ({ x: origin.x + (p.x - origin.x) * cos - (p.y - origin.y) * sin, y: origin.y + (p.x - origin.x) * sin + (p.y - origin.y) * cos })
  const edge = (side: 1 | -1) => model.c.map((c, i) => {
    const width = side > 0 ? model.left[i] : model.right[i]
    return turn({ x: c.x + side * model.nx[i] * width, y: c.y + side * model.ny[i] * width })
  })
  return {
    laps: results.map((lap) => lap && lap.map(turn)),
    left: edge(1),
    right: edge(-1),
    centre: model.c.map(turn),
    shift: lead.shift,
  }
}
