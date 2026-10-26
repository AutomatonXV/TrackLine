const test = require('node:test')
const assert = require('node:assert/strict')
const { Coach } = require('./coach.cjs')
const { findEvents } = require('./events.cjs')
const { SpeechScheduler } = require('./speech-scheduler.cjs')
const { sampleAt } = require('./reference.cjs')

// 1000 points over 5 km: at 50 m/s the car covers one point every 0.1 s.
const POINTS = 1001
const SPEED = 50

function makeTable(shape) {
  const brake = new Array(POINTS).fill(0)
  const throttle = new Array(POINTS).fill(100)
  shape(brake, throttle)
  return { points: POINTS, lengthM: 5000, brake, throttle }
}

// Brake zone from point 500: ramps to `peak` over `rampPoints`, holds, then releases at 540..545.
const zone = (peak, rampPoints) => (brake, throttle) => {
  for (let i = 500; i < 545; i += 1) {
    const up = Math.min(1, (i - 499) / rampPoints)
    const down = i >= 540 ? Math.max(0, (545 - i) / 5) : 1
    brake[i] = peak * up * down
    throttle[i] = 0
  }
}

// Steps the car through the table at 16 ms ticks, collecting every cue the scheduler releases.
function drive(table, { from, to, driver, cooldownS = 1.5 }) {
  throttleOf.table = table
  const coach = new Coach()
  coach.table = table
  coach.setCooldown(cooldownS)
  const cues = []
  let t = 0
  for (let index = from; index < to; index += (SPEED * 0.016) / (5000 / 1000)) {
    t += 16
    const brakeRef = sampleAt(table.brake, index)
    const live = driver(index, t / 1000, brakeRef)
    const cue = coach.cue(index, SPEED, brakeRef, live, t)
    if (cue) cues.push({ ...cue, at: t / 1000, index })
  }
  return cues
}

const throttleOf = { table: null }
const gasOn = (index) => sampleAt(throttleOf.table.throttle, index) / 100
const idle = (index) => ({ brake: 0, gas: gasOn(index) })
const mirror = (index) => ({ brake: sampleAt(throttleOf.table.brake, index) / 100, gas: gasOn(index) })

test('rapid 30% to 100% braking is one "Brake hard!" cue, spoken before the zone', () => {
  const table = makeTable(zone(100, 3))
  const cues = drive(table, { from: 440, to: 500, driver: idle })
  assert.equal(cues.length, 1)
  assert.equal(cues[0].clip, 'brake-hard')
  assert.ok(500 - cues[0].index >= 5, 'spoken at least 0.5 s ahead of the first brake point')
  assert.ok(findEvents(table, 480, SPEED).filter((e) => e.type === 'brake').length === 1)
})

test('gradual braking gets a plain "Brake." cue', () => {
  const table = makeTable(zone(60, 20))
  const cues = drive(table, { from: 440, to: 500, driver: idle })
  assert.deepEqual(cues.map((cue) => cue.clip), ['brake'])
})

test('a driver already braking on the reference hears no brake or corrective cues', () => {
  const table = makeTable(zone(100, 3))
  const cues = drive(table, { from: 505, to: 560, driver: mirror })
  assert.deepEqual(cues.map((cue) => cue.clip).filter((clip) => clip !== 'throttle'), [])
})

test('a driver who follows the reference through a whole corner gets no corrective cues', () => {
  const table = makeTable(zone(100, 3))
  const cues = drive(table, { from: 440, to: 600, driver: mirror })
  assert.deepEqual(cues.map((cue) => cue.clip).filter((clip) => clip === 'brake-now' || clip === 'release'), [])
})

test('a missed braking point gets one urgent "Brake now!"', () => {
  const table = makeTable(zone(100, 3))
  const cues = drive(table, { from: 495, to: 545, driver: idle })
  assert.equal(cues.filter((cue) => cue.clip === 'brake-now').length, 1)
})

test('still braking after the reference releases gets exactly one "Release the brake."', () => {
  const table = makeTable(zone(100, 3))
  const cues = drive(table, { from: 535, to: 580, driver: () => ({ brake: 0.9, gas: 0 }) })
  assert.equal(cues.filter((cue) => cue.clip === 'release').length, 1)
})

test('noisy telemetry near the thresholds never repeats a callout', () => {
  const table = makeTable(zone(100, 3))
  let flip = 0
  const jitter = (index) => ({ brake: (flip++ % 2 ? 0.28 : 0.34), gas: gasOn(index) })
  const clips = drive(table, { from: 440, to: 560, driver: jitter }).map((cue) => cue.clip)
  assert.equal(new Set(clips).size, clips.length, `repeated: ${clips}`)
})

test('scheduler drops stale cues and keeps a single pending cue', () => {
  const speech = new SpeechScheduler({ cooldownS: 1.5 })
  speech.submit({ id: 'a', clip: 'brake', priority: 0, expiresAt: 1000 }, 0)
  assert.equal(speech.next(2000), null)
  speech.submit({ id: 'b', clip: 'brake', priority: 0, expiresAt: 5000 }, 2000)
  speech.submit({ id: 'c', clip: 'throttle', priority: 0, expiresAt: 5000 }, 2001)
  assert.equal(speech.next(2002).id, 'c')
  assert.equal(speech.next(2003), null)
})

test('scheduler suppresses duplicates, applies cooldown and lets urgent cues bypass it', () => {
  const speech = new SpeechScheduler({ cooldownS: 1.5, clipSeconds: () => 1 })
  speech.submit({ id: 'a', clip: 'brake', priority: 0, expiresAt: 9000 }, 0)
  assert.equal(speech.next(0).id, 'a')
  speech.submit({ id: 'a', clip: 'brake', priority: 0, expiresAt: 9000 }, 100)
  assert.equal(speech.next(100), null)
  speech.submit({ id: 'b', clip: 'throttle', priority: 0, expiresAt: 9000 }, 200)
  assert.equal(speech.next(1000), null)
  assert.equal(speech.next(1600).id, 'b')
  speech.submit({ id: 'c', clip: 'brake-hard', priority: 1, expiresAt: 9000 }, 1700)
  const urgent = speech.next(1700)
  assert.equal(urgent.id, 'c')
  assert.equal(urgent.interrupt, true)
})
