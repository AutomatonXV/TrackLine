// Pre-renders the coaching callouts to WAV with Piper: node scripts/render-voice.cjs
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const dir = path.join(__dirname, '..', 'Assets', 'voice')
const out = path.join(__dirname, '..', 'src', 'voice')
fs.mkdirSync(out, { recursive: true })

// Keep in sync with CLIPS in electron/coach-policy.cjs.
const clips = {
  'brake-hard': 'Brake hard!',
  'brake-now': 'Brake now!',
  brake: 'Brake.',
  release: 'Release the brake.',
  throttle: 'Back on throttle.',
}
for (const file of fs.readdirSync(out)) fs.unlinkSync(path.join(out, file))

for (const [name, text] of Object.entries(clips)) {
  const result = spawnSync(path.join(dir, 'piper', 'piper.exe'), ['-m', path.join(dir, 'amy.onnx'), '-f', path.join(out, `${name}.wav`), '--length_scale', '0.85'], { input: text, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`)
}
console.log(`rendered ${Object.keys(clips).length} clips`)
