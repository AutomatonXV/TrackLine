const DEFAULT_PROFILE_POINTS = 1200
const DEFAULT_BRAKE_THRESHOLD = 8
const DEFAULT_THROTTLE_THRESHOLD = 70
const DEFAULT_MIN_ZONE_LENGTH_M = 25
const DEFAULT_MERGE_GAP_M = 10
const METERS_PER_DEGREE = 111319.49079327358
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const wrapDistance = (distance, trackLengthM) => ((distance % trackLengthM) + trackLengthM) % trackLengthM

function interpolate(samples, distanceM, field) {
  let upper = 1
  while (upper < samples.length - 1 && samples[upper].distance < distanceM) upper += 1
  const first = samples[upper - 1]
  const second = samples[upper]
  const span = second.distance - first.distance
  const amount = span > 0 ? clamp((distanceM - first.distance) / span, 0, 1) : 0
  return first[field] + (second[field] - first[field]) * amount
}

function validLap(lap) {
  if (!lap || !Array.isArray(lap.samples) || lap.samples.length < 10) return false
  if (!(lap.lapTime > 0) || !(lap.samples.at(-1).distance - lap.samples[0].distance > 100)) return false
  return lap.samples.every((sample, index) => Number.isFinite(sample.distance)
    && Number.isFinite(sample.speed) && Number.isFinite(sample.throttle) && Number.isFinite(sample.brake)
    && (!index || sample.distance >= lap.samples[index - 1].distance))
}

function resampleLap(lap, trackLengthM, pointCount = DEFAULT_PROFILE_POINTS) {
  if (!validLap(lap)) throw new Error('Reference laps require increasing lap distance, speed, throttle, and brake samples.')
  if (!Number.isFinite(trackLengthM) || trackLengthM <= 0 || !Number.isInteger(pointCount) || pointCount < 2) {
    throw new Error('A positive track length and at least two profile samples are required.')
  }
  const firstDistance = lap.samples[0].distance
  const lapLength = lap.samples.at(-1).distance - firstDistance
  return Array.from({ length: pointCount }, (_, index) => {
    const fraction = index / (pointCount - 1)
    const sourceDistance = firstDistance + lapLength * fraction
    const sample = {
      distanceM: trackLengthM * fraction,
      speedMps: interpolate(lap.samples, sourceDistance, 'speed'),
      throttlePercent: clamp(interpolate(lap.samples, sourceDistance, 'throttle'), 0, 100),
      brakePercent: clamp(interpolate(lap.samples, sourceDistance, 'brake'), 0, 100),
      yawRateRadS: Number.isFinite(interpolate(lap.samples, sourceDistance, 'yawRate'))
        ? interpolate(lap.samples, sourceDistance, 'yawRate') : 0,
    }
    sample.lateralAccelerationMps2 = Math.abs(sample.speedMps * sample.yawRateRadS)
    return sample
  })
}

function detectZones(profile, {
  input,
  threshold,
  trackLengthM,
  minimumLengthM = DEFAULT_MIN_ZONE_LENGTH_M,
  mergeGapM = DEFAULT_MERGE_GAP_M,
}) {
  const active = profile.map((sample) => sample[input] >= threshold)
  const runs = []
  for (let index = 0; index < active.length; index += 1) {
    if (!active[index]) continue
    const previous = runs.at(-1)
    if (previous && profile[index].distanceM - profile[previous.end].distanceM <= mergeGapM) previous.end = index
    else runs.push({ start: index, end: index })
  }
  if (runs.length > 1 && active[0] && active.at(-1)) {
    const first = runs.shift()
    const last = runs.pop()
    runs.unshift({ start: last.start, end: first.end, wrapsStartLine: true })
  }

  let zoneNumber = 0
  return runs.flatMap((run) => {
    const start = profile[run.start]
    const end = profile[run.end]
    const lengthM = run.wrapsStartLine
      ? trackLengthM - start.distanceM + end.distanceM
      : end.distanceM - start.distanceM
    if (lengthM < minimumLengthM) return []
    let minimum = start
    let peakInputPercent = 0
    for (let offset = 0; offset <= lengthM; offset += Math.max(trackLengthM / (profile.length - 1), 0.1)) {
      const position = wrapDistance(start.distanceM + offset, trackLengthM)
      const nearest = Math.min(profile.length - 1, Math.round(position / trackLengthM * (profile.length - 1)))
      const sample = profile[nearest]
      if (sample.speedMps < minimum.speedMps) minimum = sample
      peakInputPercent = Math.max(peakInputPercent, sample[input])
    }
    return [{
      id: `${input === 'brakePercent' ? 'brake' : 'throttle'}-${++zoneNumber}`,
      startDistanceM: round(start.distanceM),
      endDistanceM: round(end.distanceM),
      wrapsStartLine: Boolean(run.wrapsStartLine),
      minimumSpeedDistanceM: round(minimum.distanceM),
      entrySpeedMps: round(start.speedMps),
      minimumSpeedMps: round(minimum.speedMps),
      exitSpeedMps: round(end.speedMps),
      peakInputPercent: round(peakInputPercent),
      thresholdPercent: threshold,
    }]
  })
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits))
}

function projectedPosition(lap, sample, gpsOrigin) {
  const names = new Set((lap.channels || []).map((channel) => channel.name.toLowerCase()))
  const gps = [...names].some((name) => /gps.*latitude|^latitude$/.test(name))
  if (gps) {
    return {
      x: (sample.x - gpsOrigin.longitude) * METERS_PER_DEGREE * Math.cos(gpsOrigin.latitude * Math.PI / 180),
      z: (sample.y - gpsOrigin.latitude) * METERS_PER_DEGREE,
    }
  }
  return { x: sample.x, z: sample.y }
}

function resampleMeasuredLine(lap, pointCount, gpsOrigin) {
  if (lap.positionSource !== 'measured' || !lap.samples.every((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y))) return null
  const firstDistance = lap.samples[0].distance
  const lapLength = lap.samples.at(-1).distance - firstDistance
  if (!(lapLength > 100)) return null
  return Array.from({ length: pointCount }, (_, index) => {
    const targetDistance = firstDistance + lapLength * index / (pointCount - 1)
    const x = interpolate(lap.samples, targetDistance, 'x')
    const y = interpolate(lap.samples, targetDistance, 'y')
    return projectedPosition(lap, { x, y }, gpsOrigin)
  })
}

function averageLines(lines) {
  return lines[0].map((_, index) => ({
    x: round(lines.reduce((sum, line) => sum + line[index].x, 0) / lines.length, 3),
    z: round(lines.reduce((sum, line) => sum + line[index].z, 0) / lines.length, 3),
  }))
}

const REFERENCE_CAR_KEY = 'nissan_gt_r_gt3_2018'
const REFERENCE_CAR_PARAMETERS = Object.freeze({
  massRatio: 1,
  powerRatio: 1,
  downforceRatio: 1,
  brakePerformanceRatio: 1,
})

function validateCarParameters(parameters) {
  const keys = ['massRatio', 'powerRatio', 'downforceRatio', 'brakePerformanceRatio']
  if (!parameters || keys.some((key) => !Number.isFinite(parameters[key]) || parameters[key] <= 0)) {
    throw new Error(`Car parameters must contain positive finite values for ${keys.join(', ')}.`)
  }
}

function adjustZonesForCar(dataset, carParameters) {
  validateCarParameters(carParameters)
  const { massRatio, powerRatio, downforceRatio, brakePerformanceRatio } = carParameters
  const brakingDecelerationRatio = brakePerformanceRatio / massRatio
    * (0.85 + 0.15 * downforceRatio)
  const brakingDistanceScale = clamp(1 / brakingDecelerationRatio, 0.65, 1.5)
  const cornerSpeedScale = clamp(Math.sqrt(downforceRatio / massRatio), 0.85, 1.15)
  const straightSpeedScale = clamp(Math.sqrt(powerRatio / massRatio), 0.8, 1.2)
  const accelerationDistanceScale = clamp(Math.sqrt(massRatio / powerRatio), 0.7, 1.4)
  const shift = (distanceM, amount) => wrapDistance(distanceM + amount, dataset.track.lengthM)
  const forwardDistance = (startM, endM, wrapsStartLine) => wrapsStartLine
    ? dataset.track.lengthM - startM + endM
    : Math.max(0, endM - startM)
  const brakingZones = dataset.brakingZones.map((zone) => {
    const brakingRunM = forwardDistance(zone.startDistanceM, zone.minimumSpeedDistanceM, zone.wrapsStartLine)
    const earlierBrakeOffsetM = (brakingDistanceScale - 1) * brakingRunM
    return {
      ...zone,
      startDistanceM: round(shift(zone.startDistanceM, -earlierBrakeOffsetM)),
      entrySpeedMps: round(zone.entrySpeedMps * straightSpeedScale),
      minimumSpeedMps: round(zone.minimumSpeedMps * cornerSpeedScale),
      exitSpeedMps: round(zone.exitSpeedMps * cornerSpeedScale),
      adjustment: {
        brakingDistanceScale: round(brakingDistanceScale, 3),
        earlierBrakeOffsetM: round(earlierBrakeOffsetM),
        cornerSpeedScale: round(cornerSpeedScale, 3),
        straightSpeedScale: round(straightSpeedScale, 3),
      },
    }
  })
  const accelerationZones = dataset.accelerationZones.map((zone) => {
    const accelerationRunM = forwardDistance(zone.minimumSpeedDistanceM, zone.endDistanceM, zone.wrapsStartLine)
    return {
      ...zone,
      endDistanceM: round(shift(zone.minimumSpeedDistanceM, accelerationRunM * accelerationDistanceScale)),
      entrySpeedMps: round(zone.entrySpeedMps * cornerSpeedScale),
      minimumSpeedMps: round(zone.minimumSpeedMps * cornerSpeedScale),
      exitSpeedMps: round(zone.exitSpeedMps * straightSpeedScale),
      adjustment: {
        accelerationDistanceScale: round(accelerationDistanceScale, 3),
        cornerSpeedScale: round(cornerSpeedScale, 3),
        straightSpeedScale: round(straightSpeedScale, 3),
      },
    }
  })
  return { brakingZones, accelerationZones }
}

function createReferenceDataset({
  track,
  gameVersion = 'ACC 1.10',
  trackLengthM,
  laps,
  fallbackLine,
  fallbackLineSource,
  profilePoints = DEFAULT_PROFILE_POINTS,
  topLapCount = 5,
  brakeThresholdPercent = DEFAULT_BRAKE_THRESHOLD,
  throttleThresholdPercent = DEFAULT_THROTTLE_THRESHOLD,
  minimumZoneLengthM = DEFAULT_MIN_ZONE_LENGTH_M,
  mergeGapM = DEFAULT_MERGE_GAP_M,
  sourceFiles = [],
  carParameters = { [REFERENCE_CAR_KEY]: REFERENCE_CAR_PARAMETERS },
}) {
  if (!track || !Number.isFinite(trackLengthM) || trackLengthM <= 0 || !Array.isArray(laps) || !laps.length) {
    throw new Error('Track name, track length, and at least one MoTeC lap are required.')
  }
  const candidates = laps.filter(validLap).sort((a, b) => a.lapTime - b.lapTime).slice(0, topLapCount)
  if (!candidates.length) throw new Error('No valid MoTeC laps with distance and pedal samples were found.')
  if (!carParameters || typeof carParameters !== 'object' || Array.isArray(carParameters)
    || !carParameters[REFERENCE_CAR_KEY]) {
    throw new Error(`Car parameters must include the reference car "${REFERENCE_CAR_KEY}".`)
  }
  for (const parameters of Object.values(carParameters)) validateCarParameters(parameters)
  if (!Number.isInteger(profilePoints) || profilePoints < 2 || !Number.isInteger(topLapCount) || topLapCount < 1) {
    throw new Error('Profile sample count and fastest-lap count must be positive integers.')
  }

  const selectedLaps = candidates.map((lap) => ({
    ...lap,
    profile: resampleLap(lap, trackLengthM, profilePoints),
  }))
  const profile = selectedLaps[0].profile.map((first, index) => {
    const sample = { distanceM: first.distanceM }
    for (const field of ['speedMps', 'throttlePercent', 'brakePercent', 'yawRateRadS', 'lateralAccelerationMps2']) {
      sample[field] = selectedLaps.reduce((sum, lap) => sum + lap.profile[index][field], 0) / selectedLaps.length
    }
    return Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, round(value)]))
  })
  const zonesOptions = { trackLengthM, minimumLengthM: minimumZoneLengthM, mergeGapM }
  const brakingZones = detectZones(profile, { ...zonesOptions, input: 'brakePercent', threshold: brakeThresholdPercent })
  const accelerationZones = detectZones(profile, { ...zonesOptions, input: 'throttlePercent', threshold: throttleThresholdPercent })

  const lineLaps = selectedLaps.filter((lap) => lap.positionSource === 'measured')
  let line
  let lineSource
  if (lineLaps.length) {
    const gpsLap = lineLaps.find((lap) => lap.channels?.some((channel) => /gps.*latitude|^latitude$/i.test(channel.name)))
    const gpsOrigin = gpsLap ? {
      latitude: gpsLap.samples[0].y,
      longitude: gpsLap.samples[0].x,
    } : { latitude: 0, longitude: 0 }
    const measuredLines = lineLaps.map((lap) => resampleMeasuredLine(lap, profilePoints, gpsOrigin)).filter(Boolean)
    if (measuredLines.length) {
      line = averageLines(measuredLines)
      lineSource = {
        type: 'motec-measured-position',
        lapCount: measuredLines.length,
        files: lineLaps.map((lap) => lap.name),
        coordinateSystem: 'local meters (x,z); GPS projected to local equirectangular coordinates when applicable',
      }
    }
  }
  if (!line) {
    if (!Array.isArray(fallbackLine) || fallbackLine.length < 2) {
      throw new Error('No measured racing-line positions were found and no sourced fallback line was supplied.')
    }
    line = fallbackLine.map((point) => ({ x: round(point.x, 3), z: round(point.z, 3) }))
    lineSource = {
      type: 'sourced-track-reference',
      lapCount: 0,
      files: [],
      source: fallbackLineSource || 'Track reference geometry (not a GT-R telemetry trace)',
      coordinateSystem: 'track source meters (x,z)',
    }
  }

  const fastestLapSeconds = Math.min(...candidates.map((lap) => lap.lapTime))
  const selectedLapMetadata = candidates.map((lap) => ({
    file: lap.name || '',
    lapIndex: Number.isInteger(lap.lapIndex) ? lap.lapIndex : 0,
    lapTimeSeconds: round(lap.lapTime, 3),
    measuredPosition: lap.positionSource === 'measured',
  }))
  const dataset = {
    schemaVersion: 1,
    track: { id: track.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: track, lengthM: round(trackLengthM, 1) },
    gameVersion,
    sharedLine: {
      coordinateFields: ['x', 'z'],
      pointCount: line.length,
      source: lineSource,
      points: line,
    },
    reference: {
      carKey: REFERENCE_CAR_KEY,
      selectedFastestLapCount: candidates.length,
      fastestLapSeconds: round(fastestLapSeconds, 3),
      sourceFiles,
      selectedLaps: selectedLapMetadata,
      averaging: 'Pedal, speed, and yaw-rate channels are resampled by normalized lap distance and averaged across the fastest valid laps.',
    },
    thresholds: {
      brakingPercent: brakeThresholdPercent,
      accelerationPercent: throttleThresholdPercent,
      minimumZoneLengthM,
      mergedGapM: mergeGapM,
    },
    profile,
    brakingZones,
    accelerationZones,
    carParameters: {
      units: 'Ratios normalized to the GT-R reference car; set from each car’s ACC 1.10 BoP and setup.',
      reference: REFERENCE_CAR_PARAMETERS,
      cars: carParameters,
      adjustmentModel: {
        brakingDistance: 'inversely scales with brakePerformanceRatio / massRatio, with a bounded downforce contribution',
        cornerSpeed: 'scales with sqrt(downforceRatio / massRatio), bounded to +/-15%',
        straightSpeed: 'scales with sqrt(powerRatio / massRatio), bounded to -20%/+20%',
        accelerationDistance: 'scales with sqrt(massRatio / powerRatio), bounded to -30%/+40%',
        note: 'First-order guidance only; validate against each car’s telemetry and ACC 1.10 BoP.',
      },
    },
  }
  dataset.carAdjustments = Object.fromEntries(Object.entries(carParameters)
    .map(([carKey, parameters]) => [carKey, adjustZonesForCar(dataset, parameters)]))
  return dataset
}

module.exports = {
  DEFAULT_PROFILE_POINTS,
  DEFAULT_BRAKE_THRESHOLD,
  DEFAULT_THROTTLE_THRESHOLD,
  REFERENCE_CAR_KEY,
  REFERENCE_CAR_PARAMETERS,
  resampleLap,
  detectZones,
  adjustZonesForCar,
  createReferenceDataset,
}
