import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-28 owner-approved Spotify Client ID setting. Labelled cloud fixture:
// static proof that a persistent, always-visible PKCE client-id field exists,
// is saved through the settings route, and has a lean setup guide. Live OAuth,
// account and device behavior remain explicit owner review.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const guide = await readFile(new URL('../docs/spotify-setup.md', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}

test('client id is a persistent setting, not a transient connect-only field', async () => {
  const controller = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
  assert.match(controller, /const spotifyClientId = atom\(/)
  assert.match(controller, /await request\('\/settings', \{ method: 'PUT', body: \{ spotify_client_id: clientId \} \}\)/)
  assert.match(controller, /spotifyClientId\.set\(clientId\)/)
  assert.match(controller, /ctx\.storage\.set\('spotifyClientId', clientId\)/)
  await new Promise(resolve => process.nextTick(resolve))
})

test('Spotify connection card always shows and saves the client id', async () => {
  const card = between('function SpotifyConnection(', 'function SpotifyLibraryPage(')
  assert.match(card, /useValue\(controller\.spotifyClientId\)/)
  assert.match(card, /'aria-label': 'Spotify Client ID'/)
  assert.match(card, /'Save Client ID'/)
  assert.match(card, /controller\.setSpotifyClientId\(clientId\)/)
  assert.match(card, /http:\/\/127\.0\.0\.1:43827\/spotify\/callback/)
  assert.match(card, /Premium required for playback control/)
  assert.doesNotMatch(card, /auth\.needsClientId &&[\s\S]{0,80}Spotify Client ID/, 'field is not hidden behind an error state')
  assert.match(card, /startSpotifyAuth\(clientId\)/)
  await new Promise(resolve => process.nextTick(resolve))
})

test('setup guide is lean, authoritative and secret-free', async () => {
  assert.ok(guide.length < 3500, 'guide stays lean')
  for (const text of ['developer.spotify.com/dashboard', 'http://127.0.0.1:43827/spotify/callback', 'Client ID', 'PKCE', 'Premium', 'no client secret']) {
    assert.ok(guide.includes(text), `guide mentions ${text}`)
  }
  assert.doesNotMatch(guide, /client[ _-]?secret\s*[:=]\s*\S+/i)
  await new Promise(resolve => process.nextTick(resolve))
})
