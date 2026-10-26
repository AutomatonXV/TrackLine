const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { parseLap } = require('./telemetry.cjs')
const { parsePhysics, parseGraphics, parseStatic, AccReader } = require('./acc.cjs')
const { pickFastest, buildTable, sameCar, sameTrack } = require('./reference.cjs')
const { Coach } = require('./coach.cjs')

const referencePath = path.join(__dirname, '../Assets/Reference_Monza_720SEVO_MoTeC/monza-mclaren_720s_gt3_evo-10-2023.06.29-19.52.41.ld')

function writeWide(buffer, offset, text) { buffer.write(`${text}\0`, offset, 'utf16le') }

function physicsBuffer({ packetId = 1, gas = 0, brake = 0, steer = 0, speed = 0 } = {}) {
  const buffer = Buffer.alloc(800)
  buffer.writeInt32LE(packetId, 0)
  buffer.writeFloatLE(gas, 4)
  buffer.writeFloatLE(brake, 8)
  buffer.writeFloatLE(steer, 24)
  buffer.writeFloatLE(speed, 28)
  return buffer
}

function graphicsBuffer({ packetId = 1, status = 2, position = 0, x = 0, z = 0, playerId = 7, slot = 3 } = {}) {
  const buffer = Buffer.alloc(1600)
  buffer.writeInt32LE(packetId, 0)
  buffer.writeInt32LE(status, 4)
  buffer.writeFloatLE(position, 248)
  for (let index = 0; index < 60; index += 1) buffer.writeInt32LE(index === slot ? playerId : 100 + index, 976 + index * 4)
  buffer.writeInt32LE(playerId, 1216)
  buffer.writeFloatLE(x, 256 + slot * 12)
  buffer.writeFloatLE(z, 256 + slot * 12 + 8)
  return buffer
}

function staticBuffer() {
  const buffer = Buffer.alloc(820)
  writeWide(buffer, 68, 'mclaren_720s_gt3_evo')
  writeWide(buffer, 134, 'monza')
  return buffer
}

test('parses ACC shared memory pages', () => {
  const physics = parsePhysics(physicsBuffer({ gas: 0.75, brake: 0.25, steer: -0.3, speed: 180 }))
  assert.equal(physics.gas, 0.75)
  assert.equal(physics.brake, 0.25)
  assert.ok(Math.abs(physics.steerAngle + 0.3) < 1e-6)
  const graphics = parseGraphics(graphicsBuffer({ position: 0.5, x: 12.5, z: -4 }))
  assert.equal(graphics.status, 'live')
  assert.equal(graphics.normalizedCarPosition, 0.5)
  assert.equal(graphics.x, 12.5)
  assert.equal(graphics.z, -4)
  assert.deepEqual(parseStatic(staticBuffer()), { carModel: 'mclaren_720s_gt3_evo', track: 'monza', maxRpm: 0 })
})

test('matches ACC identifiers to MoTeC metadata and picks the fastest lap', () => {
  assert.ok(sameCar('mclaren_720s_gt3_evo', 'mclaren 720s gt3 evo'))
  assert.ok(!sameCar('mclaren_720s_gt3_evo', 'nissan gtr nismo gt3'))
  assert.ok(sameTrack('Nurburgring', 'nurburgring gp'))
  const best = pickFastest([
    { path: 'a.ld', name: 'a', car: 'mclaren 720s gt3 evo', track: 'monza', lapTimes: [110, 106.5] },
    { path: 'b.ld', name: 'b', car: 'mclaren 720s gt3 evo', track: 'monza', lapTimes: [105.8] },
    { path: 'c.ld', name: 'c', car: 'nissan', track: 'monza', lapTimes: [90] },
    { path: 'd.ld', name: 'd', car: 'mclaren 720s gt3 evo', track: 'spa', lapTimes: [100] },
  ], 'mclaren_720s_gt3_evo', 'monza')
  assert.deepEqual(best, { path: 'b.ld', name: 'b', lapIndex: 0, lapTime: 105.8 })
})

test('builds a uniform reference table from the bundled lap', () => {
  const table = buildTable(parseLap(referencePath))
  assert.equal(table.points, 960)
  assert.equal(table.throttle.length, 960)
  assert.ok(table.lengthM > 5000 && table.lengthM < 6500)
  assert.ok(Math.max(...table.throttle) <= 100 && Math.max(...table.brake) > 20)
  assert.ok(table.hasPosition)
})

function simulate({ mirror }) {
  const table = buildTable(parseLap(referencePath))
  const n = table.points
  const angle = 0.7
  const toLive = (x, y) => {
    const rx = x * Math.cos(angle) - y * Math.sin(angle) + 1000
    const ry = x * Math.sin(angle) + y * Math.cos(angle) - 500
    return [mirror ? -rx : rx, ry]
  }
  const coach = new Coach()
  coach.setReference(table)
  const results = []
  let now = 1000
  for (let lap = 0; lap < 2; lap += 1) {
    for (let index = 0; index < n - 1; index += 1) {
      const a = (index + n - 3) % (n - 1)
      const b = (index + 3) % (n - 1)
      const next = (index + 4) % (n - 1)
      const tx = table.x[b] - table.x[a]
      const ty = table.y[b] - table.y[a]
      const length = Math.hypot(tx, ty)
      const offset = lap === 1 ? 3 : 0
      const x = table.x[index] - (ty / length) * offset
      const y = table.y[index] + (tx / length) * offset
      const cross = tx * (table.y[next] - table.y[b]) - ty * (table.x[next] - table.x[b])
      const steer = Math.abs(cross) < 1e-3 ? 0 : cross < 0 ? 0.2 : -0.2
      const [lx, ly] = toLive(x, y)
      now += 16
      const out = coach.update({ status: 'live', gas: 1, brake: 0, steerAngle: steer, speedKmh: 150, isInPit: false, normalizedCarPosition: index / (n - 1), x: lx, z: ly }, now)
      if (lap === 1 && index > 100 && index % 50 === 0) results.push(out)
    }
  }
  return results
}

for (const mirror of [false, true]) {
  test(`coach calibrates and reports the line to the right when driving left (mirror=${mirror})`, () => {
    const results = simulate({ mirror })
    const ok = results.filter((result) => result.lateral.status === 'ok')
    assert.ok(ok.length > results.length * 0.9, 'lateral guidance available')
    const median = ok.map((result) => result.lateral.offsetM).sort((p, q) => p - q)[Math.floor(ok.length / 2)]
    assert.ok(median > 1.5 && median < 4.5, `median offset ${median}`)
    assert.equal(ok[0].lateral.ahead.length, 11)
    assert.ok(ok[0].lateral.ahead[5].y > 0)
  })
}

test('warns about an upcoming brake zone one lead-time ahead, only once per approach', () => {
  const table = buildTable(parseLap(referencePath))
  const n = table.points
  const brakeStart = table.brake.findIndex((value, index) => index > 5 && value > 40 && table.brake[index - 3] < 5)
  assert.ok(brakeStart > 0)
  const coach = new Coach()
  coach.setReference(table)
  const speedMs = 70
  const read = (index) => coach.update({ status: 'live', gas: 1, brake: 0, steerAngle: 0, speedKmh: speedMs * 3.6, gear: 5, isInPit: false, normalizedCarPosition: index / (n - 1), x: 0, z: 0 }, 1000)
  const metersPerPoint = table.lengthM / (n - 1)
  const leadPoints = (speedMs * 0.25) / metersPerPoint
  const far = read(Math.max(0, brakeStart - Math.ceil(leadPoints * 4)))
  assert.equal(far.brake.warn, 0)
  const near = read(brakeStart - Math.floor(leadPoints * 0.8))
  assert.ok(near.brake.warn >= 40, `warn ${near.brake.warn}`)
  assert.equal(near.gear, 5)
  assert.ok(Math.abs(near.speedKmh - 252) < 1e-6)
  const inside = read(brakeStart + 6)
  assert.equal(inside.brake.warn, 0)
})

test('reader connects to real shared memory and reports pedals', { skip: process.platform !== 'win32' }, () => {
  const koffi = require('koffi')
  const k32 = koffi.load('kernel32.dll')
  const open = k32.func('void * OpenFileMappingW(uint32 access, int inherit, str16 name)')
  const create = k32.func('void * CreateFileMappingW(intptr_t file, void *attributes, uint32 protect, uint32 high, uint32 low, str16 name)')
  const map = k32.func('void * MapViewOfFile(void *handle, uint32 access, uint32 high, uint32 low, size_t bytes)')
  if (open(4, 0, 'Local\\acpmf_physics')) return
  const pages = [['Local\\acpmf_physics', physicsBuffer({ packetId: 1, gas: 0.6, brake: 0.1 })], ['Local\\acpmf_graphics', graphicsBuffer({ packetId: 1, position: 0.25 })], ['Local\\acpmf_static', staticBuffer()]]
  const views = pages.map(([name, source]) => {
    const handle = create(-1, null, 4, 0, 2048, name)
    const view = Buffer.from(koffi.view(map(handle, 6, 0, 0, 2048), 2048))
    source.copy(view)
    return view
  })
  const reader = new AccReader()
  const frames = []
  reader.on('frame', (frame) => frames.push(frame))
  reader.tick()
  assert.equal(reader.connected, false)
  views[0].writeInt32LE(2, 0)
  views[1].writeInt32LE(2, 0)
  reader.tick()
  assert.equal(reader.connected, true)
  assert.equal(frames.length, 1)
  assert.ok(Math.abs(frames[0].gas - 0.6) < 1e-6)
  assert.equal(frames[0].carModel, 'mclaren_720s_gt3_evo')
  assert.equal(frames[0].normalizedCarPosition, 0.25)
  reader.stop()
})
