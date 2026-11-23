import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-26 owner-approved mini-player hide-video toggle. Labelled cloud fixture:
// this proves the DOM/CSS contract — the frame stays MOUNTED and only its
// visibility is toggled, so the single engine keeps decoding audio. Controller
// state/persistence is exercised with the working harness in titlebar-mini.test.mjs.
// Real rendering/audio remains an explicit owner review boundary.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const css = source.match(/const CSS = `([\s\S]*?)`/)?.[1]
assert.ok(css, 'CSS template is present')

test('hide-video toggle: real control, CSS hides frame without unmounting, audio path untouched', async () => {
  const mini = between('function MiniPlayer(', 'function YouTubeControls(')
  assert.match(mini, /useValue\(controller\.youtubeVideoHidden\)/)
  assert.match(mini, /fluid-mini-player fluid-youtube-player\$\{videoHidden \? ' fluid-video-hidden' : ''\}/)
  assert.match(mini, /className: 'fluid-youtube-stage'/)
  assert.match(mini, /className: 'fluid-youtube-frame-wrap'/)
  assert.match(mini, /className: 'fluid-video-toggle'/)
  assert.match(mini, /'aria-pressed': videoHidden/, 'explicit toggle state, not color alone')
  assert.match(mini, /'aria-label': videoHidden \? 'Show video' : 'Hide video'/)
  assert.match(mini, /onClick: \(\) => controller\.toggleYouTubeVideo\(\)/)
  assert.match(mini, /videoHidden \? 'Show video' : 'Hide video'/)
  assert.match(css, /\.fluid-video-hidden \.fluid-youtube-frame-wrap\{display:none\}/, 'frame hidden, not unmounted')
  assert.match(css, /\.fluid-video-toggle\[aria-pressed="true"\]\{background:var\(--fm-soft\)\}/)
  assert.match(css, /\.fluid-youtube-frame\{min-width:200px;min-height:200px\}/, '200x200 minimum kept')
  assert.doesNotMatch(mini, /videoHidden[\s\S]{0,120}\?\s*null/, 'no null/unmount path for the frame')
  await new Promise(resolve => process.nextTick(resolve))
})

test('hide-video never opens a Browser or a second renderer surface', async () => {
  const mini = between('function MiniPlayer(', 'function YouTubeControls(')
  assert.doesNotMatch(mini, /openOrFocus|preview\.|h\(OwnedMediaView/)
  assert.equal((source.match(/id: 'mini-player'/g) || []).length, 1, 'still exactly one dockable mini pane')
  await new Promise(resolve => process.nextTick(resolve))
})
