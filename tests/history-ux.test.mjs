import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-06 played-history semantics fixtures: actual played confirmation once per
// transition, never merely-selected/failed items; replay revalidates local
// availability; explicit scoped clear confirmation. Headless labelled doubles
// only — real Desktop history/playback remains owner acceptance (FM-25).
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, isSupportedLocalAudio, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason, QUEUE_ORIGINS, normalizeListeningSessions, makeId, isLongFormEligible, mediaKeyFor, normalizeResumePosition, normalizeBookmark, formatPositionMs, boundedSleepMinutes, SLEEP_MAX_CUSTOM_MIN };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

function makeController({ rest, autoPlay = true } = {}) {
  const disposers = []
  const calls = []
  const elements = []
  const clock = { now: 1_000_000 }
  const original = { Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now }
  class FakeAudio {
    constructor() { this.listeners = new Map(); this.ended = false; elements.push(this) }
    addEventListener(name, handler) { this.listeners.set(name, handler) }
    pause() { this.listeners.get('pause')?.() }
    removeAttribute() {}
    load() {}
    remove() { this.removed = true }
    async play() { if (autoPlay) this.listeners.get('playing')?.() }
  }
  globalThis.Audio = FakeAudio
  globalThis.setInterval = () => ({ cleared: false })
  globalThis.clearInterval = () => {}
  globalThis.setTimeout = () => ({})
  globalThis.clearTimeout = () => {}
  Date.now = () => clock.now
  const ctx = {
    storage: { get: (_key, fallback) => fallback, set: () => {} },
    rest: async (path, options) => {
      calls.push({ path, method: String(options?.method || 'GET').toUpperCase(), body: options?.body })
      if (rest) return rest(path, options)
      if (path.startsWith('/local/tracks')) return { ok: true, data: { items: [], total: 0 } }
      if (path === '/local/roots') return { ok: true, data: { roots: [] } }
      return { ok: true, data: {} }
    },
    os: { pickOpenPath: async () => null },
    preview: {},
    onDispose: fn => disposers.push(fn),
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', 'QUEUE_ORIGINS', 'normalizeListeningSessions', 'makeId', 'isLongFormEligible', 'mediaKeyFor', 'normalizeResumePosition', 'normalizeBookmark', 'formatPositionMs', 'boundedSleepMinutes', 'SLEEP_MAX_CUSTOM_MIN', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason, pure.QUEUE_ORIGINS, pure.normalizeListeningSessions, pure.makeId, pure.isLongFormEligible, pure.mediaKeyFor, pure.normalizeResumePosition, pure.normalizeBookmark, pure.formatPositionMs, pure.boundedSleepMinutes, pure.SLEEP_MAX_CUSTOM_MIN)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  const historyPosts = () => calls.filter(call => call.path === '/history' && call.method === 'POST')
  return { controller, calls, elements, clock, flush, historyPosts, restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow } }
}

const youtubeItem = { source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Night set', subtitle: 'Night Channel' }
const playingReport = { kind: 'state', videoId: 'abcdefghijk', playerState: 1, playing: true, ended: false, positionMs: 1000, durationMs: 90000 }

test('YouTube selection is not a played event; the first confirmed playing report records exactly once', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.addYouTubeItem(youtubeItem, true)
    await harness.flush()
    await harness.flush()
    assert.equal(harness.historyPosts().length, 0, 'merely selecting/embedding a video never records a play')
    c.reportYouTubeState(playingReport)
    await harness.flush()
    assert.equal(harness.historyPosts().length, 1, 'actual playing confirmation records once')
    assert.equal(harness.historyPosts()[0].body.item.title, 'Night set')
    c.reportYouTubeState(playingReport)
    c.reportYouTubeState({ ...playingReport, playerState: 2, playing: false })
    c.reportYouTubeState(playingReport)
    await harness.flush()
    assert.equal(harness.historyPosts().length, 1, 'duplicate/alternating state reports never double-record')
    harness.clock.now += 6_000 // a deliberate replay happens after the duplicate-suppression window
    await c.playAt(0)
    await harness.flush()
    c.reportYouTubeState(playingReport)
    await harness.flush()
    assert.equal(harness.historyPosts().length, 2, 'a new transition may record a new confirmed play')
  } finally { harness.restore() }
})

test('a failed Spotify start is never recorded as played', async () => {
  const harness = makeController({ rest: async path => path === '/play' ? { ok: false, error: 'No active device' } : { ok: true, data: {} } })
  try {
    const c = harness.controller
    c.add({ source: 'spotify', uri: 'spotify:track:one', title: 'Track' })
    await c.playAt(0)
    await harness.flush()
    assert.equal(c.status.get(), 'error')
    assert.equal(harness.historyPosts().length, 0)
  } finally { harness.restore() }
})

test('radio records on actual playing, and a stream that never plays records nothing', async () => {
  const playing = makeController()
  try {
    playing.controller.add({ source: 'radio', title: 'Live', streamUrl: 'https://radio.example/live' })
    await playing.controller.playAt(0)
    await playing.flush()
    assert.equal(playing.controller.status.get(), 'playing')
    assert.equal(playing.historyPosts().length, 1)
  } finally { playing.restore() }
  const failing = makeController({ autoPlay: false })
  try {
    failing.controller.add({ source: 'radio', title: 'Live', streamUrl: 'https://radio.example/live' })
    await failing.controller.playAt(0)
    await failing.flush()
    failing.elements.at(-1).listeners.get('error')()
    await failing.flush()
    assert.equal(failing.controller.status.get(), 'error')
    assert.equal(failing.historyPosts().length, 0, 'a failed stream is not a played event')
  } finally { failing.restore() }
})

test('history replay revalidates indexed local availability against the current library', async () => {
  const indexed = { id: 'a', title: 'One', subtitle: 'Artist', path: 'C:/Music/One.mp3', mime_type: 'audio/mpeg', duration_ms: 60000, available: true }
  const withLibrary = makeController({
    rest: async path => path.startsWith('/local/tracks') ? { ok: true, data: { items: [indexed], total: 1 } } : path === '/local/roots' ? { ok: true, data: { roots: [] } } : { ok: true, data: {} },
  })
  try {
    const c = withLibrary.controller
    await c.refreshLocalLibrary()
    // A persisted history reference carries no path/object URL — only the ID.
    const historyReference = { source: 'local', id: 'local:a', localTrackId: 'a', title: 'One' }
    assert.equal(c.add(historyReference, true), true, 'replay relinks the indexed track')
    await withLibrary.flush()
    assert.equal(c.status.get(), 'playing')
    assert.equal(withLibrary.historyPosts().length, 1)
  } finally { withLibrary.restore() }
  const withoutLibrary = makeController()
  try {
    const c = withoutLibrary.controller
    await c.refreshLocalLibrary()
    assert.equal(c.add({ source: 'local', id: 'local:a', localTrackId: 'a', title: 'One' }, true), false, 'unindexed history replay is honestly unavailable')
    assert.match(c.message.get(), /unavailable/i)
    assert.equal(withoutLibrary.elements.length, 0)
    assert.equal(withoutLibrary.historyPosts().length, 0)
  } finally { withoutLibrary.restore() }
})

test('HistoryPage offers replay and an explicit scoped Clear confirmation', () => {
  const page = source.slice(source.indexOf('function HistoryPage('), source.indexOf('function NowPlayingBand('))
  assert.ok(page.includes('Confirm'), 'clearing history requires the confirmation dialog')
  assert.ok(/clearHistory/.test(page), 'the confirmed action clears history')
  assert.ok(!/onClick:\s*clear\b/.test(page), 'the toolbar button no longer clears directly')
  assert.ok(/controller\.add\(entry\.item,\s*true,\s*'history'\)/.test(page), 'replay goes through the shared coordinator with history provenance')
  assert.ok(/this profile/i.test(page), 'the confirmation states its scope')
})
