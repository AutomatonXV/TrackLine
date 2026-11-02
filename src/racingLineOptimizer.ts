export interface RacingLinePoint { x: number; y: number }

export interface RacingLineSearchSpace {
  center: RacingLinePoint[]
  normals: RacingLinePoint[]
  leftLimit: number[]
  rightLimit: number[]
  metersPerMapUnit: number
  initialOffsets: number[]
  displayWidthScale: number
}

export interface RacingLineProgress {
  iteration: number
  totalIterations: number
  complete: boolean
  line: RacingLinePoint[]
  candidate: RacingLinePoint[]
  lateral: number[]
  speedsKmh: number[]
  accelerationsMps2: number[]
  estimatedLapSeconds: number
}

export interface RacingLineTelemetry {
  speedMps: number[]
  throttlePercent: number[]
  brakePercent: number[]
  lateralAccelerationMps2: number[]
  longitudinalAccelerationMps2: number[]
}

interface Particle {
  position: number[]
  velocity: number[]
  bestPosition: number[]
  bestCost: number
}

const PARTICLE_COUNT = 20
export const RACING_LINE_SECTOR_COUNT = 240
const SECTOR_COUNT = RACING_LINE_SECTOR_COUNT
const LINE_SAMPLE_COUNT = 960
// Curvature is measured over a few metres either side so tiny kinks in the path do not read as corners.
const CURVATURE_SPAN = 3
const ITERATION_COUNT = 48
const INERTIA = 0.72
const COGNITIVE_WEIGHT = 1.35
const SOCIAL_WEIGHT = 1.35
const MAX_SPEED_MPS = 82
const MAX_OFFSET = 0.97

// Defaults describe a GT3 car: about 1.7 g of grip, braking that grows with speed as drag and
// downforce help, and acceleration that fades toward top speed.
const LATERAL_ACCELERATION_MPS2 = 17
const BRAKE_BASE_MPS2 = 14.5
const BRAKE_PER_SPEED = 0.06
const ACCELERATION_BASE_MPS2 = 6
const DRAG_PER_SPEED_SQUARED = 0.00095

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const wrap = (index: number, length: number) => ((index % length) + length) % length

function percentile(values: number[], fraction: number) {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

interface VehicleLimits {
  lateral: number
  brakeBase: number
  accelerationScale: number
}

const accelerationAt = (limits: VehicleLimits, speed: number) =>
  Math.max(0.3, (ACCELERATION_BASE_MPS2 - DRAG_PER_SPEED_SQUARED * speed * speed) * limits.accelerationScale)
const brakingAt = (limits: VehicleLimits, speed: number) => limits.brakeBase + BRAKE_PER_SPEED * speed

function vehicleLimits(telemetry?: RacingLineTelemetry): VehicleLimits {
  const limits: VehicleLimits = { lateral: LATERAL_ACCELERATION_MPS2, brakeBase: BRAKE_BASE_MPS2, accelerationScale: 1 }
  if (!telemetry) return limits

  const lateral = telemetry.lateralAccelerationMps2.filter((value, index) =>
    telemetry.speedMps[index] > 25 && value > 5)
  const acceleration = telemetry.longitudinalAccelerationMps2.filter((value, index) =>
    telemetry.throttlePercent[index] >= 70 && value > 0.5)
  const braking = telemetry.longitudinalAccelerationMps2
    .map((value, index) => telemetry.brakePercent[index] >= 20 && value < -1 ? -value : 0)
    .filter((value) => value > 0)

  if (lateral.length >= 10) limits.lateral = clamp(percentile(lateral, 0.8), 8, 22)
  if (acceleration.length >= 12) {
    const typical = ACCELERATION_BASE_MPS2 - DRAG_PER_SPEED_SQUARED * 40 * 40
    limits.accelerationScale = clamp(percentile(acceleration, 0.8) / typical, 0.5, 1.6)
  }
  if (braking.length >= 8) limits.brakeBase = clamp(percentile(braking, 0.7), 8, 22) - BRAKE_PER_SPEED * 40
  return limits
}

// Catmull-Rom through the sector offsets keeps the path smooth, so curvature (and the speed limit
// derived from it) changes gradually instead of spiking at every sector boundary.
function smoothOffset(offsets: number[], position: number) {
  const sector = Math.floor(position)
  const t = position - sector
  const p0 = offsets[wrap(sector - 1, SECTOR_COUNT)]
  const p1 = offsets[wrap(sector, SECTOR_COUNT)]
  const p2 = offsets[wrap(sector + 1, SECTOR_COUNT)]
  const p3 = offsets[wrap(sector + 2, SECTOR_COUNT)]
  const value = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
  return clamp(value, -1, 1)
}

function lineFor(space: RacingLineSearchSpace, offsets: number[], lateralScale = 1): RacingLinePoint[] {
  return Array.from({ length: LINE_SAMPLE_COUNT }, (_, index) => {
    const offset = smoothOffset(offsets, index * SECTOR_COUNT / LINE_SAMPLE_COUNT)
    const sourcePosition = index * space.center.length / LINE_SAMPLE_COUNT
    const source = Math.floor(sourcePosition)
    const sourceBlend = sourcePosition - source
    const next = (source + 1) % space.center.length
    const interpolate = (values: RacingLinePoint[]) => ({
      x: values[source].x + (values[next].x - values[source].x) * sourceBlend,
      y: values[source].y + (values[next].y - values[source].y) * sourceBlend,
    })
    const center = interpolate(space.center)
    const interpolatedNormal = interpolate(space.normals)
    const normalLength = Math.hypot(interpolatedNormal.x, interpolatedNormal.y) || 1
    const normal = { x: interpolatedNormal.x / normalLength, y: interpolatedNormal.y / normalLength }
    const limitValues = offset >= 0 ? space.leftLimit : space.rightLimit
    const limit = limitValues[source] + (limitValues[next] - limitValues[source]) * sourceBlend
    const distance = offset * limit * lateralScale
    return { x: center.x + normal.x * distance, y: center.y + normal.y * distance }
  })
}

function lateralFor(offsets: number[]) {
  return Array.from({ length: LINE_SAMPLE_COUNT }, (_, index) => smoothOffset(offsets, index * SECTOR_COUNT / LINE_SAMPLE_COUNT))
}

function evaluate(space: RacingLineSearchSpace, offsets: number[], limits: VehicleLimits) {
  const line = lineFor(space, offsets)
  const count = line.length
  const distances = new Array<number>(count)
  const speedLimits = new Array<number>(count)
  for (let index = 0; index < count; index += 1) {
    const point = line[index]
    const next = line[(index + 1) % count]
    distances[index] = Math.hypot(next.x - point.x, next.y - point.y) * space.metersPerMapUnit
  }
  for (let index = 0; index < count; index += 1) {
    const before = line[wrap(index - CURVATURE_SPAN, count)]
    const point = line[index]
    const after = line[(index + CURVATURE_SPAN) % count]
    const firstX = point.x - before.x
    const firstY = point.y - before.y
    const secondX = after.x - point.x
    const secondY = after.y - point.y
    const firstDistance = Math.hypot(firstX, firstY) * space.metersPerMapUnit
    const secondDistance = Math.hypot(secondX, secondY) * space.metersPerMapUnit
    const turn = Math.atan2(firstX * secondY - firstY * secondX, firstX * secondX + firstY * secondY)
    const curvature = Math.abs(turn) / Math.max((firstDistance + secondDistance) / 2, 0.01)
    speedLimits[index] = Math.min(MAX_SPEED_MPS, Math.sqrt(limits.lateral / Math.max(curvature, 0.00002)))
    if (!Number.isFinite(firstDistance) || !Number.isFinite(secondDistance) || !Number.isFinite(speedLimits[index])) {
      return { line, speedsKmh: [], accelerationsMps2: [], lapSeconds: Number.POSITIVE_INFINITY }
    }
  }

  const speeds = speedLimits.slice()
  for (let pass = 0; pass < 3; pass += 1) {
    for (let index = 0; index < count; index += 1) {
      const previous = wrap(index - 1, count)
      const reachable = Math.sqrt(speeds[previous] ** 2 + 2 * accelerationAt(limits, speeds[previous]) * distances[previous])
      speeds[index] = Math.min(speeds[index], reachable)
    }
    for (let index = count - 1; index >= 0; index -= 1) {
      const next = (index + 1) % count
      const reachable = Math.sqrt(speeds[next] ** 2 + 2 * brakingAt(limits, speeds[next]) * distances[index])
      speeds[index] = Math.min(speeds[index], reachable)
    }
  }

  let lapSeconds = 0
  const accelerationsMps2 = new Array<number>(count)
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count
    lapSeconds += distances[index] / Math.max((speeds[index] + speeds[next]) / 2, 1)
    accelerationsMps2[index] = (speeds[next] ** 2 - speeds[index] ** 2) / Math.max(2 * distances[index], 0.01)
  }
  return { line, speedsKmh: speeds.map((speed) => speed * 3.6), accelerationsMps2, lapSeconds }
}

// Minimum-curvature path inside the limits: each sector slides to where the path through its
// neighbours is straightest, which gives the classic wide-in, apex, wide-out shape.
function minimumCurvatureOffsets(space: RacingLineSearchSpace) {
  const step = space.center.length / SECTOR_COUNT
  const source = (sector: number) => Math.floor(wrap(sector, SECTOR_COUNT) * step)
  const unit = (index: number) => {
    const normal = space.normals[index]
    const length = Math.hypot(normal.x, normal.y) || 1
    return { x: normal.x / length, y: normal.y / length }
  }
  const normals = Array.from({ length: SECTOR_COUNT }, (_, sector) => unit(source(sector)))
  const lateral = space.initialOffsets.map((offset, sector) =>
    offset * (offset >= 0 ? space.leftLimit[source(sector)] : space.rightLimit[source(sector)]))
  const point = (sector: number) => {
    const wrapped = wrap(sector, SECTOR_COUNT)
    const centre = space.center[source(wrapped)]
    return { x: centre.x + normals[wrapped].x * lateral[wrapped], y: centre.y + normals[wrapped].y * lateral[wrapped] }
  }
  for (let pass = 0; pass < 4000; pass += 1) {
    for (let sector = 0; sector < SECTOR_COUNT; sector += 1) {
      const a = point(sector - 2)
      const b = point(sector - 1)
      const c = point(sector)
      const d = point(sector + 1)
      const e = point(sector + 2)
      const secondBefore = { x: a.x - 2 * b.x + c.x, y: a.y - 2 * b.y + c.y }
      const secondHere = { x: b.x - 2 * c.x + d.x, y: b.y - 2 * c.y + d.y }
      const secondAfter = { x: c.x - 2 * d.x + e.x, y: c.y - 2 * d.y + e.y }
      const normal = normals[sector]
      const gradient = normal.x * (secondBefore.x + secondAfter.x - 2 * secondHere.x)
        + normal.y * (secondBefore.y + secondAfter.y - 2 * secondHere.y)
      const index = source(sector)
      const next = lateral[sector] - 1.5 * gradient / 6
      lateral[sector] = clamp(next, -space.rightLimit[index] * MAX_OFFSET, space.leftLimit[index] * MAX_OFFSET)
    }
  }
  return lateral.map((value, sector) => {
    const index = source(sector)
    return clamp(value / Math.max(value >= 0 ? space.leftLimit[index] : space.rightLimit[index], 1e-9), -MAX_OFFSET, MAX_OFFSET)
  })
}

export function createRacingLineOptimizer(space: RacingLineSearchSpace, seed: number, telemetry?: RacingLineTelemetry) {
  if (space.center.length < LINE_SAMPLE_COUNT || space.normals.length !== space.center.length
    || space.leftLimit.length !== space.center.length || space.rightLimit.length !== space.center.length
    || space.initialOffsets.length !== SECTOR_COUNT
    || space.initialOffsets.some((offset) => !Number.isFinite(offset) || offset < -1 || offset > 1)
    || !Number.isFinite(space.displayWidthScale) || space.displayWidthScale <= 0
    || !Number.isFinite(space.metersPerMapUnit) || space.metersPerMapUnit <= 0) {
    throw new Error('The racing-line optimizer requires matching track centerline and boundary data.')
  }
  if (telemetry && (
    telemetry.speedMps.length < 30
    || telemetry.throttlePercent.length !== telemetry.speedMps.length
    || telemetry.brakePercent.length !== telemetry.speedMps.length
    || telemetry.lateralAccelerationMps2.length !== telemetry.speedMps.length
    || telemetry.longitudinalAccelerationMps2.length !== telemetry.speedMps.length
    || [
      ...telemetry.speedMps,
      ...telemetry.throttlePercent,
      ...telemetry.brakePercent,
      ...telemetry.lateralAccelerationMps2,
      ...telemetry.longitudinalAccelerationMps2,
    ].some((value) => !Number.isFinite(value))
    || telemetry.throttlePercent.some((value) => value < 0 || value > 100)
    || telemetry.brakePercent.some((value) => value < 0 || value > 100)
  )) {
    throw new Error('MoTeC telemetry must contain aligned, finite speed, pedal, and acceleration samples.')
  }
  const limits = vehicleLimits(telemetry)

  let randomState = seed >>> 0 || 1
  const random = () => {
    randomState = (1664525 * randomState + 1013904223) >>> 0
    return randomState / 0x100000000
  }
  const cost = (offsets: number[]) => evaluate(space, offsets, limits).lapSeconds
  // Start from the quickest blend of the shortest path and the smoothest path, then let the swarm refine it.
  const smoothest = minimumCurvatureOffsets(space)
  const seedOffsets = [0, 0.25, 0.5, 0.75, 1]
    .map((mix) => space.initialOffsets.map((offset, sector) => offset + (smoothest[sector] - offset) * mix))
    .reduce((best, offsets) => cost(offsets) < cost(best) ? offsets : best)
  const makePosition = (index: number) => index === 0
    ? seedOffsets.slice()
    : seedOffsets.map((offset) => clamp(offset + (random() * 2 - 1) * 0.04 * index / PARTICLE_COUNT * 3, -MAX_OFFSET, MAX_OFFSET))
  const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const position = makePosition(index)
    return {
      position,
      velocity: position.map(() => (random() * 0.04) - 0.02),
      bestPosition: position.slice(),
      bestCost: cost(position),
    }
  })
  let globalBest = particles.reduce((best, particle) => particle.bestCost < best.bestCost ? particle : best, particles[0]).bestPosition.slice()
  let globalBestCost = cost(globalBest)
  let iteration = 0
  let candidate = particles[1].position.slice()

  const snapshot = (): RacingLineProgress => {
    const best = evaluate(space, globalBest, limits)
    return {
      iteration,
      totalIterations: ITERATION_COUNT,
      complete: iteration >= ITERATION_COUNT,
      line: lineFor(space, globalBest, space.displayWidthScale),
      candidate: lineFor(space, candidate, space.displayWidthScale),
      lateral: lateralFor(globalBest),
      speedsKmh: best.speedsKmh,
      accelerationsMps2: best.accelerationsMps2,
      estimatedLapSeconds: best.lapSeconds,
    }
  }

  return {
    current: snapshot,
    step(): RacingLineProgress {
      if (iteration >= ITERATION_COUNT) return snapshot()
      candidate = particles[(iteration % (PARTICLE_COUNT - 1)) + 1].position.slice()
      for (const particle of particles) {
        for (let dimension = 0; dimension < SECTOR_COUNT; dimension += 1) {
          const velocity = INERTIA * particle.velocity[dimension]
            + COGNITIVE_WEIGHT * random() * (particle.bestPosition[dimension] - particle.position[dimension])
            + SOCIAL_WEIGHT * random() * (globalBest[dimension] - particle.position[dimension])
          particle.velocity[dimension] = clamp(velocity, -0.04, 0.04)
          particle.position[dimension] = clamp(particle.position[dimension] + particle.velocity[dimension], -MAX_OFFSET, MAX_OFFSET)
        }

        const particleCost = cost(particle.position)
        if (particleCost < particle.bestCost) {
          particle.bestCost = particleCost
          particle.bestPosition = particle.position.slice()
          if (particleCost < globalBestCost) {
            globalBestCost = particleCost
            globalBest = particle.position.slice()
          }
        }
      }
      iteration += 1
      return snapshot()
    },
  }
}
