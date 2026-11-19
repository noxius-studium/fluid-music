import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-10 Spotify transport/error/capability fixtures. Headless labelled doubles
// only — real Connect playback and in-plugin decoded audio remain owner-side
// evidence (FM-25). Connect control is never equated with local audio.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { classifySpotifyFailure, spotifyLocalPlaybackCapability, clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, isSupportedLocalAudio, classifyYouTubeFailure };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

// Node exposes navigator as a getter-only accessor; swap globals via
// descriptors so labelled doubles install AND restore cleanly.
function setGlobal(name, value) { Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }) }
function restoreGlobal(name, descriptor) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }

function makeController({ rest } = {}) {
  const disposers = []
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
    rest: async (path, options) => { calls.push({ path, method: String(options?.method || 'GET').toUpperCase(), body: options?.body, params: options?.params }); return rest ? rest(path, options) : { ok: true, data: {} } },
    os: { pickOpenPath: async () => null },
    preview: {},
    onDispose: fn => disposers.push(fn),
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  return { controller, calls, elements, flush, restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow; restoreGlobal('window', original.windowDescriptor); restoreGlobal('navigator', original.navigatorDescriptor) } }
}

test('Spotify failures classify into distinct remedies; unknown stays unknown', () => {
  const c = (statusCode, message = '') => pure.classifySpotifyFailure({ statusCode, message })
  assert.equal(c(401).reason, 'auth-required')
  assert.equal(c(401).action, 'reconnect')
  assert.equal(c(429).reason, 'rate-limited')
  assert.equal(c(429).retryable, true)
  assert.equal(c(403).reason, 'forbidden')
  assert.equal(c(403).action, 'check-account')
  assert.equal(c(410).reason, 'no-device')
  assert.equal(c(404, 'No active device found').reason, 'no-device')
  assert.equal(c(404, 'Playlist not found').reason, 'not-found')
  assert.equal(c(500).reason, 'transient')
  assert.equal(c(503).retryable, true)
  const unknown = c(undefined, 'something odd')
  assert.equal(unknown.reason, 'undetermined')
  assert.equal(unknown.retryable, false)
  const reasons = new Set([c(401), c(429), c(403), c(410), c(404), c(500), unknown].map(entry => entry.reason))
  assert.equal(reasons.size, 7)
})

test('local playback capability never certifies audio without runtime AND owner proof', () => {
  const cap = pure.spotifyLocalPlaybackCapability
  assert.equal(cap({ product: 'free', checked: true, sdkPresent: true, emeSupported: true }).state, 'ineligible-account')
  assert.equal(cap({ product: 'premium', checked: true, sdkPresent: false, emeSupported: true }).state, 'unsupported-runtime')
  assert.equal(cap({ product: 'premium', checked: true, sdkPresent: true, emeSupported: false }).state, 'unsupported-runtime')
  const eligible = cap({ product: 'premium', checked: true, sdkPresent: true, emeSupported: true })
  assert.equal(eligible.state, 'eligible-unproven')
  assert.equal(eligible.localAudio, null, 'passing checks is NOT decoded-audio proof')
  assert.equal(cap({}).state, 'unverified')
  assert.equal(cap({ product: 'premium' }).state, 'unverified', 'unchecked runtime never claims support')
})

test('device discovery failures surface distinct classified remedies', async () => {
  for (const [status, reason] of [[429, 'rate-limited'], [403, 'forbidden'], [410, 'no-device'], [500, 'transient']]) {
    const harness = makeController({ rest: async path => path === '/devices' ? { ok: false, error: 'provider failure', status_code: status } : { ok: true, data: {} } })
    try {
      await harness.controller.refreshSpotifyDevices()
      await harness.flush()
      assert.equal(harness.controller.spotifyFailure.get().reason, reason, `status ${status}`)
      assert.deepEqual(harness.controller.spotifyDevices.get(), [])
    } finally { harness.restore() }
  }
})

test('local playback assessment combines account product with runtime feature detection', async () => {
  const harness = makeController({ rest: async path => path === '/spotify/local-capability' ? { ok: true, data: { account_product: 'premium', local_audio: 'unverified' } } : { ok: true, data: {} } })
  try {
    setGlobal('window', { Spotify: { Player: function FakePlayer() {} } })
    setGlobal('navigator', { requestMediaKeySystemAccess: async () => ({}) })
    const capability = await harness.controller.assessSpotifyLocalPlayback()
    assert.equal(capability.state, 'eligible-unproven')
    assert.equal(harness.controller.spotifyLocalCapability.get().state, 'eligible-unproven')
    setGlobal('window', {})
    const unsupported = await harness.controller.assessSpotifyLocalPlayback()
    assert.equal(unsupported.state, 'unsupported-runtime')
  } finally { harness.restore() }
  const free = makeController({ rest: async path => path === '/spotify/local-capability' ? { ok: true, data: { account_product: 'free' } } : { ok: true, data: {} } })
  try {
    setGlobal('window', { Spotify: { Player: function FakePlayer() {} } })
    setGlobal('navigator', { requestMediaKeySystemAccess: async () => ({}) })
    assert.equal((await free.controller.assessSpotifyLocalPlayback()).state, 'ineligible-account')
  } finally { free.restore() }
})

test('switching from Spotify to radio pauses the provider before the new engine starts', async () => {
  const harness = makeController({ rest: async path => path === '/player' ? { ok: true, data: { is_playing: true, item: { uri: 'spotify:track:one', name: 'One' } } } : { ok: true, data: {} } })
  try {
    const c = harness.controller
    c.add({ source: 'spotify', uri: 'spotify:track:one', title: 'One' })
    await c.playAt(0)
    await harness.flush()
    c.add({ source: 'radio', title: 'Live', streamUrl: 'https://radio.example/live' })
    harness.calls.length = 0
    await c.playAt(1)
    await harness.flush()
    const pauseAt = harness.calls.findIndex(call => call.path === '/pause' && call.method === 'POST')
    assert.ok(pauseAt >= 0, 'the prior Spotify engine is paused through the coordinator')
    assert.equal(c.current().source, 'radio')
    assert.equal(c.status.get(), 'playing')
    assert.equal(harness.calls.filter(call => call.path === '/play' && call.method === 'POST').length, 0, 'no Spotify play command after handoff')
    assert.equal(harness.elements.filter(element => !element.removed).length, 1, 'exactly one live engine')
  } finally { harness.restore() }
})
