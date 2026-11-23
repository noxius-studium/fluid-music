import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-04 YouTube command/state bridge contract fixtures. Headless logic-level
// checks over the shipped pure helpers and controller region with labelled
// doubles. Issued commands are NOT audible/video proof — real embed playback
// and volume remain owner Desktop acceptance (FM-25).
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { youTubeCommandMessage, youTubeListeningMessage, embedFrameOrigin, parseYouTubePlayerMessage, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, clampVolume, nextQueueIndex, previousQueueIndex, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, isSupportedLocalAudio, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason, QUEUE_ORIGINS, normalizeListeningSessions, makeId, isLongFormEligible, mediaKeyFor, normalizeResumePosition, normalizeBookmark, formatPositionMs, boundedSleepMinutes, SLEEP_MAX_CUSTOM_MIN, retryGate, retryConsumed, normalizeHealthRow, RETRY_COOLDOWN_MS };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

function makeController({ rest, storage = new Map() } = {}) {
  const disposers = []
  const timers = []
  const original = { Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now }
  class FakeAudio {
    constructor() { this.listeners = new Map(); this.ended = false }
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
  globalThis.setTimeout = (fn, ms) => ({ fn, ms })
  globalThis.clearTimeout = () => {}
  Date.now = () => 1_000_000
  const ctx = {
    storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) },
    rest: rest || (async path => path === '/config' ? { ok: true, data: {} } : { ok: true, data: {} }),
    os: { pickOpenPath: async () => null },
    preview: {},
    onDispose: fn => disposers.push(fn),
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', 'QUEUE_ORIGINS', 'normalizeListeningSessions', 'makeId', 'isLongFormEligible', 'mediaKeyFor', 'normalizeResumePosition', 'normalizeBookmark', 'formatPositionMs', 'boundedSleepMinutes', 'SLEEP_MAX_CUSTOM_MIN', 'retryGate', 'retryConsumed', 'normalizeHealthRow', 'RETRY_COOLDOWN_MS', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason, pure.QUEUE_ORIGINS, pure.normalizeListeningSessions, pure.makeId, pure.isLongFormEligible, pure.mediaKeyFor, pure.normalizeResumePosition, pure.normalizeBookmark, pure.formatPositionMs, pure.boundedSleepMinutes, pure.SLEEP_MAX_CUSTOM_MIN, pure.retryGate, pure.retryConsumed, pure.normalizeHealthRow, pure.RETRY_COOLDOWN_MS)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  return { controller, ctx, storage, timers, flush, dispose: () => disposers.forEach(fn => fn()), restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow } }
}

const VIDEO = 'abcdefghijk'
const youtubeItem = { source: 'youtube', url: `https://www.youtube.com/watch?v=${VIDEO}`, title: 'Night set' }

test('command messages are whitelisted, schema-shaped and channel-bound', () => {
  const play = JSON.parse(pure.youTubeCommandMessage('playVideo'))
  assert.deepEqual(play, { event: 'command', func: 'playVideo', args: [], id: 'fluid-music', channel: 'fluid-music' })
  const seek = JSON.parse(pure.youTubeCommandMessage('seekTo', [30]))
  assert.deepEqual(seek.args, [30])
  const volume = JSON.parse(pure.youTubeCommandMessage('setVolume', [40]))
  assert.equal(volume.func, 'setVolume')
  assert.equal(pure.youTubeCommandMessage('evalScript'), null)
  assert.equal(pure.youTubeCommandMessage('loadVideoById', ['x']), null)
  assert.deepEqual(JSON.parse(pure.youTubeListeningMessage()), { event: 'listening', id: 'fluid-music', channel: 'fluid-music' })
})

test('embed frame origins are derived from the actual src, never guessed', () => {
  assert.equal(pure.embedFrameOrigin('http://127.0.0.1:43827/token/youtube/abcdefghijk?controls=1'), 'http://127.0.0.1:43827')
  assert.equal(pure.embedFrameOrigin('https://www.youtube-nocookie.com/embed/abcdefghijk?controls=1'), 'https://www.youtube-nocookie.com')
  assert.equal(pure.embedFrameOrigin('https://evil.example/embed/abcdefghijk'), 'https://evil.example')
  assert.equal(pure.embedFrameOrigin('javascript:alert(1)'), '')
  assert.equal(pure.embedFrameOrigin(''), '')
  assert.equal(pure.embedFrameOrigin(null), '')
})

test('player messages parse only valid schemas, states and the expected video', () => {
  const ready = pure.parseYouTubePlayerMessage(JSON.stringify({ event: 'onReady', id: 'fluid-music' }), VIDEO)
  assert.equal(ready.kind, 'ready')
  const state = pure.parseYouTubePlayerMessage({ event: 'infoDelivery', info: { playerState: 1, currentTime: 4, duration: 90, videoData: { video_id: VIDEO } } }, VIDEO)
  assert.deepEqual(state, { kind: 'state', videoId: VIDEO, playerState: 1, playing: true, ended: false, positionMs: 4000, durationMs: 90000 })
  const ended = pure.parseYouTubePlayerMessage({ event: 'infoDelivery', info: { playerState: 0, currentTime: 90, duration: 90, videoData: { video_id: VIDEO } } }, VIDEO)
  assert.equal(ended.ended, true)
  // Wrong video is rejected even when the schema is otherwise valid.
  assert.equal(pure.parseYouTubePlayerMessage({ event: 'infoDelivery', info: { playerState: 1, videoData: { video_id: 'lmnopqrstuv' } } }, VIDEO), null)
  // Foreign/malformed schemas never produce state.
  assert.equal(pure.parseYouTubePlayerMessage('not json', VIDEO), null)
  assert.equal(pure.parseYouTubePlayerMessage({ event: 'infoDelivery' }, VIDEO), null)
  assert.equal(pure.parseYouTubePlayerMessage({ event: 'command', func: 'playVideo' }, VIDEO), null)
  assert.equal(pure.parseYouTubePlayerMessage({ event: 'infoDelivery', info: { playerState: 99 } }, VIDEO), null)
  assert.equal(pure.parseYouTubePlayerMessage({ event: 'infoDelivery', info: { playerState: 'playing' } }, VIDEO), null)
  assert.equal(pure.parseYouTubePlayerMessage(null, VIDEO), null)
  // Without an expected video the state still parses (readiness before metadata).
  assert.equal(pure.parseYouTubePlayerMessage({ event: 'infoDelivery', info: { playerState: 2 } }, '').playing, false)
})

test('the shipped transport never posts to wildcard origins or double-sends toggles', () => {
  const transport = source.slice(source.indexOf('function YouTubeTransport('), source.indexOf('function MiniPlayer('))
  assert.ok(!transport.includes("'*'"), 'no wildcard postMessage target in the transport')
  assert.ok(!transport.includes('setTimeout'), 'no blind delayed re-send of toggle commands')
  assert.ok(transport.includes('embedFrameOrigin'), 'commands and validation use the actual frame origin')
  assert.ok(transport.includes('parseYouTubePlayerMessage'), 'incoming messages pass the schema/video contract')
  assert.ok(transport.includes('event.origin'), 'incoming origin is validated, not only event.source')
  const frame = source.slice(source.indexOf('function EmbeddedYouTubeFrame('), source.indexOf('function MiniControlBar('))
  assert.ok(!frame.includes('origin=https%3A%2F%2Fwww.youtube.com'), 'the direct fallback no longer hardcodes a foreign origin parameter')
})

test('embed state reports bind to the exact occurrence and advance completion exactly once', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.addYouTubeItem(youtubeItem, true)
    c.add({ source: 'radio', streamUrl: 'https://radio.example/live', title: 'Next' })
    await harness.flush()
    assert.equal(c.index.get(), 0)
    assert.equal(typeof c.reportYouTubeState, 'function', 'the controller exposes the embed state adapter')
    c.reportYouTubeState({ kind: 'state', videoId: VIDEO, playerState: 1, playing: true, ended: false, positionMs: 4000, durationMs: 90000 })
    assert.equal(c.status.get(), 'playing')
    assert.equal(c.youtube.get().playing, true)
    assert.deepEqual(c.progress.get(), { positionMs: 4000, durationMs: 90000 })
    // A different video's state never mutates the selected occurrence.
    c.reportYouTubeState({ kind: 'state', videoId: 'lmnopqrstuv', playerState: 0, playing: false, ended: true, positionMs: 90000, durationMs: 90000 })
    assert.equal(c.index.get(), 0)
    assert.equal(c.status.get(), 'playing')
    // Duplicate ended deliveries advance exactly once.
    const ended = { kind: 'state', videoId: VIDEO, playerState: 0, playing: false, ended: true, positionMs: 90000, durationMs: 90000 }
    c.reportYouTubeState(ended)
    c.reportYouTubeState(ended)
    await harness.flush()
    await harness.flush()
    assert.equal(c.index.get(), 1, 'exactly one completion advance')
    assert.equal(c.current().source, 'radio')
    assert.equal(c.youtube.get().playing, false, 'handoff clears the embed state')
  } finally { harness.restore() }
})

test('stale embed reports after a source change cannot mutate the newer source', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.addYouTubeItem(youtubeItem, true)
    c.add({ source: 'radio', streamUrl: 'https://radio.example/live', title: 'New source' })
    await harness.flush()
    await c.playAt(1)
    assert.equal(c.status.get(), 'playing')
    c.reportYouTubeState({ kind: 'state', videoId: VIDEO, playerState: 0, playing: false, ended: true, positionMs: 90000, durationMs: 90000 })
    c.reportYouTubeState({ kind: 'state', videoId: VIDEO, playerState: 1, playing: true, ended: false, positionMs: 1000, durationMs: 90000 })
    await harness.flush()
    assert.equal(c.current().title, 'New source')
    assert.equal(c.index.get(), 1)
    assert.equal(c.status.get(), 'playing', 'radio state is untouched by stale YouTube reports')
    assert.equal(c.progress.get().durationMs, 0)
  } finally { harness.restore() }
})
