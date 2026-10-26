const POINTS = 960

const key = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

function sameCar(accCar, logCar) {
  const a = key(accCar)
  const b = key(logCar)
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)))
}

const trackKey = (text) => {
  const normalized = key(text)
  return normalized.includes('nurburgring') ? 'nurburgring' : normalized
}

function sameTrack(accTrack, logTrack) {
  const a = trackKey(accTrack)
  const b = trackKey(logTrack)
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)))
}

// Fastest valid lap across every log whose car and track match the live session.
function pickFastest(summaries, carModel, track) {
  let best = null
  for (const summary of summaries) {
    if (summary.error || !sameCar(carModel, summary.car) || !sameTrack(track, summary.track)) continue
    const times = summary.lapTimes || []
    const indexes = times.length ? times.map((_, index) => index) : [summary.fastestLapIndex ?? 0]
    for (const index of indexes) {
      const time = times.length ? times[index] : summary.lapTime
      if (!(time > 0)) continue
      if (!best || time < best.lapTime) best = { path: summary.path, name: summary.name, lapIndex: index, lapTime: time }
    }
  }
  return best
}

function sampleAt(values, position) {
  const lower = Math.max(0, Math.min(values.length - 1, Math.floor(position)))
  const upper = Math.min(values.length - 1, lower + 1)
  return values[lower] + (values[upper] - values[lower]) * (position - lower)
}

// Resample a parsed lap to a uniform lap-fraction table with pedals in percent.
function buildTable(lap, points = POINTS) {
  const samples = lap.samples || []
  if (samples.length < 10) return null
  const start = samples[0].distance
  const span = samples[samples.length - 1].distance - start
  if (!(span > 100)) return null
  const fractions = samples.map((sample) => (sample.distance - start) / span)
  const percent = Math.max(...samples.map((sample) => sample.throttle), ...samples.map((sample) => sample.brake)) <= 1.5 ? 100 : 1
  const hasPosition = Boolean(lap.hasPosition) && samples.every((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y))
  const table = { points, lengthM: span, throttle: [], brake: [], x: [], y: [], hasPosition, lapTime: lap.lapTimes?.[lap.lapIndex] || lap.lapTime }
  let cursor = 0
  for (let index = 0; index < points; index += 1) {
    const fraction = index / (points - 1)
    while (cursor < samples.length - 2 && fractions[cursor + 1] < fraction) cursor += 1
    const a = samples[cursor]
    const b = samples[cursor + 1]
    const gap = fractions[cursor + 1] - fractions[cursor]
    const mix = gap > 0 ? Math.max(0, Math.min(1, (fraction - fractions[cursor]) / gap)) : 0
    const mixed = (field) => a[field] + (b[field] - a[field]) * mix
    table.throttle.push(Math.max(0, Math.min(100, mixed('throttle') * percent)))
    table.brake.push(Math.max(0, Math.min(100, mixed('brake') * percent)))
    table.x.push(hasPosition ? mixed('x') : 0)
    table.y.push(hasPosition ? mixed('y') : 0)
  }
  return table
}

module.exports = { POINTS, key, sameCar, sameTrack, pickFastest, buildTable, sampleAt }
