const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { createServer } = require('vite')

test('generates finite corner and racing-line guidance for every bundled circuit', async () => {
  const server = await createServer({
    configFile: path.join(__dirname, '../vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'custom',
  })
  try {
    const { getTrackGuide, GUIDE_TRACKS } = await server.ssrLoadModule('/src/trackGuide.ts')
    const expectedLength = {
      Monza: [5700, 5900],
      'Spa-Francorchamps': [6900, 7100],
      'Nürburgring GP': [5000, 5300],
    }
    const expectedCorners = {
      Monza: [10, 13],
      'Spa-Francorchamps': [12, 18],
      'Nürburgring GP': [12, 18],
    }
    for (const track of GUIDE_TRACKS) {
      const guide = getTrackGuide(track)
      assert.equal(guide.track, track)
      assert.equal(guide.centerline.length, 1200)
      assert.equal(guide.racingLine.length, 1200)
      assert.ok(guide.lengthMeters >= expectedLength[track][0] && guide.lengthMeters <= expectedLength[track][1], `${track}: ${guide.lengthMeters} m`)
      assert.ok(guide.corners.length >= expectedCorners[track][0] && guide.corners.length <= expectedCorners[track][1], `${track}: ${guide.corners.length} turns`)
      for (const edge of [guide.leftEdge, guide.rightEdge]) {
        assert.equal(edge.length, guide.centerline.length)
        for (const point of edge) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
          assert.ok(point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 1000)
        }
      }
      for (const point of guide.racingLine) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
        assert.ok(point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 1000)
      }
      for (const corner of guide.corners) {
        assert.ok(['left', 'right'].includes(corner.direction))
        assert.ok(['tight', 'medium', 'flowing'].includes(corner.character))
        assert.ok(corner.line.length >= 3)
        for (const index of [corner.startIndex, corner.apexIndex, corner.endIndex]) {
          assert.ok(Number.isInteger(index) && index >= 0 && index < guide.racingLine.length)
        }
        for (const point of [corner.points.approach, corner.points.turnIn, corner.points.apex, corner.points.exit, ...corner.line]) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${track} turn ${corner.number} contains an invalid point`)
          assert.ok(point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 1000, `${track} turn ${corner.number} is off the map`)
        }
      }
    }
  } finally {
    await server.close()
  }
})
