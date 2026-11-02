import monzaTrack from './data/tumftm/tracks/monza.csv?raw'
import spaTrack from './data/tumftm/tracks/spa.csv?raw'
import nurburgringTrack from './data/tumftm/tracks/nurburgring.csv?raw'
import monzaLine from './data/tumftm/racelines/monza.csv?raw'
import spaLine from './data/tumftm/racelines/spa.csv?raw'
import nurburgringLine from './data/tumftm/racelines/nurburgring.csv?raw'
import donintonTrack from './data/tumftm/tracks/donington.csv?raw'
import imolaTrack from './data/tumftm/tracks/imola.csv?raw'
import kyalamiTrack from './data/tumftm/tracks/kyalami.csv?raw'
import lagunaSecaTrack from './data/tumftm/tracks/laguna-seca.csv?raw'
import donintonLine from './data/tumftm/racelines/donington.csv?raw'
import imolaLine from './data/tumftm/racelines/imola.csv?raw'
import kyalamiLine from './data/tumftm/racelines/kyalami.csv?raw'
import lagunaSecaLine from './data/tumftm/racelines/laguna-seca.csv?raw'
import misanoTrack from './data/tumftm/tracks/misano.csv?raw'
import mountPanoramaTrack from './data/tumftm/tracks/mount-panorama.csv?raw'
import oultonParkTrack from './data/tumftm/tracks/oulton-park.csv?raw'
import paulRicardTrack from './data/tumftm/tracks/paul-ricard.csv?raw'
import snettertonTrack from './data/tumftm/tracks/snetterton.csv?raw'
import valenciaTrack from './data/tumftm/tracks/valencia.csv?raw'
import watkinsGlenTrack from './data/tumftm/tracks/watkins-glen.csv?raw'
import zolderTrack from './data/tumftm/tracks/zolder.csv?raw'
import cotaTrack from './data/tumftm/tracks/cota.csv?raw'
import brandsHatchTrack from './data/tumftm/tracks/brands-hatch.csv?raw'
import hungaroringTrack from './data/tumftm/tracks/hungaroring.csv?raw'
import barcelonaTrack from './data/tumftm/tracks/barcelona.csv?raw'
import indianapolisTrack from './data/tumftm/tracks/indianapolis.csv?raw'
import silverstoneTrack from './data/tumftm/tracks/silverstone.csv?raw'
import redBullRingTrack from './data/tumftm/tracks/red-bull-ring.csv?raw'
import zandvoortTrack from './data/tumftm/tracks/zandvoort.csv?raw'
import suzukaTrack from './data/tumftm/tracks/suzuka.csv?raw'
import misanoLine from './data/tumftm/racelines/misano.csv?raw'
import mountPanoramaLine from './data/tumftm/racelines/mount-panorama.csv?raw'
import oultonParkLine from './data/tumftm/racelines/oulton-park.csv?raw'
import paulRicardLine from './data/tumftm/racelines/paul-ricard.csv?raw'
import snettertonLine from './data/tumftm/racelines/snetterton.csv?raw'
import valenciaLine from './data/tumftm/racelines/valencia.csv?raw'
import watkinsGlenLine from './data/tumftm/racelines/watkins-glen.csv?raw'
import zolderLine from './data/tumftm/racelines/zolder.csv?raw'
import cotaLine from './data/tumftm/racelines/cota.csv?raw'
import brandsHatchLine from './data/tumftm/racelines/brands-hatch.csv?raw'
import hungaroringLine from './data/tumftm/racelines/hungaroring.csv?raw'
import barcelonaLine from './data/tumftm/racelines/barcelona.csv?raw'
import indianapolisLine from './data/tumftm/racelines/indianapolis.csv?raw'
import silverstoneLine from './data/tumftm/racelines/silverstone.csv?raw'
import redBullRingLine from './data/tumftm/racelines/red-bull-ring.csv?raw'
import zandvoortLine from './data/tumftm/racelines/zandvoort.csv?raw'
import suzukaLine from './data/tumftm/racelines/suzuka.csv?raw'
import { createRacingLineOptimizer, RACING_LINE_SECTOR_COUNT, type RacingLineSearchSpace } from './racingLineOptimizer'

export const GUIDE_TRACKS = [
  'Monza', 'Spa-Francorchamps', 'Nürburgring GP', 'Donington Park', 'Imola', 'Kyalami', 'Laguna Seca',
  'Misano', 'Mount Panorama', 'Oulton Park', 'Paul Ricard', 'Snetterton', 'Valencia', 'Watkins Glen', 'Zolder',
  'Circuit of the Americas', 'Brands Hatch', 'Hungaroring', 'Barcelona', 'Indianapolis', 'Silverstone',
  'Red Bull Ring', 'Zandvoort', 'Suzuka',
] as const
export type GuideTrack = typeof GUIDE_TRACKS[number]

export interface GuidePoint { x: number; y: number }
export interface GuideCorner {
  number: number
  direction: 'left' | 'right'
  character: 'tight' | 'medium' | 'flowing'
  startIndex: number
  apexIndex: number
  endIndex: number
  points: { approach: GuidePoint; turnIn: GuidePoint; apex: GuidePoint; exit: GuidePoint }
  line: GuidePoint[]
}
export interface TrackGuide {
  track: GuideTrack
  lengthMeters: number
  leftEdge: GuidePoint[]
  rightEdge: GuidePoint[]
  centerline: GuidePoint[]
  racingLine: GuidePoint[]
  optimizer: RacingLineSearchSpace
  corners: GuideCorner[]
}

interface TrackPoint extends GuidePoint { rightWidth: number; leftWidth: number }

const SOURCES: Record<GuideTrack, { track: string; line: string }> = {
  Monza: { track: monzaTrack, line: monzaLine },
  'Spa-Francorchamps': { track: spaTrack, line: spaLine },
  'Nürburgring GP': { track: nurburgringTrack, line: nurburgringLine },
  'Donington Park': { track: donintonTrack, line: donintonLine },
  Imola: { track: imolaTrack, line: imolaLine },
  Kyalami: { track: kyalamiTrack, line: kyalamiLine },
  'Laguna Seca': { track: lagunaSecaTrack, line: lagunaSecaLine },
  Misano: { track: misanoTrack, line: misanoLine },
  'Mount Panorama': { track: mountPanoramaTrack, line: mountPanoramaLine },
  'Oulton Park': { track: oultonParkTrack, line: oultonParkLine },
  'Paul Ricard': { track: paulRicardTrack, line: paulRicardLine },
  Snetterton: { track: snettertonTrack, line: snettertonLine },
  Valencia: { track: valenciaTrack, line: valenciaLine },
  'Watkins Glen': { track: watkinsGlenTrack, line: watkinsGlenLine },
  Zolder: { track: zolderTrack, line: zolderLine },
  'Circuit of the Americas': { track: cotaTrack, line: cotaLine },
  'Brands Hatch': { track: brandsHatchTrack, line: brandsHatchLine },
  Hungaroring: { track: hungaroringTrack, line: hungaroringLine },
  Barcelona: { track: barcelonaTrack, line: barcelonaLine },
  Indianapolis: { track: indianapolisTrack, line: indianapolisLine },
  Silverstone: { track: silverstoneTrack, line: silverstoneLine },
  'Red Bull Ring': { track: redBullRingTrack, line: redBullRingLine },
  Zandvoort: { track: zandvoortTrack, line: zandvoortLine },
  Suzuka: { track: suzukaTrack, line: suzukaLine },
}

export function trackCenterlineCsv(track: string): string | null {
  return track in SOURCES ? SOURCES[track as GuideTrack].track : null
}

const SAMPLE_COUNT = 1200
const TURN_THRESHOLD = 0.006
const CORNER_THRESHOLD = 0.22
const MERGE_GAP = 8
const MARKER_APPROACH = 14
const MARKER_TURN_IN = 4
export const MAP_WIDTH_VISUAL_SCALE = 2.8
const usableWidthFor = (track: string) => track === 'Monza' ? 0.97 : 0.95

const wrap = (index: number, length: number) => ((index % length) + length) % length
const distance = (a: GuidePoint, b: GuidePoint) => Math.hypot(b.x - a.x, b.y - a.y)

function parseTrack(content: string): TrackPoint[] {
  return content.split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [x, y, rightWidth, leftWidth] = line.split(',').map(Number)
      if (![x, y, rightWidth, leftWidth].every(Number.isFinite) || rightWidth <= 0 || leftWidth <= 0) {
        throw new Error('The bundled track centerline contains invalid coordinates or widths.')
      }
      return { x, y, rightWidth, leftWidth }
    })
}

function parseRacingLine(content: string): GuidePoint[] {
  return content.split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [x, y] = line.split(',').map(Number)
      if (![x, y].every(Number.isFinite)) {
        throw new Error('The bundled optimized racing line contains invalid coordinates.')
      }
      return { x, y }
    })
}

function pathLength(points: GuidePoint[]) {
  return points.reduce((length, point, index) => length + distance(point, points[(index + 1) % points.length]), 0)
}

function resampleClosed<T extends GuidePoint>(points: T[], count: number, interpolate: (current: T, next: T, amount: number) => T): T[] {
  if (points.length < 3) throw new Error('The bundled circuit geometry has too few points.')
  const lengths = points.map((point, index) => distance(point, points[(index + 1) % points.length]))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const output: T[] = []
  let segment = 0
  let walked = 0
  for (let index = 0; index < count; index += 1) {
    const target = total * index / count
    while (segment < points.length - 1 && walked + lengths[segment] < target) {
      walked += lengths[segment]
      segment += 1
    }
    const next = points[(segment + 1) % points.length]
    const amount = (target - walked) / Math.max(lengths[segment], 1e-9)
    output.push(interpolate(points[segment], next, amount))
  }
  return output
}

const interpolatePoint = (current: GuidePoint, next: GuidePoint, amount: number) => ({
  x: current.x + (next.x - current.x) * amount,
  y: current.y + (next.y - current.y) * amount,
})

function resampleTrack(points: TrackPoint[]) {
  return resampleClosed(points, SAMPLE_COUNT, (current, next, amount) => ({
    ...interpolatePoint(current, next, amount),
    rightWidth: current.rightWidth + (next.rightWidth - current.rightWidth) * amount,
    leftWidth: current.leftWidth + (next.leftWidth - current.leftWidth) * amount,
  }))
}

function resampleRacingLine(points: GuidePoint[]) {
  return resampleClosed(points, SAMPLE_COUNT, interpolatePoint)
}

function boundaryPoints(centerline: TrackPoint[]) {
  const left: GuidePoint[] = []
  const right: GuidePoint[] = []
  for (let index = 0; index < centerline.length; index += 1) {
    const before = centerline[wrap(index - 1, centerline.length)]
    const after = centerline[(index + 1) % centerline.length]
    const length = distance(before, after) || 1
    const normalX = -(after.y - before.y) / length
    const normalY = (after.x - before.x) / length
    const point = centerline[index]
    left.push({ x: point.x + normalX * point.leftWidth, y: point.y + normalY * point.leftWidth })
    right.push({ x: point.x - normalX * point.rightWidth, y: point.y - normalY * point.rightWidth })
  }
  return { left, right }
}

// Shortest-path relaxation inside the track limits: each sector slides toward the chord between its
// neighbours and stops at the limit, so the line swings to the kerbs instead of hugging the centerline.
function hugEdges(center: GuidePoint[], normals: GuidePoint[], leftLimit: number[], rightLimit: number[]) {
  const count = RACING_LINE_SECTOR_COUNT
  const step = center.length / count
  const index = (sector: number) => Math.floor(wrap(sector, count) * step)
  const lateral = new Array<number>(count).fill(0)
  const position = (sector: number) => {
    const source = index(sector)
    return { x: center[source].x + normals[source].x * lateral[wrap(sector, count)], y: center[source].y + normals[source].y * lateral[wrap(sector, count)] }
  }
  for (let pass = 0; pass < 6000; pass += 1) {
    for (let sector = 0; sector < count; sector += 1) {
      const before = position(sector - 1)
      const after = position(sector + 1)
      const source = index(sector)
      const target = ((before.x + after.x) / 2 - center[source].x) * normals[source].x + ((before.y + after.y) / 2 - center[source].y) * normals[source].y
      const next = lateral[sector] + 1.85 * (target - lateral[sector])
      lateral[sector] = Math.max(-rightLimit[source], Math.min(leftLimit[source], next))
    }
  }
  return lateral.map((value, sector) => {
    const source = index(sector)
    const limit = value >= 0 ? leftLimit[source] : rightLimit[source]
    return Math.max(-0.97, Math.min(0.97, value / Math.max(limit, 1e-9)))
  })
}

function fitToMap(centerline: TrackPoint[], left: GuidePoint[], right: GuidePoint[], racingLine: GuidePoint[], usableWidth: number) {
  const widen = (point: GuidePoint, center: GuidePoint) => ({
    x: center.x + (point.x - center.x) * MAP_WIDTH_VISUAL_SCALE,
    y: center.y + (point.y - center.y) * MAP_WIDTH_VISUAL_SCALE,
  })
  const wideLeft = left.map((point, index) => widen(point, centerline[index]))
  const wideRight = right.map((point, index) => widen(point, centerline[index]))
  const points = [...wideLeft, ...wideRight, ...racingLine]
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const scale = 920 / Math.max(maxX - minX, maxY - minY, 1)
  const offsetX = (1000 - (maxX - minX) * scale) / 2
  const offsetY = (1000 - (maxY - minY) * scale) / 2
  const fit = (point: GuidePoint): GuidePoint => ({
    x: offsetX + (point.x - minX) * scale,
    y: 1000 - offsetY - (point.y - minY) * scale,
  })
  const mappedCenterline = centerline.map(fit)
  const normals = centerline.map((_, index) => {
    const before = centerline[wrap(index - 1, centerline.length)]
    const after = centerline[(index + 1) % centerline.length]
    const length = distance(before, after) || 1
    return { x: -(after.y - before.y) / length, y: -(after.x - before.x) / length }
  })
  const leftLimit = centerline.map((point) => point.leftWidth * scale * usableWidth)
  const rightLimit = centerline.map((point) => point.rightWidth * scale * usableWidth)
  const initialOffsets = hugEdges(mappedCenterline, normals, leftLimit, rightLimit)
  const optimizer: RacingLineSearchSpace = {
    center: mappedCenterline,
    normals,
    leftLimit,
    rightLimit,
    metersPerMapUnit: 1 / scale,
    initialOffsets,
    displayWidthScale: MAP_WIDTH_VISUAL_SCALE,
  }
  return {
    centerline: mappedCenterline,
    leftEdge: wideLeft.map(fit),
    rightEdge: wideRight.map(fit),
    racingLine: racingLine.map(fit),
    optimizer,
  }
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

function findCorners(turns: number[], sampleSpacing: number) {
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

  if (groups.length > 1) {
    const first = groups[0]
    const last = groups[groups.length - 1]
    if (first.sign === last.sign && first.start + turns.length - last.end <= MERGE_GAP) {
      const wrapped = {
        start: last.start,
        end: first.end + turns.length,
        sum: first.sum + last.sum,
        sign: first.sign,
        apex: first.peak > last.peak ? first.apex : last.apex,
        peak: Math.max(first.peak, last.peak),
      }
      groups.splice(groups.length - 1, 1)
      groups.splice(0, 1, wrapped)
    }
  }

  return groups
    .filter((corner) => Math.abs(corner.sum) >= CORNER_THRESHOLD)
    .map((corner) => ({
      ...corner,
      character: sampleSpacing / corner.peak <= 45 ? 'tight' as const
        : sampleSpacing / corner.peak <= 110 ? 'medium' as const : 'flowing' as const,
    }))
}

function pointAt(points: GuidePoint[], index: number): GuidePoint {
  return points[wrap(index, points.length)]
}

function sliceClosed(points: GuidePoint[], start: number, end: number) {
  const result: GuidePoint[] = []
  for (let index = start; index <= end; index += 1) result.push(pointAt(points, index))
  return result
}

function guideFor(track: GuideTrack): TrackGuide {
  const source = SOURCES[track]
  const rawCenterline = parseTrack(source.track)
  const rawRacingLine = parseRacingLine(source.line)
  const lengthMeters = pathLength(rawCenterline)
  const centerline = resampleTrack(rawCenterline)
  const racingLine = resampleRacingLine(rawRacingLine)
  const bounds = boundaryPoints(centerline)
  const fitted = fitToMap(centerline, bounds.left, bounds.right, racingLine, usableWidthFor(track))
  const sampleSpacing = pathLength(racingLine) / SAMPLE_COUNT
  const groups = findCorners(localTurns(racingLine), sampleSpacing)
  const corners: GuideCorner[] = groups.map((corner, index) => {
    const entry = corner.start - MARKER_APPROACH
    const turnIn = corner.start - MARKER_TURN_IN
    const exit = corner.end + MARKER_APPROACH
    return {
      number: index + 1,
      direction: corner.sign > 0 ? 'left' : 'right',
      character: corner.character,
      startIndex: wrap(entry, SAMPLE_COUNT),
      apexIndex: wrap(corner.apex, SAMPLE_COUNT),
      endIndex: wrap(exit, SAMPLE_COUNT),
      points: {
        approach: pointAt(fitted.racingLine, entry),
        turnIn: pointAt(fitted.racingLine, turnIn),
        apex: pointAt(fitted.racingLine, corner.apex),
        exit: pointAt(fitted.racingLine, exit),
      },
      line: sliceClosed(fitted.racingLine, entry, exit),
    }
  })

  return { track, lengthMeters, ...fitted, corners }
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

export const optimizerSeed = (track: string) => [...track].reduce((seed, character) => (seed * 31 + character.charCodeAt(0)) >>> 0, 7)

export interface IdealLine {
  // Signed lateral position per sample around the lap, as a fraction of the half-width on that side (+ is left).
  lateral: number[]
  usableWidth: number
  lapSeconds: number
}

const IDEAL = new Map<string, IdealLine>()

// The pre-flight optimizer's finished line, so other views can draw the same ideal line.
export function idealLine(track: string): IdealLine | null {
  if (!(track in SOURCES)) return null
  let ideal = IDEAL.get(track)
  if (!ideal) {
    const guide = getTrackGuide(track as GuideTrack)
    const optimizer = createRacingLineOptimizer(guide.optimizer, optimizerSeed(track))
    let progress = optimizer.current()
    while (!progress.complete) progress = optimizer.step()
    ideal = { lateral: progress.lateral, usableWidth: usableWidthFor(track), lapSeconds: progress.estimatedLapSeconds }
    IDEAL.set(track, ideal)
  }
  return ideal
}
