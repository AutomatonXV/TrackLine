const assert = require('node:assert/strict')
const test = require('node:test')
const { SessionRecorder } = require('./session-recorder.cjs')

const frame = (overrides = {}) => ({
  status: 'live',
  carModel: 'mclaren_720s_gt3_evo',
  track: 'monza',
  completedLaps: 0,
  speedKmh: 180,
  ...overrides,
})

test('records car, track, completed laps and ends feedback on session stop', () => {
  const recorder = new SessionRecorder()
  recorder.update(frame(), 1000)
  recorder.update(frame({ completedLaps: 2, speedKmh: 250 }), 90000)
  assert.deepEqual(recorder.finish(121000), {
    id: '1000-121000',
    car: 'mclaren_720s_gt3_evo',
    track: 'monza',
    durationSeconds: 120,
    completedLaps: 2,
    maxSpeedKmh: 250,
    endedAt: 121000,
  })
  assert.equal(recorder.finish(122000), null)
})

test('starts a new session when the driver changes car or track', () => {
  const recorder = new SessionRecorder()
  recorder.update(frame(), 1000)
  const completed = recorder.update(frame({ track: 'spa' }), 70000)
  assert.equal(completed.track, 'monza')
  assert.equal(recorder.current.track, 'spa')
})

test('does not ask for feedback after a brief menu or paused session', () => {
  const recorder = new SessionRecorder()
  recorder.update(frame(), 1000)
  assert.equal(recorder.finish(30000), null)
  assert.equal(recorder.current, null)
})
