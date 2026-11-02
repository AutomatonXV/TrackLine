const fs = require('node:fs')
const path = require('node:path')

const ISSUES = {
  entryUndersteer: {
    label: 'Understeer on corner entry',
    description: 'Reduce front roll stiffness by one front anti-roll-bar click. Re-test before changing anything else.',
    apply(setup) {
      adjust(setup?.advancedSetup?.mechanicalBalance, 'aRBFront', -1)
      return 'Front anti-roll bar -1 click'
    },
  },
  entryOversteer: {
    label: 'Oversteer on corner entry',
    description: 'Add one front anti-roll-bar click to calm entry rotation. Re-test before changing anything else.',
    apply(setup) {
      adjust(setup?.advancedSetup?.mechanicalBalance, 'aRBFront', 1)
      return 'Front anti-roll bar +1 click'
    },
  },
  midUndersteer: {
    label: 'Understeer mid-corner',
    description: 'Soften the front anti-roll bar by one click to reduce front roll stiffness. Re-test before changing anything else.',
    apply(setup) {
      adjust(setup?.advancedSetup?.mechanicalBalance, 'aRBFront', -1)
      return 'Front anti-roll bar -1 click'
    },
  },
  midOversteer: {
    label: 'Oversteer mid-corner',
    description: 'Reduce rear roll stiffness by one rear anti-roll-bar click to add rear mechanical grip. Re-test before changing anything else.',
    apply(setup) {
      adjust(setup?.advancedSetup?.mechanicalBalance, 'aRBRear', -1)
      return 'Rear anti-roll bar -1 click'
    },
  },
  exitUndersteer: {
    label: 'Understeer on corner exit',
    description: 'Reduce rear roll stiffness by one rear anti-roll-bar click as a small traction-focused change. Re-test before changing anything else.',
    apply(setup) {
      adjust(setup?.advancedSetup?.mechanicalBalance, 'aRBRear', -1)
      return 'Rear anti-roll bar -1 click'
    },
  },
  exitOversteer: {
    label: 'Oversteer on corner exit',
    description: 'Increase differential preload by one click to calm power-on wheelspin and rear rotation. Re-test before changing anything else.',
    apply(setup) {
      adjust(setup?.advancedSetup?.drivetrain, 'preload', 1)
      return 'Differential preload +1 click'
    },
  },
  brakingStability: {
    label: 'Car feels unstable under braking',
    description: 'Move brake bias one click forward to favor braking stability. This can reduce rotation; re-test before changing anything else.',
    apply(setup) {
      adjust(setup?.advancedSetup?.mechanicalBalance, 'brakeBias', 1, 100)
      return 'Brake bias +1 click forward'
    },
  },
  balanced: {
    label: 'The car felt balanced',
    description: 'Keep the setup unchanged and save a dated copy as this session’s baseline.',
    apply() { return 'No changes; saved as a baseline copy' },
  },
  tyrePressure: {
    label: 'Tyre pressure or temperature out of range',
    description: 'Use the entered in-game hot pressures and temperatures to adjust the imported starting pressures by a small amount. Temperatures outside the working window are not treated as a pressure-only problem.',
    apply(setup, tyres) {
      if (!tyres || !Array.isArray(tyres.pressuresPsi) || tyres.pressuresPsi.length !== 4
        || !Array.isArray(tyres.temperaturesC) || tyres.temperaturesC.length !== 4
        || !tyres.pressuresPsi.every((value) => Number.isFinite(value) && value >= 20 && value <= 40)
        || !tyres.temperaturesC.every((value) => Number.isFinite(value) && value >= 0 && value <= 160)
        || !['dry', 'wet'].includes(tyres.conditions)) {
        throw new Error('Enter valid in-game pressure and temperature readings for all four tyres.')
      }

      const target = tyres.conditions === 'wet' ? 30.5 : 26.6
      if (tyres.temperaturesC.some((temperature) => temperature < 70 || temperature > 100)) {
        return 'No pressure change: tyre temperatures are outside the 70–100°C working window'
      }
      if (!normalize(setup?.carName).includes('gt3')) {
        return 'No pressure change: automatic native-pressure adjustment is currently supported only for GT3 setups'
      }

      const adjustments = tyres.pressuresPsi.map((pressure) => Math.round(Math.max(-1, Math.min(1, target - pressure)) * 10))
      const pressures = setup?.basicSetup?.tyres?.tyrePressure
      if (!Array.isArray(pressures) || pressures.length !== 4
        || pressures.some((value) => !Number.isInteger(value) || value < 0 || value > 147)) {
        throw new Error('The imported setup does not contain four valid GT3 starting-pressure values.')
      }
      const next = pressures.map((pressure, index) => pressure + adjustments[index])
      if (next.some((value) => value < 0 || value > 147)) {
        throw new Error('The recommended tyre-pressure change exceeds the ACC setup range.')
      }
      setup.basicSetup.tyres.tyrePressure = next
      const pitStrategies = setup.basicSetup.strategy?.pitStrategy
      for (const strategy of Array.isArray(pitStrategies) ? pitStrategies : []) {
        if (strategy.tyres && Array.isArray(strategy.tyres.tyrePressure) && strategy.tyres.tyrePressure.length === 4) {
          strategy.tyres.tyrePressure = strategy.tyres.tyrePressure.map((pressure, index) => {
            if (!Number.isInteger(pressure) || pressure < 0 || pressure > 147) {
              throw new Error('A pit strategy contains an invalid tyre-pressure value.')
            }
            const value = pressure + adjustments[index]
            if (value < 0 || value > 147) throw new Error('The recommended pit tyre-pressure change exceeds the ACC setup range.')
            return value
          })
        }
      }
      return `Starting pressures ${adjustments.map((value) => `${value >= 0 ? '+' : ''}${(value / 10).toFixed(1)} psi`).join(' / ')} (FL / FR / RL / RR)`
    },
  },
}

const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

function trackMatches(first, second) {
  const a = normalize(first)
  const b = normalize(second)
  if (a === b) return true
  if (a.startsWith('nurburgring') && b.startsWith('nurburgring')) return true
  if (a.startsWith('spa') && b.startsWith('spa')) return true
  return false
}

function readDocument(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The ACC setup file must contain a JSON object.')
  }
  if (typeof parsed.carName !== 'string' || !parsed.carName) {
    throw new Error('The ACC setup does not identify its car.')
  }
  const maxNativePressure = normalize(parsed.carName).includes('gt4') ? 180 : 147
  const pressureValues = parsed.basicSetup?.tyres?.tyrePressure
  if (!Array.isArray(pressureValues) || pressureValues.length !== 4
    || pressureValues.some((value) => !Number.isInteger(value) || value < 0 || value > maxNativePressure)) {
    throw new Error('The ACC setup must contain four valid native tyre-pressure values.')
  }
  return parsed
}

function parseSetup(filePath) {
  const parsed = readDocument(filePath)
  const setupFolder = path.dirname(filePath)
  return {
    path: filePath,
    name: path.basename(filePath),
    car: parsed.carName,
    track: path.basename(setupFolder),
    pressureValues: parsed.basicSetup.tyres.tyrePressure,
  }
}

function carFolderFor(root, car) {
  if (!fs.existsSync(root)) return null
  return fs.readdirSync(root, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && normalize(entry.name) === normalize(car))?.name ?? null
}

function setupFilesIn(folder) {
  if (!fs.existsSync(folder)) return []
  const result = []
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const fullPath = path.join(folder, entry.name)
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') result.push(fullPath)
    else if (entry.isDirectory()) result.push(...setupFilesIn(fullPath))
  }
  return result
}

function newest(files) {
  return files.map((filePath) => ({ filePath, modified: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.modified - a.modified)[0]?.filePath ?? null
}

function findSetupTemplate({ setupsRoot, car, track, preferredPath }) {
  if (preferredPath && fs.existsSync(preferredPath)) {
    const preferred = parseSetup(preferredPath)
    if (normalize(preferred.car) === normalize(car) && trackMatches(preferred.track, track)) return preferredPath
  }

  const carFolder = carFolderFor(setupsRoot, car)
  if (!carFolder) return null
  const carPath = path.join(setupsRoot, carFolder)
  const trackFolder = fs.readdirSync(carPath, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && trackMatches(entry.name, track))?.name
  if (trackFolder) {
    const matching = setupFilesIn(path.join(carPath, trackFolder))
      .filter((filePath) => normalize(readDocument(filePath).carName) === normalize(car))
    const match = newest(matching)
    if (match) return match
  }

  return newest(setupFilesIn(carPath)
    .filter((filePath) => normalize(readDocument(filePath).carName) === normalize(car)))
}

function adjust(object, key, delta, max = 20) {
  if (!object || !Number.isInteger(object[key]) || object[key] < 0) {
    throw new Error(`The selected setup has no valid ${key} setting.`)
  }
  const next = object[key] + delta
  if (next < 0 || next > max) throw new Error(`The selected setup's ${key} is already at the safe adjustment limit.`)
  object[key] = next
}

function createSetupVariant({ sourcePath, setupsRoot, car, track, issue, tyres, now = new Date() }) {
  const recommendation = ISSUES[issue]
  if (!recommendation) throw new Error('Choose a supported setup feedback option.')
  const setup = readDocument(sourcePath)
  if (normalize(setup.carName) !== normalize(car)) {
    throw new Error('The selected setup is for a different car. Choose a setup for the car you just drove.')
  }
  if (!/^[a-z0-9_-]+$/i.test(car) || !/^[a-z0-9_-]+$/i.test(track)) {
    throw new Error('ACC car and track identifiers are not safe setup-folder names.')
  }

  const change = recommendation.apply(setup, tyres)
  const destination = writeVariant({ setup, setupsRoot, car, track, tag: issue, now })
  return { setup: parseSetup(destination), issue: recommendation.label, description: recommendation.description, change }
}

function writeVariant({ setup, setupsRoot, car, track, tag, now }) {
  const carFolder = carFolderFor(setupsRoot, car) || setup.carName
  const existingTrackFolder = fs.existsSync(path.join(setupsRoot, carFolder))
    ? fs.readdirSync(path.join(setupsRoot, carFolder), { withFileTypes: true })
      .find((entry) => entry.isDirectory() && trackMatches(entry.name, track))?.name
    : null
  const destinationFolder = path.join(setupsRoot, carFolder, existingTrackFolder || track)
  fs.mkdirSync(destinationFolder, { recursive: true })

  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '-').replace('Z', '')
  const baseName = `TrackLine-${tag}-${stamp}`
  let destination = path.join(destinationFolder, `${baseName}.json`)
  let suffix = 2
  while (fs.existsSync(destination)) {
    destination = path.join(destinationFolder, `${baseName}-${suffix}.json`)
    suffix += 1
  }
  fs.writeFileSync(destination, `${JSON.stringify(setup, null, 2)}\n`, { flag: 'wx' })
  return destination
}

const CHOICES = {
  entry: ['understeer', 'oversteer', 'ok'],
  mid: ['understeer', 'oversteer', 'ok'],
  exit: ['understeer', 'oversteer', 'ok'],
  speed: ['low', 'high', 'both'],
  braking: ['ok', 'rearLocks', 'frontLocks'],
  brakeTemp: ['ok', 'hot', 'cold'],
  kerbs: ['ok', 'unsettled', 'bottoming'],
  straights: ['ok', 'draggy', 'needsDownforce'],
}

// Each rule is a single click toward the behaviour described in the ACC setup guides
// (Patagonia Sim Racing parameter reference, Trinacria Sim Racing beginner guide).
function planTune(answers) {
  const plan = new Map()
  const advice = []
  const push = (key, delta, reason) => {
    const entry = plan.get(key) || { delta: 0, reasons: [] }
    entry.delta += delta
    entry.reasons.push(reason)
    plan.set(key, entry)
  }
  const highSpeed = answers.speed === 'high'
  const lowSpeed = answers.speed === 'low'

  if (answers.entry === 'understeer') {
    push('aRBFront', -1, 'entry understeer')
    push('brakeBias', -1, 'entry understeer')
  } else if (answers.entry === 'oversteer') {
    push('aRBFront', 1, 'entry oversteer')
    push('brakeBias', 1, 'entry oversteer')
  }

  if (answers.mid === 'understeer') {
    push('aRBFront', -1, 'mid-corner understeer')
    if (highSpeed) push('rearWing', -1, 'high-speed understeer')
    if (lowSpeed) advice.push('Low-speed understeer: try 1–2 clicks more front toe-out and a softer front wheel rate in the in-game editor.')
  } else if (answers.mid === 'oversteer') {
    push('aRBRear', -1, 'mid-corner oversteer')
    if (highSpeed) push('rearWing', 1, 'high-speed oversteer')
    if (lowSpeed) advice.push('Low-speed oversteer: try a little more rear toe-in in the in-game editor.')
  }

  if (answers.exit === 'understeer') {
    push('aRBRear', 1, 'exit understeer')
    push('preload', -1, 'exit understeer')
  } else if (answers.exit === 'oversteer') {
    push('preload', 1, 'exit oversteer')
    push('aRBRear', -1, 'exit oversteer')
    advice.push('If the rear still snaps on throttle, raise traction control one step (TC1) rather than adding more diff preload.')
  }

  if (answers.braking === 'rearLocks') push('brakeBias', 1, 'rear locks or is unstable under braking')
  else if (answers.braking === 'frontLocks') push('brakeBias', -1, 'front locks under braking')

  if (answers.brakeTemp === 'hot') push('brakeDuct', 1, 'brakes overheating')
  else if (answers.brakeTemp === 'cold') push('brakeDuct', -1, 'brakes too cold')

  if (answers.kerbs === 'unsettled') {
    push('bumpFast', -1, 'unsettled over kerbs')
    advice.push('Car unsettled over kerbs: softer fast bump helps; also try softer bump-stop rate.')
  } else if (answers.kerbs === 'bottoming') {
    advice.push('Scraping or bottoming out: raise ride height by one click on the affected axle and/or add bump-stop range. This is not auto-applied because ride-height clicks are car-specific.')
  }

  if (answers.straights === 'draggy') push('rearWing', -1, 'too slow on the straights')
  else if (answers.straights === 'needsDownforce') push('rearWing', 1, 'needs more downforce')

  return { plan, advice }
}

const KNOBS = {
  aRBFront: { label: 'Front anti-roll bar', get: (s) => s.advancedSetup?.mechanicalBalance, key: 'aRBFront', max: 20 },
  aRBRear: { label: 'Rear anti-roll bar', get: (s) => s.advancedSetup?.mechanicalBalance, key: 'aRBRear', max: 20 },
  brakeBias: { label: 'Brake bias (+ = forward)', get: (s) => s.advancedSetup?.mechanicalBalance, key: 'brakeBias', max: 100 },
  preload: { label: 'Differential preload', get: (s) => s.advancedSetup?.drivetrain, key: 'preload', max: 20 },
  rearWing: { label: 'Rear wing', get: (s) => s.advancedSetup?.aeroBalance, key: 'rearWing', max: 20 },
  brakeDuct: { label: 'Brake ducts (front & rear)', get: (s) => s.advancedSetup?.aeroBalance, key: 'brakeDuct', max: 6, array: true },
  bumpFast: { label: 'Fast bump damping (all corners)', get: (s) => s.advancedSetup?.dampers, key: 'bumpFast', max: 40, array: true },
}

function applyKnob(setup, name, delta) {
  const knob = KNOBS[name]
  const holder = knob.get(setup)
  const current = holder?.[knob.key]
  const values = Array.isArray(current) ? current : [current]
  if (!holder || values.length === 0 || !values.every((value) => Number.isInteger(value) && value >= 0)) {
    return { applied: false, note: `${knob.label}: not present in this setup, skipped` }
  }
  const next = values.map((value) => Math.max(0, Math.min(knob.max, value + delta)))
  if (next.every((value, index) => value === values[index])) {
    return { applied: false, note: `${knob.label}: already at its safe limit, skipped` }
  }
  holder[knob.key] = Array.isArray(current) ? next : next[0]
  return { applied: true, note: `${knob.label} ${delta > 0 ? '+' : ''}${delta} click${Math.abs(delta) === 1 ? '' : 's'}` }
}

function createTuneVariant({ sourcePath, setupsRoot, car, track, answers, now = new Date() }) {
  if (!answers || typeof answers !== 'object') throw new Error('Answer at least one question first.')
  for (const [key, options] of Object.entries(CHOICES)) {
    if (answers[key] !== undefined && !options.includes(answers[key])) throw new Error(`Unsupported answer for ${key}.`)
  }
  const setup = readDocument(sourcePath)
  if (normalize(setup.carName) !== normalize(car)) {
    throw new Error('The selected setup is for a different car. Choose a setup for the car you want to tune.')
  }
  if (!/^[a-z0-9_-]+$/i.test(car) || !/^[a-z0-9_-]+$/i.test(track)) {
    throw new Error('ACC car and track identifiers are not safe setup-folder names.')
  }

  const { plan, advice } = planTune(answers)
  const changes = []
  const skipped = []
  for (const [name, { delta, reasons }] of plan) {
    const net = Math.max(-2, Math.min(2, delta))
    if (net === 0) {
      skipped.push(`${KNOBS[name].label}: conflicting answers (${reasons.join(' vs ')}) cancelled out`)
      continue
    }
    const result = applyKnob(setup, name, net)
    ;(result.applied ? changes : skipped).push(result.applied ? `${result.note} — ${reasons.join(', ')}` : result.note)
  }

  const tyres = answers.tyres
  if (tyres) {
    const pressure = ISSUES.tyrePressure.apply(setup, tyres)
    changes.push(pressure)
    if (tyres.temperaturesC.some((value) => value > 100)) advice.push('Tyres are overheating: open the brake ducts a click, check camber/toe and consider a pressure drop only once temperatures are back in 70–100°C.')
    if (tyres.temperaturesC.some((value) => value < 70)) advice.push('Tyres are below their 70–100°C window: do a longer warm-up before judging grip or pressure.')
    const spread = (value, limit, axle) => {
      if (Number.isFinite(value) && value > limit) advice.push(`${axle} tyres run ${value.toFixed(0)}°C hotter on the inside than the outside (limit ${limit}°C): reduce negative camber a little.`)
      else if (Number.isFinite(value) && value < 0) advice.push(`${axle} outside edge is hotter than the inside: add a little negative camber.`)
    }
    spread(tyres.frontSpreadC, 9, 'Front')
    spread(tyres.rearSpreadC, 5, 'Rear')
  }

  if (changes.length === 0 && advice.length === 0 && skipped.length === 0) {
    changes.push('No changes; saved as a baseline copy')
  }
  const destination = writeVariant({ setup, setupsRoot, car, track, tag: 'tune', now })
  return { setup: parseSetup(destination), changes, skipped, advice }
}

function listSetups({ setupsRoot, car, track }) {
  const carFolder = carFolderFor(setupsRoot, car)
  if (!carFolder) return []
  const result = []
  for (const filePath of setupFilesIn(path.join(setupsRoot, carFolder))) {
    try {
      if (normalize(readDocument(filePath).carName) !== normalize(car)) continue
      const trackName = path.basename(path.dirname(filePath))
      result.push({ path: filePath, name: path.basename(filePath), track: trackName, sameTrack: trackMatches(trackName, track), modified: fs.statSync(filePath).mtimeMs })
    } catch { /* ignore unreadable or non-setup JSON */ }
  }
  return result.sort((a, b) => Number(b.sameTrack) - Number(a.sameTrack) || b.modified - a.modified)
}

module.exports = { ISSUES, CHOICES, parseSetup, findSetupTemplate, listSetups, createSetupVariant, createTuneVariant, trackMatches }
