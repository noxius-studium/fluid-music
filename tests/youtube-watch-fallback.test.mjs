import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-08 owned first-party watch fallback fixtures. The required public host
// capability (OwnedMediaView + host.mediaSession) does NOT exist in the
// current Hermes SDK; these fixtures use a LABELLED FAKE capability to prove
// the adapter's negotiation/fencing/uniqueness logic, plus the honest
// capability-absent behavior. Real watch-eligible playback and the packaged
// host capability remain explicit owner/host review gates (FM-25).
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { youTubeWatchCapability, classifyYouTubeFailure, clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, isSupportedLocalAudio, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

// LABELLED FAKE of the REQUIRED host contract — not a real Hermes export.
// Shaped like the public SDK namespace the checker negotiates against.
function fakeWatchCapability() {
  return {
    OwnedMediaView: function FakeOwnedMediaView() { return null },
    host: { mediaSession: { ensurePartition: () => {}, openLogin: () => {}, dispose: () => {} } },
  }
}

function makeController({ watchCapability, rest } = {}) {
  const disposers = []
  const calls = []
  const previewCalls = []
  const original = { Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now }
  class FakeAudio {
    constructor() { this.listeners = new Map() }
    addEventListener(name, handler) { this.listeners.set(name, handler) }
    pause() {}
    removeAttribute() {}
    load() {}
    remove() {}
    async play() {}
  }
  globalThis.Audio = FakeAudio
  globalThis.setInterval = () => ({})
  globalThis.clearInterval = () => {}
  globalThis.setTimeout = () => ({})
  globalThis.clearTimeout = () => {}
  Date.now = () => 1_000_000
  const ctx = {
    storage: { get: (_key, fallback) => fallback, set: () => {} },
    rest: async (path, options) => { calls.push({ path, method: String(options?.method || 'GET').toUpperCase() }); return rest ? rest(path, options) : { ok: true, data: {} } },
    os: { pickOpenPath: async () => null },
    preview: { openOrFocus: (...args) => previewCalls.push(args), executeJavaScriptIn: (...args) => previewCalls.push(args) },
    onDispose: fn => disposers.push(fn),
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason)
  const controller = factory(ctx, watchCapability ? { watchCapability: pure.youTubeWatchCapability(watchCapability) } : {})
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  const historyPosts = () => calls.filter(call => call.path === '/history' && call.method === 'POST')
  return { controller, calls, previewCalls, flush, historyPosts, restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow } }
}

const youtubeItem = { source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Night set' }
const embedPlaying = { kind: 'state', engine: 'embed', videoId: 'abcdefghijk', playerState: 1, playing: true, ended: false, positionMs: 1000, durationMs: 90000 }
const watchPlaying = { kind: 'state', engine: 'watch', videoId: 'abcdefghijk', playerState: 1, playing: true, ended: false, positionMs: 1000, durationMs: 90000 }

test('capability negotiation demands the exact owned-view contract, never a sandboxed iframe substitute', () => {
  const absent = pure.youTubeWatchCapability({})
  assert.equal(absent.available, false)
  assert.deepEqual(absent.missing, ['OwnedMediaView', 'host.mediaSession'])
  // SandboxedFrame alone is NOT the capability (opaque origin cannot hold login).
  const sandboxOnly = pure.youTubeWatchCapability({ SandboxedFrame: () => null, host: { navigate: () => {} } })
  assert.equal(sandboxOnly.available, false)
  const partial = pure.youTubeWatchCapability({ OwnedMediaView: () => null, host: {} })
  assert.deepEqual(partial.missing, ['host.mediaSession'])
  const complete = pure.youTubeWatchCapability(fakeWatchCapability())
  assert.equal(complete.available, true)
  assert.deepEqual(complete.missing, [])
  assert.equal(pure.youTubeWatchCapability(null).available, false)
})

test('without the host capability the fallback is an honest unavailable state, never an external app', async () => {
  const harness = makeController() // no capability injected — the real current-host condition
  try {
    const c = harness.controller
    c.addYouTubeItem(youtubeItem, true)
    await harness.flush()
    c.reportYouTubeState({ kind: 'error', engine: 'embed', errorCode: 101 })
    assert.equal(c.youtube.get().fallbackEligible, true)
    assert.equal(c.attemptYouTubeWatchFallback(), false)
    assert.equal(c.youtube.get().watchUnavailable, true)
    assert.equal(c.youtube.get().engine, 'embed', 'engine never switches without the capability')
    assert.match(c.message.get(), /does not provide/)
    assert.equal(harness.previewCalls.length, 0, 'no focused-chat Browser takeover')
    assert.equal(harness.calls.filter(call => call.path.startsWith('http')).length, 0)
    // The working embed path is preserved.
    c.reportYouTubeState(embedPlaying)
    assert.equal(c.status.get(), 'playing')
    assert.equal(c.index.get(), 0)
  } finally { harness.restore() }
})

test('with a labelled fake capability the switch is visible, fenced and bounded', async () => {
  const harness = makeController({ watchCapability: fakeWatchCapability() })
  try {
    const c = harness.controller
    c.addYouTubeItem(youtubeItem, true)
    c.add({ source: 'radio', streamUrl: 'https://radio.example/live', title: 'Next' })
    await harness.flush()
    c.reportYouTubeState({ kind: 'error', engine: 'embed', errorCode: 150 })
    assert.equal(c.attemptYouTubeWatchFallback(), true)
    assert.equal(c.youtube.get().engine, 'watch')
    assert.equal(c.youtube.get().status, 'switching')
    assert.match(c.message.get(), /Switching player/)
    assert.equal(c.index.get(), 0, 'the exact occurrence is preserved')
    // Late embed events after the switch cannot mutate the watch engine.
    c.reportYouTubeState(embedPlaying)
    assert.equal(c.youtube.get().status, 'switching')
    assert.equal(c.status.get(), 'loading')
    // Watch reports drive state; completion still advances exactly once.
    c.reportYouTubeState(watchPlaying)
    assert.equal(c.status.get(), 'playing')
    assert.equal(c.youtube.get().playing, true)
    assert.equal(harness.historyPosts().length, 1)
    c.reportYouTubeState(watchPlaying)
    assert.equal(harness.historyPosts().length, 1, 'engine switch never duplicates the played event')
    // Bounded: while already on the watch engine another attempt is refused.
    c.reportYouTubeState({ kind: 'error', engine: 'watch', errorCode: 5 })
    assert.equal(c.attemptYouTubeWatchFallback(), false)
    assert.equal(c.youtube.get().engine, 'watch', 'no engine ping-pong')
    assert.equal(c.index.get(), 0, 'no engine loop advances the queue')
    assert.equal(harness.previewCalls.length, 0)
  } finally { harness.restore() }
})

test('a new transition resets the engine and the bounded attempt budget', async () => {
  const harness = makeController({ watchCapability: fakeWatchCapability() })
  try {
    const c = harness.controller
    c.addYouTubeItem(youtubeItem, true)
    await harness.flush()
    c.reportYouTubeState({ kind: 'error', engine: 'embed', errorCode: 101 })
    assert.equal(c.attemptYouTubeWatchFallback(), true)
    await c.playAt(0)
    await harness.flush()
    assert.equal(c.youtube.get().engine, 'embed')
    assert.equal(c.youtube.get().status, 'ready')
    c.reportYouTubeState({ kind: 'error', engine: 'embed', errorCode: 101 })
    assert.equal(c.attemptYouTubeWatchFallback(), true, 'fresh transition gets one fresh attempt')
  } finally { harness.restore() }
})

test('the player surface renders exactly one engine and disposes the owned view', () => {
  const mini = source.slice(source.indexOf('function MiniPlayer('))
  assert.ok(/watching\s*\?\s*h\(OwnedWatchSurface/.test(mini), 'either the owned watch surface or the embed frame, never both')
  assert.ok(/:\s*h\(EmbeddedYouTubeFrame/.test(mini))
  assert.ok(/Try watch fallback/.test(mini), 'the fallback is an explicit user action')
  const surface = source.slice(source.indexOf('function OwnedWatchSurface('), source.indexOf('function MiniPlayer('))
  assert.ok(/dispose/.test(surface), 'owned view resources are disposed on unmount')
  assert.ok(/engine: 'watch'/.test(surface), 'watch reports are engine-tagged for fencing')
  assert.ok(!surface.includes('executeJavaScriptIn') && !surface.includes('openOrFocus'), 'no Browser scripting or focused-chat takeover')
})
