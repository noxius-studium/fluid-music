import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-07 recovery-matrix fixtures: documented YouTube player errors, autoplay
// blocking, bridge validation failures and provider signals map to DISTINCT
// sanitized reasons/remedies. Unknown stays unknown — never a catch-all
// unavailable label, never a blind retry storm. Deterministic headless
// fixtures only; real failed-video classification is owner-side (FM-25).
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { classifyYouTubeFailure, parseYouTubePlayerMessage, clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, isSupportedLocalAudio, classifySpotifyFailure, spotifyLocalPlaybackCapability };`)()

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
  globalThis.setInterval = () => ({})
  globalThis.clearInterval = () => {}
  globalThis.setTimeout = () => ({})
  globalThis.clearTimeout = () => {}
  Date.now = () => 1_000_000
  const ctx = {
    storage: { get: (_key, fallback) => fallback, set: () => {} },
    rest: async (path, options) => { calls.push({ path, method: String(options?.method || 'GET').toUpperCase() }); return rest ? rest(path, options) : { ok: true, data: {} } },
    os: { pickOpenPath: async () => null },
    preview: {},
    onDispose: fn => disposers.push(fn),
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  return { controller, calls, flush, restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow } }
}

test('documented player errors map to distinct reasons and remediation', () => {
  const c = code => pure.classifyYouTubeFailure({ kind: 'player-error', errorCode: code })
  const two = c(2)
  assert.equal(two.reason, 'invalid-video-id')
  assert.equal(two.action, 'skip')
  assert.equal(two.retryable, false)
  const five = c(5)
  assert.equal(five.reason, 'html5-player-failure')
  assert.equal(five.retryable, true)
  assert.equal(five.fallbackEligible, true)
  const hundred = c(100)
  assert.equal(hundred.reason, 'video-not-found')
  assert.equal(hundred.contentAvailable, false)
  assert.equal(hundred.retryable, false)
  for (const code of [101, 150]) {
    const denied = c(code)
    assert.equal(denied.reason, 'embed-denied-by-owner', `${code} is an embed restriction, not a rights verdict`)
    assert.equal(denied.action, 'fallback')
    assert.equal(denied.fallbackEligible, true)
    assert.equal(denied.contentAvailable, null, 'first-party watch may still work; never guaranteed')
    assert.equal(denied.retryable, false, 'retrying the same embed is pointless')
  }
  const oneFiftyThree = c(153)
  assert.equal(oneFiftyThree.reason, 'missing-referer-identification')
  assert.equal(oneFiftyThree.action, 'fix-configuration')
  assert.notEqual(oneFiftyThree.reason, 'embed-denied-by-owner', '153 is Referer/client identification, not owner denial')
  assert.equal(oneFiftyThree.fallbackEligible, false)
})

test('autoplay blocking and bridge failures are configuration/lifecycle, not content verdicts', () => {
  const blocked = pure.classifyYouTubeFailure({ kind: 'autoplay-blocked' })
  assert.equal(blocked.reason, 'autoplay-blocked')
  assert.equal(blocked.action, 'interact')
  assert.equal(blocked.contentAvailable, null)
  const wrongVideo = pure.classifyYouTubeFailure({ kind: 'bridge', reason: 'wrong-video' })
  assert.equal(wrongVideo.reason, 'wrong-video-state')
  assert.equal(wrongVideo.action, 'retry')
  const wrongOrigin = pure.classifyYouTubeFailure({ kind: 'bridge', reason: 'wrong-origin' })
  assert.equal(wrongOrigin.action, 'fix-configuration')
  const notReady = pure.classifyYouTubeFailure({ kind: 'bridge', reason: 'not-ready' })
  assert.equal(notReady.action, 'wait')
  const stale = pure.classifyYouTubeFailure({ kind: 'bridge', reason: 'stale-generation' })
  assert.equal(stale.action, 'ignore')
})

test('provider signals stay distinct and unknown is never labelled unavailable', () => {
  const p = code => pure.classifyYouTubeFailure({ kind: 'provider', code })
  assert.equal(p('content-unavailable').contentAvailable, false)
  assert.equal(p('private-video').contentAvailable, false)
  assert.equal(p('consent-required').action, 'sign-in')
  assert.equal(p('consent-required').fallbackEligible, true)
  assert.equal(p('rate-limited').action, 'wait')
  assert.equal(p('rate-limited').retryable, true)
  assert.equal(p('network-error').action, 'retry')
  const unknown = p('undetermined')
  assert.equal(unknown.reason, 'undetermined')
  assert.equal(unknown.contentAvailable, null)
  assert.equal(unknown.retryable, false, 'no blind retry storm for unknown causes')
  assert.equal(unknown.action, 'diagnose')
  const garbage = pure.classifyYouTubeFailure({ kind: 'player-error', errorCode: 999 })
  assert.equal(garbage.reason, 'undetermined')
  assert.equal(pure.classifyYouTubeFailure(null).reason, 'undetermined')
})

test('every matrix entry carries sanitized user-facing message and remedy copy', () => {
  const signals = [
    { kind: 'player-error', errorCode: 2 }, { kind: 'player-error', errorCode: 5 },
    { kind: 'player-error', errorCode: 100 }, { kind: 'player-error', errorCode: 101 },
    { kind: 'player-error', errorCode: 150 }, { kind: 'player-error', errorCode: 153 },
    { kind: 'autoplay-blocked' }, { kind: 'bridge', reason: 'wrong-video' },
    { kind: 'bridge', reason: 'wrong-origin' }, { kind: 'bridge', reason: 'not-ready' },
    { kind: 'provider', code: 'content-unavailable' }, { kind: 'provider', code: 'private-video' },
    { kind: 'provider', code: 'consent-required' }, { kind: 'provider', code: 'rate-limited' },
    { kind: 'provider', code: 'network-error' }, { kind: 'provider', code: 'undetermined' },
  ]
  const messages = new Set()
  for (const signal of signals) {
    const entry = pure.classifyYouTubeFailure(signal)
    assert.ok(typeof entry.message === 'string' && entry.message.length > 0, JSON.stringify(signal))
    assert.ok(typeof entry.remedy === 'string' && entry.remedy.length > 0, JSON.stringify(signal))
    assert.ok(!/token|secret|127\.0\.0\.1|Traceback/i.test(entry.message + entry.remedy))
    messages.add(entry.message)
  }
  assert.ok(messages.size >= signals.length - 2, 'remediation copy is distinct per reason (101/150 share)')
})

test('the message parser surfaces onError and onAutoplayBlocked without trusting foreign shapes', () => {
  const err = pure.parseYouTubePlayerMessage({ event: 'onError', info: 150 }, 'abcdefghijk')
  assert.deepEqual(err, { kind: 'error', errorCode: 150 })
  const blocked = pure.parseYouTubePlayerMessage({ event: 'onAutoplayBlocked' }, 'abcdefghijk')
  assert.equal(blocked.kind, 'autoplay-blocked')
  assert.equal(pure.parseYouTubePlayerMessage({ event: 'onError', info: 'not-a-code' }, 'abcdefghijk'), null)
  assert.equal(pure.parseYouTubePlayerMessage({ event: 'onError' }, 'abcdefghijk'), null)
  assert.equal(pure.parseYouTubePlayerMessage({ event: 'onStateChange', info: 1 }, 'abcdefghijk'), null)
})

test('controller error reports show distinct remedies without advancing the queue or recording history', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.addYouTubeItem({ source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Night set' }, true)
    c.add({ source: 'radio', streamUrl: 'https://radio.example/live', title: 'Next' })
    await harness.flush()
    c.reportYouTubeState({ kind: 'error', errorCode: 101 })
    await harness.flush()
    assert.equal(c.index.get(), 0, 'recoverable embed errors never advance the queue')
    assert.equal(c.youtube.get().status, 'error')
    assert.equal(c.youtube.get().reason, 'embed-denied-by-owner')
    assert.match(c.message.get(), /embed/i)
    assert.equal(harness.calls.filter(call => call.path === '/history' && call.method === 'POST').length, 0)
    c.reportYouTubeState({ kind: 'autoplay-blocked' })
    assert.equal(c.youtube.get().reason, 'autoplay-blocked')
    assert.match(c.message.get(), /play/i)
    assert.equal(c.index.get(), 0)
    // Unknown player codes stay unknown — no unavailable verdict.
    c.reportYouTubeState({ kind: 'error', errorCode: 999 })
    assert.equal(c.youtube.get().reason, 'undetermined')
    assert.ok(!/unavailable|removed|private/i.test(c.message.get()))
  } finally { harness.restore() }
})

test('retry is explicit, bounded and reloads the embed; skip remains a user action', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.addYouTubeItem({ source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Night set' }, true)
    await harness.flush()
    c.reportYouTubeState({ kind: 'error', errorCode: 5 })
    const before = c.youtube.get().reloadToken || 0
    assert.equal(typeof c.retryYouTube, 'function')
    await c.retryYouTube()
    await harness.flush()
    assert.ok((c.youtube.get().reloadToken || 0) > before, 'retry forces a fresh embed load')
    assert.equal(c.index.get(), 0, 'retry stays on the same occurrence')
    assert.equal(c.youtube.get().status !== 'error' || c.youtube.get().error === '', true, 'retry clears the stale error state')
    assert.equal(harness.calls.filter(call => call.method === 'POST' && call.path === '/play').length, 0, 'no provider command storm')
  } finally { harness.restore() }
})

test('the player surface offers explicit Retry/Skip/why actions and never auto-retries', () => {
  const mini = source.slice(source.indexOf('function MiniPlayer('))
  assert.ok(/retryYouTube/.test(mini), 'Retry action wired to the bounded controller retry')
  assert.ok(/controller\.next\(\)/.test(mini), 'Skip remains an explicit user action')
  const transport = source.slice(source.indexOf('function YouTubeTransport('), source.indexOf('function MiniPlayer('))
  assert.ok(!transport.includes('setTimeout'), 'no blind delayed retry/re-send in the transport')
})
