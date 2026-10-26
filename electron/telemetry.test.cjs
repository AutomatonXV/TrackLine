const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { discoverFiles, parseLap } = require('./telemetry.cjs')

function createFixture(folder, options = {}) {
  const filePath = path.join(folder, 'lap-one.ld')
  const channels = options.channels || [
    ['Distance', [0, 1000, 2000, 3000], 'm'],
    ['Time', [0, 30, 60, 90], 's'],
    ['Throttle Pos', [0, 0.8, 1, 0], '%'],
    ['Brake Pos', [0, 0.2, 0, 0], '%'],
    ['Ground Speed', [100, 120, 130, 100], 'km/h'],
    ['GPS Latitude', [50, 50.01, 50.01, 50], 'deg'],
    ['GPS Longitude', [4, 4, 4.01, 4.01], 'deg'],
  ]
  const headerSize = 1762
  const channelSize = 124
  const dataOffset = headerSize + channels.length * channelSize
  const dataSize = channels.reduce((sum, [, values]) => sum + values.length * 4, 0)
  const buffer = Buffer.alloc(dataOffset + dataSize)
  buffer.writeUInt32LE(headerSize, 8)
  buffer.write('12/03/2024', 94, 'ascii')
  buffer.write('Driver One', 158, 'ascii')
  buffer.write('McLaren 720S GT3 Evo', 222, 'ascii')
  buffer.write('Monza', 350, 'ascii')

  let nextDataOffset = dataOffset
  channels.forEach(([name, values, unit], index) => {
    const channelOffset = headerSize + index * channelSize
    const payloadOffset = nextDataOffset
    buffer.writeUInt32LE(index < channels.length - 1 ? channelOffset + channelSize : 0, channelOffset + 4)
    buffer.writeUInt32LE(payloadOffset, channelOffset + 8)
    buffer.writeUInt32LE(values.length, channelOffset + 12)
    buffer.writeUInt16LE(7, channelOffset + 18)
    buffer.writeUInt16LE(4, channelOffset + 20)
    buffer.writeUInt16LE(4, channelOffset + 22)
    buffer.writeInt16LE(1, channelOffset + 26)
    buffer.writeInt16LE(1, channelOffset + 28)
    buffer.write(name, channelOffset + 32, 'ascii')
    buffer.write(unit, channelOffset + 72, 'ascii')
    values.forEach((value, valueIndex) => buffer.writeFloatLE(value, payloadOffset + valueIndex * 4))
    nextDataOffset += values.length * 4
  })
  fs.writeFileSync(filePath, buffer)
  fs.writeFileSync(path.join(folder, 'lap-one.ldx'), options.sidecar || '<Log><Vehicle>Nissan GT-R Nismo GT3</Vehicle><Venue>Spa-Francorchamps</Venue><Driver>Sidecar Driver</Driver></Log>')
  return filePath
}

test('decodes numeric channels, track position, and paired LDX metadata', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fastrack-'))
  try {
    const filePath = createFixture(folder)
    const lap = parseLap(filePath)
    assert.equal(lap.car, 'Nissan GT-R Nismo GT3')
    assert.equal(lap.track, 'Spa-Francorchamps')
    assert.equal(lap.driver, 'Sidecar Driver')
    assert.equal(lap.lapTime, 90)
    assert.equal(lap.hasSidecar, true)
    assert.equal(lap.hasPosition, true)
    assert.equal(lap.hasThrottle, true)
    assert.equal(lap.hasBrake, true)
    assert.equal(lap.samples.length, 480)
    assert.ok(lap.samples[180].throttle > 70)
    assert.ok(lap.samples.some((sample) => sample.x !== null && sample.y !== null))

    const discovered = discoverFiles(folder)
    assert.equal(discovered.length, 1)
    assert.equal(discovered[0].path, filePath)
    assert.equal(discovered[0].hasSidecar, true)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('selects the fastest plausible lap and estimates a path from speed and yaw rate', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fastrack-estimated-'))
  try {
    const filePath = createFixture(folder, {
      channels: [
        ['Time', [0, 25, 50, 0, 60, 120], 's'],
        ['Speed', [20, 20, 20, 20, 20, 20], 'm/s'],
        ['ROTY', [0.05, 0.05, 0.05, 0.05, 0.05, 0.05], 'rad/s'],
      ],
      sidecar: '<Log><Venue>Test Circuit</Venue></Log>',
    })
    const fastest = parseLap(filePath)
    assert.deepEqual(fastest.lapTimes, [50, 120])
    assert.equal(fastest.lapIndex, 0)
    assert.equal(fastest.lapTime, 50)
    assert.equal(fastest.positionSource, 'estimated')
    assert.ok(fastest.samples.some((sample) => sample.x !== 0 && sample.y !== 0))

    const laterLap = parseLap(filePath, 1)
    assert.equal(laterLap.lapTime, 120)
    assert.equal(laterLap.lapIndex, 1)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('rejects invalid or unsupported logs with a useful error', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fastrack-bad-'))
  try {
    const filePath = path.join(folder, 'bad.ld')
    fs.writeFileSync(filePath, Buffer.alloc(16))
    assert.throws(() => parseLap(filePath), /too small/)
    assert.equal(discoverFiles(folder)[0].error, true)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})