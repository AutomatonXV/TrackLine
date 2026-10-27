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
    for (const track of GUIDE_TRACKS) {
      const guide = getTrackGuide(track)
      assert.equal(guide.track, track)
      assert.equal(guide.outline.length, 360)
      assert.ok(guide.corners.length >= 8 && guide.corners.length <= 25, `${track}: ${guide.corners.length} turns`)
      for (const corner of guide.corners) {
        assert.ok(['left', 'right'].includes(corner.direction))
        assert.ok(['tight', 'medium', 'flowing'].includes(corner.character))
        assert.ok(corner.line.length >= 3)
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
