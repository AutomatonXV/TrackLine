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
export const RACING_LINE_SECTOR_COUNT = 120
const SECTOR_COUNT = RACING_LINE_SECTOR_COUNT
const LINE_SAMPLE_COUNT = 480
const ITERATION_COUNT = 48
const INERTIA = 0.72
const COGNITIVE_WEIGHT = 1.35
const SOCIAL_WEIGHT = 1.35
const MAX_SPEED_MPS = 82
const LATERAL_ACCELERATION_MPS2 = 8.5
const ACCELERATION_MPS2 = 4.5
const BRAKING_MPS2 = 9

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const wrap = (index: number, length: number) => (index + length) % length

function percentile(values: number[], fraction: number) {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

function vehicleLimits(telemetry?: RacingLineTelemetry) {
  const limits = {
    lateral: LATERAL_ACCELERATION_MPS2,
    acceleration: ACCELERATION_MPS2,
    braking: BRAKING_MPS2,
  }
  if (!telemetry) return limits

  const lateral = telemetry.lateralAccelerationMps2.filter((value, index) =>
    telemetry.speedMps[index] > 25 && value > 5)
  const acceleration = telemetry.longitudinalAccelerationMps2.filter((value, index) =>
    telemetry.throttlePercent[index] >= 70 && value > 0.5)
  const braking = telemetry.longitudinalAccelerationMps2
    .map((value, index) => telemetry.brakePercent[index] >= 20 && value < -1 ? -value : 0)
    .filter((value) => value > 0)

  if (lateral.length >= 10) limits.lateral = clamp(percentile(lateral, 0.8), 6.5, 15)
  if (acceleration.length >= 12) limits.acceleration = clamp(percentile(acceleration, 0.8), 2.5, 6.5)
  if (braking.length >= 8) limits.braking = clamp(percentile(braking, 0.7), 7, 14)
  return limits
}

function lineFor(space: RacingLineSearchSpace, offsets: number[], lateralScale = 1): RacingLinePoint[] {
  return Array.from({ length: LINE_SAMPLE_COUNT }, (_, index) => {
    const position = index * SECTOR_COUNT / LINE_SAMPLE_COUNT
    const sector = Math.floor(position)
    const blend = position - sector
    const offset = offsets[sector] + (offsets[(sector + 1) % SECTOR_COUNT] - offsets[sector]) * blend
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

function evaluate(space: RacingLineSearchSpace, offsets: number[], limits: ReturnType<typeof vehicleLimits>) {
  const line = lineFor(space, offsets)
  const count = line.length
  const distances = new Array<number>(count)
  const speedLimits = new Array<number>(count)
  for (let index = 0; index < count; index += 1) {
    const before = line[wrap(index - 1, count)]
    const point = line[index]
    const after = line[(index + 1) % count]
    const firstX = point.x - before.x
    const firstY = point.y - before.y
    const secondX = after.x - point.x
    const secondY = after.y - point.y
    const firstDistance = Math.hypot(firstX, firstY) * space.metersPerMapUnit
    const secondDistance = Math.hypot(secondX, secondY) * space.metersPerMapUnit
    const turn = Math.atan2(firstX * secondY - firstY * secondX, firstX * secondX + firstY * secondY)
    const curvature = Math.abs(turn) / Math.max((firstDistance + secondDistance) / 2, 0.01)
    distances[index] = secondDistance
    speedLimits[index] = Math.min(MAX_SPEED_MPS, Math.sqrt(limits.lateral / Math.max(curvature, 0.00002)))
    if (!Number.isFinite(firstDistance) || !Number.isFinite(secondDistance) || !Number.isFinite(speedLimits[index])) {
      return { line, speedsKmh: [], accelerationsMps2: [], lapSeconds: Number.POSITIVE_INFINITY }
    }
  }

  const speeds = speedLimits.slice()
  for (let pass = 0; pass < 3; pass += 1) {
    for (let index = 0; index < count; index += 1) {
      const previous = wrap(index - 1, count)
      const reachable = Math.sqrt(speeds[previous] ** 2 + 2 * limits.acceleration * distances[previous])
      speeds[index] = Math.min(speeds[index], reachable)
    }
    for (let index = count - 1; index >= 0; index -= 1) {
      const next = (index + 1) % count
      const reachable = Math.sqrt(speeds[next] ** 2 + 2 * limits.braking * distances[index])
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
  const makePosition = (index: number) => index === 0
    ? space.initialOffsets.slice()
    : Array.from({ length: SECTOR_COUNT }, () => index === 1 ? 0 : (random() * 1.4 - 0.7))
  const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const position = makePosition(index)
    return {
      position,
      velocity: position.map(() => (random() * 0.24) - 0.12),
      bestPosition: position.slice(),
      bestCost: evaluate(space, position, limits).lapSeconds,
    }
  })
  let globalBest = particles.reduce((best, particle) => particle.bestCost < best.bestCost ? particle : best, particles[0]).bestPosition.slice()
  let globalBestCost = evaluate(space, globalBest, limits).lapSeconds
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
          particle.velocity[dimension] = clamp(velocity, -0.22, 0.22)
          particle.position[dimension] = clamp(particle.position[dimension] + particle.velocity[dimension], -1, 1)
        }

        const cost = evaluate(space, particle.position, limits).lapSeconds
        if (cost < particle.bestCost) {
          particle.bestCost = cost
          particle.bestPosition = particle.position.slice()
          if (cost < globalBestCost) {
            globalBestCost = cost
            globalBest = particle.position.slice()
          }
        }
      }
      iteration += 1
      return snapshot()
    },
  }
}
