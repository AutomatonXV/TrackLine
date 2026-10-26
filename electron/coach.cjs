const { sampleAt } = require('./reference.cjs')
const { findEvents } = require('./events.cjs')
const { CoachPolicy, CLIPS } = require('./coach-policy.cjs')
const { SpeechScheduler } = require('./speech-scheduler.cjs')

const BINS = 240
const MIN_FILL = 0.85
const HAND_THRESHOLD = 0.3
const MAX_RMS_M = 40
const LOOKAHEAD_M = 15
const LOOKAHEAD_STEPS = 10
const DEFAULT_LEAD_S = 0.25
const WARN_STEPS = 8
const WARN_MIN_PCT = 12
const WARN_RISE_PCT = 8

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

function applyTransform(cal, x, y) {
  const cx = x - cal.ma[0]
  const cy = (cal.reflect ? -y : y) - cal.ma[1]
  return [cal.z[0] * cx - cal.z[1] * cy + cal.mb[0], cal.z[0] * cy + cal.z[1] * cx + cal.mb[1]]
}

// Least-squares similarity transform (complex-number form) mapping `from` points onto `to` points.
function fitSimilarity(from, to, reflect) {
  const count = from.length
  const src = from.map(([x, y]) => [x, reflect ? -y : y])
  const ma = [src.reduce((sum, p) => sum + p[0], 0) / count, src.reduce((sum, p) => sum + p[1], 0) / count]
  const mb = [to.reduce((sum, p) => sum + p[0], 0) / count, to.reduce((sum, p) => sum + p[1], 0) / count]
  let real = 0
  let imag = 0
  let energy = 0
  for (let index = 0; index < count; index += 1) {
    const ax = src[index][0] - ma[0]
    const ay = src[index][1] - ma[1]
    const bx = to[index][0] - mb[0]
    const by = to[index][1] - mb[1]
    real += ax * bx + ay * by
    imag += ax * by - ay * bx
    energy += ax * ax + ay * ay
  }
  if (!(energy > 0)) return null
  const cal = { reflect, z: [real / energy, imag / energy], ma, mb, rms: 0 }
  let error = 0
  for (let index = 0; index < count; index += 1) {
    const [x, y] = applyTransform(cal, from[index][0], from[index][1])
    error += (x - to[index][0]) ** 2 + (y - to[index][1]) ** 2
  }
  cal.rms = Math.sqrt(error / count)
  return cal
}

class Coach {
  constructor() {
    this.table = null
    this.cal = null
    this.liveLine = null
    this.bins = new Array(BINS).fill(null)
    this.handScore = 0
    this.swap = false
    this.anchor = null
    this.heading = null
    this.lastFitAt = 0
    this.onCalibrated = null
    this.onHand = null
    this.handReported = false
    this.leadS = DEFAULT_LEAD_S
    this.policy = new CoachPolicy()
    this.speech = new SpeechScheduler({ clipSeconds: (clip) => CLIPS[clip]?.s ?? 1 })
  }

  setCooldown(seconds) {
    this.speech.setCooldown(seconds)
  }

  setReference(table) {
    this.table = table
    this.cal = null
    this.liveLine = null
    this.bins.fill(null)
    this.policy.reset()
    this.speech.reset()
  }

  setCalibration(cal) {
    this.cal = cal && cal.z && cal.ma && cal.mb ? cal : null
    this.buildLiveLine()
  }

  setHand(rightIsCounterClockwise) {
    if (typeof rightIsCounterClockwise !== 'boolean') return
    this.handScore = rightIsCounterClockwise ? 1 : -1
    this.handReported = true
  }

  setSwap(value) { this.swap = Boolean(value) }

  rightIsCCW() {
    if (Math.abs(this.handScore) < HAND_THRESHOLD) return null
    return this.swap ? this.handScore < 0 : this.handScore > 0
  }

  buildLiveLine() {
    this.liveLine = null
    const table = this.table
    if (!this.cal || !table || !table.hasPosition) return
    const n = table.points
    const x = new Array(n)
    const y = new Array(n)
    for (let index = 0; index < n; index += 1) [x[index], y[index]] = applyTransform(this.cal, table.x[index], table.y[index])
    const tx = new Array(n)
    const ty = new Array(n)
    for (let index = 0; index < n; index += 1) {
      const a = (index + n - 2) % (n - 1)
      const b = (index + 2) % (n - 1)
      const dx = x[b] - x[a]
      const dy = y[b] - y[a]
      const length = Math.hypot(dx, dy) || 1
      tx[index] = dx / length
      ty[index] = dy / length
    }
    this.liveLine = { x, y, tx, ty }
  }

  track(frame, position, now) {
    const point = [frame.x, frame.z]
    if (this.anchor && Math.hypot(point[0] - this.anchor[0], point[1] - this.anchor[1]) > 60) { this.anchor = null; this.heading = null }
    if (!this.anchor) this.anchor = point
    const dx = point[0] - this.anchor[0]
    const dy = point[1] - this.anchor[1]
    const moved = Math.hypot(dx, dy)
    if (moved >= 2) {
      const next = [dx / moved, dy / moved]
      if (this.heading && frame.speedKmh > 30 && Math.abs(frame.steerAngle) > 0.01) {
        const cross = this.heading[0] * next[1] - this.heading[1] * next[0]
        this.handScore = clamp(this.handScore + Math.sign(frame.steerAngle) * cross, -5, 5)
      }
      this.heading = next
      this.anchor = point
    }
    if (!this.handReported && Math.abs(this.handScore) >= HAND_THRESHOLD && this.onHand) {
      this.handReported = true
      this.onHand(this.handScore > 0)
    }
    if (frame.speedKmh > 30 && !frame.isInPit) {
      this.bins[clamp(Math.floor(position * BINS), 0, BINS - 1)] = { x: point[0], y: point[1], p: position }
      this.maybeCalibrate(now)
    }
  }

  coverage() {
    return this.bins.reduce((count, bin) => count + (bin ? 1 : 0), 0) / BINS
  }

  maybeCalibrate(now) {
    const table = this.table
    if (!table || !table.hasPosition || this.coverage() < MIN_FILL || now - this.lastFitAt < 3000) return
    if (this.cal && this.cal.rms <= MAX_RMS_M) return
    this.lastFitAt = now
    const filled = this.bins.filter(Boolean)
    const n = table.points
    const target = filled.map((bin) => [bin.x, bin.y])
    const seed = filled.map((bin) => { const index = Math.round(bin.p * (n - 1)); return [table.x[index], table.y[index]] })
    let best = null
    for (const reflect of [false, true]) {
      let cal = fitSimilarity(seed, target, reflect)
      for (let pass = 0; cal && pass < 3; pass += 1) {
        const pairs = filled.map((bin) => {
          const center = Math.round(bin.p * (n - 1))
          let bestIndex = center
          let bestDistance = Infinity
          for (let offset = -50; offset <= 50; offset += 1) {
            const index = (((center + offset) % (n - 1)) + (n - 1)) % (n - 1)
            const [x, y] = applyTransform(cal, table.x[index], table.y[index])
            const distance = (x - bin.x) ** 2 + (y - bin.y) ** 2
            if (distance < bestDistance) { bestDistance = distance; bestIndex = index }
          }
          return [table.x[bestIndex], table.y[bestIndex]]
        })
        cal = fitSimilarity(pairs, target, reflect) || cal
      }
      if (cal && (!best || cal.rms < best.rms)) best = cal
    }
    if (!best) return
    this.cal = best
    this.buildLiveLine()
    if (best.rms <= MAX_RMS_M && this.onCalibrated) this.onCalibrated(best)
  }

  leftNormal(tx, ty, rightIsCCW) {
    return rightIsCCW ? [ty, -tx] : [-ty, tx]
  }

  lateral(frame, position) {
    const table = this.table
    if (!table.hasPosition) return { status: 'unavailable' }
    const rightIsCCW = this.rightIsCCW()
    const progress = clamp(this.coverage() / MIN_FILL, 0, 1)
    if (!this.cal || this.cal.rms > MAX_RMS_M) return { status: 'calibrating', progress, reason: this.cal ? 'fit' : 'lap' }
    if (rightIsCCW === null || !this.liveLine) return { status: 'calibrating', progress: Math.max(progress, 0.9), reason: 'direction' }
    const n = table.points
    const center = Math.round(position * (n - 1))
    const line = this.liveLine
    let nearest = center
    let nearestDistance = Infinity
    for (let offset = -40; offset <= 40; offset += 1) {
      const index = (((center + offset) % (n - 1)) + (n - 1)) % (n - 1)
      const distance = (line.x[index] - frame.x) ** 2 + (line.y[index] - frame.z) ** 2
      if (distance < nearestDistance) { nearestDistance = distance; nearest = index }
    }
    const [nx, ny] = this.leftNormal(line.tx[nearest], line.ty[nearest], rightIsCCW)
    const rx = frame.x - line.x[nearest]
    const ry = frame.z - line.y[nearest]
    const offsetM = rx * nx + ry * ny
    const forward = this.heading && frame.speedKmh > 10 ? this.heading : [line.tx[nearest], line.ty[nearest]]
    const [lx, ly] = this.leftNormal(forward[0], forward[1], rightIsCCW)
    const step = Math.max(1, Math.round(LOOKAHEAD_M / (table.lengthM / (n - 1))))
    const ahead = []
    for (let k = 0; k <= LOOKAHEAD_STEPS; k += 1) {
      const index = (nearest + k * step) % (n - 1)
      const dx = line.x[index] - frame.x
      const dy = line.y[index] - frame.z
      ahead.push({ x: -(dx * lx + dy * ly), y: dx * forward[0] + dy * forward[1] })
    }
    return { status: 'ok', offsetM, ahead }
  }

  // Peak reference pedal over the next `leadS` seconds at the current speed. Returns the percent to
  // warn about when the reference is about to rise well above what it is right now, else 0.
  upcoming(values, position, speedMs, refNow) {
    const table = this.table
    const span = (speedMs * this.leadS) / table.lengthM
    if (!(span > 0)) return 0
    let peak = 0
    for (let step = 1; step <= WARN_STEPS; step += 1) {
      const ahead = (position + (span * step) / WARN_STEPS) % 1
      peak = Math.max(peak, sampleAt(values, ahead * (table.points - 1)))
    }
    return peak >= WARN_MIN_PCT && peak - refNow >= WARN_RISE_PCT ? peak : 0
  }

  setLead(seconds) {
    if (Number.isFinite(seconds)) this.leadS = clamp(seconds, 0.05, 1)
  }

  // Telemetry only feeds the policy; the scheduler alone decides whether anything is spoken.
  cue(index, speedMs, brakeRef, frame, now) {
    const events = findEvents(this.table, index, speedMs)
    for (const cue of this.policy.evaluate({ events, refBrake: brakeRef, liveBrake: clamp(frame.brake * 100, 0, 100), liveGas: clamp(frame.gas * 100, 0, 100), now })) this.speech.submit(cue, now)
    const next = this.speech.next(now)
    return next && { ...next, text: CLIPS[next.clip]?.text ?? '' }
  }

  update(frame, now = Date.now()) {
    if (!this.table) return { state: 'noReference' }
    if (frame.status !== 'live') return { state: 'paused' }
    const position = clamp(frame.normalizedCarPosition, 0, 1)
    this.track(frame, position, now)
    const index = position * (this.table.points - 1)
    const throttleRef = sampleAt(this.table.throttle, index)
    const brakeRef = sampleAt(this.table.brake, index)
    const speedMs = Math.max(0, frame.speedKmh || 0) / 3.6
    return {
      state: 'active',
      throttle: { you: clamp(frame.gas * 100, 0, 100), ref: throttleRef, warn: this.upcoming(this.table.throttle, position, speedMs, throttleRef) },
      brake: { you: clamp(frame.brake * 100, 0, 100), ref: brakeRef, warn: this.upcoming(this.table.brake, position, speedMs, brakeRef) },
      lateral: this.lateral(frame, position),
      speedKmh: frame.speedKmh || 0,
      pos: position,
      lapMs: frame.currentTimeMs || 0,
      rpm: frame.rpm || 0,
      maxRpm: frame.maxRpm || 0,
      gear: Number.isInteger(frame.gear) ? frame.gear : 1,
      cue: this.cue(index, speedMs, brakeRef, frame, now) ?? undefined,
    }
  }
}

module.exports = { Coach, fitSimilarity, applyTransform, BINS }
