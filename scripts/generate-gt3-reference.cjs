#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { parseLap } = require('../electron/telemetry.cjs')
const { createReferenceDataset, REFERENCE_CAR_KEY, REFERENCE_CAR_PARAMETERS } = require('../electron/gt3-reference.cjs')

const ROOT = path.resolve(__dirname, '..')
const TRACKS = {
  monza: {
    name: 'Monza',
    geometry: 'src/data/tumftm/tracks/monza.csv',
    line: 'src/data/tumftm/racelines/monza.csv',
  },
  spa: {
    name: 'Spa-Francorchamps',
    geometry: 'src/data/tumftm/tracks/spa.csv',
    line: 'src/data/tumftm/racelines/spa.csv',
  },
  nurburgring: {
    name: 'Nürburgring GP',
    geometry: 'src/data/tumftm/tracks/nurburgring.csv',
    line: 'src/data/tumftm/racelines/nurburgring.csv',
  },
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1]
}

function csvPoints(filePath, withWidths = false) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [x, z, ...widths] = line.split(',').map(Number)
      if (![x, z, ...widths].every(Number.isFinite) || (withWidths && widths.length < 2)) {
        throw new Error(`Invalid track geometry row in ${filePath}.`)
      }
      return withWidths ? { x, z, rightWidthM: widths[0], leftWidthM: widths[1] } : { x, z }
    })
}

function pathLength(points) {
  return points.reduce((length, point, index) => {
    const next = points[(index + 1) % points.length]
    return length + Math.hypot(next.x - point.x, next.z - point.z)
  }, 0)
}

function findLogs(inputPath) {
  const absolute = path.resolve(inputPath)
  if (!fs.existsSync(absolute)) throw new Error(`Input path does not exist: ${absolute}`)
  const stat = fs.statSync(absolute)
  if (stat.isFile()) {
    if (!absolute.toLowerCase().endsWith('.ld')) throw new Error('Input file must be a MoTeC .ld log.')
    return [absolute]
  }
  const files = []
  const pending = [absolute]
  while (pending.length) {
    const folder = pending.pop()
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const child = path.join(folder, entry.name)
      if (entry.isDirectory()) pending.push(child)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.ld')) files.push(child)
    }
  }
  return files
}

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function normalizedTrack(value) {
  const key = normalized(value)
  if (key.includes('nurburgring')) return 'nurburgring'
  if (key.includes('spa')) return 'spa'
  if (key.includes('monza')) return 'monza'
  return key
}

function collectCandidates(files, trackName) {
  const candidates = []
  const skipped = []
  for (const file of files) {
    let lap
    try {
      lap = parseLap(file)
    } catch (error) {
      skipped.push({ file: path.basename(file), reason: error instanceof Error ? error.message : String(error) })
      continue
    }
    if (!normalized(lap.car).includes('nissangtr') || normalizedTrack(lap.track) !== normalizedTrack(trackName)) continue
    if (!lap.hasThrottle || !lap.hasBrake) {
      skipped.push({ file: path.basename(file), reason: 'Missing throttle or brake channel.' })
      continue
    }
    lap.lapTimes.forEach((lapTimeSeconds, lapIndex) => {
      if (lapTimeSeconds >= 40 && lapTimeSeconds <= 240) candidates.push({ file, lapIndex, lapTimeSeconds })
    })
  }
  return { candidates: candidates.sort((a, b) => a.lapTimeSeconds - b.lapTimeSeconds), skipped }
}

function main() {
  const args = process.argv.slice(2)
  const input = optionValue(args, '--input')
  const trackKey = optionValue(args, '--track', 'monza').toLowerCase()
  const track = TRACKS[trackKey]
  const topLapCount = Number(optionValue(args, '--top-laps', '5'))
  const brakeThresholdPercent = Number(optionValue(args, '--brake-threshold', '8'))
  const throttleThresholdPercent = Number(optionValue(args, '--throttle-threshold', '70'))
  const carConfigPath = path.resolve(ROOT, optionValue(args, '--car-config', 'src/data/gt3-reference/car-parameters.json'))
  const output = path.resolve(ROOT, optionValue(args, '--output', `src/data/gt3-reference/${trackKey}.json`))
  if (!input) throw new Error('Usage: node scripts/generate-gt3-reference.cjs --input <MoTeC .ld file or folder> [--track monza|spa|nurburgring] [--top-laps 5]')
  if (!track) throw new Error(`Unsupported track "${trackKey}". Choose ${Object.keys(TRACKS).join(', ')}.`)
  if (!Number.isInteger(topLapCount) || topLapCount < 1) throw new Error('--top-laps must be a positive integer.')

  const geometryPath = path.join(ROOT, track.geometry)
  const linePath = path.join(ROOT, track.line)
  const carParameters = JSON.parse(fs.readFileSync(carConfigPath, 'utf8'))
  if (!carParameters || typeof carParameters !== 'object' || Array.isArray(carParameters)) {
    throw new Error('The car-parameter file must contain an object keyed by car ID.')
  }
  if (!carParameters[REFERENCE_CAR_KEY]) carParameters[REFERENCE_CAR_KEY] = REFERENCE_CAR_PARAMETERS
  const geometry = csvPoints(geometryPath, true)
  const fallbackLine = csvPoints(linePath)
  const { candidates, skipped } = collectCandidates(findLogs(input), track.name)
  const selected = candidates.slice(0, topLapCount).map(({ file, lapIndex }) => parseLap(file, lapIndex))
  if (!selected.length) throw new Error(`No valid ${track.name} Nissan GT-R GT3 laps with brake and throttle data were found.`)

  const dataset = createReferenceDataset({
    track: track.name,
    trackLengthM: pathLength(geometry),
    laps: selected,
    fallbackLine,
    fallbackLineSource: 'TUMFTM/racetrack-database minimum-curvature reference line, pinned at e59595d1f3573b30d1ded6a08984935b957688e0',
    topLapCount,
    brakeThresholdPercent,
    throttleThresholdPercent,
    sourceFiles: [...new Set(selected.map((lap) => lap.name))],
    carParameters,
  })
  dataset.track.geometrySource = 'TUMFTM/racetrack-database, revision e59595d1f3573b30d1ded6a08984935b957688e0'
  dataset.reference.lapDistanceSource = selected.every((lap) => lap.hasDistance) ? 'MoTeC distance channel or speed-time integration' : 'incomplete'
  dataset.warnings = dataset.sharedLine.source.type === 'sourced-track-reference'
    ? ['The selected GT-R logs do not contain measured GPS/world coordinates. The shared line is the bundled track-reference line, not a GT-R driver trace. Supply logs with measured position channels to extract and average the GT-R line.']
    : []
  dataset.warnings.push('Per-car ratios are configurable first-order estimates; validate each car against ACC 1.10 BoP and telemetry.')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${path.relative(ROOT, output)} using ${selected.length} fastest GT-R laps.`)
  console.log(`Shared line source: ${dataset.sharedLine.source.type} (${dataset.sharedLine.pointCount} points).`)
  console.log(`Detected ${dataset.brakingZones.length} braking zones and ${dataset.accelerationZones.length} acceleration zones.`)
  console.log(`Fastest selected lap: ${Math.floor(dataset.reference.fastestLapSeconds / 60)}:${(dataset.reference.fastestLapSeconds % 60).toFixed(2).padStart(5, '0')}.`)
  for (const warning of dataset.warnings) console.warn(`Warning: ${warning}`)
  if (skipped.length) console.warn(`Skipped ${skipped.length} unreadable or incomplete logs.`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
