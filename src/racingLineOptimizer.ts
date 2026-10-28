export interface RacingLinePoint { x: number; y: number }

export interface RacingLineSearchSpace {
  center: RacingLinePoint[]
  normals: RacingLinePoint[]
  leftLimit: number[]
  rightLimit: number[]
  metersPerMapUnit: number
}

export interface RacingLineProgress {
  iteration: number
  totalIterations: number
  complete: boolean
  line: RacingLinePoint[]
  candidate: RacingLinePoint[]
  speedsKmh: number[]
  estimatedLapSeconds: number
}

interface Particle {
  position: number[]
  velocity: number[]
  bestPosition: number[]
  bestCost: number
}

const PARTICLE_COUNT = 20
const SECTOR_COUNT = 56
const LINE_SAMPLE_COUNT = 240
const ITERATION_COUNT = 36
const INERTIA = 0.72
const COGNITIVE_WEIGHT = 1.35
const SOCIAL_WEIGHT = 1.35
const MAX_SPEED_MPS = 82
const LATERAL_ACCELERATION_MPS2 = 8.5
const ACCELERATION_MPS2 = 4.5
const BRAKING_MPS2 = 9

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const wrap = (index: number, length: number) => (index + length) % length

function lineFor(space: RacingLineSearchSpace, offsets: number[]): RacingLinePoint[] {
  return Array.from({ length: LINE_SAMPLE_COUNT }, (_, index) => {
    const position = index * SECTOR_COUNT / LINE_SAMPLE_COUNT
    const sector = Math.floor(position)
    const blend = position - sector
    const offset = offsets[sector] + (offsets[(sector + 1) % SECTOR_COUNT] - offsets[sector]) * blend
    const source = Math.round(index * space.center.length / LINE_SAMPLE_COUNT) % space.center.length
    const center = space.center[source]
    const normal = space.normals[source]
    const limit = offset >= 0 ? space.leftLimit[source] : space.rightLimit[source]
    const distance = offset * limit
    return { x: center.x + normal.x * distance, y: center.y + normal.y * distance }
  })
}

function evaluate(space: RacingLineSearchSpace, offsets: number[]) {
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
    speedLimits[index] = Math.min(MAX_SPEED_MPS, Math.sqrt(LATERAL_ACCELERATION_MPS2 / Math.max(curvature, 0.00002)))
    if (!Number.isFinite(firstDistance) || !Number.isFinite(secondDistance) || !Number.isFinite(speedLimits[index])) {
      return { line, speedsKmh: [], lapSeconds: Number.POSITIVE_INFINITY }
    }
  }

  const speeds = speedLimits.slice()
  for (let pass = 0; pass < 3; pass += 1) {
    for (let index = 0; index < count; index += 1) {
      const previous = wrap(index - 1, count)
      const reachable = Math.sqrt(speeds[previous] ** 2 + 2 * ACCELERATION_MPS2 * distances[previous])
      speeds[index] = Math.min(speeds[index], reachable)
    }
    for (let index = count - 1; index >= 0; index -= 1) {
      const next = (index + 1) % count
      const reachable = Math.sqrt(speeds[next] ** 2 + 2 * BRAKING_MPS2 * distances[index])
      speeds[index] = Math.min(speeds[index], reachable)
    }
  }

  let lapSeconds = 0
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count
    lapSeconds += distances[index] / Math.max((speeds[index] + speeds[next]) / 2, 1)
  }
  return { line, speedsKmh: speeds.map((speed) => speed * 3.6), lapSeconds }
}

export function createRacingLineOptimizer(space: RacingLineSearchSpace, seed: number) {
  if (space.center.length < LINE_SAMPLE_COUNT || space.normals.length !== space.center.length
    || space.leftLimit.length !== space.center.length || space.rightLimit.length !== space.center.length
    || !Number.isFinite(space.metersPerMapUnit) || space.metersPerMapUnit <= 0) {
    throw new Error('The racing-line optimizer requires matching track centerline and boundary data.')
  }

  let randomState = seed >>> 0 || 1
  const random = () => {
    randomState = (1664525 * randomState + 1013904223) >>> 0
    return randomState / 0x100000000
  }
  const makePosition = (centered: boolean) => Array.from({ length: SECTOR_COUNT }, () => centered ? 0 : (random() * 1.4 - 0.7))
  const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const position = makePosition(index === 0)
    return {
      position,
      velocity: position.map(() => (random() * 0.24) - 0.12),
      bestPosition: position.slice(),
      bestCost: evaluate(space, position).lapSeconds,
    }
  })
  let globalBest = particles.reduce((best, particle) => particle.bestCost < best.bestCost ? particle : best, particles[0]).bestPosition.slice()
  let globalBestCost = evaluate(space, globalBest).lapSeconds
  let iteration = 0
  let candidate = particles[1].position.slice()

  const snapshot = (): RacingLineProgress => {
    const best = evaluate(space, globalBest)
    return {
      iteration,
      totalIterations: ITERATION_COUNT,
      complete: iteration >= ITERATION_COUNT,
      line: best.line,
      candidate: lineFor(space, candidate),
      speedsKmh: best.speedsKmh,
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

        const cost = evaluate(space, particle.position).lapSeconds
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
