// Decides what is worth saying. Takes events plus live pedals, returns cues; never speaks itself.

// `s` is the audible length of each clip; keep clip names in sync with scripts/render-voice.cjs.
const CLIPS = {
  'brake-hard': { text: 'Big stop ahead: brake hard', s: 0.8 },
  'brake-now': { text: 'Missed the brake point: brake now', s: 0.8 },
  brake: { text: 'Braking zone: get on the brakes', s: 0.6 },
  release: { text: 'Ease off the brake and let the car rotate', s: 1.1 },
  throttle: { text: 'Back on the throttle, squeeze it on', s: 1.2 },
}

const REACTION_S = 0.3
const MIN_NOTICE_S = 0.1
const BRAKE_DONE = 30
const RELEASE_DONE = 20
const THROTTLE_DONE = 30
const MISSED_REF = 40
const MISSED_RATIO = 0.3
const MISSED_HOLD_MS = 250
const ZONE_OVER = 15
const OVERBRAKE_LIVE = 40
const OVERBRAKE_HOLD_MS = 300
const MAX_DONE = 64

class CoachPolicy {
  constructor() { this.reset() }

  reset() {
    this.done = new Set()
    this.missedSince = null
    this.missedLatched = false
    this.holdSince = null
    this.holdLatched = false
  }

  // Returns the cues that should be queued right now (usually none).
  evaluate({ events, refBrake, liveBrake, liveGas, now }) {
    const cues = []

    for (const event of events) {
      if (this.done.has(event.id)) continue
      const clip = event.type === 'brake' ? (event.hard ? 'brake-hard' : 'brake') : event.type
      // Speak early enough that the clip ends REACTION_S before the action should start.
      if (event.startsInS > CLIPS[clip].s + REACTION_S) continue
      if (event.startsInS < MIN_NOTICE_S) continue
      const satisfied = event.type === 'brake' ? liveBrake >= Math.min(BRAKE_DONE, event.peak * 0.5) : liveGas >= THROTTLE_DONE
      if (satisfied) { this.remember(event.id); continue }
      cues.push({ id: event.id, clip, priority: event.hard ? 1 : 0, expiresAt: now + event.startsInS * 1000 + 300 })
      break
    }

    // The braking zone has started and the driver has not braked: one urgent call per zone.
    if (refBrake >= MISSED_REF && liveBrake < refBrake * MISSED_RATIO) {
      this.missedSince ??= now
      if (!this.missedLatched && now - this.missedSince >= MISSED_HOLD_MS) {
        this.missedLatched = true
        cues.push({ id: `missed@${Math.floor(now)}`, clip: 'brake-now', priority: 1, expiresAt: now + 800 })
      }
    } else {
      this.missedSince = null
    }
    if (refBrake < ZONE_OVER) this.missedLatched = false

    // The reference has let go of the brake but the driver is still on it.
    if (refBrake < ZONE_OVER && liveBrake >= OVERBRAKE_LIVE) {
      this.holdSince ??= now
      if (!this.holdLatched && now - this.holdSince >= OVERBRAKE_HOLD_MS) {
        this.holdLatched = true
        cues.push({ id: `release@${Math.floor(now)}`, clip: 'release', priority: 1, expiresAt: now + 800 })
      }
    } else {
      this.holdSince = null
    }
    if (liveBrake < RELEASE_DONE) this.holdLatched = false
    return cues
  }

  remember(id) {
    this.done.add(id)
    if (this.done.size > MAX_DONE) this.done.delete(this.done.values().next().value)
  }
}

module.exports = { CoachPolicy, CLIPS }
