const assert = require('node:assert/strict')
const test = require('node:test')
const {
  resampleLap,
  detectZones,
  adjustZonesForCar,
  createReferenceDataset,
} = require('./gt3-reference.cjs')

function lapFixture({ lapTime = 108, positionSource = 'none', lapIndex = 0, offset = 0 } = {}) {
  const samples = Array.from({ length: 101 }, (_, index) => {
    const distance = index * 10
    const brake = distance >= 400 && distance <= 520 ? 100 : 0
    const throttle = distance >= 600 && distance <= 900 ? 100 : 0
    return {
      distance,
      time: distance / 50,
      speed: distance >= 450 && distance <= 500 ? 30 : 60,
      throttle,
      brake,
      yawRate: 0.1,
      x: offset + Math.cos(index / 100 * Math.PI * 2),
      y: offset + Math.sin(index / 100 * Math.PI * 2),
    }
  })
  return {
    name: `lap-${lapIndex}.ld`,
    lapTime,
    lapIndex,
    samples,
    positionSource,
    channels: positionSource === 'measured'
      ? [{ name: 'GPS Longitude', unit: 'deg' }, { name: 'GPS Latitude', unit: 'deg' }]
      : [],
  }
}

test('resamples each lap on evenly spaced distance coordinates', () => {
  const profile = resampleLap(lapFixture(), 1000, 5)
  assert.deepEqual(profile.map((sample) => sample.distanceM), [0, 250, 500, 750, 1000])
  assert.equal(profile[0].speedMps, 60)
  assert.equal(profile[2].speedMps, 30)
  assert.ok(profile.every((sample) => Number.isFinite(sample.lateralAccelerationMps2)))
})

test('detects braking and throttle zones with distance and speed landmarks', () => {
  const lap = lapFixture()
  const profile = resampleLap(lap, 1000, 101)
  const braking = detectZones(profile, { input: 'brakePercent', threshold: 8, trackLengthM: 1000, minimumLengthM: 20 })
  const acceleration = detectZones(profile, { input: 'throttlePercent', threshold: 70, trackLengthM: 1000, minimumLengthM: 20 })
  assert.equal(braking.length, 1)
  assert.equal(braking[0].startDistanceM, 400)
  assert.equal(braking[0].endDistanceM, 520)
  assert.equal(braking[0].minimumSpeedMps, 30)
  assert.equal(braking[0].peakInputPercent, 100)
  assert.equal(acceleration.length, 1)
  assert.equal(acceleration[0].startDistanceM, 600)
  assert.equal(acceleration[0].entrySpeedMps, 60)
})

test('joins acceleration zones across the start line and scales their wrapped extent', () => {
  const profile = Array.from({ length: 101 }, (_, index) => ({
    distanceM: index * 10,
    speedMps: 60,
    throttlePercent: index <= 10 || index >= 90 ? 100 : 0,
    brakePercent: 0,
  }))
  const zones = detectZones(profile, { input: 'throttlePercent', threshold: 70, trackLengthM: 1000, minimumLengthM: 20 })
  assert.equal(zones.length, 1)
  assert.equal(zones[0].wrapsStartLine, true)
  assert.equal(zones[0].startDistanceM, 900)
  assert.equal(zones[0].endDistanceM, 100)
  const dataset = createReferenceDataset({
    track: 'Monza',
    trackLengthM: 1000,
    laps: [lapFixture()],
    fallbackLine: [{ x: 0, z: 0 }, { x: 1, z: 1 }],
    profilePoints: 101,
  })
  dataset.accelerationZones = zones
  const adjusted = adjustZonesForCar(dataset, {
    massRatio: 1.1,
    powerRatio: 0.9,
    downforceRatio: 1,
    brakePerformanceRatio: 1,
  })
  assert.ok(adjusted.accelerationZones[0].endDistanceM > zones[0].endDistanceM)
})

test('scales zones per car parameters while preserving a common base dataset', () => {
  const dataset = createReferenceDataset({
    track: 'Monza',
    trackLengthM: 1000,
    laps: [lapFixture()],
    fallbackLine: [{ x: 0, z: 0 }, { x: 1, z: 1 }],
    profilePoints: 101,
    carParameters: {
      nissan_gt_r_gt3_2018: { massRatio: 1, powerRatio: 1, downforceRatio: 1, brakePerformanceRatio: 1 },
      mclaren_720s_gt3_evo: { massRatio: 1.02, powerRatio: 1.05, downforceRatio: 1.1, brakePerformanceRatio: 1 },
    },
  })
  const adjusted = adjustZonesForCar(dataset, {
    massRatio: 1.1,
    powerRatio: 0.9,
    downforceRatio: 1.05,
    brakePerformanceRatio: 0.95,
  })
  assert.equal(dataset.sharedLine.source.type, 'sourced-track-reference')
  assert.ok(adjusted.brakingZones[0].startDistanceM < dataset.brakingZones[0].startDistanceM)
  assert.ok(adjusted.accelerationZones[0].endDistanceM > dataset.accelerationZones[0].endDistanceM)
  assert.notEqual(adjusted.accelerationZones[0].exitSpeedMps, dataset.accelerationZones[0].exitSpeedMps)
  assert.ok(dataset.carAdjustments.mclaren_720s_gt3_evo)
})

test('averages measured position laps and converts GPS coordinates to local x/z meters', () => {
  const dataset = createReferenceDataset({
    track: 'Monza',
    trackLengthM: 1000,
    laps: [
      lapFixture({ lapTime: 108, positionSource: 'measured', lapIndex: 0 }),
      lapFixture({ lapTime: 109, positionSource: 'measured', lapIndex: 1, offset: 0.00001 }),
    ],
    profilePoints: 101,
  })
  assert.equal(dataset.sharedLine.source.type, 'motec-measured-position')
  assert.equal(dataset.sharedLine.source.lapCount, 2)
  assert.equal(dataset.sharedLine.points.length, 101)
  assert.ok(dataset.sharedLine.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z)))
  assert.ok(dataset.sharedLine.points[25].x < 0)
  assert.ok(dataset.sharedLine.points[25].z > 0)
})

test('requires a fallback line when telemetry does not include measured position', () => {
  assert.throws(() => createReferenceDataset({
    track: 'Monza',
    trackLengthM: 1000,
    laps: [lapFixture()],
  }), /no measured racing-line positions/i)
})
