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
  const carFolder = carFolderFor(setupsRoot, car) || setup.carName
  const existingTrackFolder = fs.existsSync(path.join(setupsRoot, carFolder))
    ? fs.readdirSync(path.join(setupsRoot, carFolder), { withFileTypes: true })
      .find((entry) => entry.isDirectory() && trackMatches(entry.name, track))?.name
    : null
  const destinationFolder = path.join(setupsRoot, carFolder, existingTrackFolder || track)
  fs.mkdirSync(destinationFolder, { recursive: true })

  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '-').replace('Z', '')
  const baseName = `TrackLine-${issue}-${stamp}`
  let destination = path.join(destinationFolder, `${baseName}.json`)
  let suffix = 2
  while (fs.existsSync(destination)) {
    destination = path.join(destinationFolder, `${baseName}-${suffix}.json`)
    suffix += 1
  }
  fs.writeFileSync(destination, `${JSON.stringify(setup, null, 2)}\n`, { flag: 'wx' })
  return { setup: parseSetup(destination), issue: recommendation.label, description: recommendation.description, change }
}

module.exports = { ISSUES, parseSetup, findSetupTemplate, createSetupVariant, trackMatches }
