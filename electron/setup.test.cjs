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
      drivetrain: { preload: 0 },
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
      issue: 'entryUndersteer',
      now: new Date('2026-10-27T20:00:00.000Z'),
    })
    const generated = JSON.parse(fs.readFileSync(result.setup.path, 'utf8'))
    assert.equal(generated.advancedSetup.mechanicalBalance.aRBFront, 7)
    assert.deepEqual(generated.basicSetup.tyres.tyrePressure, [88, 88, 82, 82])
    assert.deepEqual(JSON.parse(fs.readFileSync(sourcePath, 'utf8')), original)
    assert.match(result.setup.path, /TrackLine-entryUndersteer-/)
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
    const entry = make('entryOversteer')
    assert.equal(JSON.parse(fs.readFileSync(entry.setup.path, 'utf8')).advancedSetup.mechanicalBalance.aRBFront, 9)
    const braking = make('brakingStability')
    assert.equal(JSON.parse(fs.readFileSync(braking.setup.path, 'utf8')).advancedSetup.mechanicalBalance.brakeBias, 41)
    const balanced = make('balanced')
    assert.deepEqual(JSON.parse(fs.readFileSync(balanced.setup.path, 'utf8')), JSON.parse(fs.readFileSync(sourcePath, 'utf8')))
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('creates phase-specific setup variants for mid-corner and exit handling', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'trackline-phases-'))
  try {
    const sourcePath = writeSetup(folder, 'mclaren_720s_gt3_evo', 'monza')
    const make = (issue) => createSetupVariant({
      sourcePath, setupsRoot: folder, car: 'mclaren_720s_gt3_evo', track: 'monza', issue,
      now: new Date('2026-10-27T20:00:00.000Z'),
    })
    const midUndersteer = make('midUndersteer')
    assert.equal(JSON.parse(fs.readFileSync(midUndersteer.setup.path, 'utf8')).advancedSetup.mechanicalBalance.aRBFront, 7)
    const midOversteer = make('midOversteer')
    assert.equal(JSON.parse(fs.readFileSync(midOversteer.setup.path, 'utf8')).advancedSetup.mechanicalBalance.aRBRear, 5)
    const exitUndersteer = make('exitUndersteer')
    assert.equal(JSON.parse(fs.readFileSync(exitUndersteer.setup.path, 'utf8')).advancedSetup.mechanicalBalance.aRBRear, 5)
    const exitOversteer = make('exitOversteer')
    assert.equal(JSON.parse(fs.readFileSync(exitOversteer.setup.path, 'utf8')).advancedSetup.drivetrain.preload, 1)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('uses in-game tyre pressure and temperature feedback for conservative pressure variants', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'trackline-pressure-'))
  try {
    const sourcePath = writeSetup(folder, 'nissan_gt_r_gt3_2018', 'monza', 'base.json', nativeSetup({
      carName: 'nissan_gt_r_gt3_2018',
      basicSetup: { tyres: { tyreCompound: 0, tyrePressure: [49, 53, 47, 47] }, strategy: { pitStrategy: [{ tyres: { tyrePressure: [49, 53, 47, 47] } }] } },
    }))
    const result = createSetupVariant({
      sourcePath, setupsRoot: folder, car: 'nissan_gt_r_gt3_2018', track: 'monza', issue: 'tyrePressure',
      tyres: { pressuresPsi: [27.2, 26.0, 27.5, 26.6], temperaturesC: [85, 88, 91, 82], conditions: 'dry' },
      now: new Date('2026-10-27T20:00:00.000Z'),
    })
    const generated = JSON.parse(fs.readFileSync(result.setup.path, 'utf8'))
    assert.deepEqual(generated.basicSetup.tyres.tyrePressure, [43, 59, 38, 47])
    assert.deepEqual(generated.basicSetup.strategy.pitStrategy[0].tyres.tyrePressure, [43, 59, 38, 47])
    assert.match(result.change, /Starting pressures/)

    const coldResult = createSetupVariant({
      sourcePath, setupsRoot: folder, car: 'nissan_gt_r_gt3_2018', track: 'monza', issue: 'tyrePressure',
      tyres: { pressuresPsi: [28, 28, 28, 28], temperaturesC: [65, 85, 85, 85], conditions: 'dry' },
      now: new Date('2026-10-27T20:00:00.000Z'),
    })
    assert.match(coldResult.change, /No pressure change/)
    assert.deepEqual(JSON.parse(fs.readFileSync(coldResult.setup.path, 'utf8')).basicSetup.tyres.tyrePressure, [49, 53, 47, 47])
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('preserves GT4 native pressure values because their pressure scale differs from GT3', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'trackline-gt4-pressure-'))
  try {
    const sourcePath = writeSetup(folder, 'alpine_a110_gt4', 'monza', 'baseline.json', nativeSetup({
      carName: 'alpine_a110_gt4',
      basicSetup: { tyres: { tyreCompound: 0, tyrePressure: [168, 168, 168, 168] }, strategy: {} },
    }))
    const result = createSetupVariant({
      sourcePath, setupsRoot: folder, car: 'alpine_a110_gt4', track: 'monza', issue: 'tyrePressure',
      tyres: { pressuresPsi: [27, 27, 27, 27], temperaturesC: [85, 85, 85, 85], conditions: 'dry' },
    })
    assert.match(result.change, /only for GT3 setups/)
    assert.deepEqual(JSON.parse(fs.readFileSync(result.setup.path, 'utf8')).basicSetup.tyres.tyrePressure, [168, 168, 168, 168])
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('rejects unsupported quiz choices and setups for a different car', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'trackline-invalid-'))
  try {
    const sourcePath = writeSetup(folder, 'mclaren_720s_gt3_evo', 'monza')
    const options = { sourcePath, setupsRoot: folder, car: 'nissan_gt_r_gt3', track: 'monza', issue: 'entryUndersteer' }
    assert.throws(() => createSetupVariant(options), /different car/)
    assert.throws(() => createSetupVariant({ ...options, car: 'mclaren_720s_gt3_evo', issue: 'unknown' }), /supported setup feedback/)
    assert.throws(() => createSetupVariant({
      ...options, car: 'mclaren_720s_gt3_evo', issue: 'tyrePressure',
      tyres: { pressuresPsi: [19, 27, 27, 27], temperaturesC: [85, 85, 85, 85], conditions: 'dry' },
    }), /valid in-game pressure and temperature/)
    assert.throws(() => parseSetup(writeSetup(folder, 'nissan_gt_r_gt3', 'monza', 'invalid.json', nativeSetup({
      carName: 'nissan_gt_r_gt3',
      basicSetup: { tyres: { tyrePressure: [148, 20, 20, 20] } },
    }))), /valid native tyre-pressure/)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})
