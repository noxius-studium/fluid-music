import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-02 focus-switch continuity fixtures. These exercise the SHIPPED controller
// region headlessly with labelled test doubles (fake audio, stubbed REST/timers,
// in-memory storage). They prove registration-level continuity only — not real
// audio, packaged-Desktop rendering, or live provider behavior.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, sourceLabel, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, shouldShowNext, isSupportedLocalAudio, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason, QUEUE_ORIGINS, normalizeListeningSessions, makeId, isLongFormEligible, mediaKeyFor, normalizeResumePosition, normalizeBookmark, formatPositionMs, boundedSleepMinutes, SLEEP_MAX_CUSTOM_MIN };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

const MEDIA_COMMAND_ROUTES = new Set(['/play', '/pause', '/next', '/previous', '/transfer', '/queue', '/seek', '/volume', '/shuffle', '/repeat'])

function makeHarness({ playerState = { is_playing: false }, storage = new Map() } = {}) {
  const restCalls = []
  const previewCalls = []
  const timers = []
  const disposers = []
  const audioElements = []
  const clock = { now: 1_000_000 }
  const original = { Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now }
  class FakeAudio {
    constructor() { this.listeners = new Map(); this.ended = false; audioElements.push(this) }
    addEventListener(name, handler) { this.listeners.set(name, handler) }
    pause() { this.listeners.get('pause')?.() }
    removeAttribute() {}
    load() {}
    remove() { this.removed = true }
    async play() { this.listeners.get('playing')?.() }
  }
  globalThis.Audio = FakeAudio
  globalThis.setInterval = (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer }
  globalThis.clearInterval = timer => { if (timer) timer.cleared = true }
  globalThis.setTimeout = (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer }
  globalThis.clearTimeout = timer => { if (timer) timer.cleared = true }
  Date.now = () => clock.now
  const rest = async (path, options) => {
    restCalls.push({ path, method: String(options?.method || 'GET').toUpperCase(), options })
    const route = path.split('?')[0]
    if (route === '/config') return { ok: true, data: { poll_interval_open: 8, poll_interval_closed: 20 } }
    if (route === '/player') return { ok: true, data: playerState }
    if (route === '/local/roots') return { ok: true, data: { roots: [] } }
    if (route.startsWith('/local/tracks')) return { ok: true, data: { items: [], total: 0 } }
    if (route === '/history') return { ok: true, data: { items: [], total: 0 } }
    if (route === '/spotify/auth/status') return { ok: true, data: { auth: { logged_in: false }, setup: {}, flow: { state: 'idle', error: null } } }
    if (route === '/devices') return { ok: true, data: { devices: [] } }
    return { ok: true, data: {} }
  }
  const ctx = {
    storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) },
    rest,
    os: { pickOpenPath: async () => null },
    preview: { navigate: (...args) => previewCalls.push(args) },
    onDispose: fn => disposers.push(fn),
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', 'QUEUE_ORIGINS', 'normalizeListeningSessions', 'makeId', 'isLongFormEligible', 'mediaKeyFor', 'normalizeResumePosition', 'normalizeBookmark', 'formatPositionMs', 'boundedSleepMinutes', 'SLEEP_MAX_CUSTOM_MIN', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason, pure.QUEUE_ORIGINS, pure.normalizeListeningSessions, pure.makeId, pure.isLongFormEligible, pure.mediaKeyFor, pure.normalizeResumePosition, pure.normalizeBookmark, pure.formatPositionMs, pure.boundedSleepMinutes, pure.SLEEP_MAX_CUSTOM_MIN)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  const mediaCalls = () => restCalls.filter(call => call.method !== 'GET' && MEDIA_COMMAND_ROUTES.has(call.path.split('?')[0]))
  const historyPosts = () => restCalls.filter(call => call.method === 'POST' && call.path.split('?')[0] === '/history')
  return {
    controller, ctx, storage, restCalls, previewCalls, timers, audioElements, clock, mediaCalls, historyPosts, flush,
    dispose: () => disposers.forEach(fn => fn()),
    restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow },
  }
}

const radio = (id, title) => ({ source: 'radio', id, title, streamUrl: `https://radio.example/${id}` })
const spotifyTrack = (id, title) => ({ source: 'spotify', id, title, uri: `spotify:track:${id}` })

// Simulates what chat-session switches and route remounts do to the plugin:
// the MediaPage effect cycles polling cadence, the titlebar popover opens and
// closes, and the workspace view changes. None of these are playback intent.
function simulateSessionSwitch(controller, label) {
  controller.setPollingOpen(false) // MediaPage unmount (navigate away / session switch)
  controller.titlebarOpen.set(true)
  controller.titlebarOpen.set(false)
  controller.setWorkspaceView('queue')
  controller.setWorkspaceView('library')
  controller.setWorkspaceView('browse')
  controller.setPollingOpen(true) // MediaPage remount
  return label
}

test('controller identity, item, index and source survive two session switches and route remounts', async () => {
  const harness = makeHarness()
  try {
    const { controller } = harness
    assert.equal(controller.add(radio('a', 'Station A')), true)
    assert.equal(controller.add(spotifyTrack('one', 'Track One')), true)
    assert.equal(controller.add(radio('b', 'Station B')), true)
    controller.move(0, 1) // select the middle occurrence without any media command
    await harness.flush()
    const snapshot = {
      item: JSON.stringify(controller.current()),
      index: controller.index.get(),
      queue: JSON.stringify(controller.queue.get()),
      status: controller.status.get(),
      view: controller.workspaceView.get(),
    }
    assert.equal(snapshot.index, 1)
    const callsBefore = harness.restCalls.length
    for (const session of ['session-1', 'session-2']) {
      simulateSessionSwitch(controller, session)
      await harness.flush()
      assert.equal(controller.current() && JSON.stringify(controller.current()), snapshot.item, `${session}: exact occurrence preserved`)
      assert.equal(controller.index.get(), snapshot.index, `${session}: index preserved`)
      assert.equal(JSON.stringify(controller.queue.get()), snapshot.queue, `${session}: queue preserved`)
      assert.equal(controller.status.get(), snapshot.status, `${session}: playback state preserved`)
      assert.equal(controller.workspaceView.get(), snapshot.view, `${session}: media destination preserved`)
    }
    assert.equal(harness.mediaCalls().length, 0, 'no implicit media command from session/focus changes')
    assert.equal(harness.historyPosts().length, 0, 'no false played-history from session/focus changes')
    assert.equal(harness.previewCalls.length, 0, 'no Browser navigation from session/focus changes')
    assert.ok(harness.restCalls.length >= callsBefore, 'observation may continue')
  } finally { harness.restore() }
})

test('polling observation across remounts never mutates the selected occurrence or issues commands', async () => {
  const harness = makeHarness({ playerState: { is_playing: true, item: { uri: 'spotify:track:one', name: 'Track One', duration_ms: 200_000 }, progress_ms: 1_000, device: { name: 'Phone' } } })
  try {
    const { controller } = harness
    controller.add(spotifyTrack('one', 'Track One')) // index 0 selects the Spotify occurrence
    controller.add(radio('a', 'Station A'))
    controller.add(radio('b', 'Station B'))
    await harness.flush()
    const item = JSON.stringify(controller.current())
    const index = controller.index.get()
    for (let cycle = 0; cycle < 3; cycle += 1) {
      simulateSessionSwitch(controller, `cycle-${cycle}`)
      // Fire the observation timers the way the host would while time passes.
      for (const timer of harness.timers.filter(entry => !entry.cleared && [500, 2_000, 8_000, 20_000].includes(entry.ms))) {
        timer.fn()
        await harness.flush()
      }
      assert.equal(JSON.stringify(controller.current()), item, 'polling preserves the exact occurrence')
      assert.equal(controller.index.get(), index, 'polling preserves the index')
    }
    assert.equal(harness.mediaCalls().length, 0, 'observation never issues transport commands')
    assert.equal(harness.historyPosts().length, 0, 'observation never records false history')
    assert.equal(harness.previewCalls.length, 0)
    assert.equal(controller.status.get(), 'playing', 'provider state is reflected honestly')
  } finally { harness.restore() }
})

test('registration creates exactly one shared controller and the controller never steals focus', () => {
  const calls = source.match(/createController\(/g) || []
  assert.equal(calls.length, 2, 'one definition plus exactly one registration call')
  assert.equal((source.match(/const controller = createController\(ctx, \{ watchCapability: youTubeWatchCapability\(SDK\) \}\)/g) || []).length, 1)
  const gate = source.indexOf('if (!SDK_COMPATIBLE)')
  const creation = source.indexOf('const controller = createController(ctx')
  assert.ok(gate >= 0 && creation > gate, 'controller is created only after the SDK capability gate')
  for (const surface of ['MediaPage', 'TitlebarPlayer', 'MiniPlayer']) {
    assert.equal((source.match(new RegExp(`render: \\(\\) => h\\(${surface}, \\{ controller \\}\\)`, 'g')) || []).length, 1, `${surface} shares the single controller`)
  }
  assert.ok(!controllerText.includes('.focus('), 'controller region never manipulates focus')
})

test('late surface unmount/remount after disposal cannot revive polling or requests', async () => {
  const harness = makeHarness()
  try {
    const { controller } = harness
    controller.add(radio('a', 'Station A'))
    await harness.flush() // let loadConfig settle before disposal
    harness.dispose()
    await harness.flush()
    assert.ok(harness.timers.every(timer => timer.cleared), 'disposal clears every timer')
    const timersBefore = harness.timers.length
    const callsBefore = harness.restCalls.length
    // A late MediaPage cleanup + remount after plugin disposal must be inert.
    controller.setPollingOpen(false)
    controller.setPollingOpen(true)
    await harness.flush()
    assert.equal(harness.timers.length, timersBefore, 'no polling timer is resurrected after disposal')
    assert.equal(harness.restCalls.length, callsBefore, 'no provider request is issued after disposal')
    assert.equal(harness.mediaCalls().length, 0)
  } finally { harness.restore() }
})

test('an in-flight auth poll cannot reschedule itself after disposal', async () => {
  const harness = makeHarness()
  try {
    const { controller } = harness
    const pending = controller.startSpotifyAuth() // explicit user sign-in action
    harness.dispose() // plugin disposal races the in-flight auth-status request
    await pending.catch(() => {})
    await harness.flush()
    assert.equal(harness.timers.filter(timer => timer.ms === 1_500 && !timer.cleared).length, 0, 'no auth poll is rescheduled after disposal')
    assert.equal(harness.timers.filter(timer => !timer.cleared).length, 0, 'no live timer remains after disposal')
  } finally { harness.restore() }
})

test('a fresh registration restores the exact queue occurrence from safe storage', async () => {
  const storage = new Map()
  const first = makeHarness({ storage })
  let currentSnapshot
  let indexSnapshot
  try {
    first.controller.add(radio('a', 'Station A'))
    first.controller.add(spotifyTrack('one', 'Track One'))
    first.controller.add(radio('b', 'Station B'))
    first.controller.move(0, 1)
    await first.flush()
    currentSnapshot = JSON.stringify(first.controller.current())
    indexSnapshot = first.controller.index.get()
    first.dispose()
  } finally { first.restore() }
  const second = makeHarness({ storage })
  try {
    await second.flush()
    assert.equal(JSON.stringify(second.controller.current()), currentSnapshot, 'restart restores the exact selected occurrence')
    assert.equal(second.controller.index.get(), indexSnapshot)
    assert.equal(second.controller.queue.get().length, 3)
    assert.equal(second.mediaCalls().length, 0, 'restore never auto-plays')
    assert.equal(second.historyPosts().length, 0)
  } finally { second.restore() }
})

test('explicit user transport still works after session switches (positive control)', async () => {
  const harness = makeHarness()
  try {
    const { controller } = harness
    controller.add(radio('a', 'Station A'))
    simulateSessionSwitch(controller, 'session-1')
    simulateSessionSwitch(controller, 'session-2')
    await controller.toggle()
    await harness.flush()
    assert.equal(controller.status.get(), 'playing', 'explicit play works after remounts')
    assert.equal(harness.audioElements.length, 1, 'exactly one engine element')
    await controller.toggle()
    await harness.flush()
    assert.equal(controller.status.get(), 'paused', 'explicit pause works after remounts')
    assert.equal(harness.audioElements.length, 1, 'no duplicate engine on toggle')
  } finally { harness.restore() }
})
