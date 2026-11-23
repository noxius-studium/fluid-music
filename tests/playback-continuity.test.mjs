import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-29: labelled static fixture for the desktop-only / playback-continuity
// assessment and the status-free background fallback. Controller behavior is
// proven with the working harness in titlebar-mini.test.mjs.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const arch = await readFile(new URL('../docs/architecture.md', import.meta.url), 'utf8')

test('background audio fallback is not a transport transition', async () => {
  const start = source.indexOf('async function downloadYouTubeAudioFallback()')
  const end = source.indexOf('async function assessSpotifyLocalPlayback()', start)
  assert.ok(start >= 0 && end > start, 'fallback region boundary')
  const fn = source.slice(start, end)
  assert.doesNotMatch(fn, /status\.set\(/, 'a download never rewrites shared transport status')
  assert.match(fn, /message\.set\('Downloading audio/)
  assert.doesNotMatch(fn, /playAt\(|toggle\(\)|stopInternalAudio\(/, 'no engine/queue transition')
  await new Promise(resolve => process.nextTick(resolve))
})

test('assessment is honest about what must stay on the backend', async () => {
  assert.match(arch, /## Desktop-only operation and playback continuity \(FM-29 assessment\)/)
  assert.match(arch, /NOT entirely/)
  for (const text of ['127.0.0.1:43827', 'yt-dlp', 'SQLite', 'Fixtures assert this while state is `playing`', 'remain owner review']) {
    assert.ok(arch.includes(text), `assessment covers ${text}`)
  }
  await new Promise(resolve => process.nextTick(resolve))
})
