const { EventEmitter } = require('node:events')

const PHYSICS = { name: 'Local\\acpmf_physics', size: 800 }
const GRAPHICS = { name: 'Local\\acpmf_graphics', size: 1600 }
const STATIC = { name: 'Local\\acpmf_static', size: 820 }
const STATUS = { 0: 'off', 1: 'replay', 2: 'live', 3: 'pause' }
const MAX_CARS = 60
const FILE_MAP_READ = 4

function wstring(buffer, offset, chars) {
  const text = buffer.toString('utf16le', offset, offset + chars * 2)
  const end = text.indexOf('\0')
  return (end < 0 ? text : text.slice(0, end)).trim()
}

function parsePhysics(buffer) {
  return {
    packetId: buffer.readInt32LE(0),
    gas: buffer.readFloatLE(4),
    brake: buffer.readFloatLE(8),
    gear: buffer.readInt32LE(16),
    rpm: buffer.readInt32LE(20),
    steerAngle: buffer.readFloatLE(24),
    speedKmh: buffer.readFloatLE(28),
    tyrePressuresPsi: Array.from({ length: 4 }, (_, index) => buffer.readFloatLE(88 + index * 4)),
    tyreCoreTempsC: Array.from({ length: 4 }, (_, index) => buffer.readFloatLE(152 + index * 4)),
  }
}

function parseGraphics(buffer) {
  const playerCarId = buffer.readInt32LE(1216)
  let playerIndex = 0
  for (let index = 0; index < MAX_CARS; index += 1) {
    if (buffer.readInt32LE(976 + index * 4) === playerCarId) { playerIndex = index; break }
  }
  const base = 256 + playerIndex * 12
  return {
    packetId: buffer.readInt32LE(0),
    status: STATUS[buffer.readInt32LE(4)] || 'off',
    completedLaps: buffer.readInt32LE(132),
    currentTimeMs: buffer.readInt32LE(140),
    isInPit: buffer.readInt32LE(160) !== 0,
    normalizedCarPosition: buffer.readFloatLE(248),
    x: buffer.readFloatLE(base),
    z: buffer.readFloatLE(base + 8),
  }
}

function parseStatic(buffer) {
  return { carModel: wstring(buffer, 68, 33), track: wstring(buffer, 134, 33), maxRpm: buffer.readInt32LE(412) }
}

class AccReader extends EventEmitter {
  constructor({ intervalMs = 16 } = {}) {
    super()
    this.intervalMs = intervalMs
    this.maps = null
    this.statics = null
    this.timer = null
    this.lastPacket = -1
    this.lastPacketAt = 0
    this.lastGraphicsPacket = -1
    this.lastGraphicsAt = 0
    this.connected = false
    this.kernel = null
    this.lastAttempt = 0
    this.seenAdvance = false
  }

  load() {
    if (this.kernel || process.platform !== 'win32') return Boolean(this.kernel)
    try {
      const koffi = require('koffi')
      const k32 = koffi.load('kernel32.dll')
      this.kernel = {
        koffi,
        open: k32.func('void * OpenFileMappingW(uint32 access, int inherit, str16 name)'),
        map: k32.func('void * MapViewOfFile(void *handle, uint32 access, uint32 high, uint32 low, size_t bytes)'),
        unmap: k32.func('int UnmapViewOfFile(void *address)'),
        close: k32.func('int CloseHandle(void *handle)'),
        copy: k32.func('void RtlMoveMemory(_Out_ uint8_t *destination, void *source, size_t length)'),
      }
    } catch (error) {
      this.emit('error', error)
    }
    return Boolean(this.kernel)
  }

  openMapping({ name, size }) {
    const { open, map, close } = this.kernel
    const handle = open(FILE_MAP_READ, 0, name)
    if (!handle) return null
    const address = map(handle, FILE_MAP_READ, 0, 0, size)
    if (!address) { close(handle); return null }
    return { handle, address, size, view: Buffer.alloc(size) }
  }

  // Electron forbids external ArrayBuffers, so each page is copied into a local buffer per tick.
  refresh(mapping) {
    this.kernel.copy(mapping.view, mapping.address, mapping.size)
    return mapping.view
  }

  closeMappings() {
    if (!this.maps || !this.kernel) return
    for (const mapping of Object.values(this.maps)) {
      this.kernel.unmap(mapping.address)
      this.kernel.close(mapping.handle)
    }
    this.maps = null
    this.statics = null
  }

  connect() {
    if (!this.load()) return false
    const physics = this.openMapping(PHYSICS)
    const graphics = this.openMapping(GRAPHICS)
    const stat = this.openMapping(STATIC)
    if (!physics || !graphics || !stat) {
      for (const mapping of [physics, graphics, stat]) {
        if (mapping) { this.kernel.unmap(mapping.address); this.kernel.close(mapping.handle) }
      }
      return false
    }
    this.maps = { physics, graphics, stat }
    this.statics = null
    this.lastPacket = -1
    this.lastGraphicsPacket = -1
    this.lastPacketAt = this.lastGraphicsAt = Date.now()
    this.seenAdvance = false
    return true
  }

  // ACC's pages stay mapped after it exits, so a connection is only trusted while packet ids advance.
  // Returns 'fresh', 'waiting' (no advance seen yet) or 'stale'.
  freshness(physicsPacket, graphicsPacket, now) {
    let advanced = false
    if (physicsPacket !== this.lastPacket) {
      advanced = advanced || this.lastPacket !== -1
      this.lastPacket = physicsPacket
      this.lastPacketAt = now
    }
    if (graphicsPacket !== this.lastGraphicsPacket) {
      advanced = advanced || this.lastGraphicsPacket !== -1
      this.lastGraphicsPacket = graphicsPacket
      this.lastGraphicsAt = now
    }
    if (advanced) this.seenAdvance = true
    if (now - Math.max(this.lastPacketAt, this.lastGraphicsAt) > 2000) return 'stale'
    return this.seenAdvance ? 'fresh' : 'waiting'
  }

  sample(now = Date.now()) {
    if (!this.maps) return null
    const physics = parsePhysics(this.refresh(this.maps.physics))
    const graphics = parseGraphics(this.refresh(this.maps.graphics))
    const freshness = this.freshness(physics.packetId, graphics.packetId, now)
    if (freshness === 'stale') return { stale: true }
    if (freshness === 'waiting') return { waiting: true }
    if (!this.statics || !this.statics.carModel) this.statics = parseStatic(this.refresh(this.maps.stat))
    return { ...physics, ...graphics, ...this.statics, t: now }
  }

  tick() {
    const now = Date.now()
    let frame = null
    try {
      if (!this.maps) {
        if (now - this.lastAttempt < 1000) return
        this.lastAttempt = now
        if (!this.connect()) { this.setConnected(false); return }
      }
      frame = this.sample(now)
      if (frame.stale) { this.closeMappings(); this.setConnected(false); return }
      if (frame.waiting) return
    } catch (error) {
      this.closeMappings()
      this.setConnected(false)
      this.emit('error', error)
      return
    }
    this.setConnected(true)
    this.emit('frame', frame)
  }

  // Drops any mapping and retries immediately, for when ACC was launched after the app.
  reconnect() {
    this.closeMappings()
    this.setConnected(false)
    this.lastAttempt = 0
    this.tick()
  }

  setConnected(value) {
    if (value === this.connected) return
    this.connected = value
    this.emit('connection', value)
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), this.intervalMs)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.closeMappings()
    this.setConnected(false)
  }
}

module.exports = { AccReader, parsePhysics, parseGraphics, parseStatic, PHYSICS, GRAPHICS, STATIC }
