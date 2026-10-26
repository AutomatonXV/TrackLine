// Groups the reference pedal traces ahead of the car into driving events. Pure functions, no I/O.

const HORIZON_S = 2.5
const BRAKE_ON = 20
const THROTTLE_ON = 40
const THROTTLE_LOW = 20
const RISE_WINDOW_S = 0.6
const HARD_PEAK = 70
const HARD_RISE_S = 0.5

// Returns events sorted by startsInS. `index` is the car's fractional position in the table.
// Ids are built from table indexes, so they stay stable while the car approaches the event.
function findEvents(table, index, speedMs, horizonS = HORIZON_S) {
  if (!table || !(speedMs > 3)) return []
  const count = table.points - 1
  const secondsPerPoint = table.lengthM / count / speedMs
  const steps = Math.min(count - 1, Math.ceil(horizonS / secondsPerPoint))
  const at = (values, k) => values[(Math.floor(index) + k) % count]
  const timeOf = (k) => (Math.floor(index) + k - index) * secondsPerPoint
  const brakeNow = at(table.brake, 0)
  const throttleNow = at(table.throttle, 0)
  const events = []

  if (brakeNow < BRAKE_ON) {
    for (let k = 1; k <= steps; k += 1) {
      if (at(table.brake, k) < BRAKE_ON) continue
      const window = Math.max(1, Math.round(RISE_WINDOW_S / secondsPerPoint))
      let peak = 0
      for (let j = 0; j <= window; j += 1) peak = Math.max(peak, at(table.brake, k + j))
      let riseS = 0
      for (let j = 0; j <= window; j += 1) if (at(table.brake, k + j) >= peak * 0.9) { riseS = j * secondsPerPoint; break }
      const hard = peak >= 90 || (peak >= HARD_PEAK && riseS <= HARD_RISE_S)
      events.push({ type: 'brake', id: `brake@${(Math.floor(index) + k) % count}`, startsInS: timeOf(k), peak, hard })
      break
    }
  }

  if (throttleNow < THROTTLE_LOW) {
    for (let k = 1; k <= steps; k += 1) {
      if (at(table.throttle, k) < THROTTLE_ON) continue
      events.push({ type: 'throttle', id: `throttle@${(Math.floor(index) + k) % count}`, startsInS: timeOf(k), peak: at(table.throttle, k), hard: false })
      break
    }
  }
  return events.sort((a, b) => a.startsInS - b.startsInS)
}

module.exports = { findEvents, HORIZON_S }
