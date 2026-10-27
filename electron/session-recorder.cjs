class SessionRecorder {
  constructor() {
    this.current = null
  }

  update(frame, now) {
    let completed = null
    const sameSession = this.current && this.current.car === frame.carModel && this.current.track === frame.track
    if (this.current && !sameSession) completed = this.finish(now)
    if (!this.current) {
      this.current = {
        startedAt: now,
        car: frame.carModel,
        track: frame.track,
        startingLaps: frame.completedLaps,
        completedLaps: 0,
        maxSpeedKmh: 0,
      }
    }
    this.current.completedLaps = Math.max(0, frame.completedLaps - this.current.startingLaps)
    this.current.maxSpeedKmh = Math.max(this.current.maxSpeedKmh, frame.speedKmh || 0)
    return completed
  }

  finish(now = Date.now()) {
    if (!this.current) return null
    const session = this.current
    this.current = null
    const durationSeconds = Math.round((now - session.startedAt) / 1000)
    if (durationSeconds < 60 && session.completedLaps === 0) return null
    return {
      id: `${session.startedAt}-${now}`,
      car: session.car,
      track: session.track,
      durationSeconds,
      completedLaps: session.completedLaps,
      maxSpeedKmh: Math.round(session.maxSpeedKmh),
      endedAt: now,
    }
  }
}

module.exports = { SessionRecorder }
