import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-12 shared transport fixtures: one capability table + one command
// vocabulary for every provider. Headless labelled doubles — real embed
// playback/volume remain owner Desktop evidence (FM-25).
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { mediaCapabilities, clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, isSupportedLocalAudio, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason, QUEUE_ORIGINS, normalizeListeningSessions, makeId };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

function makeController({ rest } = {}) {
  const calls = []
  const elements = []
  const original = { Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now }
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
  globalThis.setTimeout = (fn) => { fn(); return {} }
  globalThis.clearTimeout = () => {}
  Date.now = () => 1_000_000
  const ctx = {
    storage: { get: (_key, fallback) => fallback, set: () => {} },
    rest: async (path, options) => { calls.push({ path, method: String(options?.method || 'GET').toUpperCase(), body: options?.body }); return rest ? rest(path, options) : { ok: true, data: {} } },
    os: { pickOpenPath: async () => null },
    preview: {},
    onDispose: () => {},
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', 'QUEUE_ORIGINS', 'normalizeListeningSessions', 'makeId', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason, pure.QUEUE_ORIGINS, pure.normalizeListeningSessions, pure.makeId)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  return { controller, calls, elements, flush, restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow } }
}

test('the capability table serves every provider; radio never gets a fake seek', () => {
  assert.deepEqual(pure.mediaCapabilities({ source: 'youtube' }), { play: true, previous: true, next: true, seek: true, volume: true, shuffle: false, repeat: false, device: false })
  assert.deepEqual(pure.mediaCapabilities({ source: 'radio' }), { play: true, previous: false, next: false, seek: false, volume: true, shuffle: false, repeat: false, device: false })
  assert.deepEqual(pure.mediaCapabilities({ source: 'local' }), { play: true, previous: true, next: true, seek: true, volume: true, shuffle: false, repeat: false, device: false })
  assert.deepEqual(pure.mediaCapabilities({ source: 'spotify' }), { play: true, previous: true, next: true, seek: true, volume: true, shuffle: true, repeat: true, device: true })
  assert.deepEqual(pure.mediaCapabilities(null), { play: false, previous: false, next: false, seek: false, volume: false, shuffle: false, repeat: false, device: false })
})

test('shared transport commands drive the registered YouTube sink, never REST or internal audio', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    const commands = []
    c.setYouTubeCommandSink((func, args = []) => { commands.push({ func, args }); return true })
    c.add({ source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Video', durationMs: 60000 })
    await c.playAt(0)
    await harness.flush()
    harness.calls.length = 0
    // playing=false after selection -> play; state reports flip it -> pause
    await c.toggle()
    assert.deepEqual(commands.at(-1), { func: 'playVideo', args: [] })
    c.youtube.set({ ...c.youtube.get(), playing: true })
    await c.toggle()
    assert.deepEqual(commands.at(-1), { func: 'pauseVideo', args: [] })
    await c.seekTo(3000)
    assert.deepEqual(commands.at(-1), { func: 'seekTo', args: [3] }, 'YouTube seek uses seconds')
    assert.equal(c.progress.get().positionMs, 3000)
    c.setVolume(0.2)
    assert.deepEqual(commands.at(-1), { func: 'setVolume', args: [20] })
    assert.equal(c.volume.get(), 0.2)
    assert.equal(harness.calls.filter(call => call.method !== 'GET').length, 0, 'embed media never goes through provider REST')
    assert.equal(harness.elements.length, 0, 'no internal audio engine for YouTube')
  } finally { harness.restore() }
})

test('without a registered surface the shared transport is honestly not-ready', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.add({ source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Video' })
    await c.playAt(0)
    await c.toggle()
    assert.match(c.message.get(), /YouTube player is not ready/)
    await c.seekTo(1000)
    assert.match(c.message.get(), /YouTube player is not ready/)
    assert.equal(c.status.get(), 'paused', 'no fake playing state is invented')
    // Unregistering restores the honest state again.
    c.setYouTubeCommandSink(() => true)
    c.setYouTubeCommandSink(null)
    await c.toggle()
    assert.match(c.message.get(), /YouTube player is not ready/)
  } finally { harness.restore() }
})

test('queue previous/next remain real queue actions for YouTube occurrences', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.setYouTubeCommandSink(() => true)
    c.add({ source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'One' })
    c.add({ source: 'youtube', url: 'https://www.youtube.com/watch?v=lmnopqrstuv', title: 'Two' })
    await c.playAt(0)
    await c.next()
    await harness.flush()
    assert.equal(c.index.get(), 1)
    assert.equal(c.current().title, 'Two')
    await c.previous()
    await harness.flush()
    assert.equal(c.index.get(), 0)
  } finally { harness.restore() }
})

test('all surfaces share one control vocabulary and usable volume widths', () => {
  // MiniControlBar uses the SAME VolumeControl as the main anchor; no
  // provider-specific volume path or double-send callback remains.
  const miniStart = source.indexOf('function MiniControlBar(')
  const miniEnd = source.indexOf('function YouTubeTransport(')
  assert.ok(miniStart >= 0 && miniEnd > miniStart)
  const mini = source.slice(miniStart, miniEnd)
  assert.match(mini, /VolumeControl/)
  assert.doesNotMatch(source, /onVolumeChange/)
  assert.doesNotMatch(source, /fluid-mini-volume' \}/)
  // The retired notice-only toggle stub is gone from the controller.
  assert.doesNotMatch(controllerText, /YouTube transport is in the FluidMusic player pane/)
  // Volume ranges are fluid 150px+ or a full row in narrow layouts.
  assert.match(source, /\.fluid-volume-compact\{width:150px\}/)
  assert.match(source, /\.fluid-mini-controls\{display:grid;grid-template-columns:auto minmax\(150px,1fr\) auto/)
  assert.match(source, /grid-template-areas:"controls links" "volume volume"/)
  assert.doesNotMatch(source, /\.fluid-volume-compact \.fluid-range\{width:60px/)
})
