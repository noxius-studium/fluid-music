import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-17 collections/legacy/import-export fixtures. Labelled headless controller
// doubles with in-memory storage only — no real user collections, files or
// provider data. Live Desktop collection UI remains an FM-25 review gate.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, sourceLabel, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, shouldShowNext, isSupportedLocalAudio, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason, QUEUE_ORIGINS, normalizeListeningSessions, makeId };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

function makeHarness({ storage = new Map() } = {}) {
  const calls = []
  const elements = []
  const disposers = []
  const original = { Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now }
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
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', 'QUEUE_ORIGINS', 'normalizeListeningSessions', 'makeId', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason, pure.QUEUE_ORIGINS, pure.normalizeListeningSessions, pure.makeId)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  return {
    controller, storage, calls, elements, flush,
    dispose: () => disposers.forEach(fn => fn()),
    restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow },
  }
}

const local = (id, title) => ({ source: 'local', id: `local:${id}`, localTrackId: id, title, filePath: `C:/Music/${id}.mp3`, mimeType: 'audio/mpeg' })

test('exact-occurrence reorder moves the chosen row, bounds are honest, and the queue is untouched', async () => {
  const harness = makeHarness()
  try {
    await harness.flush()
    const c = harness.controller
    const p = c.createPlaylist('Order')
    c.addManyToPlaylist(p.id, [local('a', 'A'), local('b', 'B'), local('a', 'A'), local('c', 'C')])
    c.add(local('b', 'B'))
    const queueBefore = JSON.stringify(c.queue.get())
    c.moveInPlaylist(p.id, 3, -1)
    assert.deepEqual(c.playlistItems(p.id).map(item => item.title), ['A', 'B', 'C', 'A'], 'the exact occurrence at position 3 moved, not every duplicate')
    c.moveInPlaylist(p.id, 0, -1)
    c.moveInPlaylist(p.id, 3, 1)
    c.moveInPlaylist(p.id, 1.5, -1)
    c.moveInPlaylist(p.id, 99, -1)
    assert.deepEqual(c.playlistItems(p.id).map(item => item.title), ['A', 'B', 'C', 'A'], 'out-of-bounds and non-integer moves are inert')
    assert.deepEqual(harness.storage.get('playlistState').playlists.find(entry => entry.id === p.id).items.map(item => item.title), ['A', 'B', 'C', 'A'], 'the reorder is persisted')
    assert.equal(JSON.stringify(c.queue.get()), queueBefore, 'collection edits never rewrite the listening queue')
  } finally { harness.restore() }
})

test('legacy export -> import -> re-export preserves raw unknown fields, duplicate order and root shape', async () => {
  const legacy = {
    id: 'legacy', name: 'Old mix', legacy: true, future: { nested: ['keep', { byteShape: 7 }] },
    items: [
      { source: 'spotify', uri: 'spotify:track:a', title: 'A', extra: { providerField: true } },
      { source: 'radio', streamUrl: 'https://radio.example/live', title: 'Live' },
      { source: 'spotify', uri: 'spotify:track:a', title: 'A', extra: { providerField: true } },
    ],
  }
  const initial = { version: 3, rootFuture: { keep: true }, playlists: [legacy] }
  const storage = new Map([['playlistState', structuredClone(initial)]])
  const harness = makeHarness({ storage })
  try {
    await harness.flush()
    const c = harness.controller
    const exported = c.exportPlaylists('legacy')
    assert.deepEqual(JSON.parse(exported).playlists[0], legacy, 'export emits the RAW legacy record')
    const imported = c.importPlaylists(exported)
    assert.equal(imported.length, 1)
    assert.notEqual(imported[0].id, 'legacy', 'import creates a new identity, never overwrites the original')
    const reexported = JSON.parse(c.exportPlaylists(imported[0].id)).playlists[0]
    assert.deepEqual(reexported, { ...legacy, id: imported[0].id }, 'unknown nested fields and duplicate order survive the round-trip')
    const stored = storage.get('playlistState')
    assert.deepEqual(stored.rootFuture, { keep: true }, 'unknown root fields survive unrelated writes')
    assert.deepEqual(stored.playlists[0], legacy, 'the original raw record is untouched')
    assert.deepEqual(stored.playlists[1], { ...legacy, id: imported[0].id }, 'the imported copy is stored raw as well')
    assert.equal(c.updatePlaylist(imported[0].id, { name: 'No' }), null, 'the imported legacy copy stays read-only')
    assert.equal(c.enqueuePlaylist('legacy'), 3, 'legacy play/enqueue remains available')
  } finally { harness.restore() }
})

test('session handles and capability secrets never persist; unrelated settings writes leave collections byte-identical', async () => {
  const harness = makeHarness()
  try {
    const c = harness.controller
    c.add({ ...local('a', 'Indexed'), objectUrl: 'blob:session-handle' })
    c.add({ source: 'local', title: 'Session only', objectUrl: 'blob:temporary' })
    const storedQueue = harness.storage.get('queue')
    assert.equal(storedQueue.length, 1, 'session-only local files are not durable queue references')
    assert.deepEqual(Object.keys(storedQueue[0]).sort(), ['durationMs', 'id', 'localTrackId', 'mimeType', 'source', 'subtitle', 'title', 'unavailable'], 'no objectUrl/filePath/handle keys persist')
    const before = c.queue.get().length
    assert.equal(c.add({ source: 'youtube', url: 'http://127.0.0.1:43111/youtube/abcdefghijk?token=capability-secret', title: 'Loopback' }), false, 'ephemeral loopback capability URLs are not durable media references')
    assert.equal(c.queue.get().length, before)
    assert.ok(!JSON.stringify(harness.storage.get('queue')).includes('capability-secret'))
    const p = c.createPlaylist('Safe')
    c.addToPlaylist(p.id, { ...local('a', 'Indexed'), objectUrl: 'blob:session-handle', token: 'secret', capabilityUrl: 'http://127.0.0.1/x?token=y' })
    const storedItem = harness.storage.get('playlistState').playlists.find(entry => entry.id === p.id).items[0]
    assert.deepEqual(storedItem, { source: 'local', id: 'local:a', localTrackId: 'a', title: 'Indexed', subtitle: '', mimeType: 'audio/mpeg', durationMs: 0, unavailable: false }, 'collection writes retain safe localTrackId metadata only')
    const snapshot = JSON.stringify(harness.storage.get('playlistState'))
    c.setVolume(0.3)
    c.setSpotifyAutoplay(true)
    c.setWorkspaceView('queue')
    c.toggleMute()
    await harness.flush()
    assert.equal(JSON.stringify(harness.storage.get('playlistState')), snapshot, 'unrelated settings writes never normalize or erase collections')
  } finally { harness.restore() }
})

test('unavailable tracks are skipped honestly and saved collections never change', async () => {
  const saved = {
    version: 3,
    playlists: [{
      id: 'col', name: 'Mix', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', legacy: false,
      items: [
        { source: 'local', id: 'local:a', localTrackId: 'a', title: 'A', subtitle: '', mimeType: 'audio/mpeg', durationMs: 0, unavailable: false },
        { source: 'local', id: 'local:b', localTrackId: 'b', title: 'B', subtitle: '', mimeType: 'audio/mpeg', durationMs: 0, unavailable: true },
      ],
    }],
  }
  const storage = new Map([['playlistState', structuredClone(saved)]])
  const harness = makeHarness({ storage })
  try {
    const c = harness.controller
    const snapshot = JSON.stringify(storage.get('playlistState'))
    c.add(local('a', 'A')) // registers the indexed reference in the live library registry
    assert.equal(c.enqueuePlaylist('col'), 1, 'only the available track is enqueued')
    assert.equal(c.queue.get().length, 2)
    assert.match(c.message.get(), /Skipped 1 missing track/)
    assert.equal(await c.playPlaylist('col', 1), false, 'an unavailable selection never starts playback')
    assert.match(c.message.get(), /selected local track is missing/)
    assert.equal(c.queue.get().length, 2, 'the queue is unchanged by the refused selection')
    assert.equal(await c.playPlaylist('col', 0), true)
    await harness.flush()
    assert.equal(c.current().localTrackId, 'a')
    assert.equal(c.queue.get().length, 1, 'playback rebuilds the queue from playable rows only')
    assert.match(c.message.get(), /1 missing local track\(s\) skipped\. Saved playlist unchanged\./)
    assert.equal(JSON.stringify(storage.get('playlistState')), snapshot, 'play/enqueue never rewrite saved collections')
  } finally { harness.restore() }
})
