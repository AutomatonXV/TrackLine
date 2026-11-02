// Builds track centerline + geometric racing-line CSVs (same format as TUMFTM/racetrack-database)
// for ACC circuits that TUMFTM does not cover, from OpenStreetMap highway=raceway ways (ODbL).
// Usage: node scripts/generate-osm-tracks.cjs [file ...]
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.join(__dirname, '..', 'src', 'data', 'tumftm')
const DEFAULT_WIDTH = 12
const CAR_MARGIN = 1.2

// length = official ACC lap length in metres (lovely-track-data), used to choose the right layout loop.
const TRACKS = [
  { file: 'donington', lat: 52.8306, lon: -1.3750, radius: 2500, length: 4020 },
  { file: 'imola', lat: 44.3439, lon: 11.7167, radius: 2500, length: 4909 },
  { file: 'kyalami', lat: -25.9967, lon: 28.0689, radius: 3000, length: 4580 },
  { file: 'laguna-seca', lat: 36.5846, lon: -121.7536, radius: 2500, length: 3602 },
  { file: 'misano', lat: 43.9618, lon: 12.6844, radius: 2500, length: 4200 },
  { file: 'mount-panorama', lat: -33.4400, lon: 149.5580, radius: 3000, length: 6213, roads: true, clockwise: true },
  { file: 'oulton-park', lat: 53.1770, lon: -2.6150, radius: 2500, length: 4333 },
  { file: 'paul-ricard', lat: 43.2506, lon: 5.7919, radius: 3500, length: 5770 },
  { file: 'snetterton', lat: 52.4644, lon: 0.9453, radius: 3000, length: 4779 },
  { file: 'valencia', lat: 39.4850, lon: -0.6310, radius: 2500, length: 4005, clockwise: true },
  { file: 'watkins-glen', lat: 42.3369, lon: -76.9271, radius: 2500, length: 5552 },
  { file: 'zolder', lat: 51.0010, lon: 5.2570, radius: 2500, length: 4010 },
]

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const wrap = (i, n) => ((i % n) + n) % n

async function overpass(track) {
  const filter = track.roads ? '["highway"~"^(tertiary|residential|unclassified|secondary)$"]' : '["highway"="raceway"]'
  const query = `[out:json][timeout:120];way${filter}(around:${track.radius},${track.lat},${track.lon});out body;>;out skel qt;`
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': 'Fastrack-track-generator/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    })
    if (response.ok) return response.json()
    await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)))
  }
  throw new Error('Overpass request failed')
}

function buildGraph(data, track) {
  const cosLat = Math.cos(track.lat * Math.PI / 180)
  const nodes = new Map()
  for (const element of data.elements) {
    if (element.type === 'node') {
      nodes.set(element.id, { x: (element.lon - track.lon) * 111320 * cosLat, y: (element.lat - track.lat) * 110574 })
    }
  }
  const adjacency = new Map()
  const edges = []
  const link = (from, to, way, forward) => {
    const length = dist(nodes.get(from), nodes.get(to))
    const edge = { from, to, length, forward, width: way.width }
    edges.push(edge)
    for (const [a, b] of [[from, to], [to, from]]) {
      if (!adjacency.has(a)) adjacency.set(a, [])
      adjacency.get(a).push({ to: b, edge })
    }
  }
  for (const way of data.elements.filter((element) => element.type === 'way')) {
    const tags = way.tags || {}
    if (tags.raceway === 'pitlane' || /pit ?lane/i.test(tags.name || '') || tags.access === 'no' || tags.operational_status === 'Unused for racing') continue
    if (tags.sport && !/motor/.test(tags.sport)) continue
    const width = Number.parseFloat(tags.width)
    const info = { width: Number.isFinite(width) && width > 6 ? width : null }
    for (let i = 0; i + 1 < way.nodes.length; i += 1) {
      if (nodes.has(way.nodes[i]) && nodes.has(way.nodes[i + 1])) link(way.nodes[i], way.nodes[i + 1], info, tags.oneway === 'yes' ? 1 : 0)
    }
  }
  // Bridges small gaps where adjacent ways end near each other without sharing a node.
  for (const [id, list] of [...adjacency]) {
    if (list.length !== 1) continue
    let nearest = null
    for (const [other, point] of nodes) {
      if (other === id || !adjacency.has(other) || list[0].to === other) continue
      const gap = dist(nodes.get(id), point)
      if (gap < 15 && (!nearest || gap < nearest.gap)) nearest = { other, gap }
    }
    if (nearest) link(id, nearest.other, { width: null }, 0)
  }
  return { nodes, adjacency, edges }
}

// Contracts degree-2 chains so cycle search only branches at junctions.
function contract(graph) {
  const junctions = new Set([...graph.adjacency].filter(([, list]) => list.length !== 2).map(([id]) => id))
  // Components that are one plain loop have no junction, so anchor them at an arbitrary node.
  const reached = new Set()
  const flood = (seed) => {
    const queue = [seed]
    reached.add(seed)
    while (queue.length) for (const { to } of graph.adjacency.get(queue.pop())) if (!reached.has(to)) { reached.add(to); queue.push(to) }
  }
  for (const id of junctions) flood(id)
  for (const id of graph.adjacency.keys()) if (!reached.has(id)) { junctions.add(id); flood(id) }
  const chains = []
  const seen = new Set()
  for (const start of junctions) {
    for (const first of graph.adjacency.get(start)) {
      if (seen.has(first.edge)) continue
      const nodeIds = [start]
      let previous = start
      let step = first
      let length = 0
      const used = []
      for (;;) {
        seen.add(step.edge)
        used.push(step.edge)
        length += step.edge.length
        nodeIds.push(step.to)
        if (junctions.has(step.to)) break
        const next = graph.adjacency.get(step.to).find((candidate) => candidate.edge !== step.edge)
        previous = step.to
        step = next
        if (!step) break
      }
      void previous
      if (junctions.has(nodeIds.at(-1))) chains.push({ a: start, b: nodeIds.at(-1), nodeIds, length, edges: used })
    }
  }
  return { junctions, chains }
}

function findLoop(graph, targetLength) {
  const { junctions, chains } = contract(graph)
  const byJunction = new Map()
  for (const chain of chains) {
    for (const [from, to, reversed] of [[chain.a, chain.b, false], [chain.b, chain.a, true]]) {
      if (!byJunction.has(from)) byJunction.set(from, [])
      byJunction.get(from).push({ chain, to, reversed })
    }
  }
  let best = null
  let work = 0
  const consider = (loop, length) => {
    const error = Math.abs(length - targetLength) / targetLength
    if (!best || error < best.error) best = { loop: [...loop], length, error }
  }
  for (const start of junctions) {
    const visited = new Set([start])
    const usedChains = new Set()
    const walk = (at, length, loop) => {
      if (work > 4e6 || length > targetLength * 1.12) return
      work += 1
      for (const option of byJunction.get(at) || []) {
        if (usedChains.has(option.chain)) continue
        const total = length + option.chain.length
        if (option.to === start) {
          if (loop.length > 0 || option.chain.a === option.chain.b) consider([...loop, option], total)
          continue
        }
        if (visited.has(option.to)) continue
        visited.add(option.to)
        usedChains.add(option.chain)
        loop.push(option)
        walk(option.to, total, loop)
        loop.pop()
        usedChains.delete(option.chain)
        visited.delete(option.to)
      }
    }
    walk(start, 0, [])
  }
  if (!best || best.error > 0.12) {
    console.error(`  diagnostics: ${junctions.size} junctions, ${chains.length} chains, best loop ${best ? Math.round(best.length) : 'none'} m, chain total ${Math.round(chains.reduce((s, c) => s + c.length, 0))} m`)
    return null
  }
  const points = []
  let forwardLength = 0
  let totalLength = 0
  for (const { chain, reversed } of best.loop) {
    const ids = reversed ? [...chain.nodeIds].reverse() : chain.nodeIds
    for (let i = 0; i < ids.length - 1; i += 1) points.push(ids[i])
    for (const edge of chain.edges) {
      totalLength += edge.length
      if (edge.forward) {
        const ordered = ids.indexOf(edge.from) < ids.indexOf(edge.to)
        forwardLength += ordered ? edge.length : -edge.length
      }
    }
  }
  return { ids: points, length: best.length, error: best.error, oneWay: forwardLength / totalLength }
}

function resample(points, spacing) {
  const lengths = points.map((point, i) => dist(point, points[(i + 1) % points.length]))
  const total = lengths.reduce((a, b) => a + b, 0)
  const count = Math.round(total / spacing)
  const out = []
  let segment = 0
  let walked = 0
  for (let i = 0; i < count; i += 1) {
    const target = total * i / count
    while (segment < points.length - 1 && walked + lengths[segment] < target) { walked += lengths[segment]; segment += 1 }
    const next = points[(segment + 1) % points.length]
    const t = (target - walked) / Math.max(lengths[segment], 1e-9)
    out.push({ x: points[segment].x + (next.x - points[segment].x) * t, y: points[segment].y + (next.y - points[segment].y) * t })
  }
  return out
}

function smooth(points, passes) {
  let current = points
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((point, i) => {
      const before = current[wrap(i - 2, current.length)]
      const b1 = current[wrap(i - 1, current.length)]
      const a1 = current[wrap(i + 1, current.length)]
      const after = current[wrap(i + 2, current.length)]
      return { x: (before.x + 4 * b1.x + 6 * point.x + 4 * a1.x + after.x) / 16, y: (before.y + 4 * b1.y + 6 * point.y + 4 * a1.y + after.y) / 16 }
    })
  }
  return current
}

function normals(points) {
  return points.map((point, i) => {
    const before = points[wrap(i - 1, points.length)]
    const after = points[wrap(i + 1, points.length)]
    const length = dist(before, after) || 1
    return { x: -(after.y - before.y) / length, y: (after.x - before.x) / length }
  })
}

// Relaxes each point toward the midpoint of its neighbours inside the track limits, which
// shortens the path and flattens curvature (a geometric minimum-curvature line).
function racingLine(center, normal, halfWidth) {
  const n = center.length
  const offset = new Float64Array(n)
  const at = (i, o) => ({ x: center[i].x + normal[i].x * o[i], y: center[i].y + normal[i].y * o[i] })
  for (let iteration = 0; iteration < 6000; iteration += 1) {
    for (let i = 0; i < n; i += 1) {
      const before = at(wrap(i - 1, n), offset)
      const after = at(wrap(i + 1, n), offset)
      const mid = { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 }
      const target = (mid.x - center[i].x) * normal[i].x + (mid.y - center[i].y) * normal[i].y
      const limit = Math.max(0.5, halfWidth[i] - CAR_MARGIN)
      offset[i] = Math.max(-limit, Math.min(limit, offset[i] + 1.6 * (target - offset[i])))
    }
  }
  return center.map((_, i) => at(i, offset))
}

async function generate(track) {
  const data = await overpass(track)
  const graph = buildGraph(data, track)
  const loop = findLoop(graph, track.length)
  if (!loop) throw new Error(`${track.file}: no closed loop within 12% of ${track.length} m`)
  let raw = loop.ids.map((id) => graph.nodes.get(id))
  if (loop.oneWay < 0) raw = raw.reverse()
  if (Math.abs(loop.oneWay) < 0.5 && track.clockwise !== undefined) {
    const area = raw.reduce((sum, point, i) => { const next = raw[(i + 1) % raw.length]; return sum + point.x * next.y - next.x * point.y }, 0)
    if ((area < 0) !== track.clockwise) raw = raw.reverse()
  }
  const spacing = Math.max(5, track.length / 1500)
  const center = smooth(resample(smooth(resample(raw, spacing / 2), 2), spacing), 3)
  const normal = normals(center)
  const width = DEFAULT_WIDTH / 2
  const halfWidth = center.map(() => width)
  const line = racingLine(center, normal, halfWidth)
  const rows = center.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)},${width.toFixed(3)},${width.toFixed(3)}`)
  const lineRows = line.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`)
  fs.writeFileSync(path.join(OUT, 'tracks', `${track.file}.csv`), `# x_m,y_m,w_tr_right_m,w_tr_left_m\n${rows.join('\n')}\n`)
  fs.writeFileSync(path.join(OUT, 'racelines', `${track.file}.csv`), `# x_m,y_m\n${lineRows.join('\n')}\n`)
  console.log(`${track.file}: ${center.length} pts, loop ${Math.round(loop.length)} m (target ${track.length}), oneway bias ${loop.oneWay.toFixed(2)}`)
}

async function main() {
  const wanted = process.argv.slice(2)
  for (const track of TRACKS.filter((item) => !wanted.length || wanted.includes(item.file))) {
    try { await generate(track) } catch (error) { console.error(error.message) }
  }
}

void main()
