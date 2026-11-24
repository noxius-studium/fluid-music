import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-27 owner-approved REAL audio fallback. Labelled cloud fixture: static
// proof that the configured folder reaches the backend, the fallback action is
// a real download (not a report-unavailable stub), and the result is registered
// in the local library. Live yt-dlp/provider behavior is owner review.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const css = source.match(/const CSS = `([\s\S]*?)`/)?.[1]
assert.ok(css, 'CSS template is present')

test('audio fallback controller surface is real and routes to the backend', async () => {
  const controller = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
  assert.match(controller, /const fallbackRootId = atom\(/)
  assert.match(controller, /await request\('\/settings'\)/)
  assert.match(controller, /request\('\/settings', \{ method: 'PUT', body: \{ fallback_root_id: id \} \}\)/)
  assert.match(controller, /await setFallbackRoot\(root\.id\)/, 'choosing a local scan root also makes it the fallback destination')
  assert.match(controller, /request\('\/youtube\/fallback\/audio', \{ method: 'POST', body: \{ url \}/)
  assert.match(controller, /await refreshLocalLibrary\(\)/)
  assert.match(controller, /addNext\(local\)/, 'registered track goes Up Next')
  assert.match(controller, /void loadSettings\(\)/)
  assert.doesNotMatch(controller, /downloadYouTubeAudioFallback[\s\S]{0,200}toggle\(\)/, 'never autoplays a second engine')
  await new Promise(resolve => process.nextTick(resolve))
})

test('local auto-scan owns the fallback destination; player exposes real fallback', async () => {
  const local = between('function LocalPage(', 'function PlaylistForm(')
  const settingsPage = between('function SettingsPage(', 'function LogsPage(')
  const mini = between('function MiniPlayer(', 'function YouTubeControls(')
  assert.match(local, /useValue\(controller\.fallbackRootId\)/)
  assert.match(local, /including subfolders/i)
  assert.match(local, /controller\.setFallbackRoot\(root\.id\)/)
  assert.match(local, /YouTube fallback/i)
  assert.doesNotMatch(settingsPage, /MusicFolderSetting|Audio fallback folder/)
  assert.match(mini, /'Download audio'/)
  assert.match(mini, /onClick: \(\) => void controller\.downloadYouTubeAudioFallback\(\)/)
  assert.match(css, /--fm-panel:var\(--ui-bg-secondary\)/, 'panels are opaque host-owned surfaces')
  await new Promise(resolve => process.nextTick(resolve))
})
