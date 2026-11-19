import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-11 Spotify catalogue/library/playlist fixtures. Headless labelled doubles
// only — live account/library effects remain owner-consent gates (FM-25).
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { classifySpotifyFailure, spotifyEntryUnavailableReason, spotifyLocalPlaybackCapability, clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, isSupportedLocalAudio, classifyYouTubeFailure };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}
function setGlobal(name, value) { Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }) }
function restoreGlobal(name, descriptor) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }

function makeController({ rest } = {}) {
  const calls = []
  const elements = []
  const original = { Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now, windowDescriptor: Object.getOwnPropertyDescriptor(globalThis, 'window'), navigatorDescriptor: Object.getOwnPropertyDescriptor(globalThis, 'navigator') }
  class FakeAudio {
    constructor() { this.listeners = new Map(); elements.push(this) }
    addEventListener(name, handler) { this.listeners.set(name, handler) }
    pause() { this.listeners.get('pause')?.() }
    removeAttribute() {}
    load() {}
    remove() { this.removed = true }
    async play() { this.listeners.get('playing')?.() }
  }
  globalThis.Audio = FakeAudio
  globalThis.setInterval = () => ({})
  globalThis.clearInterval = () => {}
  globalThis.setTimeout = () => ({})
  globalThis.clearTimeout = () => {}
  Date.now = () => 1_000_000
  const ctx = {
    storage: { get: (_key, fallback) => fallback, set: () => {} },
    rest: async (path, options) => { calls.push({ path, method: String(options?.method || 'GET').toUpperCase(), body: options?.body }); return rest ? rest(path, options) : { ok: true, data: {} } },
    os: { pickOpenPath: async () => null },
    preview: {},
    onDispose: () => {},
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  return { controller, calls, elements, flush, restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow; restoreGlobal('window', original.windowDescriptor); restoreGlobal('navigator', original.navigatorDescriptor) } }
}

const playlistPage = {
  items: [
    { track: null },
    { track: { id: 'a', uri: 'spotify:track:a', name: 'A', artists: [{ name: 'Artist' }] } },
    { track: { id: 'a', uri: 'spotify:track:a', name: 'A again', artists: [{ name: 'Artist' }] } },
    { track: { id: 'm', uri: 'spotify:track:m', name: 'Market blocked', is_playable: false, restrictions: { reason: 'market' }, artists: [] } },
    { track: { id: 'l', uri: 'spotify:track:l', name: 'Local file', is_local: true, artists: [] } },
    { track: { id: 'r2', uri: 'spotify:track:r2', name: 'Relinked', linked_from: { id: 'r1', uri: 'spotify:track:r1' }, artists: [{ name: 'Artist' }] } },
  ],
  total: 56,
  next: 'https://api.spotify.com/v1/playlists/list/tracks?offset=56',
}

test('playlist pages list unavailable/relinked entries honestly at exact occurrence positions', async () => {
  const harness = makeController({ rest: async path => path.startsWith('/playlists/') ? { ok: true, data: playlistPage } : { ok: true, data: {} } })
  try {
    const page = await harness.controller.loadSpotifyPlaylist({ id: 'list', uri: 'spotify:playlist:list' }, 50)
    // Playable contract preserved: duplicates keep their exact positions.
    assert.deepEqual(page.tracks.map(track => track.contextPosition), [51, 52, 55])
    assert.equal(page.tracks[0].uri, page.tracks[1].uri, 'exact duplicate occurrences preserved')
    assert.equal(page.skipped, 3)
    // Merged rows cover EVERY entry in order, unavailable ones honest and unplayable.
    assert.deepEqual(page.rows.map(row => row.contextPosition), [50, 51, 52, 53, 54, 55])
    const missing = page.rows[0]
    assert.equal(missing.unavailable, true)
    assert.equal(missing.playable, false)
    assert.equal(missing.unavailableReason, 'Removed or unavailable on Spotify.')
    assert.equal(page.rows[3].unavailableReason, 'Not available in your market.')
    assert.equal(page.rows[4].unavailableReason, 'Local file — not synced to Spotify streaming.')
    assert.equal(page.rows[5].relinked, true)
    assert.match(page.rows[5].subtitle, /relinked by Spotify/)
    assert.ok(page.rows.every(row => row.contextUri === 'spotify:playlist:list'))
    assert.equal(page.nextOffset, 56)
    assert.equal(page.next, true)
  } finally { harness.restore() }
})

test('unavailable playlist entries can never start playback', async () => {
  const harness = makeController({ rest: async path => path.startsWith('/playlists/') ? { ok: true, data: playlistPage } : { ok: true, data: {} } })
  try {
    const c = harness.controller
    const item = { source: 'spotify', uri: 'spotify:playlist:list', title: 'Collection' }
    c.add(item)
    const page = await c.loadSpotifyPlaylist(item, 50)
    harness.calls.length = 0
    const refused = await c.playSpotifyPlaylistTrack(item, page.rows[0])
    assert.equal(refused, false)
    assert.match(c.message.get(), /unavailable/i)
    assert.equal(harness.calls.filter(call => call.path === '/play').length, 0, 'no provider play command for unavailable entries')
  } finally { harness.restore() }
})

test('unavailable reasons map provider restrictions honestly; unknown stays generic', () => {
  const reason = pure.spotifyEntryUnavailableReason
  assert.equal(reason(null), 'Removed or unavailable on Spotify.')
  assert.equal(reason({ is_local: true }), 'Local file — not synced to Spotify streaming.')
  assert.equal(reason({ restrictions: { reason: 'market' } }), 'Not available in your market.')
  assert.equal(reason({ restrictions: { reason: 'product' } }), 'Requires a different Spotify subscription.')
  assert.equal(reason({ restrictions: { reason: 'explicit' } }), 'Blocked by explicit-content settings.')
  assert.equal(reason({ is_playable: false }), 'Not playable on your account right now.')
  assert.equal(reason({ id: 'x' }), 'Unavailable on Spotify.')
})

test('insufficient client scope is distinct from generic forbidden', () => {
  const scoped = pure.classifySpotifyFailure({ statusCode: 403, message: 'Insufficient client scope' })
  assert.equal(scoped.reason, 'insufficient-scope')
  assert.equal(scoped.action, 'reconnect')
  assert.match(scoped.remedy, /scopes/)
  const premium = pure.classifySpotifyFailure({ statusCode: 403, message: 'Premium required' })
  assert.equal(premium.reason, 'forbidden')
})

test('catalogue search exposes per-type cursors and the shared provider offset', async () => {
  const harness = makeController({ rest: async path => path.startsWith('/search') ? { ok: true, data: { tracks: { items: [{ id: 't', uri: 'spotify:track:t', name: 'T', artists: [] }], next: 'https://api.spotify.com/v1/search?offset=10' }, albums: { items: [], next: null }, playlists: { items: [], next: null }, artists: { items: [], next: null } } } : { ok: true, data: {} } })
  try {
    const first = await harness.controller.searchSpotifyCatalog('night drive', 0)
    assert.equal(first.cursors.tracks, true)
    assert.equal(first.cursors.albums, false)
    assert.equal(first.offset, 0)
    assert.match(harness.calls.at(-1).path, /offset=0/)
    const second = await harness.controller.searchSpotifyCatalog('night drive', 10)
    assert.equal(second.offset, 10)
    assert.match(harness.calls.at(-1).path, /offset=10/)
    assert.match(harness.calls.at(-1).path, /type=track,album,artist,playlist/)
  } finally { harness.restore() }
})
