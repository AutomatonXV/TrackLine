import monzaSvg from '../public/tracks/monza.svg?raw'
import spaSvg from '../public/tracks/spa.svg?raw'
import nurburgringSvg from '../public/tracks/nurburgring.svg?raw'

export const GUIDE_TRACKS = ['Monza', 'Spa-Francorchamps', 'Nürburgring GP'] as const
export type GuideTrack = typeof GUIDE_TRACKS[number]

export interface GuidePoint { x: number; y: number }
export interface GuideCorner {
  number: number
  direction: 'left' | 'right'
  character: 'tight' | 'medium' | 'flowing'
  points: { approach: GuidePoint; turnIn: GuidePoint; apex: GuidePoint; exit: GuidePoint }
  line: GuidePoint[]
}
export interface TrackGuide { track: GuideTrack; outline: GuidePoint[]; corners: GuideCorner[] }

const SOURCES: Record<GuideTrack, string> = {
  Monza: monzaSvg,
  'Spa-Francorchamps': spaSvg,
  'Nürburgring GP': nurburgringSvg,
}

const SAMPLE_COUNT = 360
const INDEX_WINDOW = 3
const TURN_THRESHOLD = 0.015
const CORNER_THRESHOLD = 0.25
const MERGE_GAP = 10
const TRACK_OFFSET = 4.5

const wrap = (index: number, length: number) => ((index % length) + length) % length
const distance = (a: GuidePoint, b: GuidePoint) => Math.hypot(b.x - a.x, b.y - a.y)

function routeFromSvg(svg: string): GuidePoint[] {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]
  const path = svg.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1]
  if (!viewBox || !path) throw new Error('The bundled track map has no usable route geometry.')
  const [minX, minY, width, height] = viewBox.split(/\s+/).map(Number)
  const numbers = path.match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi)?.map(Number)
  if (!numbers || numbers.length < 8 || numbers.length % 2 !== 0 || !numbers.every(Number.isFinite)) {
    throw new Error('The bundled track route contains invalid geometry.')
  }
  const points = Array.from({ length: numbers.length / 2 }, (_, index) => ({
    x: numbers[index * 2],
    y: numbers[index * 2 + 1],
  }))
  if (distance(points[0], points[points.length - 1]) < 0.01) points.pop()
  return points.map((point) => ({
    x: (point.x - minX) * 1000 / width,
    y: (point.y - minY) * 1000 / height,
  }))
}

function resampleClosed(points: GuidePoint[]): GuidePoint[] {
  const lengths = points.map((point, index) => distance(point, points[(index + 1) % points.length]))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const output: GuidePoint[] = []
  let segment = 0
  let walked = 0
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const target = total * index / SAMPLE_COUNT
    while (walked + lengths[segment] < target) {
      walked += lengths[segment]
      segment = (segment + 1) % points.length
    }
    const next = points[(segment + 1) % points.length]
    const amount = (target - walked) / Math.max(lengths[segment], 1e-9)
    output.push({
      x: points[segment].x + (next.x - points[segment].x) * amount,
      y: points[segment].y + (next.y - points[segment].y) * amount,
    })
  }
  return output
}

function localTurns(points: GuidePoint[]): number[] {
  return points.map((point, index) => {
    const before = points[wrap(index - 1, points.length)]
    const after = points[(index + 1) % points.length]
    const ax = point.x - before.x
    const ay = point.y - before.y
    const bx = after.x - point.x
    const by = after.y - point.y
    return Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
  })
}

function findCorners(turns: number[]) {
  const groups: { start: number; end: number; sum: number; sign: number; apex: number; peak: number }[] = []
  let active: typeof groups[number] | null = null
  for (let index = 0; index < turns.length; index += 1) {
    const angle = turns[index]
    if (Math.abs(angle) < TURN_THRESHOLD) continue
    if (!active || Math.sign(angle) !== active.sign || index - active.end > MERGE_GAP) {
      if (active) groups.push(active)
      active = { start: index, end: index, sum: 0, sign: Math.sign(angle), apex: index, peak: 0 }
    }
    active.end = index
    active.sum += angle
    if (Math.abs(angle) > active.peak) {
      active.peak = Math.abs(angle)
      active.apex = index
    }
  }
  if (active) groups.push(active)
  return groups
    .filter((corner) => Math.abs(corner.sum) >= CORNER_THRESHOLD)
    .map((corner) => ({
      ...corner,
      character: Math.abs(corner.sum) >= 2.4 ? 'tight' as const : Math.abs(corner.sum) >= 1.1 ? 'medium' as const : 'flowing' as const,
    }))
}

function tangent(points: GuidePoint[], index: number) {
  const before = points[wrap(index - INDEX_WINDOW, points.length)]
  const after = points[(index + INDEX_WINDOW) % points.length]
  const length = distance(before, after) || 1
  return { x: (after.x - before.x) / length, y: (after.y - before.y) / length }
}

function pointAt(points: GuidePoint[], index: number, offset = 0): GuidePoint {
  const at = wrap(index, points.length)
  const direction = tangent(points, at)
  return {
    x: points[at].x - direction.y * offset,
    y: points[at].y + direction.x * offset,
  }
}

function guideFor(track: GuideTrack): TrackGuide {
  const outline = resampleClosed(routeFromSvg(SOURCES[track]))
  const corners = findCorners(localTurns(outline))
  const guides: GuideCorner[] = corners.map((corner, index) => {
    const entry = wrap(corner.start - 8, outline.length)
    const turnIn = wrap(corner.start - 3, outline.length)
    const exit = wrap(corner.end + 8, outline.length)
    const entryOffset = -corner.sign * TRACK_OFFSET
    const apexOffset = corner.sign * TRACK_OFFSET
    const line: GuidePoint[] = []
    let length = wrap(exit - entry, outline.length)
    if (length === 0) length = outline.length
    const apexDistance = wrap(corner.apex - entry, outline.length)
    for (let step = 0; step <= length; step += 1) {
      const approachProgress = Math.min(1, step / Math.max(1, apexDistance))
      const exitProgress = step <= apexDistance ? 0 : (step - apexDistance) / Math.max(1, length - apexDistance)
      const smooth = (value: number) => value * value * (3 - 2 * value)
      const offset = step <= apexDistance
        ? entryOffset + (apexOffset - entryOffset) * smooth(approachProgress)
        : apexOffset + (entryOffset - apexOffset) * smooth(exitProgress)
      line.push(pointAt(outline, entry + step, offset))
    }
    return {
      number: index + 1,
      direction: corner.sign > 0 ? 'right' : 'left',
      character: corner.character,
      points: {
        approach: pointAt(outline, entry),
        turnIn: pointAt(outline, turnIn),
        apex: pointAt(outline, corner.apex, apexOffset),
        exit: pointAt(outline, exit),
      },
      line,
    }
  })

  return {
    track,
    outline,
    corners: guides,
  }
}

const CACHE = new Map<GuideTrack, TrackGuide>()

export function getTrackGuide(track: GuideTrack): TrackGuide {
  let guide = CACHE.get(track)
  if (!guide) {
    guide = guideFor(track)
    CACHE.set(track, guide)
  }
  return guide
}
