import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Controls-only mini player contract. The optional body leaves view by default,
// while YouTube remains mounted so playback and its command bridge continue.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const css = source.match(/const CSS = `([\s\S]*?)`/)?.[1]
assert.ok(css, 'CSS template is present')

test('details leave view without unmounting the active player surface', async () => {
  const mini = between('function MiniPlayer(', 'function YouTubeControls(')
  assert.match(mini, /useValue\(controller\.miniDetailsVisible\)/)
  assert.match(mini, /className: 'fluid-mini-details', hidden: !detailsVisible/)
  assert.match(mini, /className: 'fluid-mini-body', hidden: !detailsVisible/)
  assert.match(mini, /className: 'fluid-youtube-frame-wrap'/)
  assert.match(css, /\.fluid-mini-details\[hidden\],\.fluid-mini-body\[hidden\]\{display:none\}/)
  const embeddedFrame = between('function EmbeddedYouTubeFrame(', 'function MiniControlBar(')
  assert.doesNotMatch(embeddedFrame, /loading: 'lazy'/, 'hidden YouTube details must not defer the one active player')
  assert.doesNotMatch(mini, /detailsVisible[\s\S]{0,120}\?\s*h\(EmbeddedYouTubeFrame/, 'visibility never controls whether the frame mounts')
  await new Promise(resolve => process.nextTick(resolve))
})

test('controls-only mode never opens a Browser or a second renderer surface', async () => {
  const mini = between('function MiniPlayer(', 'function YouTubeControls(')
  assert.doesNotMatch(mini, /openOrFocus|preview\.|h\(OwnedMediaView/)
  assert.equal((source.match(/id: 'mini-player'/g) || []).length, 1, 'still exactly one dockable mini pane')
  await new Promise(resolve => process.nextTick(resolve))
})
