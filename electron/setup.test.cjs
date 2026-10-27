const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { parseSetup, findSetupTemplate, createSetupVariant } = require('./setup.cjs')

function nativeSetup(overrides = {}) {
  return {
    carName: 'mclaren_720s_gt3_evo',
    basicSetup: {
      tyres: { tyreCompound: 0, tyrePressure: [88, 88, 82, 82] },
      strategy: {},
    },
    advancedSetup: {
      mechanicalBalance: { aRBFront: 8, aRBRear: 6, brakeBias: 40 },
      dampers: { bumpFast: [0, 2, 4, 0] },
    },
    trackBopType: 31,
    ...overrides,
  }
}

function writeSetup(root, car, track, name = 'baseline.json', setup = nativeSetup()) {
  const folder = path.join(root, car, track)
  fs.mkdirSync(folder, { recursive: true })
  const filePath = path.join(folder, name)
  fs.writeFileSync(filePath, JSON.stringify(setup))
  return filePath
}

test('reads ACC native setup fields without mislabeling car-specific pressure values as PSI', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'trackline-setup-'))
  try {
    const filePath = writeSetup(folder, 'mclaren_720s_gt3_evo', 'monza')
    assert.deepEqual(parseSetup(filePath), {
      path: filePath,
      name: 'baseline.json',
      car: 'mclaren_720s_gt3_evo',
      track: 'monza',
      pressureValues: [88, 88, 82, 82],
    })
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('finds a recent setup for the same car and track, then falls back to the same car', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'trackline-find-'))
  try {
    const monza = writeSetup(folder, 'mclaren_720s_gt3_evo', 'monza')
    const spa = writeSetup(folder, 'mclaren_720s_gt3_evo', 'spa')
    writeSetup(folder, 'nissan_gt_r_gt3', 'monza', 'other-car.json', nativeSetup({ carName: 'nissan_gt_r_gt3' }))
    assert.equal(findSetupTemplate({ setupsRoot: folder, car: 'mclaren_720s_gt3_evo', track: 'Monza' }), monza)
    assert.equal(findSetupTemplate({ setupsRoot: folder, car: 'mclaren_720s_gt3_evo', track: 'spa-francorchamps' }), spa)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('creates a separate one-click anti-roll-bar setup and leaves the original unchanged', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'trackline-variant-'))
  try {
    const sourcePath = writeSetup(folder, 'mclaren_720s_gt3_evo', 'monza')
    const original = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
    const result = createSetupVariant({
      sourcePath,
      setupsRoot: folder,
      car: 'mclaren_720s_gt3_evo',
      track: 'monza',
      issue: 'frontPush',
      now: new Date('2026-10-27T20:00:00.000Z'),
    })
    const generated = JSON.parse(fs.readFileSync(result.setup.path, 'utf8'))
    assert.equal(generated.advancedSetup.mechanicalBalance.aRBFront, 7)
    assert.deepEqual(generated.basicSetup.tyres.tyrePressure, [88, 88, 82, 82])
    assert.deepEqual(JSON.parse(fs.readFileSync(sourcePath, 'utf8')), original)
    assert.match(result.setup.path, /TrackLine-frontPush-/)
    assert.equal(result.change, 'Front anti-roll bar -1 click')
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('the quiz uses conservative entry-oversteer, braking, and balanced variants', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'trackline-quiz-'))
  try {
    const sourcePath = writeSetup(folder, 'mclaren_720s_gt3_evo', 'monza')
    const make = (issue) => createSetupVariant({
      sourcePath, setupsRoot: folder, car: 'mclaren_720s_gt3_evo', track: 'monza', issue,
      now: new Date('2026-10-27T20:00:00.000Z'),
    })
    const entry = make('rearLoose')
    assert.equal(JSON.parse(fs.readFileSync(entry.setup.path, 'utf8')).advancedSetup.mechanicalBalance.aRBFront, 9)
    const braking = make('brakingStability')
    assert.equal(JSON.parse(fs.readFileSync(braking.setup.path, 'utf8')).advancedSetup.mechanicalBalance.brakeBias, 41)
    const balanced = make('balanced')
    assert.deepEqual(JSON.parse(fs.readFileSync(balanced.setup.path, 'utf8')), JSON.parse(fs.readFileSync(sourcePath, 'utf8')))
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('rejects unsupported quiz choices and setups for a different car', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'trackline-invalid-'))
  try {
    const sourcePath = writeSetup(folder, 'mclaren_720s_gt3_evo', 'monza')
    const options = { sourcePath, setupsRoot: folder, car: 'nissan_gt_r_gt3', track: 'monza', issue: 'frontPush' }
    assert.throws(() => createSetupVariant(options), /different car/)
    assert.throws(() => createSetupVariant({ ...options, car: 'mclaren_720s_gt3_evo', issue: 'unknown' }), /supported setup feedback/)
    assert.throws(() => parseSetup(writeSetup(folder, 'nissan_gt_r_gt3', 'monza', 'invalid.json', nativeSetup({
      carName: 'nissan_gt_r_gt3',
      basicSetup: { tyres: { tyrePressure: [20, 20, -1, 20] } },
    }))), /valid native tyre-pressure/)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})
