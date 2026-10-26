const fs = require('node:fs')
const path = require('node:path')
const { XMLParser } = require('fast-xml-parser')
const xmlParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true })

function fixedString(buffer, offset, length) {
  return buffer.toString('ascii', offset, offset + length).replace(/\0.*$/s, '').trim()
}

function halfToFloat(value) {
  const sign = value & 0x8000 ? -1 : 1
  const exponent = (value >> 10) & 0x1f
  const fraction = value & 0x3ff
  if (exponent === 0) return sign * Math.pow(2, -14) * fraction / 1024
  if (exponent === 31) return fraction ? NaN : sign * Infinity
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024)
}

function readChannel(buffer, offset) {
  if (offset < 0 || offset + 84 > buffer.length) return null
  const next = buffer.readUInt32LE(offset + 4)
  const dataOffset = buffer.readUInt32LE(offset + 8)
  const length = Math.min(buffer.readUInt32LE(offset + 12), 2000000)
  const dtypeA = buffer.readUInt16LE(offset + 18)
  const dtype = buffer.readUInt16LE(offset + 20)
  const frequency = buffer.readUInt16LE(offset + 22)
  const shift = buffer.readInt16LE(offset + 24)
  const multiplier = buffer.readInt16LE(offset + 26) || 1
  const scale = buffer.readInt16LE(offset + 28) || 1
  const decimals = buffer.readInt16LE(offset + 30)
  const name = fixedString(buffer, offset + 32, 32)
  const unit = fixedString(buffer, offset + 72, 12)
  let bytes = 0
  if (dtypeA === 7 && (dtype === 2 || dtype === 4)) bytes = dtype
  else if ([0, 3, 5].includes(dtypeA) && (dtype === 2 || dtype === 4)) bytes = dtype
  else if (dtypeA === 8 && dtype === 8) bytes = 8
  if (!name || !bytes || dataOffset + length * bytes > buffer.length) return { name, unit, next, values: [], frequency }
  const values = new Array(length)
  for (let index = 0; index < length; index += 1) {
    const position = dataOffset + index * bytes
    let raw
    if (dtypeA === 7) raw = bytes === 2 ? halfToFloat(buffer.readUInt16LE(position)) : buffer.readFloatLE(position)
    else if (bytes === 8) raw = buffer.readDoubleLE(position)
    else if (bytes === 2) raw = buffer.readInt16LE(position)
    else raw = buffer.readInt32LE(position)
    values[index] = (raw / scale * Math.pow(10, -decimals) + shift) * multiplier
  }
  return { name, unit, next, values, frequency }
}

function pickChannel(channels, expressions) {
  for (const expression of expressions) {
    const channel = channels.find(({ name }) => expression.test(name))
    if (channel && channel.values.length > 1) return channel
  }
  return null
}

function valueAt(values, ratio) {
  const position = ratio * (values.length - 1)
  const lower = Math.floor(position)
  const upper = Math.min(values.length - 1, lower + 1)
  return values[lower] + (values[upper] - values[lower]) * (position - lower)
}

function trackLength(track) {
  const normalized = track.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  if (normalized.includes('brands hatch')) return 3916
  if (normalized.includes('spa')) return 7004
  if (normalized.includes('monza')) return 5793
  if (normalized.includes('paul ricard')) return 5842
  if (normalized.includes('nurburgring')) return 5148
  return 0
}

function speedInMetersPerSecond(channel, value) {
  return /km\s*\/\s*h|kmh/i.test(channel.unit) ? value / 3.6 : value
}

function estimateDistance(speed, startRatio, endRatio, duration) {
  let travelled = 0
  let previousSpeed = speedInMetersPerSecond(speed, valueAt(speed.values, startRatio))
  const steps = 120
  for (let step = 1; step <= steps; step += 1) {
    const ratio = startRatio + (endRatio - startRatio) * step / steps
    const currentSpeed = speedInMetersPerSecond(speed, valueAt(speed.values, ratio))
    travelled += (previousSpeed + currentSpeed) / 2 * duration / steps
    previousSpeed = currentSpeed
  }
  return travelled
}

function geometricLapSegments(speed, yawRate, track) {
  const expectedDistance = trackLength(track)
  const frequency = yawRate.frequency
  const duration = frequency ? (yawRate.values.length - 1) / frequency : 0
  if (!expectedDistance || !frequency || !duration) {
    return [{ startRatio: 0, endRatio: 1, startTime: 0, duration, travelled: 0, useTime: false }]
  }
  const direction = Math.sign(yawRate.values.reduce((sum, value) => sum + value, 0))
  if (!direction) return []

  const boundaries = [0]
  const turnPerLap = Math.PI * 2
  let heading = 0
  let nextTurn = turnPerLap
  for (let index = 0; index < yawRate.values.length - 1; index += 1) {
    const previousHeading = heading
    heading += yawRate.values[index] / frequency
    while (direction * heading >= nextTurn) {
      const fraction = (nextTurn - direction * previousHeading) / Math.max(0.000001, direction * (heading - previousHeading))
      boundaries.push((index + Math.max(0, Math.min(1, fraction))) / (yawRate.values.length - 1))
      nextTurn += turnPerLap
    }
  }
  boundaries.push(1)

  const plausible = ({ duration: lapDuration, travelled }) =>
    lapDuration >= 40 && lapDuration <= 240
    && travelled >= expectedDistance * 0.72 && travelled <= expectedDistance * 1.3
  const segments = boundaries.slice(1).map((endRatio, index) => {
    const startRatio = boundaries[index]
    const lapDuration = (endRatio - startRatio) * duration
    return {
      startRatio, endRatio, startTime: 0, duration: lapDuration,
      travelled: estimateDistance(speed, startRatio, endRatio, lapDuration), useTime: false,
    }
  }).filter(plausible)
  if (segments.length) return segments

  // Heading can overshoot a full turn mid-lap on twisty tracks, so a single-lap log is judged as a whole.
  const whole = { startRatio: 0, endRatio: 1, startTime: 0, duration, travelled: estimateDistance(speed, 0, 1, duration), useTime: false }
  return plausible(whole) ? [whole] : []
}

// `telemetryDuration` is the wall-clock length of the speed/yaw channels. TIME can be longer than
// the telemetry (it keeps running after logging stops), so its index ratio is not the telemetry ratio.
function lapSegments(time, speed, distance, track, telemetryDuration = 0) {
  const ranges = []
  let start = 0
  for (let index = 1; index < time.values.length; index += 1) {
    if (time.values[index] < time.values[index - 1] - 0.5) {
      ranges.push({ start, end: index - 1 })
      start = index
    }
  }
  ranges.push({ start, end: time.values.length - 1 })

  const wallClock = Boolean(telemetryDuration && time.frequency)
  const toTelemetry = (index) => wallClock
    ? Math.min(1, index / time.frequency / telemetryDuration)
    : index / (time.values.length - 1)
  const candidates = ranges.filter(({ end: last }) => !wallClock || last / time.frequency <= telemetryDuration + 0.5).map(({ start: first, end: last }) => {
    const startRatio = toTelemetry(first)
    const endRatio = toTelemetry(last)
    const timeStart = first / (time.values.length - 1)
    const timeEnd = last / (time.values.length - 1)
    const duration = Math.max(0, time.values[last] - time.values[first])
    let travelled = 0
    let previousTime = time.values[first]
    let previousSpeed = speed ? speedInMetersPerSecond(speed, valueAt(speed.values, startRatio)) : 0
    const steps = Math.max(1, Math.min(480, last - first))
    for (let step = 1; step <= steps; step += 1) {
      const ratio = startRatio + (endRatio - startRatio) * step / steps
      const currentTime = valueAt(time.values, timeStart + (timeEnd - timeStart) * step / steps)
      const currentSpeed = speed ? speedInMetersPerSecond(speed, valueAt(speed.values, ratio)) : 0
      const deltaTime = Math.max(0, currentTime - previousTime)
      travelled += (previousSpeed + currentSpeed) / 2 * deltaTime
      previousTime = currentTime
      previousSpeed = currentSpeed
    }
    if (distance) travelled = Math.abs(valueAt(distance.values, endRatio) - valueAt(distance.values, startRatio))
    return { startRatio, endRatio, timeStart, timeEnd, startTime: time.values[first], duration, travelled, useTime: true }
  }).filter((candidate) => candidate.duration >= 20 && candidate.duration <= 240)

  const expectedDistance = trackLength(track)
  const complete = expectedDistance
    ? candidates.filter(({ travelled }) => travelled >= expectedDistance * 0.72 && travelled <= expectedDistance * 1.3)
    : []
  const selected = complete.length ? complete : candidates.filter(({ duration }) => duration >= 40)
  if (selected.length) return selected
  return [{ startRatio: 0, endRatio: 1, timeStart: 0, timeEnd: 1, startTime: time.values[0], duration: Math.max(0, time.values.at(-1) - time.values[0]), travelled: 0, useTime: true }]
}

function sidecarMetadata(filePath) {
  const sidecar = filePath.replace(/\.ld$/i, '.ldx')
  if (!fs.existsSync(sidecar)) return {}
  const document = xmlParser.parse(fs.readFileSync(sidecar, 'utf8'))
  const textOf = (value) => {
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
    if (value && typeof value === 'object' && typeof value['#text'] === 'string') return value['#text'].trim()
    return ''
  }
  const find = (node, tags) => {
    if (!node || typeof node !== 'object') return ''
    for (const [key, value] of Object.entries(node)) {
      const name = key.split(':').pop().toLowerCase()
      if (tags.has(name)) {
        const result = textOf(value)
        if (result) return result
      }
      const nested = find(value, tags)
      if (nested) return nested
    }
    return ''
  }
  return {
    car: find(document, new Set(['vehicle', 'vehicleid', 'vehiclename', 'car', 'carname', 'carmodel'])),
    track: find(document, new Set(['venue', 'venuename', 'track', 'trackname', 'circuit'])),
    driver: find(document, new Set(['driver', 'drivername'])),
  }
}

function parseLap(filePath, requestedLapIndex) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.length < 1762) throw new Error('File is too small to be a valid MoTeC LD log.')
  let channelOffset = buffer.readUInt32LE(8)
  const channels = []
  const visited = new Set()
  while (channelOffset > 0 && channelOffset < buffer.length && !visited.has(channelOffset) && channels.length < 512) {
    visited.add(channelOffset)
    const channel = readChannel(buffer, channelOffset)
    if (!channel) break
    channels.push(channel)
    channelOffset = channel.next
  }
  if (!channels.some((channel) => channel.values.length > 1)) throw new Error('No readable numeric telemetry channels were found.')

  const header = {
    date: fixedString(buffer, 94, 16),
    driver: fixedString(buffer, 158, 64),
    car: fixedString(buffer, 222, 64),
    track: fixedString(buffer, 350, 64),
  }
  const sidecar = sidecarMetadata(filePath)
  const distance = pickChannel(channels, [/^lap distance$/i, /^distance$/i, /lap distance/i, /distance/i])
  const speed = pickChannel(channels, [/ground speed/i, /vehicle speed/i, /gps speed/i, /^speed$/i])
  const throttle = pickChannel(channels, [/throttle/i, /accelerator/i])
  const brake = pickChannel(channels, [/brake/i])
  const rawTime = pickChannel(channels, [/^time$/i, /lap time/i, /time channel/i])
  const time = rawTime && Math.abs(rawTime.values.at(-1) - rawTime.values[0]) < 100000 ? rawTime : null
  const latitude = pickChannel(channels, [/gps.*latitude/i, /^latitude$/i, /gps.*\blat\b/i])
  const longitude = pickChannel(channels, [/gps.*longitude/i, /^longitude$/i, /gps.*\blon\b/i])
  const positionX = pickChannel(channels, [/^gps x$/i, /position x/i, /world x/i])
  const positionY = pickChannel(channels, [/^gps y$/i, /position y/i, /world y/i])
  const yawRate = pickChannel(channels, [/^roty$/i, /yaw rate/i, /angular velocity.*yaw/i])
  const directPosition = Boolean(latitude && longitude || positionX && positionY)
  const telemetryDuration = speed?.frequency
    ? (speed.values.length - 1) / speed.frequency
    : yawRate?.frequency ? (yawRate.values.length - 1) / yawRate.frequency : 0
  const timeDuration = time?.frequency ? (time.values.length - 1) / time.frequency : 0
  const track = sidecar.track || header.track
  const clockMatchesTelemetry = directPosition || !timeDuration || !telemetryDuration
    || Math.abs(timeDuration - telemetryDuration) / telemetryDuration <= 0.12
  const segments = time && clockMatchesTelemetry
    ? lapSegments(time, speed, distance, track, telemetryDuration)
    : speed && yawRate
      ? geometricLapSegments(speed, yawRate, track)
      : [{
        startRatio: 0, endRatio: 1, startTime: 0,
        duration: telemetryDuration, travelled: 0, useTime: false,
      }]
  if (!segments.length) throw new Error('No complete lap with a plausible track distance was found.')
  const fastestLapIndex = segments.reduce((best, segment, index) => segment.duration < segments[best].duration ? index : best, 0)
  const lapIndex = requestedLapIndex == null ? fastestLapIndex : requestedLapIndex
  if (!Number.isInteger(lapIndex) || lapIndex < 0 || lapIndex >= segments.length) {
    throw new Error(`Lap index ${lapIndex} is out of range (0-${segments.length - 1}).`)
  }
  const segment = segments[lapIndex]
  const samples = []
  const startDistance = distance ? valueAt(distance.values, segment.startRatio) : 0
  let elapsed = 0
  let previousTime = 0
  let previousSpeed = 0
  for (let index = 0; index < 480; index += 1) {
    const progress = index / 479
    const ratio = segment.startRatio + (segment.endRatio - segment.startRatio) * progress
    const lapSeconds = time && segment.useTime
      ? Math.max(0, valueAt(time.values, segment.timeStart + (segment.timeEnd - segment.timeStart) * progress) - segment.startTime)
      : segment.duration * progress
    const currentSpeed = speed ? speedInMetersPerSecond(speed, valueAt(speed.values, ratio)) : 0
    if (index) elapsed += Math.max(0, lapSeconds - previousTime) * (previousSpeed + currentSpeed) / 2
    const travelled = distance
      ? valueAt(distance.values, ratio) - startDistance
      : elapsed
    const x = latitude && longitude ? valueAt(longitude.values, ratio) : positionX ? valueAt(positionX.values, ratio) : null
    const y = latitude && longitude ? valueAt(latitude.values, ratio) : positionY ? valueAt(positionY.values, ratio) : null
    samples.push({
      distance: Math.max(0, travelled), time: lapSeconds, speed: currentSpeed,
      throttle: throttle ? valueAt(throttle.values, ratio) : 0,
      brake: brake ? valueAt(brake.values, ratio) : 0,
      x, y,
    })
    previousTime = lapSeconds
    previousSpeed = currentSpeed
  }
  const hasMeasuredPosition = samples.some((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y))
  const hasEstimatedPosition = !hasMeasuredPosition && Boolean(yawRate && speed && time)
  if (hasEstimatedPosition) {
    const steps = []
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1]
      const current = samples[index]
      const deltaTime = Math.max(0, current.time - previous.time)
      steps.push({
        turn: valueAt(yawRate.values, segment.startRatio + (segment.endRatio - segment.startRatio) * index / 479) * deltaTime,
        distance: (previous.speed + current.speed) / 2 * deltaTime,
      })
    }
    // A lap is a closed circuit: remove the constant yaw-rate bias so the total
    // heading change is exactly one revolution, then spread the leftover
    // position gap along the lap so the finish lands on the start.
    const totalTurn = steps.reduce((sum, step) => sum + step.turn, 0)
    const bias = (totalTurn - Math.sign(totalTurn || 1) * 2 * Math.PI) / steps.length
    let heading = 0
    let x = 0
    let y = 0
    samples[0].x = 0
    samples[0].y = 0
    steps.forEach((step, index) => {
      const turn = step.turn - bias
      x += step.distance * Math.cos(heading + turn / 2)
      y += step.distance * Math.sin(heading + turn / 2)
      heading += turn
      samples[index + 1].x = x
      samples[index + 1].y = y
    })
    const pathLength = steps.reduce((sum, step) => sum + step.distance, 0) || 1
    let travelled = 0
    steps.forEach((step, index) => {
      travelled += step.distance
      samples[index + 1].x -= x * travelled / pathLength
      samples[index + 1].y -= y * travelled / pathLength
    })
  }
  for (const key of ['throttle', 'brake']) {
    const maximum = Math.max(...samples.map((sample) => sample[key]))
    if (maximum > 0 && maximum <= 1.01) for (const sample of samples) sample[key] *= 100
  }
  const positions = samples.filter((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y))
  const expectedDistance = trackLength(track)
  if (!directPosition && expectedDistance && speed
    && (samples.at(-1).distance < expectedDistance * 0.72 || samples.at(-1).distance > expectedDistance * 1.3)) {
    throw new Error('No complete lap with a plausible track distance was found.')
  }
  const stat = fs.statSync(filePath)
  const filenameCar = path.basename(filePath).match(/(?:^|-)(mclaren_720s_gt3_evo|nissan_gt_r_gt3_2018|lexus_rc_f_gt3)(?:-|$)/i)
  return {
    id: filePath, path: filePath, name: path.basename(filePath),
    car: sidecar.car || header.car || filenameCar?.[1]?.replace(/_/g, ' ') || 'Unknown car', track: sidecar.track || header.track || 'Unknown track',
    driver: sidecar.driver || header.driver || 'Unknown driver', date: header.date || stat.mtime.toISOString().slice(0, 10),
    lapTime: Math.max(0, samples.at(-1).time - samples[0].time),
    lapIndex, fastestLapIndex, lapTimes: segments.map(({ duration }) => duration),
    hasSidecar: fs.existsSync(filePath.replace(/\.ld$/i, '.ldx')),
    channels: channels.map(({ name, unit }) => ({ name, unit })), samples,
    hasPosition: positions.length > 20, positionSource: hasMeasuredPosition ? 'measured' : hasEstimatedPosition ? 'estimated' : 'none',
    hasDistance: Boolean(distance) || Boolean(speed && time), hasThrottle: Boolean(throttle), hasBrake: Boolean(brake),
  }
}

function summaryForDiscovery(filePath) {
  try {
    const lap = parseLap(filePath)
    return {
      id: filePath, path: filePath, name: path.basename(filePath), car: lap.car, track: lap.track,
      date: lap.date, lapTime: lap.lapTime, lapTimes: lap.lapTimes, fastestLapIndex: lap.fastestLapIndex,
    }
  } catch (error) {
    return {
      id: filePath, path: filePath, name: path.basename(filePath), car: 'Unreadable log', track: error.message,
      date: fs.statSync(filePath).mtime.toISOString().slice(0, 10), lapTime: 0, lapTimes: [], fastestLapIndex: 0, error: true,
    }
  }
}

function discoverFiles(root) {
  if (!fs.existsSync(root)) return []
  const results = []
  const pending = [{ folder: root, depth: 0 }]
  while (pending.length) {
    const { folder, depth } = pending.pop()
    let entries
    try { entries = fs.readdirSync(folder, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const filePath = path.join(folder, entry.name)
      if (entry.isDirectory() && depth < 4 && !entry.name.startsWith('.')) pending.push({ folder: filePath, depth: depth + 1 })
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.ld')) results.push({ ...summaryForDiscovery(filePath), hasSidecar: fs.existsSync(filePath.replace(/\.ld$/i, '.ldx')) })
    }
  }
  return results.sort((a, b) => b.date.localeCompare(a.date))
}

module.exports = { discoverFiles, parseLap }