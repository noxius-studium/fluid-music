import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-22 recovery/health/retry-bounds/data-safe-restart fixtures. Labelled
// headless doubles: controlled clock, captured intervals, fake Audio/URL and
// an in-memory backend mirror with fault injection. No real user data,
// credentials or provider calls. Live recovery UI/rendering stays FM-25.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, sourceLabel, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, shouldShowNext, isSupportedLocalAudio, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason, QUEUE_ORIGINS, queueOriginLabel, normalizeListeningSessions, makeId, isLongFormEligible, mediaKeyFor, normalizeResumePosition, normalizeBookmark, formatPositionMs, boundedSleepMinutes, SLEEP_MAX_CUSTOM_MIN, LONG_FORM_MIN_MS, SLEEP_PRESETS_MIN, retryGate, retryConsumed, normalizeHealthRow, RETRY_COOLDOWN_MS, RETRY_MAX_ATTEMPTS, HEALTH_SOURCES };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

function makeBackend() {
  const state = { resume: new Map(), bookmarks: [], nextBookmarkId: 1, history: [], retention: 0 }
  const backend = {
    state,
    shouldFail: null,
    handle(path, method, body) {
      const url = new URL(path, 'http://fixture.local')
      const route = url.pathname
      if (route === '/resume') {
        const key = url.searchParams.get('media_key') || body?.media_key
        if (method === 'GET') return { resume: state.resume.get(key) || null }
        if (method === 'PUT') { const row = { media_key: key, source: key.split(':')[0], position_ms: body.position_ms, duration_ms: body.duration_ms, updated_at: 'fixture' }; state.resume.set(key, row); return { resume: row } }
        if (method === 'DELETE') return { removed: state.resume.delete(key) }
      }
      if (route === '/bookmarks' && method === 'GET') return { items: state.bookmarks.filter(entry => entry.media_key === url.searchParams.get('media_key')) }
      if (route === '/bookmarks' && method === 'POST') { const row = { id: state.nextBookmarkId++, media_key: body.media_key, source: body.media_key.split(':')[0], position_ms: body.position_ms, label: String(body.label || '').slice(0, 120), created_at: 'fixture' }; state.bookmarks.push(row); return { bookmark: row } }
      if (route === '/history' && method === 'GET') {
        const params = url.searchParams
        let items = state.history
        const query = params.get('query')
        if (query) items = items.filter(entry => entry.item.title.toLowerCase().includes(query.toLowerCase()))
        const total = items.length
        const offset = Number(params.get('offset') || 0)
        const limit = Number(params.get('limit') || 50)
        return { items: items.slice(offset, offset + limit), total }
      }
      if (route === '/history' && method === 'POST') { const entry = { id: state.history.length + 1, played_at: '2026-11-19T12:00:00+00:00', item: body.item }; state.history.unshift(entry); return { entry } }
      if (route === '/history' && method === 'DELETE') { const removed = state.history.length; state.history = []; return { removed } }
      if (route === '/history/retention') { if (method === 'GET') return { days: state.retention }; if (method === 'PUT') { state.retention = body.days; return { days: body.days, removed: 0 } } }
      if (route === '/player') return { player: { is_playing: false, device: { name: 'Fixture device' } } }
      if (route.startsWith('/local/tracks')) return { items: [], total: 0 }
      if (route === '/local/roots') return { roots: [] }
      if (route === '/spotify/auth/status') return { auth: { logged_in: false }, setup: {}, flow: { state: 'idle', error: null } }
      return {}
    },
  }
  return backend
}

function makeHarness({ storage = new Map(), backend = makeBackend() } = {}) {
  const calls = []
  const elements = []
  const disposers = []
  const intervals = []
  const clock = { now: 1_000_000 }
  const original = {
    Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now,
    performance: Object.getOwnPropertyDescriptor(globalThis, 'performance'),
    createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL,
  }
  class FakeAudio {
    constructor() { this.listeners = new Map(); this.ended = false; this.currentTime = 0; elements.push(this) }
    addEventListener(name, handler) { this.listeners.set(name, handler) }
    pause() { this.listeners.get('pause')?.() }
    removeAttribute() {}
    load() {}
    remove() {}
    async play() { this.listeners.get('playing')?.() }
    fire(name) { this.listeners.get(name)?.() }
  }
  globalThis.Audio = FakeAudio
  globalThis.performance = { now: () => clock.now }
  globalThis.setInterval = (fn, ms) => { const handle = { fn, ms, cleared: false }; intervals.push(handle); return handle }
  globalThis.clearInterval = handle => { if (handle && typeof handle === 'object') handle.cleared = true }
  globalThis.setTimeout = () => ({})
  globalThis.clearTimeout = () => {}
  Date.now = () => clock.now
  URL.createObjectURL = () => 'blob:labelled-fm22-fixture'
  URL.revokeObjectURL = () => {}
  const ctx = {
    storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) },
    rest: async (path, options) => {
      const method = String(options?.method || 'GET').toUpperCase()
      calls.push({ path, method, body: options?.body })
      const fault = backend.shouldFail?.(path, method)
      if (fault) return { ok: false, error: fault.error || 'fixture fault', status_code: fault.status_code || 0 }
      return { ok: true, data: backend.handle(path, method, options?.body) }
    },
    os: { pickOpenPath: async () => null },
    preview: { navigate: () => {} },
    onDispose: fn => disposers.push(fn),
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', 'QUEUE_ORIGINS', 'normalizeListeningSessions', 'makeId', 'isLongFormEligible', 'mediaKeyFor', 'normalizeResumePosition', 'normalizeBookmark', 'formatPositionMs', 'boundedSleepMinutes', 'SLEEP_MAX_CUSTOM_MIN', 'retryGate', 'retryConsumed', 'normalizeHealthRow', 'RETRY_COOLDOWN_MS', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason, pure.QUEUE_ORIGINS, pure.normalizeListeningSessions, pure.makeId, pure.isLongFormEligible, pure.mediaKeyFor, pure.normalizeResumePosition, pure.normalizeBookmark, pure.formatPositionMs, pure.boundedSleepMinutes, pure.SLEEP_MAX_CUSTOM_MIN, pure.retryGate, pure.retryConsumed, pure.normalizeHealthRow, pure.RETRY_COOLDOWN_MS)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  const settle = async () => { for (let at = 0; at < 12; at += 1) await flush() }
  return {
    controller, storage, calls, elements, intervals, clock, backend, flush, settle,
    advance: ms => { clock.now += ms },
    fireTimers: () => intervals.filter(handle => !handle.cleared).forEach(handle => handle.fn()),
    dispose: () => disposers.forEach(fn => fn()),
    restore() {
      globalThis.Audio = original.Audio
      globalThis.setInterval = original.setInterval
      globalThis.clearInterval = original.clearInterval
      globalThis.setTimeout = original.setTimeout
      globalThis.clearTimeout = original.clearTimeout
      Date.now = original.dateNow
      if (original.performance) Object.defineProperty(globalThis, 'performance', original.performance)
      else delete globalThis.performance
      URL.createObjectURL = original.createObjectURL
      URL.revokeObjectURL = original.revokeObjectURL
    },
  }
}

const youtubeItem = { source: 'youtube', id: 'youtube:abcdefgh001', url: 'https://www.youtube.com/watch?v=abcdefgh001', title: 'Video', durationMs: 600000 }
const radioItem = { source: 'radio', id: 'radio:jazz', streamUrl: 'https://radio.example/jazz', title: 'Jazz Live' }
const spotifyItem = { source: 'spotify', id: 'spotify:track:x', uri: 'spotify:track:x', title: 'Track' }

test('pure: retry gate bounds and health-row normalization are deterministic', async () => {
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  await flush()
  assert.equal(pure.RETRY_MAX_ATTEMPTS, 3)
  assert.equal(pure.RETRY_COOLDOWN_MS, 30000)
  let budget = null
  const now = 100000
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const gate = pure.retryGate(budget, now)
    assert.equal(gate.allowed, true, `attempt ${attempt} allowed`)
    assert.equal(gate.attempts, attempt - 1)
    budget = pure.retryConsumed(budget, now)
  }
  assert.equal(budget.cooldownUntil, now + 30000, 'third attempt arms the cooldown')
  const blocked = pure.retryGate(budget, now + 10000)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.remainingMs, 20000)
  const reset = pure.retryGate(budget, now + 30000)
  assert.equal(reset.allowed, true, 'cooldown expiry re-opens the budget')
  assert.equal(reset.attempts, 0, 'attempts reset after cooldown')
  assert.equal(pure.normalizeHealthRow({ source: 'bogus', state: 'ready' }), null)
  assert.equal(pure.normalizeHealthRow(null), null)
  const row = pure.normalizeHealthRow({ source: 'spotify', state: 'weird', detail: 'x'.repeat(300), action: 'retry', lastEvidenceAt: 't' })
  assert.equal(row.state, 'unknown', 'unknown states never fabricate readiness')
  assert.equal(row.detail.length, 200)
  assert.deepEqual(pure.HEALTH_SOURCES, ['spotify', 'youtube', 'local', 'radio', 'backend'])
})

test('retryYouTube is bounded: three attempts, honest cooldown, then reset', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(youtubeItem)
    await c.playAt(0)
    await harness.flush()
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      assert.equal(await c.retryYouTube(), true, `attempt ${attempt} goes through`)
    }
    const token = c.youtube.get().reloadToken
    assert.equal(await c.retryYouTube(), false, 'fourth attempt is refused')
    assert.match(c.message.get(), /cooling down/)
    assert.equal(c.youtube.get().reloadToken, token, 'no reload happens during cooldown')
    assert.ok(c.logs.get().some(entry => entry.event === 'recovery.retry'), 'retry provenance is logged')
    harness.advance(30000)
    assert.equal(await c.retryYouTube(), true, 'after the cooldown the budget resets')
  } finally { harness.restore() }
})

test('retry budgets are per-source and radio/spotify retries use the shared coordinator', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(radioItem)
    await c.playAt(0)
    await harness.flush()
    assert.equal(await c.retryRadio(), true)
    assert.equal(await c.retryRadio(), true)
    assert.equal(await c.retryRadio(), true)
    assert.equal(await c.retryRadio(), false, 'radio budget exhausted independently')
    assert.equal(await c.retrySpotify(), true, 'spotify budget is separate')
    assert.ok(harness.calls.some(call => call.path === '/player'), 'spotify retry refreshes real state')
    c.add(spotifyItem)
    await c.playAt(1)
    await harness.flush()
    assert.equal(await c.retryRadio(), false, 'radio retry refuses when radio is not current')
  } finally { harness.restore() }
})

test('health reflects real evidence only: failures degrade, recovery readies, no fake all-online badge', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    assert.deepEqual(c.sourceHealth.get().backend, undefined, 'no evidence yet — never a fabricated ready')
    harness.backend.shouldFail = (path) => path.startsWith('/history') ? { error: 'fixture offline', status_code: 503 } : null
    await c.refreshHistory().catch(() => {})
    assert.equal(c.sourceHealth.get().backend.state, 'unavailable')
    assert.equal(c.sourceHealth.get().backend.action, 'retry')
    harness.backend.shouldFail = null
    await c.refreshHistory()
    assert.equal(c.sourceHealth.get().backend.state, 'ready', 'a real success restores readiness')
    // Spotify expiry classifies to reconnect, not a retry storm.
    harness.backend.shouldFail = (path) => path === '/player' ? { error: 'Authentication expired', status_code: 401 } : null
    await c.refreshSpotify()
    const spotifyRow = c.sourceHealth.get().spotify
    assert.equal(spotifyRow.state, 'unavailable')
    assert.equal(spotifyRow.action, 'reconnect')
    assert.equal(c.spotifyFailure.get().reason, 'auth-required')
    const playerCalls = harness.calls.filter(call => call.path === '/player').length
    await harness.settle()
    assert.equal(harness.calls.filter(call => call.path === '/player').length, playerCalls, 'no automatic retry loop after expiry')
    // YouTube player error and radio stream failure produce honest rows.
    harness.backend.shouldFail = null
    c.add(youtubeItem)
    await c.playAt(0)
    await harness.flush()
    c.reportYouTubeState({ kind: 'error', errorCode: 150 })
    assert.ok(['degraded', 'unavailable'].includes(c.sourceHealth.get().youtube.state))
    c.add(radioItem)
    await c.playAt(1)
    await harness.flush()
    const element = harness.elements[harness.elements.length - 1]
    element.error = { code: 2 }
    element.fire('error')
    await harness.flush()
    assert.equal(c.sourceHealth.get().radio.state, 'degraded')
    assert.match(c.sourceHealth.get().radio.detail, /network boundary/)
    assert.equal(c.sourceHealth.get().local.state, 'ready', 'library refresh produced real evidence')
  } finally { harness.restore() }
})

test('offline faults never mutate the queue or duplicate history', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(spotifyItem)
    const queueBefore = JSON.stringify(c.queue.get())
    harness.backend.shouldFail = () => ({ error: 'fixture offline', status_code: 0 })
    await c.refreshHistory().catch(() => {})
    await c.refreshSpotify().catch(() => {})
    await harness.settle()
    assert.equal(JSON.stringify(c.queue.get()), queueBefore, 'offline faults leave the queue untouched')
    assert.equal(harness.backend.state.history.length, 0, 'no history is fabricated while offline')
    assert.equal(c.sourceHealth.get().backend.state, 'unavailable')
    assert.ok(!c.message.get().includes('fixture offline') || c.message.get().length > 0)
  } finally { harness.restore() }
})

test('restart is data-safe: queue restores paused, no engine, no autoplay, no play command', async () => {
  const storage = new Map()
  const first = makeHarness({ storage })
  try {
    await first.flush()
    const c = first.controller
    c.add({ source: 'local', id: 'local:a', localTrackId: 'a', title: 'A', filePath: 'C:/Music/a.mp3', mimeType: 'audio/mpeg' })
    c.add(radioItem)
    await c.playAt(0)
    await first.flush()
    first.dispose()
  } finally { first.restore() }
  const second = makeHarness({ storage })
  try {
    await second.flush()
    const c = second.controller
    assert.equal(c.queue.get().length, 2, 'the durable queue survives restart')
    assert.equal(c.index.get(), 0)
    assert.notEqual(c.status.get(), 'playing', 'restart never auto-resumes audio')
    assert.equal(second.elements.length, 0, 'no media engine is created on startup')
    assert.ok(!second.calls.some(call => call.method === 'POST' && (call.path === '/play' || call.path === '/pause')), 'no transport command on startup')
  } finally { second.restore() }
})

test('disposal clears sleep/retry timers and late work stays inert', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add({ source: 'local', id: 'local:a', localTrackId: 'a', title: 'A', filePath: 'C:/Music/a.mp3', mimeType: 'audio/mpeg', durationMs: 3600000 })
    await c.playAt(0)
    await harness.flush()
    assert.equal(c.armSleepTimer('duration', 15), true)
    harness.dispose()
    assert.ok(harness.intervals.every(handle => handle.cleared), 'every interval is cleared on disposal')
    const queueBefore = JSON.stringify(c.queue.get())
    harness.advance(15 * 60000)
    harness.fireTimers()
    await harness.settle()
    assert.equal(JSON.stringify(c.queue.get()), queueBefore, 'late timer work after disposal is inert')
  } finally { harness.restore() }
})

test('copyDiagnostics is sanitized and evidence-based', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    harness.backend.shouldFail = (path) => path.startsWith('/history') ? { error: 'fixture offline', status_code: 503 } : null
    await c.refreshHistory().catch(() => {})
    harness.backend.shouldFail = null
    const text = c.copyDiagnostics()
    assert.match(text, /FluidMusic diagnostics \(sanitized/)
    assert.match(text, /backend: unavailable/)
    assert.match(text, /Recent events:/)
    assert.ok(!text.includes('password'), 'no credential material in diagnostics')
    assert.ok(!text.includes('blob:'), 'no session handles in diagnostics')
  } finally { harness.restore() }
})

test('UI anatomy: one quiet recovery center with bounded actions and honest empty evidence', async () => {
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  await flush()
  for (const needle of [
    'function RecoveryPage(',
    "'aria-label': 'Recovery center'",
    'No evidence yet — health updates only from real requests and playback.',
    'never a fake all-online badge',
    'Retries cool down after three attempts',
    'Retry (${cooldownFor(row.source)}s)',
    'Reconnect',
    'Rescan',
    'Copy diagnostics',
    'Open diagnostics',
    'Skipping advances the queue once; it never edits provider playlists',
    "['recovery', 'Recovery']",
    'fluid-health-row',
  ]) {
    assert.ok(source.includes(needle), `bundle contains ${needle}`)
  }
  assert.ok(/@container fluid \(max-width:580px\)\{[\s\S]*?fluid-health-row/.test(source), 'narrow rules cover health rows')
  assert.ok(source.includes('@media(prefers-reduced-motion:reduce)'), 'reduced-motion support is preserved')
  const navStart = source.indexOf('const PRIMARY_NAV')
  const navLine = source.slice(navStart, source.indexOf('\n', navStart))
  assert.ok(navLine.includes('const PRIMARY_NAV') && !navLine.includes('recovery'), 'recovery adds no new primary tab')
})
