import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-15 radio fixtures: discovery validation, selection/enqueue/pin workflows,
// LIVE failure cleanup and bounded Radio Browser click registration. Labelled
// headless doubles only (fake audio, stubbed REST/timers, in-memory storage) —
// NO public stream is launched and no live Radio Browser call is made. Real
// station audio, CORS/codec behavior and Desktop rendering stay unverified
// here and are gated to the FM-25 owner review.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, sourceLabel, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, shouldShowNext, isSupportedLocalAudio, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

function makeHarness({ storage = new Map(), playBehavior = 'ok', rest } = {}) {
  const calls = []
  const elements = []
  const timers = []
  const disposers = []
  const original = { Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now }
  class FakeAudio {
    constructor() { this.listeners = new Map(); this.ended = false; this.error = null; elements.push(this) }
    addEventListener(name, handler) { this.listeners.set(name, handler) }
    pause() { this.listeners.get('pause')?.() }
    removeAttribute() {}
    load() {}
    remove() { this.removed = true }
    async play() {
      if (playBehavior === 'ok') this.listeners.get('playing')?.()
      else if (playBehavior === 'reject') throw new Error('autoplay blocked')
    }
  }
  globalThis.Audio = FakeAudio
  globalThis.setInterval = (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer }
  globalThis.clearInterval = timer => { if (timer) timer.cleared = true }
  globalThis.setTimeout = (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer }
  globalThis.clearTimeout = timer => { if (timer) timer.cleared = true }
  const ctx = {
    storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) },
    rest: async (path, options) => {
      calls.push({ path, method: String(options?.method || 'GET').toUpperCase() })
      if (rest) return rest(path, options)
      if (path === '/config') return { ok: true, data: {} }
      if (path.startsWith('/local/tracks')) return { ok: true, data: { items: [], total: 0 } }
      if (path === '/local/roots') return { ok: true, data: { roots: [] } }
      if (path === '/history') return { ok: true, data: { items: [], total: 0 } }
      if (path === '/spotify/auth/status') return { ok: true, data: { auth: { logged_in: false }, setup: {}, flow: { state: 'idle', error: null } } }
      return { ok: true, data: {} }
    },
    os: { pickOpenPath: async () => null },
    preview: { navigate: () => {} },
    onDispose: fn => disposers.push(fn),
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  const historyPosts = () => calls.filter(call => call.path === '/history' && call.method === 'POST')
  const clickPosts = () => calls.filter(call => call.path.startsWith('/radio/click/') && call.method === 'POST')
  return {
    controller, storage, calls, elements, timers, flush, historyPosts, clickPosts,
    dispose: () => disposers.forEach(fn => fn()),
    restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow },
  }
}

const UUID_A = 'b30b1e1e-6e7e-4a4e-9876-a5bb13be0c60'
const UUID_B = 'b30b1e1e-6e7e-4a4e-9876-a5bb13be0c61'
const station = (id, title) => ({ source: 'radio', id, title, streamUrl: `https://radio.example/${id}.mp3` })

test('radio pins persist across restarts, unpin cleanly, and resetSavedRadio clears only radio pins', async () => {
  const storage = new Map()
  const first = makeHarness({ storage })
  try {
    const { controller } = first
    controller.toggleFavorite(station(UUID_A, 'Safe FM'))
    controller.toggleFavorite({ source: 'spotify', id: 'spotify:track:abc', title: 'Track', uri: 'spotify:track:abc' })
    await first.flush()
    assert.deepEqual(controller.favorites.get().map(item => item.source), ['radio', 'spotify'])
    assert.equal(storage.get('favorites').length, 2, 'pins are persisted to profile storage')
    controller.toggleFavorite(station(UUID_A, 'Safe FM'))
    assert.deepEqual(controller.favorites.get().map(item => item.source), ['spotify'], 'second toggle unpins by stable id')
    controller.toggleFavorite(station(UUID_A, 'Safe FM'))
    controller.toggleFavorite({ source: 'local', id: 'local:x', title: 'Local', objectUrl: 'blob:x' })
    assert.equal(controller.favorites.get().length, 2, 'local files are not pinnable radio favorites')
    controller.resetSavedRadio()
    assert.deepEqual(controller.favorites.get().map(item => item.source), ['spotify'], 'reset clears radio pins only')
    controller.toggleFavorite(station(UUID_B, 'Other FM'))
    await first.flush()
  } finally { first.restore() }
  const second = makeHarness({ storage })
  try {
    await second.flush()
    const restored = second.controller.favorites.get()
    assert.deepEqual(restored.map(item => item.id), ['spotify:track:abc', UUID_B], 'a fresh registration restores the exact saved pins, radio reset intact')
    assert.equal(restored[1].streamUrl, `https://radio.example/${UUID_B}.mp3`)
  } finally { second.restore() }
})

test('enqueue selects without an engine; play starts exactly one; unsafe stream URLs are rejected honestly', async () => {
  const harness = makeHarness()
  try {
    const { controller } = harness
    assert.equal(controller.add(station(UUID_A, 'Safe FM')), true)
    await harness.flush()
    assert.equal(controller.index.get(), 0)
    assert.equal(controller.status.get(), 'paused', 'enqueue alone is not playback intent')
    assert.equal(harness.elements.length, 0, 'no audio engine before an explicit play')
    assert.equal(controller.add(station(UUID_B, 'Other FM'), true), true)
    await harness.flush()
    assert.equal(harness.elements.length, 1, 'explicit play starts exactly one engine')
    assert.equal(controller.current().id, UUID_B)
    assert.equal(controller.status.get(), 'playing')
    const before = controller.queue.get().length
    assert.equal(controller.add({ source: 'radio', title: 'Bad', streamUrl: 'https://127.0.0.1/admin' }), false)
    assert.equal(controller.add({ source: 'radio', title: 'Bad', streamUrl: 'https://user:pass@radio.example/live' }), false)
    assert.equal(controller.queue.get().length, before, 'rejected URLs never enter the queue')
    assert.match(controller.message.get(), /not a supported public/)
  } finally { harness.restore() }
})

test('LIVE failure cleanup: real boundary messages, no false history, timer lifecycle, stale generations fenced', async () => {
  const silent = makeHarness({ playBehavior: 'silent' })
  try {
    const { controller } = silent
    controller.add(station(UUID_A, 'Safe FM'), true)
    await silent.flush()
    assert.equal(controller.status.get(), 'loading')
    const element = silent.elements.at(-1)
    element.error = { code: 2 }
    element.listeners.get('error')()
    assert.equal(controller.status.get(), 'error')
    assert.match(controller.message.get(), /network boundary/, 'MediaError NETWORK reports the network boundary')
    assert.equal(silent.historyPosts().length, 0, 'a failed stream is not a played event')
    element.error = { code: 3 }
    element.listeners.get('error')()
    assert.match(controller.message.get(), /codec boundary/)
    element.error = { code: 4 }
    element.listeners.get('error')()
    assert.match(controller.message.get(), /codec\/CORS boundary/, 'unsupported format-or-origin is reported honestly, not as a rights claim')
    element.listeners.get('ended')()
    assert.match(controller.message.get(), /ended unexpectedly/, 'a live stream that ends is an error, not a completed track')
  } finally { silent.restore() }
  const timeout = makeHarness({ playBehavior: 'silent' })
  try {
    timeout.controller.add(station(UUID_A, 'Safe FM'), true)
    await timeout.flush()
    const guard = timeout.timers.find(timer => timer.ms === 15_000 && !timer.cleared)
    assert.ok(guard, 'a bounded connect timeout is armed')
    guard.fn()
    assert.equal(timeout.controller.status.get(), 'error')
    assert.match(timeout.controller.message.get(), /could not connect/)
    assert.equal(timeout.historyPosts().length, 0)
  } finally { timeout.restore() }
  const rejected = makeHarness({ playBehavior: 'reject' })
  try {
    rejected.controller.add(station(UUID_A, 'Safe FM'), true)
    await rejected.flush()
    assert.equal(rejected.controller.status.get(), 'error', 'a rejected play() settles as an honest failure')
    assert.equal(rejected.historyPosts().length, 0)
  } finally { rejected.restore() }
  const switching = makeHarness()
  try {
    const { controller } = switching
    controller.add(station(UUID_A, 'A'), true)
    await switching.flush()
    const old = switching.elements.at(-1)
    assert.ok(switching.timers.filter(timer => timer.ms === 15_000 && !timer.cleared).length === 0, 'confirmed playing clears the connect timeout')
    controller.add(station(UUID_B, 'B'), true)
    await switching.flush()
    assert.equal(controller.status.get(), 'playing')
    old.error = { code: 2 }
    old.listeners.get('error')()
    old.listeners.get('ended')()
    old.listeners.get('playing')()
    await switching.flush()
    assert.equal(controller.status.get(), 'playing', 'late events from the stopped station cannot disturb the active one')
    assert.equal(controller.current().id, UUID_B)
    assert.equal(switching.historyPosts().length, 2, 'each station records exactly once; stale replays record nothing')
  } finally { switching.restore() }
})

test('Radio Browser click registration is UUID-only, bounded, and never gates playback', async () => {
  const harness = makeHarness()
  try {
    const { controller } = harness
    controller.add(station(UUID_A, 'Safe FM'), true)
    await harness.flush()
    assert.deepEqual(harness.clickPosts().map(call => call.path), [`/radio/click/${UUID_A}`], 'one click per directory play attempt')
    assert.equal(controller.status.get(), 'playing')
    await controller.toggle() // pause
    await harness.flush()
    assert.equal(harness.clickPosts().length, 1, 'pause registers no click')
    await controller.toggle() // resume is a new play intent
    await harness.flush()
    assert.equal(harness.clickPosts().length, 2)
    controller.add({ source: 'radio', id: 'fluid-chillsynth', title: 'Preset', streamUrl: 'https://stream.example/preset.mp3' }, true)
    await harness.flush()
    assert.equal(harness.clickPosts().length, 2, 'preset/custom ids are not directory stations')
    const clicksBefore = harness.clickPosts().length
    harness.dispose()
    await controller.toggle().catch(() => {})
    await harness.flush()
    assert.equal(harness.clickPosts().length, clicksBefore, 'disposal ends click registration')
  } finally { harness.restore() }
  const failing = makeHarness({ rest: async (path) => { if (path.startsWith('/radio/click/')) throw new Error('directory offline'); return { ok: true, data: {} } } })
  try {
    failing.controller.add(station(UUID_A, 'Safe FM'), true)
    await failing.flush()
    assert.equal(failing.controller.status.get(), 'playing', 'a failed click registration never blocks or fails playback')
    assert.equal(failing.historyPosts().length, 1)
  } finally { failing.restore() }
})

test('LIVE surfaces stay source-honest: no seek/skip affordances for radio', () => {
  assert.deepEqual(pure.mediaCapabilities({ source: 'radio' }), { play: true, previous: false, next: false, seek: false, volume: true, shuffle: false, repeat: false, device: false })
  const bar = source.slice(source.indexOf('function BottomTransport('), source.indexOf('function SecondaryTabs('))
  assert.match(bar, /LIVE · station broadcast/, 'the shared bar shows LIVE, never a fake seek for radio')
  const mini = source.slice(source.indexOf('function MiniPlayer('), source.indexOf('function YouTubeControls('))
  assert.match(mini, /item\?\.source === 'radio' \? 'LIVE' : status/, 'the mini pane shows LIVE for radio')
})
