import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-20 queue edit/undo/provenance + resumable listening sessions fixtures.
// Labelled headless controller doubles with in-memory storage only — no real
// user queues, files, sessions or provider data. Live Queue UI, keyboard
// traversal and rendered narrow layouts remain an FM-25 owner review gate.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, sourceLabel, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, shouldShowNext, isSupportedLocalAudio, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason, QUEUE_ORIGINS, queueOriginLabel, normalizeListeningSessions, makeId, isLongFormEligible, mediaKeyFor, normalizeResumePosition, normalizeBookmark, formatPositionMs, boundedSleepMinutes, SLEEP_MAX_CUSTOM_MIN, retryGate, retryConsumed, normalizeHealthRow, RETRY_COOLDOWN_MS };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

function makeHarness({ storage = new Map() } = {}) {
  const calls = []
  const elements = []
  const disposers = []
  const original = { Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
  class FakeAudio {
    constructor() { this.listeners = new Map(); this.ended = false; elements.push(this) }
    addEventListener(name, handler) { this.listeners.set(name, handler) }
    pause() { this.listeners.get('pause')?.() }
    removeAttribute() {}
    load() {}
    remove() {}
    async play() { this.listeners.get('playing')?.() }
  }
  globalThis.Audio = FakeAudio
  globalThis.setInterval = () => ({ cleared: false })
  globalThis.clearInterval = () => {}
  globalThis.setTimeout = () => ({})
  globalThis.clearTimeout = () => {}
  URL.createObjectURL = () => `blob:labelled-fm20-fixture-${elements.length}`
  URL.revokeObjectURL = () => {}
  const ctx = {
    storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) },
    rest: async (path, options) => {
      calls.push({ path, method: String(options?.method || 'GET').toUpperCase() })
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
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', 'QUEUE_ORIGINS', 'normalizeListeningSessions', 'makeId', 'isLongFormEligible', 'mediaKeyFor', 'normalizeResumePosition', 'normalizeBookmark', 'formatPositionMs', 'boundedSleepMinutes', 'SLEEP_MAX_CUSTOM_MIN', 'retryGate', 'retryConsumed', 'normalizeHealthRow', 'RETRY_COOLDOWN_MS', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason, pure.QUEUE_ORIGINS, pure.normalizeListeningSessions, pure.makeId, pure.isLongFormEligible, pure.mediaKeyFor, pure.normalizeResumePosition, pure.normalizeBookmark, pure.formatPositionMs, pure.boundedSleepMinutes, pure.SLEEP_MAX_CUSTOM_MIN, pure.retryGate, pure.retryConsumed, pure.normalizeHealthRow, pure.RETRY_COOLDOWN_MS)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  return {
    controller, storage, calls, elements, flush,
    dispose: () => disposers.forEach(fn => fn()),
    restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow; URL.createObjectURL = original.createObjectURL; URL.revokeObjectURL = original.revokeObjectURL },
  }
}

const local = (id, title) => ({ source: 'local', id: `local:${id}`, localTrackId: id, title, filePath: `C:/Music/${id}.mp3`, mimeType: 'audio/mpeg' })
const spotify = (id, title) => ({ source: 'spotify', id: `spotify:track:${id}`, uri: `spotify:track:${id}`, title })
const radio = (id, title) => ({ source: 'radio', id: `radio:${id}`, streamUrl: `https://radio.example/${id}`, title })
const sessionFile = { name: 'opened.mp3', size: 1234, type: 'audio/mpeg' }

test('pure: listening-session normalization enforces bounds, safe references and honest labels', async () => {
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  await flush()
  const unsafe = {
    id: 's1', name: 'N'.repeat(200), createdAt: '2026-11-19T00:00:00Z',
    items: [
      { source: 'local', id: 'local:a', localTrackId: 'a', title: 'A', filePath: 'C:/Music/a.mp3', objectUrl: 'blob:secret-handle', mimeType: 'audio/mpeg' },
      { source: 'local', id: 'session:only', title: 'Session only', objectUrl: 'blob:secret-handle-2' },
      { source: 'spotify', uri: 'spotify:track:x', title: 'X', capabilityUrl: 'https://signed.example/expiring' },
      ...Array.from({ length: 600 }, (_, at) => ({ source: 'radio', streamUrl: `https://radio.example/s${at}`, title: `S${at}` })),
    ],
  }
  const many = Array.from({ length: 60 }, (_, at) => ({ ...unsafe, id: `s${at}` }))
  const normalized = pure.normalizeListeningSessions(many)
  assert.equal(normalized.length, 50, 'at most 50 sessions survive')
  const first = normalized[0]
  assert.equal(first.name.length, 120, 'names are bounded')
  assert.equal(first.items.length, 500, 'at most 500 items per session survive')
  const serialized = JSON.stringify(normalized)
  for (const secret of ['blob:', 'C:/Music', 'filePath', 'objectUrl', 'capabilityUrl', 'signed.example', 'session:only']) {
    assert.ok(!serialized.includes(secret), `stored sessions never carry ${secret}`)
  }
  assert.ok(first.items.every(item => item.source !== 'local' || item.localTrackId), 'session-only local references are dropped on load')
  assert.deepEqual(pure.normalizeListeningSessions([null, 42, { items: [] }, { items: [{ source: 'local', id: 'session:x', title: 'X', objectUrl: 'blob:x' }] }]), [], 'garbage and empty/session-only entries are dropped')
  assert.equal(pure.queueOriginLabel('search'), 'From search')
  assert.equal(pure.queueOriginLabel('history'), 'From history')
  assert.equal(pure.queueOriginLabel('collection'), 'From collection')
  assert.equal(pure.queueOriginLabel('provider'), 'From provider')
  assert.equal(pure.queueOriginLabel('library'), 'From local library')
  assert.equal(pure.queueOriginLabel('session'), 'Opened this session')
  assert.equal(pure.queueOriginLabel('invented'), '', 'unknown origins render nothing, never a fabricated fact')
  assert.equal(pure.isWorkspaceView('sessions'), 'browse', 'sessions add no new primary workspace tab')
})

test('Play next inserts after the exact current occurrence without stealing selection', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(local('a', 'A'))
    c.add(local('b', 'B'))
    c.add(local('a', 'A'))
    await c.playAt(2)
    await harness.flush()
    assert.equal(c.index.get(), 2)
    assert.equal(c.addNext(local('c', 'C'), 'search'), true)
    assert.deepEqual(c.queue.get().map(item => item.title), ['A', 'B', 'A', 'C'], 'inserted directly after the current duplicate occurrence')
    assert.equal(c.index.get(), 2, 'the playing occurrence keeps its selection')
    assert.equal(c.queue.get()[3].origin, 'search', 'origin fact attached at the call site')
    assert.equal(c.addNext({ source: 'bogus' }), false, 'unsupported items are refused honestly')
    assert.equal(c.queue.get().length, 4)
    const empty = makeHarness()
    try {
      await empty.flush()
      const e = empty.controller
      assert.equal(e.addNext(spotify('z', 'Z')), true)
      assert.equal(e.index.get(), 0)
      assert.equal(e.status.get(), 'paused', 'empty-queue Play next selects but never autoplays')
    } finally { empty.restore() }
  } finally { harness.restore() }
})

test('provenance is display-only: validated at attach, never persisted or restored', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(spotify('a', 'A'), false, 'history')
    c.add(radio('r', 'R'), false, 'not-a-real-origin')
    assert.equal(c.queue.get()[0].origin, 'history')
    assert.equal(c.queue.get()[1].origin, undefined, 'invented origins are not attached')
    const stored = JSON.stringify(harness.storage.get('queue'))
    assert.ok(!stored.includes('origin'), 'queue persistence carries no display-only origin metadata')
    const reloaded = makeHarness({ storage: harness.storage })
    try {
      await reloaded.flush()
      assert.equal(reloaded.controller.queue.get()[0].origin, undefined, 'reload never fabricates provenance')
    } finally { reloaded.restore() }
  } finally { harness.restore() }
})

test('multi-select remove keeps occurrence identity, pauses honestly and undo restores exactly', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(local('a', 'A'))
    c.add(local('b', 'B'))
    c.add(local('a', 'A'))
    c.add(local('c', 'C'))
    await c.playAt(2)
    await harness.flush()
    const currentBefore = c.current()
    await c.removeQueueItems([0, 3])
    await harness.flush()
    assert.deepEqual(c.queue.get().map(item => item.title), ['B', 'A'])
    assert.equal(c.index.get(), 1, 'index shifts by the number of removed earlier rows')
    assert.equal(c.current(), currentBefore, 'the exact playing occurrence object survives')
    assert.equal(c.status.get(), 'playing', 'removing other rows never interrupts playback')
    const snapshot = JSON.stringify(c.queue.get())
    await c.toggle()
    await harness.flush()
    assert.equal(c.status.get(), 'paused')
    await c.removeQueueItems([1])
    await harness.flush()
    assert.deepEqual(c.queue.get().map(item => item.title), ['B'])
    assert.equal(c.status.get(), 'paused', 'removing the current row while paused never autoplays the successor')
    assert.equal(c.index.get(), 0)
    await c.undoQueueEdit()
    await harness.flush()
    assert.equal(JSON.stringify(c.queue.get()), snapshot, 'undo restores the exact pre-edit queue')
    assert.equal(c.index.get(), 1)
    assert.equal(c.status.get(), 'paused', 'undo never auto-resumes playback')
    assert.equal(await c.removeQueueItems([0, 1]), true)
    await harness.flush()
    assert.deepEqual(c.queue.get(), [])
    assert.equal(c.status.get(), 'idle')
    assert.equal(c.index.get(), -1)
    assert.equal(c.removeQueueItems([0]), false, 'out-of-range selections are inert')
    assert.equal(c.removeQueueItems([]), false)
  } finally { harness.restore() }
})

test('removing the current row while playing continues with the successor, and undo stops honestly', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(local('a', 'A'))
    c.add(local('b', 'B'))
    await c.playAt(0)
    await harness.flush()
    assert.equal(c.status.get(), 'playing')
    await c.removeQueueItems([0])
    await harness.flush()
    assert.equal(c.current().title, 'B')
    assert.equal(c.status.get(), 'playing', 'a playing queue continues with the successor, matching single-row remove')
    await c.undoQueueEdit()
    await harness.flush()
    assert.deepEqual(c.queue.get().map(item => item.title), ['A', 'B'])
    assert.equal(c.index.get(), 0)
    assert.equal(c.status.get(), 'paused', 'undo of a current-changing edit stops the engine and pauses')
    assert.match(c.message.get(), /Press play to resume/)
  } finally { harness.restore() }
})

test('multi-select move preserves duplicate occurrence identity and bounds are inert', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(local('a', 'A'))
    c.add(local('b', 'B'))
    c.add(local('a', 'A'))
    await c.playAt(2)
    await harness.flush()
    const currentBefore = c.current()
    assert.equal(c.moveQueueItems([2], -1), true)
    assert.deepEqual(c.queue.get().map(item => item.title), ['A', 'A', 'B'])
    assert.equal(c.current(), currentBefore, 'the exact occurrence moved, not its duplicate')
    assert.equal(c.index.get(), 1)
    assert.equal(c.moveQueueItems([0, 1], 1), true)
    assert.deepEqual(c.queue.get().map(item => item.title), ['B', 'A', 'A'])
    assert.equal(c.current(), currentBefore)
    assert.equal(c.index.get(), 2)
    const snapshot = JSON.stringify(c.queue.get())
    assert.equal(c.moveQueueItems([0], -1), false, 'moving the first row up is inert')
    assert.equal(c.moveQueueItems([2], 1), false, 'moving the last row down is inert')
    assert.equal(c.moveQueueItems([1], 2), false, 'invalid directions are inert')
    assert.equal(c.moveQueueItems([99], -1), false)
    assert.equal(JSON.stringify(c.queue.get()), snapshot)
    await c.undoQueueEdit()
    assert.deepEqual(c.queue.get().map(item => item.title), ['A', 'A', 'B'], 'undo restores the last successful move only')
  } finally { harness.restore() }
})

test('clear upcoming keeps the current item playing; clear-all and undo stay deterministic', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(local('a', 'A'))
    c.add(local('b', 'B'))
    c.add(local('c', 'C'))
    await c.playAt(1)
    await harness.flush()
    assert.equal(c.clearUpcoming(), true)
    assert.deepEqual(c.queue.get().map(item => item.title), ['A', 'B'])
    assert.equal(c.index.get(), 1)
    assert.equal(c.status.get(), 'playing', 'clear upcoming never stops the current item')
    assert.equal(c.clearUpcoming(), false, 'nothing upcoming is an honest no-op')
    await c.undoQueueEdit()
    assert.deepEqual(c.queue.get().map(item => item.title), ['A', 'B', 'C'])
    assert.equal(c.status.get(), 'playing')
    await c.clearQueue()
    await harness.flush()
    assert.deepEqual(c.queue.get(), [])
    assert.equal(c.status.get(), 'idle')
    await c.undoQueueEdit()
    await harness.flush()
    assert.deepEqual(c.queue.get().map(item => item.title), ['A', 'B', 'C'])
    assert.equal(c.index.get(), 1)
    assert.equal(c.status.get(), 'paused', 'undo of clear-all restores data paused, never auto-resumes')
  } finally { harness.restore() }
})

test('undo is exactly one step and never interrupts an unchanged current occurrence', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    c.add(local('a', 'A'))
    c.add(local('b', 'B'))
    await c.playAt(0)
    await harness.flush()
    c.add(local('c', 'C'))
    c.add(local('d', 'D'))
    assert.equal(c.queueUndo.get().label, 'Add to queue')
    await c.undoQueueEdit()
    assert.deepEqual(c.queue.get().map(item => item.title), ['A', 'B', 'C'], 'only the LAST edit is undone')
    assert.equal(c.status.get(), 'playing', 'an unchanged current occurrence keeps playing through undo')
    assert.equal(c.undoQueueEdit(), false, 'one-step undo: the previous edit is not replayed')
    assert.equal(c.queueUndo.get(), null)
  } finally { harness.restore() }
})

test('listening sessions: safe save, reload round-trip, filtered restore and delete', async () => {
  const storage = new Map()
  const harness = makeHarness({ storage })
  try {
    await harness.flush()
    const c = harness.controller
    c.add(spotify('a', 'A'))
    c.add(radio('r', 'R'))
    c.add(local('a', 'A'))
    assert.equal(c.openLocalFiles([sessionFile]), 1)
    assert.equal(c.queue.get().length, 4)
    const sessionOnlyId = c.queue.get()[3].id
    const session = c.saveListeningSession('Late night drive')
    assert.ok(session)
    assert.equal(session.items.length, 3, 'the session-only opened file is skipped')
    assert.match(c.message.get(), /1 session-only skipped/)
    const stored = JSON.stringify(storage.get('listeningSessions'))
    for (const secret of ['blob:', 'C:/Music', 'filePath', 'objectUrl', sessionOnlyId, 'hermes-media']) {
      assert.ok(!stored.includes(secret), `saved sessions never persist ${secret}`)
    }
    assert.equal(c.saveListeningSession('N'.repeat(200)).name.length, 120)
    for (let at = 0; at < 48; at += 1) c.saveListeningSession(`Bulk ${at}`)
    assert.equal(c.listeningSessions.get().length, 50, 'session storage is bounded at 50')
    assert.equal(c.deleteListeningSession('missing'), false)
    assert.equal(c.deleteListeningSession(session.id), true)
    assert.ok(!c.listeningSessions.get().some(entry => entry.id === session.id))
    c.saveListeningSession('Restore me')
    const target = c.listeningSessions.get()[0]

    // Reload in a fresh controller sharing only the storage double.
    const reloaded = makeHarness({ storage })
    try {
      await reloaded.flush()
      const r = reloaded.controller
      const loaded = r.listeningSessions.get().find(entry => entry.id === target.id)
      assert.ok(loaded, 'sessions survive a reload through the storage boundary')
      const preview = r.listeningSessionPreview(target.id)
      assert.equal(preview.rows.length, 3)
      assert.equal(preview.unavailable.length, 1, 'the unregistered local reference is previewed unavailable')
      assert.match(preview.unavailable[0].reason, /rescan/)
      const queueBefore = JSON.stringify(r.queue.get())
      assert.equal(r.restoreListeningSession('missing', 'replace'), false)
      await r.restoreListeningSession(target.id, 'replace')
      await reloaded.flush()
      assert.deepEqual(r.queue.get().map(item => item.source), ['spotify', 'radio'], 'unavailable items are filtered out of the restore')
      assert.equal(r.index.get(), 0)
      assert.equal(r.status.get(), 'paused', 'replace loads paused — no autoplay on restore')
      assert.notEqual(JSON.stringify(r.queue.get()), queueBefore)
      r.add(local('a', 'A'))
      const registered = r.listeningSessionPreview(target.id)
      assert.equal(registered.unavailable.length, 0, 'a registered local reference previews available')
      const currentIndex = r.index.get()
      const currentBefore = r.current()
      await r.restoreListeningSession(target.id, 'append')
      await reloaded.flush()
      assert.equal(r.queue.get().length, 6)
      assert.equal(r.index.get(), currentIndex, 'append keeps the current selection')
      assert.equal(r.current(), currentBefore)
      assert.equal(r.status.get(), 'paused')
    } finally { reloaded.restore() }
  } finally { harness.restore() }
})

test('restore refuses honestly when nothing is available and leaves the queue untouched', async () => {
  const storage = new Map([['listeningSessions', [{ id: 's1', name: 'All local', createdAt: '2026-11-19T00:00:00Z', items: [{ source: 'local', id: 'local:ghost', localTrackId: 'ghost', title: 'Ghost' }] }]]])
  const harness = makeHarness({ storage })
  try {
    await harness.flush()
    const c = harness.controller
    c.add(spotify('keep', 'Keep'))
    const queueBefore = JSON.stringify(c.queue.get())
    const preview = c.listeningSessionPreview('s1')
    assert.equal(preview.unavailable.length, 1)
    assert.equal(c.restoreListeningSession('s1', 'replace'), false)
    assert.equal(c.restoreListeningSession('s1', 'append'), false)
    assert.equal(JSON.stringify(c.queue.get()), queueBefore, 'a refused restore never mutates the queue')
    assert.match(c.message.get(), /Nothing in this session is currently available/)
  } finally { harness.restore() }
})

test('collection play/enqueue and opened files participate in one-step queue undo', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    const p = c.createPlaylist('Collection')
    c.addManyToPlaylist(p.id, [local('a', 'A'), local('b', 'B')])
    c.add(spotify('keep', 'Keep'))
    const before = JSON.stringify(c.queue.get())
    assert.equal(c.enqueuePlaylist(p.id), 2)
    assert.equal(c.queue.get().length, 3)
    assert.equal(c.queue.get()[1].origin, 'collection')
    await c.undoQueueEdit()
    assert.equal(JSON.stringify(c.queue.get()), before, 'undo restores the pre-enqueue queue')
    await c.playPlaylist(p.id)
    await harness.flush()
    assert.deepEqual(c.queue.get().map(item => item.title), ['A', 'B'])
    assert.equal(c.queue.get()[0].origin, 'collection')
    await c.undoQueueEdit()
    await harness.flush()
    assert.equal(JSON.stringify(c.queue.get()), before, 'undo of collection play restores the previous queue')
    assert.equal(c.status.get(), 'paused', 'undo never auto-resumes the restored queue')
    assert.equal(c.openLocalFiles([sessionFile]), 1)
    assert.equal(c.queue.get().length, 2)
    assert.equal(c.queue.get()[1].origin, 'session')
    await c.undoQueueEdit()
    assert.equal(JSON.stringify(c.queue.get()), before, 'opened files are undoable too')
  } finally { harness.restore() }
})

test('UI anatomy: contextual queue actions, confirmations and restore review exist without new primary tabs', async () => {
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  await flush()
  for (const needle of [
    'Undo: ${undo.label}',
    'Clear upcoming',
    'Save session',
    "role: 'toolbar', 'aria-label': 'Selected queue items'",
    'Move up',
    'Move down',
    'Remove selected',
    'Clear selection',
    'Listening sessions',
    'Named snapshots of safe source references and order',
    'title: \'Clear queue\'',
    'title: \'Clear upcoming\'',
    'title: \'Delete session\'',
    'title: \'Save listening session\'',
    'Append to queue',
    'Replace queue',
    'Unavailable items are skipped. Restoring loads the queue paused',
    'Play ${item.title} next',
    'fluid-queue-origin',
    'Select ${item.title} (position ${at + 1})',
    'data-selectable',
    'useEffect(() => setSelected(new Set()), [queue])',
  ]) {
    assert.ok(source.includes(needle), `bundle contains ${needle}`)
  }
  assert.ok(/@container fluid \(max-width:580px\)\{[\s\S]*?fluid-session-row/.test(source), 'narrow-container rules cover session rows')
  assert.ok(/@container fluid \(max-width:580px\)\{[\s\S]*?data-selectable=true/.test(source), 'narrow-container rules cover selectable queue rows')
  assert.ok(source.includes('@media(prefers-reduced-motion:reduce)'), 'reduced-motion support is preserved')
  const workspaceTabs = source.match(/\['browse', 'library', 'queue', 'settings'\]/g) || []
  assert.ok(workspaceTabs.length >= 1, 'the primary workspace tab set is unchanged')
  assert.ok(!source.includes("'sessions'") || !/\['browse', 'library', 'queue', 'settings', 'sessions'\]/.test(source), 'no new primary sessions tab')
})
