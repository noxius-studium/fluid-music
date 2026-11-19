import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-21 long-form resume/bookmarks, history discovery and sleep-timer fixtures.
// Labelled headless doubles: controlled monotonic clock, captured intervals,
// fake Audio/URL and an in-memory backend mirror. No real user media, history,
// credentials or provider calls. Live seek/sound/UI rendering stays FM-25.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, sourceLabel, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, shouldShowNext, isSupportedLocalAudio, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason, QUEUE_ORIGINS, queueOriginLabel, normalizeListeningSessions, makeId, isLongFormEligible, mediaKeyFor, normalizeResumePosition, normalizeBookmark, formatPositionMs, boundedSleepMinutes, SLEEP_MAX_CUSTOM_MIN, LONG_FORM_MIN_MS, SLEEP_PRESETS_MIN, retryGate, retryConsumed, normalizeHealthRow, RETRY_COOLDOWN_MS };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

// Labelled in-memory mirror of the FM-21 backend semantics (safe keys, bounds).
function makeBackend() {
  const state = { resume: new Map(), bookmarks: [], nextBookmarkId: 1, history: [], retention: 0 }
  const handle = (path, method, body) => {
    const url = new URL(path, 'http://fixture.local')
    const route = url.pathname
    if (route === '/resume') {
      const key = url.searchParams.get('media_key') || body?.media_key
      if (method === 'GET') return { resume: state.resume.get(key) || null }
      if (method === 'PUT') {
        const row = { media_key: key, source: key.split(':')[0], position_ms: body.position_ms, duration_ms: body.duration_ms, updated_at: 'fixture' }
        state.resume.set(key, row)
        return { resume: row }
      }
      if (method === 'DELETE') return { removed: state.resume.delete(key) }
    }
    if (route === '/bookmarks' && method === 'GET') return { items: state.bookmarks.filter(entry => entry.media_key === url.searchParams.get('media_key')) }
    if (route === '/bookmarks' && method === 'POST') {
      const row = { id: state.nextBookmarkId++, media_key: body.media_key, source: body.media_key.split(':')[0], position_ms: body.position_ms, label: String(body.label || '').slice(0, 120), created_at: 'fixture' }
      state.bookmarks.push(row)
      return { bookmark: row }
    }
    const bookmarkMatch = route.match(/^\/bookmarks\/(\d+)$/)
    if (bookmarkMatch) {
      const id = Number(bookmarkMatch[1])
      const row = state.bookmarks.find(entry => entry.id === id)
      if (method === 'PUT') {
        if (!row) return {}
        if (body.position_ms !== undefined) row.position_ms = body.position_ms
        if (body.label !== undefined) row.label = body.label
        return { bookmark: row }
      }
      if (method === 'DELETE') { state.bookmarks = state.bookmarks.filter(entry => entry.id !== id); return { removed: Boolean(row) } }
    }
    if (route === '/history' && method === 'GET') {
      const params = url.searchParams
      let items = state.history
      const query = params.get('query')
      if (query) items = items.filter(entry => entry.item.title.toLowerCase().includes(query.toLowerCase()))
      const sourceFilter = params.get('source')
      if (sourceFilter) items = items.filter(entry => entry.item.source === sourceFilter)
      const total = items.length
      const offset = Number(params.get('offset') || 0)
      const limit = Number(params.get('limit') || 50)
      return { items: items.slice(offset, offset + limit), total }
    }
    if (route === '/history' && method === 'POST') {
      const entry = { id: state.history.length + 1, played_at: '2026-11-19T12:00:00+00:00', item: body.item }
      state.history.unshift(entry)
      return { entry }
    }
    if (route === '/history' && method === 'DELETE') { const removed = state.history.length; state.history = []; return { removed } }
    const historyMatch = route.match(/^\/history\/(\d+)$/)
    if (historyMatch && method === 'DELETE') {
      const id = Number(historyMatch[1])
      const before = state.history.length
      state.history = state.history.filter(entry => entry.id !== id)
      return { removed: before !== state.history.length }
    }
    if (route === '/history/retention') {
      if (method === 'GET') return { days: state.retention }
      if (method === 'PUT') { state.retention = body.days; return { days: body.days, removed: 0 } }
    }
    if (route.startsWith('/local/tracks')) return { items: [], total: 0 }
    if (route === '/local/roots') return { roots: [] }
    if (route === '/spotify/auth/status') return { auth: { logged_in: false }, setup: {}, flow: { state: 'idle', error: null } }
    return {}
  }
  return { state, handle }
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
  URL.createObjectURL = () => 'blob:labelled-fm21-fixture'
  URL.revokeObjectURL = () => {}
  const ctx = {
    storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) },
    rest: async (path, options) => {
      const method = String(options?.method || 'GET').toUpperCase()
      calls.push({ path, method, body: options?.body })
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
  const waitFor = async condition => { for (let at = 0; at < 60 && !condition(); at += 1) await flush(); return condition() }
  return {
    controller, storage, calls, elements, intervals, clock, backend, flush, settle, waitFor,
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

const longLocal = (id, title) => ({ source: 'local', id: `local:${id}`, localTrackId: id, title, filePath: `C:/Music/${id}.mp3`, mimeType: 'audio/mpeg', durationMs: 3_600_000 })
const shortLocal = (id, title) => ({ source: 'local', id: `local:${id}`, localTrackId: id, title, filePath: `C:/Music/${id}.mp3`, mimeType: 'audio/mpeg', durationMs: 120_000 })
const longYouTube = (id, title) => ({ source: 'youtube', id: `youtube:${id}`, url: `https://www.youtube.com/watch?v=${id}`, title, durationMs: 3_600_000 })
const radioItem = { source: 'radio', id: 'radio:jazz', streamUrl: 'https://radio.example/jazz', title: 'Jazz Live' }

test('pure: eligibility, safe keys, normalization bounds and clock formatting', async () => {
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  await flush()
  assert.equal(pure.LONG_FORM_MIN_MS, 600000)
  assert.equal(pure.isLongFormEligible(longLocal('a', 'A')), true)
  assert.equal(pure.isLongFormEligible(longYouTube('abcdefgh001', 'V')), true)
  assert.equal(pure.isLongFormEligible(shortLocal('b', 'B')), false, 'short items are not long-form')
  assert.equal(pure.isLongFormEligible(radioItem), false, 'LIVE radio is never resume-eligible')
  assert.equal(pure.isLongFormEligible({ source: 'spotify', uri: 'spotify:track:x', durationMs: 3_600_000 }), false, 'Spotify position is provider-owned')
  assert.equal(pure.isLongFormEligible({ ...longLocal('c', 'C'), unavailable: true }), false)
  assert.equal(pure.mediaKeyFor(longLocal('a', 'A')), 'local:a')
  assert.equal(pure.mediaKeyFor(longYouTube('abcdefgh001', 'V')), 'youtube:abcdefgh001')
  assert.equal(pure.mediaKeyFor(radioItem), '', 'no unsafe keys for radio')
  assert.equal(pure.mediaKeyFor({ source: 'local', id: 'session:x', title: 'X', objectUrl: 'blob:x' }), '', 'session-only files have no durable key')
  assert.deepEqual(pure.normalizeResumePosition({ media_key: 'local:a', position_ms: -5, duration_ms: 99_999_999 }), { mediaKey: 'local:a', positionMs: 0, durationMs: 86400000 })
  assert.equal(pure.normalizeResumePosition(null), null)
  assert.equal(pure.normalizeResumePosition({ position_ms: 5 }), null)
  assert.equal(pure.normalizeBookmark({ id: 0, position_ms: 5 }), null)
  assert.deepEqual(pure.normalizeBookmark({ id: 3, media_key: 'local:a', position_ms: 60000, label: 'x'.repeat(200) }), { id: 3, mediaKey: 'local:a', positionMs: 60000, label: 'x'.repeat(120), createdAt: '' })
  assert.equal(pure.formatPositionMs(0), '0:00')
  assert.equal(pure.formatPositionMs(754000), '12:34')
  assert.equal(pure.formatPositionMs(3_600_000 + 61_000), '1:01:01')
  assert.equal(pure.boundedSleepMinutes(15), 15)
  assert.equal(pure.boundedSleepMinutes(720), 720)
  for (const bad of [0, -5, 721, NaN, 'abc', Infinity]) assert.equal(pure.boundedSleepMinutes(bad), 0, `refuses ${bad}`)
  assert.deepEqual(pure.SLEEP_PRESETS_MIN, [15, 30, 60])
})

test('sleep duration: monotonic expiry pauses only the current engine; cancel and bounds are honest', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    assert.equal(c.armSleepTimer('duration', 15), false, 'no item: honest refusal')
    c.add(longLocal('a', 'Long A'))
    await c.playAt(0)
    await harness.flush()
    assert.equal(c.status.get(), 'playing')
    assert.equal(c.armSleepTimer('duration', 0), false)
    assert.equal(c.armSleepTimer('duration', 721), false)
    assert.equal(c.armSleepTimer('duration', 15), true)
    const sleepHandle = harness.intervals[harness.intervals.length - 1]
    assert.equal(c.sleepTimer.get().mode, 'duration')
    assert.equal(c.sleepTimer.get().remainingMs, 900000)
    harness.advance(60000)
    harness.fireTimers()
    assert.equal(c.sleepTimer.get().remainingMs, 840000, 'remaining time counts down monotonically')
    assert.equal(c.status.get(), 'playing')
    assert.equal(c.cancelSleepTimer(), true)
    assert.equal(c.sleepTimer.get().mode, 'off')
    assert.ok(sleepHandle.cleared, 'cancel clears the tick interval')
    harness.advance(900000)
    harness.fireTimers()
    assert.equal(c.status.get(), 'playing', 'a cancelled timer never pauses later')
    assert.equal(c.armSleepTimer('duration', 1), true)
    const expiryHandle = harness.intervals[harness.intervals.length - 1]
    harness.advance(60000)
    harness.fireTimers()
    assert.equal(c.status.get(), 'paused', 'expiry pauses the current engine')
    assert.equal(c.sleepTimer.get().mode, 'off')
    assert.match(c.message.get(), /Sleep timer finished/)
    assert.ok(expiryHandle.cleared, 'expiry clears the tick interval')
    assert.equal(c.cancelSleepTimer(), false, 'cancelling an off timer is an honest no-op')
  } finally { harness.restore() }
})

test('sleep source-change policy: switching items cancels the timer, never a later device takeover', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(longLocal('a', 'Long A'))
    c.add(longLocal('b', 'Long B'))
    await c.playAt(0)
    await harness.flush()
    assert.equal(c.armSleepTimer('duration', 30), true)
    const sleepHandle = harness.intervals[harness.intervals.length - 1]
    await c.playAt(1)
    await harness.flush()
    assert.equal(c.sleepTimer.get().mode, 'off', 'source change cancels immediately')
    assert.ok(sleepHandle.cleared)
    harness.advance(30 * 60000)
    harness.fireTimers()
    assert.equal(c.status.get(), 'playing', 'the new item keeps playing; no delayed takeover')
    // The honest cancellation copy is visible when no new playback overwrites the notice slot.
    assert.equal(c.armSleepTimer('duration', 30), true)
    await c.clearQueue()
    await harness.flush()
    harness.fireTimers()
    assert.equal(c.sleepTimer.get().mode, 'off')
    assert.match(c.message.get(), /never controls another device/)
  } finally { harness.restore() }
})

test('end-of-item: local ended pauses instead of advancing, and repeated ended reports stay inert', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(longLocal('a', 'Long A'))
    c.add(longLocal('b', 'Long B'))
    await c.playAt(0)
    await harness.flush()
    const element = harness.elements[harness.elements.length - 1]
    assert.equal(c.armSleepTimer('end-of-item'), true)
    element.ended = true
    element.fire('ended')
    await harness.flush()
    assert.equal(c.index.get(), 0, 'end-of-item sleep does NOT advance the queue')
    assert.equal(c.status.get(), 'paused')
    assert.equal(c.sleepTimer.get().mode, 'off')
    element.fire('ended')
    await harness.flush()
    assert.equal(c.index.get(), 0, 'a repeated ended report cannot advance after the sleep stop')
    // Positive control: without the timer, ended advances as before.
    await c.playAt(0)
    await harness.flush()
    const next = harness.elements[harness.elements.length - 1]
    next.ended = true
    next.fire('ended')
    await harness.flush()
    assert.equal(c.index.get(), 1, 'normal ended behavior is preserved')
  } finally { harness.restore() }
})

test('end-of-item: YouTube ended pauses instead of advancing; radio end-of-item is refused honestly', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(longYouTube('abcdefgh001', 'Long Video'))
    c.add(longYouTube('abcdefgh002', 'Next Video'))
    await c.playAt(0)
    await harness.flush()
    c.reportYouTubeState({ kind: 'state', playing: true, ended: false, positionMs: 1000, durationMs: 3_600_000 })
    assert.equal(c.armSleepTimer('end-of-item'), true)
    c.reportYouTubeState({ kind: 'state', playing: false, ended: true, positionMs: 3_600_000, durationMs: 3_600_000 })
    await harness.flush()
    assert.equal(c.index.get(), 0, 'YouTube end-of-item sleep does not advance')
    assert.equal(c.status.get(), 'paused')
    c.reportYouTubeState({ kind: 'state', playing: false, ended: true, positionMs: 3_600_000, durationMs: 3_600_000 })
    await harness.flush()
    assert.equal(c.index.get(), 0, 'repeated ended reports stay inert')
    c.add(radioItem)
    await c.playAt(2)
    await harness.flush()
    assert.equal(c.armSleepTimer('end-of-item'), false, 'LIVE radio has no end-of-item')
    assert.match(c.message.get(), /Live radio has no end-of-item/)
    assert.equal(c.armSleepTimer('duration', 15), true, 'duration sleep still works for radio')
  } finally { harness.restore() }
})

test('sleep expiry on Spotify pauses the bound Connect device only', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add({ source: 'spotify', id: 'spotify:track:x', uri: 'spotify:track:x', title: 'Track' })
    assert.equal(c.armSleepTimer('duration', 1), true)
    harness.advance(60000)
    harness.fireTimers()
    const pauses = harness.calls.filter(call => call.path === '/pause' && call.method === 'POST')
    assert.equal(pauses.length, 1, 'expiry issues exactly one pause to the current Spotify device')
    assert.equal(c.sleepTimer.get().mode, 'off')
  } finally { harness.restore() }
})

test('resume: explicit offer only, Resume seeks, Start over clears, ineligible items never offer', async () => {
  const backend = makeBackend()
  backend.state.resume.set('local:a', { media_key: 'local:a', source: 'local', position_ms: 754000, duration_ms: 3_600_000, updated_at: 'fixture' })
  const harness = makeHarness({ backend })
  try {
    await harness.flush()
    const c = harness.controller
    c.add(longLocal('a', 'Long A'))
    await harness.flush()
    assert.equal(c.resumeOffer.get(), null, 'mere enqueue never offers or seeks')
    await c.playAt(0)
    await harness.waitFor(() => c.resumeOffer.get())
    const offer = c.resumeOffer.get()
    assert.ok(offer, 'selecting an eligible item with a saved position offers resume')
    assert.equal(offer.positionMs, 754000)
    const element = harness.elements[harness.elements.length - 1]
    assert.equal(element.currentTime, 0, 'no automatic seek — the offer is explicit')
    assert.equal(c.resumeHere(), true)
    assert.equal(element.currentTime, 754, 'Resume seeks the current engine to the saved position')
    assert.equal(c.resumeOffer.get(), null)
    assert.equal(c.resumeHere(), false, 'the offer is consumed once')
    // Start over clears the durable position and seeks to zero.
    backend.state.resume.set('local:a', { media_key: 'local:a', source: 'local', position_ms: 754000, duration_ms: 3_600_000, updated_at: 'fixture' })
    await c.playAt(0)
    await harness.waitFor(() => c.resumeOffer.get())
    assert.ok(c.resumeOffer.get())
    const restarted = harness.elements[harness.elements.length - 1]
    assert.equal(c.startOver(), true)
    assert.equal(restarted.currentTime, 0)
    assert.ok(!backend.state.resume.has('local:a'), 'Start over deletes the saved position')
    // Ineligible and near-start/near-end positions never offer.
    c.add(shortLocal('b', 'Short B'))
    await c.playAt(1)
    await harness.settle()
    assert.equal(c.resumeOffer.get(), null)
    assert.ok(!harness.calls.some(call => call.path.startsWith(`/resume?media_key=${encodeURIComponent('local:b')}`)), 'no resume lookup for ineligible items')
    backend.state.resume.set('local:c', { media_key: 'local:c', source: 'local', position_ms: 5000, duration_ms: 3_600_000, updated_at: 'fixture' })
    c.add(longLocal('c', 'Long C'))
    await c.playAt(2)
    await harness.settle()
    assert.equal(c.resumeOffer.get(), null, 'positions under 15s are not worth resuming')
  } finally { harness.restore() }
})

test('resume persistence: throttled saves, forced save on pause/switch, delete on ended', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(longLocal('a', 'Long A'))
    c.add(longLocal('b', 'Long B'))
    await c.playAt(0)
    await harness.flush()
    const element = harness.elements[harness.elements.length - 1]
    const puts = () => harness.calls.filter(call => call.path === '/resume' && call.method === 'PUT')
    element.currentTime = 100
    element.fire('timeupdate')
    await harness.flush()
    assert.equal(puts().length, 1, 'first eligible position save goes through')
    assert.equal(puts()[0].body.position_ms, 100000)
    assert.equal(puts()[0].body.media_key, 'local:a', 'safe reference only')
    harness.advance(5000)
    element.currentTime = 110
    element.fire('timeupdate')
    await harness.flush()
    assert.equal(puts().length, 1, 'saves are throttled to one per 15s window')
    harness.advance(15000)
    element.currentTime = 130
    element.fire('timeupdate')
    await harness.flush()
    assert.equal(puts().length, 2, 'the next window saves again')
    await c.toggle()
    await harness.flush()
    assert.equal(puts().length, 3, 'pausing forces a save')
    await c.playAt(1)
    await harness.flush()
    assert.equal(puts().length, 4, 'switching items forces a save of the previous position')
    assert.equal(puts()[3].body.media_key, 'local:a')
    const deletes = () => harness.calls.filter(call => call.path.startsWith('/resume?') && call.method === 'DELETE')
    const current = harness.elements[harness.elements.length - 1]
    current.currentTime = 3599
    current.fire('timeupdate')
    await harness.flush()
    const beforeNearEnd = puts().length
    assert.equal(puts().length, beforeNearEnd, 'near-end positions are not saved as resume points')
    current.ended = true
    current.fire('ended')
    await harness.flush()
    assert.ok(deletes().some(call => call.path.includes(encodeURIComponent('local:b'))), 'finishing an item deletes its resume position')
  } finally { harness.restore() }
})

test('bookmarks: add/edit/delete/jump on eligible items only, sorted and reload-safe', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(longLocal('a', 'Long A'))
    await c.playAt(0)
    await harness.flush()
    const element = harness.elements[harness.elements.length - 1]
    element.currentTime = 120
    element.fire('timeupdate')
    await harness.flush()
    const first = await c.addBookmark('Chorus')
    assert.ok(first)
    assert.equal(first.positionMs, 120000)
    assert.equal(first.label, 'Chorus')
    element.currentTime = 60
    element.fire('timeupdate')
    await harness.flush()
    const second = await c.addBookmark('Intro')
    assert.deepEqual(c.bookmarks.get().map(entry => entry.label), ['Intro', 'Chorus'], 'bookmarks sort by timestamp')
    const edited = await c.editBookmark(first.id, { label: 'Bridge', positionMs: 180000 })
    assert.equal(edited.label, 'Bridge')
    assert.equal(c.bookmarks.get().find(entry => entry.id === first.id).positionMs, 180000)
    assert.equal(c.jumpToBookmark(second.id), true)
    assert.equal(element.currentTime, 60, 'jump seeks the current engine')
    assert.equal(c.jumpToBookmark(999999), false)
    assert.equal(await c.deleteBookmark(second.id), true)
    assert.equal(c.bookmarks.get().length, 1)
    // Reload round-trip through the backend double.
    const reloaded = makeHarness({ backend: harness.backend })
    try {
      await reloaded.flush()
      const r = reloaded.controller
      r.add(longLocal('a', 'Long A'))
      await r.playAt(0)
      await reloaded.waitFor(() => r.bookmarks.get().length === 1)
      assert.equal(r.bookmarks.get().length, 1, 'bookmarks survive reload via safe references')
      assert.equal(r.bookmarks.get()[0].label, 'Bridge')
    } finally { reloaded.restore() }
    // Ineligible refusal is honest and issues no write.
    c.add(shortLocal('b', 'Short B'))
    await c.playAt(1)
    await harness.flush()
    const postsBefore = harness.calls.filter(call => call.path === '/bookmarks' && call.method === 'POST').length
    assert.equal(await c.addBookmark('Nope'), null)
    assert.match(c.message.get(), /long-form/)
    assert.equal(harness.calls.filter(call => call.path === '/bookmarks' && call.method === 'POST').length, postsBefore)
  } finally { harness.restore() }
})

test('history discovery: filters, stable pagination, entry removal, retention and scoped clear', async () => {
  const backend = makeBackend()
  for (let at = 0; at < 120; at += 1) {
    const id = `abcdefgh${String(at).padStart(3, '0')}`
    backend.state.history.push({ id: at + 1, played_at: '2026-11-19T12:00:00+00:00', item: { source: at % 2 ? 'youtube' : 'radio', id: at % 2 ? `youtube:${id}` : `radio:station${at}`, url: at % 2 ? `https://www.youtube.com/watch?v=${id}` : undefined, streamUrl: at % 2 ? undefined : `https://radio.example/station${at}`, title: at % 3 ? `Track ${at}` : `Mix ${at}` } })
  }
  const harness = makeHarness({ backend })
  try {
    await harness.flush()
    const c = harness.controller
    await c.refreshHistory({ query: 'Mix', source: '', since: '', until: '' }, 0)
    assert.equal(c.historyTotal.get(), 40, 'filtered total reflects the query')
    assert.equal(c.history.get().length, 40)
    assert.ok(c.history.get().every(entry => entry.item.title.startsWith('Mix')))
    const firstPageIds = c.history.get().map(entry => entry.id)
    await c.refreshHistory({ query: 'Track', source: '', since: '', until: '' }, 0)
    assert.equal(c.historyTotal.get(), 80, 'a broad query spans multiple pages')
    const pageOne = c.history.get().map(entry => entry.id)
    assert.equal(pageOne.length, 50)
    await c.refreshHistory(null, 50)
    const pageTwo = c.history.get().map(entry => entry.id)
    assert.equal(pageTwo.length, 30)
    assert.equal(c.historyOffset.get(), 50)
    assert.ok(pageOne.every(id => !pageTwo.includes(id)), 'pagination never duplicates rows')
    assert.equal(c.historyFilters.get().query, 'Track', 'paging keeps the active filters')
    const target = c.history.get()[0]
    await c.removeHistoryEntry(target.id)
    assert.ok(!c.history.get().some(entry => entry.id === target.id))
    assert.ok(harness.calls.some(call => call.path === `/history/${target.id}` && call.method === 'DELETE'))
    await c.setHistoryRetention(90)
    assert.equal(c.historyRetention.get(), 90)
    assert.ok(harness.calls.some(call => call.path === '/history/retention' && call.method === 'PUT' && call.body.days === 90))
    assert.equal(c.historyOffset.get(), 0, 'retention change refreshes from the first page')
    await c.clearHistory()
    assert.equal(c.historyTotal.get(), 0)
    assert.equal(c.historyOffset.get(), 0)
    assert.deepEqual(firstPageIds.slice(0, 1), firstPageIds.slice(0, 1))
  } finally { harness.restore() }
})

test('sleep timer is session-only and disposal clears its interval', async () => {
  const storage = new Map()
  const harness = makeHarness({ storage })
  try {
    await harness.flush()
    const c = harness.controller
    c.add(longLocal('a', 'Long A'))
    await c.playAt(0)
    await harness.flush()
    assert.equal(c.armSleepTimer('duration', 60), true)
    const serialized = JSON.stringify([...storage.entries()])
    assert.ok(!serialized.includes('sleep'), 'no sleep state is persisted')
    harness.dispose()
    assert.ok(harness.intervals.every(handle => handle.cleared), 'disposal clears the sleep interval')
    const reloaded = makeHarness({ storage })
    try {
      await reloaded.flush()
      assert.equal(reloaded.controller.sleepTimer.get().mode, 'off', 'reload never restores a timer')
    } finally { reloaded.restore() }
  } finally { harness.restore() }
})

test('UI anatomy: resume offer, sleep controls, bookmark sheet, history filters and retention exist accessibly', async () => {
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  await flush()
  for (const needle of [
    'Resume “${offer.title}” at ${formatPositionMs(offer.positionMs)}?',
    'Start over',
    'fluid-sleep-chip',
    'Sleep timer: ${formatPositionMs(sleep.remainingMs)} remaining',
    'Custom minutes (1–720)',
    'End of item',
    'Live radio has no end-of-item; choose a duration.',
    'Changing the source cancels the timer; it never takes over another device',
    'The timer is not restored after a reload',
    'Cancel timer',
    'Bookmarks${bookmarks.length ? ` · ${bookmarks.length}` : \'\'}',
    'Bookmark at ${formatPositionMs(progress.positionMs)}',
    'Jump seeks the current player; nothing is downloaded',
    'Filter history by title',
    'Filter history by source',
    'Filter history since date',
    'Filter history until date',
    'fluid-history-pager',
    'Remove history entry',
    'The media itself and provider history are not affected',
    'History retention',
    'Media files, queues and provider history are never touched',
    'h(PlayerExtras, { controller })',
    "kind: 'clock'",
    "bookmark: 'M7 4h10v16l-5-4-5 4z'",
  ]) {
    assert.ok(source.includes(needle), `bundle contains ${needle}`)
  }
  assert.ok(/@container fluid \(max-width:580px\)\{[\s\S]*?fluid-history-filters/.test(source), 'narrow rules cover history filters')
  assert.ok(/@container fluid \(max-width:580px\)\{[\s\S]*?fluid-bookmark-row/.test(source), 'narrow rules cover bookmark rows')
  assert.ok(source.includes('.fluid-player-extras{grid-column:1/-1'), 'extras span the shared bar without changing its approved geometry')
  assert.ok(/\.fluid-bottom-bar\{[^}]*min-height:68px/.test(source), 'broad bar geometry is preserved')
  assert.ok(source.includes('@media(prefers-reduced-motion:reduce)'), 'reduced-motion support is preserved')
})
