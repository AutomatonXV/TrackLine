// Single-slot speech scheduler: dedupes, expires stale cues, applies a cooldown to ordinary cues
// and lets urgent ones interrupt. It only returns what to play; audio output lives elsewhere.

const REPEAT_BLOCK_MS = 8000

class SpeechScheduler {
  constructor({ cooldownS = 1.5, clipSeconds = () => 1 } = {}) {
    this.cooldownMs = cooldownS * 1000
    this.clipSeconds = clipSeconds
    this.reset()
  }

  reset() {
    this.pending = null
    this.spoken = new Map()
    this.lastStart = -Infinity
    this.speakingUntil = 0
  }

  setCooldown(seconds) {
    if (Number.isFinite(seconds)) this.cooldownMs = Math.max(1, Math.min(2, seconds)) * 1000
  }

  submit(cue, now) {
    const heard = this.spoken.get(cue.id)
    if (heard !== undefined && now - heard < REPEAT_BLOCK_MS) return
    if (this.pending && this.pending.id === cue.id) return
    // The newest ordinary cue replaces an older ordinary one; an urgent one is never displaced by a normal one.
    if (this.pending && this.pending.priority > cue.priority) return
    this.pending = cue
  }

  // Returns { id, clip, interrupt } when something should be played now, else null.
  next(now) {
    for (const [id, at] of this.spoken) if (now - at >= REPEAT_BLOCK_MS) this.spoken.delete(id)
    const cue = this.pending
    if (!cue) return null
    if (now > cue.expiresAt) { this.pending = null; return null }
    const speaking = now < this.speakingUntil
    if (cue.priority === 0 && (speaking || now - this.lastStart < this.cooldownMs)) return null
    this.pending = null
    this.spoken.set(cue.id, now)
    this.lastStart = now
    this.speakingUntil = now + this.clipSeconds(cue.clip) * 1000
    return { id: cue.id, clip: cue.clip, interrupt: speaking }
  }
}

module.exports = { SpeechScheduler }
