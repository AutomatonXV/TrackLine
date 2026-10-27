const fs = require('node:fs')
const path = require('node:path')

const ISSUES = {
  frontPush: {
    label: 'Front pushes wide (understeer)',
    description: 'Soften the front anti-roll bar by one click to reduce front roll stiffness. Re-test before changing anything else.',
    apply(setup) {
      adjust(setup?.advancedSetup?.mechanicalBalance, 'aRBFront', -1)
      return 'Front anti-roll bar -1 click'
    },
  },
  rearLoose: {
    label: 'Rear steps out on turn-in (entry oversteer)',
    description: 'Increase the front anti-roll bar by one click as a small entry-stability change. Re-test before changing anything else.',
    apply(setup) {
      adjust(setup?.advancedSetup?.mechanicalBalance, 'aRBFront', 1)
      return 'Front anti-roll bar +1 click'
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
  const pressureValues = parsed.basicSetup?.tyres?.tyrePressure
  if (!Array.isArray(pressureValues) || pressureValues.length !== 4
    || pressureValues.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('The ACC setup must contain four valid native tyre-pressure values.')
  }
  if (typeof parsed.carName !== 'string' || !parsed.carName) {
    throw new Error('The ACC setup does not identify its car.')
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

function createSetupVariant({ sourcePath, setupsRoot, car, track, issue, now = new Date() }) {
  const recommendation = ISSUES[issue]
  if (!recommendation) throw new Error('Choose a supported setup feedback option.')
  const setup = readDocument(sourcePath)
  if (normalize(setup.carName) !== normalize(car)) {
    throw new Error('The selected setup is for a different car. Choose a setup for the car you just drove.')
  }
  if (!/^[a-z0-9_-]+$/i.test(car) || !/^[a-z0-9_-]+$/i.test(track)) {
    throw new Error('ACC car and track identifiers are not safe setup-folder names.')
  }

  const change = recommendation.apply(setup)
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
