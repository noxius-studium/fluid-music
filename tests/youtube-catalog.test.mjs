import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-05 catalogue UX contract fixtures: queue insertion vs confirmed playback,
// real titles reaching the shared player/history, stale-query fencing and
// honest loading/empty states in the Browse surface. Headless labelled
// doubles only — real search results/playback remain owner acceptance (FM-25).
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, isSupportedLocalAudio, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

function makeController({ rest } = {}) {
  const disposers = []
  const calls = []
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
  globalThis.setInterval = () => ({ cleared: false })
  globalThis.clearInterval = () => {}
  globalThis.setTimeout = () => ({})
  globalThis.clearTimeout = () => {}
  Date.now = () => 1_000_000
  const ctx = {
    storage: { get: (_key, fallback) => fallback, set: () => {} },
    rest: async (path, options) => {
      calls.push({ path, method: String(options?.method || 'GET').toUpperCase(), body: options?.body })
      return rest ? rest(path, options) : { ok: true, data: {} }
    },
    os: { pickOpenPath: async () => null },
    preview: {},
    onDispose: fn => disposers.push(fn),
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  return { controller, calls, flush, restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow } }
}

const item = { source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Night set — live', subtitle: 'Night Channel', durationMs: 3600000 }

test('adding a YouTube result to Up Next is selection, not confirmed playback or history', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    assert.equal(c.addYouTubeItem(item, false), true)
    await harness.flush()
    assert.equal(c.queue.get().length, 1)
    assert.equal(c.current().title, 'Night set — live')
    assert.equal(c.status.get(), 'paused', 'enqueue selects paused; the embed surface confirms playback')
    assert.equal(c.youtube.get().playing, false)
    assert.equal(harness.calls.filter(call => call.path === '/history' && call.method === 'POST').length, 0, 'no played event without playback')
    assert.equal(harness.calls.filter(call => call.method !== 'GET' && call.path !== '/youtube/resolve').length, 0)
  } finally { harness.restore() }
})

test('playing a YouTube result carries the real title to the shared player; history records on confirmed playback', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.addYouTubeItem(item, true)
    await harness.flush()
    await harness.flush()
    assert.equal(c.current().title, 'Night set — live')
    assert.equal(c.youtube.get().title, 'Night set — live')
    assert.equal(c.youtube.get().subtitle, 'Night Channel')
    assert.equal(harness.calls.filter(call => call.path === '/history' && call.method === 'POST').length, 0, 'selection alone is not a played event (FM-06)')
    c.reportYouTubeState({ kind: 'state', videoId: 'abcdefghijk', playerState: 1, playing: true, ended: false, positionMs: 1000, durationMs: 3600000 })
    await harness.flush()
    const posts = harness.calls.filter(call => call.path === '/history' && call.method === 'POST')
    assert.equal(posts.length, 1, 'exactly one played event on confirmed playback')
    assert.equal(posts[0].body.item.title, 'Night set — live')
    assert.equal(posts[0].body.item.id, 'youtube:abcdefghijk')
    assert.ok(!JSON.stringify(posts[0].body).includes('127.0.0.1'), 'no capability URL in history')
    assert.equal(c.status.get(), 'playing', 'confirmed embed playback is reflected honestly')
  } finally { harness.restore() }
})

test('search results are normalized and foreign entries are dropped before display', async () => {
  const harness = makeController({
    rest: async path => path.startsWith('/youtube/search')
      ? { ok: true, data: { items: [item, { source: 'youtube', url: 'https://evil.example/watch?v=abcdefghijk', title: 'Foreign' }, { source: 'radio', title: 'Not video' }] } }
      : { ok: true, data: {} },
  })
  try {
    const results = await harness.controller.searchYouTube('night set')
    assert.equal(results.length, 1)
    assert.equal(results[0].id, 'youtube:abcdefghijk')
    assert.equal(results[0].title, 'Night set — live')
  } finally { harness.restore() }
})

test('the Browse YouTube surface fences stale queries and shows honest loading/empty states', () => {
  const controls = source.slice(source.indexOf('function YouTubeControls('), source.indexOf('function HistoryPage('))
  assert.ok(controls.includes('request.current'), 'a request generation token fences stale query results')
  assert.ok(/token !== request\.current|token === request\.current/.test(controls), 'stale responses are ignored, not rendered')
  assert.ok(controls.includes('Resolving…') && controls.includes('Searching…'), 'loading state distinguishes URL resolution from search')
  assert.ok(/No videos found/.test(controls), 'an explicit empty state exists after a completed search')
  assert.ok(controls.includes('useEffect'), 'unmount invalidates in-flight requests')
  // Result rows keep explicit Play AND Add-to-queue actions (TrackRow contract).
  const row = source.slice(source.indexOf('function TrackRow('), source.indexOf('function MediaTile('))
  assert.ok(row.includes('Add ${item.title} to queue'), 'explicit enqueue action remains distinct from Play')
})
