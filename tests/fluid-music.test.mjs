import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}

// These are exact shipped source regions. Disk plugins load through blob URLs, so
// evaluating the marked factory avoids a divergent Node-only implementation.
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, sourceLabel, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, shouldShowNext, isSupportedLocalAudio, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason, QUEUE_ORIGINS, normalizeListeningSessions, makeId };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

function makeAudioHarness({ analysisFails = false, events = [] } = {}) {
  const elements = []
  class FakeAudio {
    constructor() { this.listeners = new Map(); this.ended = false; elements.push(this) }
    addEventListener(name, handler) { this.listeners.set(name, handler) }
    pause() { events.push('audio:pause'); this.listeners.get('pause')?.() }
    removeAttribute(name) { events.push(`audio:remove:${name}`) }
    load() { events.push('audio:load') }
    remove() { this.removed = true; events.push('audio:remove-element') }
    async play() { events.push('audio:play'); this.listeners.get('playing')?.() }
  }
  class FakeAudioContext {
    constructor() { this.state = 'suspended' }
    createAnalyser() { return { kind: 'analyser', fftSize: 8, connect() {}, disconnect() {}, getByteTimeDomainData(data) { data.fill(128) } } }
    createGain() { return { kind: 'gain', gain: { value: 0, setTargetAtTime(value) { this.value = value; events.push('gain:ramp') }, cancelAndHoldAtTime() {} }, connect() {}, disconnect() {} } }
    createMediaElementSource() {
      if (analysisFails) throw new Error('CORS analysis unavailable')
      return { connect(node) { events.push(`source:connect:${node?.kind}`) }, disconnect(node) { events.push(`source:disconnect:${node?.kind || 'all'}`) } }
    }
    async resume() { this.state = 'running' }
    async suspend() { this.state = 'suspended' }
    async close() { this.state = 'closed' }
  }
  return { FakeAudio, FakeAudioContext, elements }
}

function makeController({ rest, preview, audio = makeAudioHarness(), timers = [], storage = new Map(), clock = { now: 0 } } = {}) {
  const disposers = []
  const original = { Audio: globalThis.Audio, AudioContext: globalThis.AudioContext, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now }
  globalThis.Audio = audio.FakeAudio
  globalThis.AudioContext = audio.FakeAudioContext
  globalThis.setInterval = (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer }
  globalThis.clearInterval = timer => { if (timer) timer.cleared = true }
  globalThis.setTimeout = (fn, ms) => ({ fn, ms })
  globalThis.clearTimeout = () => {}
  Date.now = () => clock.now
  const ctx = {
    storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) },
    rest: rest || (async path => path === '/config' ? { ok: true, data: { poll_interval_open: 8, poll_interval_closed: 20 } } : path === '/local/roots' ? { ok: true, data: { roots: [] } } : path.startsWith('/local/tracks') ? { ok: true, data: { items: [], total: 0 } } : { ok: true, data: { is_playing: false } }),
    os: { pickOpenPath: async () => null },
    preview,
    onDispose: fn => disposers.push(fn)
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', 'QUEUE_ORIGINS', 'normalizeListeningSessions', 'makeId', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason, pure.QUEUE_ORIGINS, pure.normalizeListeningSessions, pure.makeId)
  const controller = factory(ctx)
  return { controller, ctx, audio, timers, storage, clock, restore() { disposers.forEach(fn => fn()); globalThis.Audio = original.Audio; globalThis.AudioContext = original.AudioContext; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow } }
}

test('clearing the queue pauses Spotify and cancels pending playback', async () => {
  const calls = []
  const harness = makeController({ rest: async (path, options) => { calls.push({ path, options }); return { ok: true, data: {} } } })
  try {
    harness.controller.add({ source: 'spotify', uri: 'spotify:track:one', title: 'One' })
    await harness.controller.playAt(0)
    calls.length = 0
    await harness.controller.clearQueue()
    assert.ok(calls.some(call => call.path === '/pause'))
    assert.equal(harness.controller.current(), null)
    assert.deepEqual(harness.controller.progress.get(), { positionMs: 0, durationMs: 0 })
  } finally { harness.restore() }
})

test('removing a different queue row must not invalidate the active radio events', async () => {
  const harness = makeController()
  try {
    harness.controller.add({ source: 'radio', title: 'Live', streamUrl: 'https://radio.example/live' })
    harness.controller.add({ source: 'spotify', uri: 'spotify:track:one' })
    await harness.controller.playAt(0)
    await harness.controller.remove(1)
    harness.audio.elements.at(-1).listeners.get('pause')()
    assert.equal(harness.controller.status.get(), 'paused')
  } finally { harness.restore() }
})

test('empty or unavailable playlists never destroy the listening queue', async () => {
  const harness = makeController()
  try {
    harness.controller.add({ source: 'radio', title: 'Keep me', streamUrl: 'https://radio.example/live' })
    await harness.controller.playAt(0)
    const playlist = harness.controller.createPlaylist('Empty')
    assert.equal(await harness.controller.playPlaylist(playlist.id), false)
    assert.equal(harness.controller.current()?.title, 'Keep me')
    assert.equal(harness.controller.status.get(), 'playing')
  } finally { harness.restore() }
})

test('Spotify resume must not send a new track or context selection', async () => {
  const calls = []
  const harness = makeController({ rest: async (path, options) => { calls.push({ path, options }); return { ok: true, data: path === '/player' ? { is_playing: false, item: { uri: 'spotify:track:one' } } : {} } } })
  try {
    harness.controller.add({ source: 'spotify', uri: 'spotify:track:one' })
    await harness.controller.playAt(0)
    await harness.controller.toggle()
    assert.deepEqual(calls.filter(call => call.path === '/play').at(-1).options.body, {})
  } finally { harness.restore() }
})

test('radio uses the requested volume directly', async () => {
  const harness = makeController()
  try {
    harness.controller.setVolume(0.5)
    harness.controller.add({ source: 'radio', streamUrl: 'https://radio.example/live' })
    await harness.controller.playAt(0)
    assert.equal(harness.audio.elements.at(-1).volume, 0.5)
  } finally { harness.restore() }
})

test('playlist bulk editing, deduplication, export/import and undo preserve saved data', async () => {
  const harness = makeController()
  try {
    const c = harness.controller, p = c.createPlaylist('Collection')
    const a = { source: 'local', title: 'A', id: 'local:a', localTrackId: 'a' }, b = { source: 'local', title: 'B', id: 'local:b', localTrackId: 'b' }
    assert.equal(c.addManyToPlaylist(p.id, [a, b, a]), 3)
    assert.equal(c.deduplicatePlaylist(p.id), 1)
    assert.deepEqual(c.playlistItems(p.id).map(item => item.title), ['A', 'B'])
    assert.equal(c.undoPlaylistEdit(), true)
    assert.equal(c.playlistItems(p.id).length, 3)
    c.removePlaylistItems(p.id, [1])
    assert.deepEqual(c.playlistItems(p.id).map(item => item.title), ['A', 'A'])
    c.undoPlaylistEdit()
    const imported = c.importPlaylists(c.exportPlaylists(p.id))
    assert.notEqual(imported[0].id, p.id)
    assert.equal(imported[0].items.length, 3)
    assert.equal(c.playlists.get().length, 2)
    const before = c.exportPlaylists()
    assert.throws(() => c.importPlaylists('{bad'), /valid JSON/)
    assert.throws(() => c.importPlaylists(JSON.stringify({ format: 'fluid-music', playlists: [{ name: 'Invalid', items: [{ source: 'radio', streamUrl: 'http://localhost/x' }] }] })), /Nothing was imported/)
    assert.equal(c.exportPlaylists(), before)
    c.deletePlaylist(p.id); c.undoPlaylistEdit()
    assert.equal(c.playlistItems(p.id).length, 3)
  } finally { harness.restore() }
})

test('enqueue and play-from-occurrence preserve duplicates and leave playlist order intact', async () => {
  const harness = makeController()
  try {
    const c = harness.controller, p = c.createPlaylist('Duplicates')
    const item = { source: 'local', title: 'Track', id: 'local:track', localTrackId: 'track', filePath: 'C:/Music/track.mp3' }
    c.addManyToPlaylist(p.id, [item, item, item])
    c.add(item)
    assert.equal(c.enqueuePlaylist(p.id), 3)
    assert.equal(c.queue.get().length, 4)
    await c.playPlaylist(p.id, 2)
    assert.equal(c.index.get(), 2)
    assert.equal(c.playlistItems(p.id).length, 3)
    const saved = c.saveQueueAsPlaylist('Session')
    assert.equal(saved.items.length, 3)
  } finally { harness.restore() }
})

test('a pending playlist cannot resurrect playback after a later clear', async () => {
  let finishPause, defer = false
  const harness = makeController({ rest: async path => {
    if (path === '/pause' && defer) { defer = false; await new Promise(resolve => { finishPause = resolve }) }
    return { ok: true, data: {} }
  } })
  try {
    const c = harness.controller, p = c.createPlaylist('Station')
    c.addToPlaylist(p.id, { source: 'local', id: 'local:track', localTrackId: 'track', filePath: 'C:/Music/track.mp3' })
    c.add({ source: 'spotify', uri: 'spotify:track:a' })
    defer = true
    const play = c.playPlaylist(p.id)
    await new Promise(resolve => setImmediate(resolve))
    const clear = c.clearQueue()
    finishPause()
    await Promise.all([play, clear])
    assert.equal(c.queue.get().length, 0)
    assert.equal(c.status.get(), 'idle')
    assert.equal(harness.audio.elements.length, 0)
  } finally { harness.restore() }
})

test('removing a paused current item does not unexpectedly start its successor', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.add({ source: 'radio', streamUrl: 'https://radio.example/one' })
    c.add({ source: 'radio', streamUrl: 'https://radio.example/two' })
    await c.remove(0)
    assert.equal(c.status.get(), 'paused')
    assert.equal(harness.audio.elements.length, 0)
  } finally { harness.restore() }
})


test('Spotify context Next stays with Spotify, not the next mixed queue item', async () => {
  const calls = []
  const harness = makeController({ rest: async path => { calls.push(path); return { ok: true, data: {} } } })
  try {
    const c = harness.controller
    c.add({ source: 'spotify', uri: 'spotify:album:album' })
    c.add({ source: 'radio', streamUrl: 'https://radio.example/live' })
    await c.playAt(0); await c.next()
    assert.ok(calls.includes('/next'))
    assert.equal(c.index.get(), 0)
  } finally { harness.restore() }
})

test('mute restores last audible volume and workspace selection survives recreation', async () => {
  const storage = new Map(), first = makeController({ storage })
  try {
    first.controller.setVolume(.37); first.controller.toggleMute()
    assert.equal(first.controller.volume.get(), 0)
    first.controller.setWorkspaceView('playlists')
  } finally { first.restore() }
  const second = makeController({ storage })
  try { second.controller.toggleMute(); assert.equal(second.controller.volume.get(), .37); assert.equal(second.controller.workspaceView.get(), 'library') } finally { second.restore() }
})

test('direct file opening is session-only and cannot create broken saved playlist references', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    const file = new File([new Uint8Array([1, 2, 3])], 'Opened.wav', { type: 'audio/wav' })
    assert.equal(c.openLocalFiles([file, new File(['notes'], 'notes.txt', { type: 'text/plain' })]), 1)
    assert.equal(c.sessionTracks.get().length, 1)
    assert.equal(c.queue.get().length, 1)
    assert.equal(harness.storage.get('queue').length, 0)
    const playlist = c.createPlaylist('Persistent only')
    assert.equal(c.addToPlaylist(playlist.id, c.sessionTracks.get()[0]), false)
    assert.equal(c.addManyToPlaylist(playlist.id, c.sessionTracks.get()), 0)
    assert.equal(c.playlistItems(playlist.id).length, 0)
    await c.playAt(0)
    await c.refreshLocalLibrary()
    assert.equal(c.sessionTracks.get().length, 1)
    assert.equal(c.current().unavailable, false)
  } finally { harness.restore() }
})


test('Spotify playlist pages preserve raw positions and playlist context for duplicate tracks', async () => {
  const harness = makeController({ rest: async path => path.startsWith('/playlists/') ? { ok: true, data: { items: [{ track: null }, { track: { id: 'a', uri: 'spotify:track:a', name: 'A' } }, { track: { id: 'a', uri: 'spotify:track:a', name: 'A again' } }], total: 53, next: null } } : { ok: true, data: {} } })
  try {
    const page = await harness.controller.loadSpotifyPlaylist({ id: 'list', uri: 'spotify:playlist:list' }, 50)
    assert.deepEqual(page.tracks.map(track => track.contextPosition), [51, 52])
    assert.ok(page.tracks.every(track => track.contextUri === 'spotify:playlist:list'))
    assert.equal(page.skipped, 1)
  } finally { harness.restore() }
})

test('queue song selection uses the exact duplicate occurrence and follows a moved context row', async () => {
  const calls = [], harness = makeController({ rest: async (path, options) => { calls.push({path, options}); return {ok:true, data:{}} } })
  try {
    const c = harness.controller, item = {source:'spotify', uri:'spotify:playlist:list', title:'Collection'}
    c.add(item); c.add(item)
    const second = c.queue.get()[1]
    c.move(1, -1)
    assert.equal(await c.playSpotifyPlaylistTrack(second, {contextUri:item.uri, contextPosition:7, uri:'spotify:track:duplicate'}), true)
    assert.equal(c.index.get(), 0)
    assert.equal(c.current(), second)
    assert.equal(c.queue.get().length, 2)
    const payload = calls.find(call => call.path === '/play').options.body
    assert.equal(payload.context_uri, item.uri)
    assert.equal(payload.offset, 7)
    assert.ok(!('uris' in payload))
    await c.remove(0)
    calls.length = 0
    assert.equal(await c.playSpotifyPlaylistTrack(second, {contextUri:item.uri, contextPosition:7}), false)
    assert.equal(calls.filter(call => call.path === '/play').length, 0)
  } finally { harness.restore() }
})

test('saveToPlaylist accepts indexed local tracks only and refuses legacy destinations', async () => {
  class RefusingStorage extends Map { refuse = false; set(key,value) { return key === 'playlistState' && this.refuse ? this : super.set(key,value) } }
  const storage = new RefusingStorage([['playlistState', { version: 3, playlists: [{ id: 'legacy', name: 'Old mix', items: [{ source: 'spotify', uri: 'spotify:track:a' }] }] }]])
  const harness = makeController({storage})
  try {
    for (const item of [
      {source:'spotify',uri:'spotify:track:a'},
      {source:'radio',streamUrl:'https://radio.example/live'},
      {source:'youtube',url:'https://www.youtube.com/watch?v=abcdefghijk'}
    ]) await assert.rejects(harness.controller.saveToPlaylist({name:'No cloud',item}),/indexed local tracks only/)
    await assert.rejects(harness.controller.saveToPlaylist({name:'Temporary',item:{source:'local',objectUrl:'blob:test'}}),/Index this file/)
    await assert.rejects(harness.controller.saveToPlaylist({id:'legacy',item:{source:'local',localTrackId:'a',id:'local:a'}}),/Legacy mixes are read-only/)
    storage.refuse = true
    await assert.rejects(harness.controller.saveToPlaylist({name:'No room',item:{source:'local',localTrackId:'a',id:'local:a'}}),/could not confirm/)
    assert.equal(harness.controller.playlists.get().length,1)
  } finally { harness.restore() }
})

test('indexed playback starts without an analyser attempt', async () => {
  const harness = makeController({rest:async path=>({ok:true,data:path.startsWith('/local/tracks')?{items:[{id:'indexed',title:'Indexed file',path:'C:/Music/test.mp3',available:true}],total:1}:{}})})
  try {
    harness.controller.add({source:'local', localTrackId:'indexed', filePath:'C:/Music/test.mp3'})
    await harness.controller.playAt(0)
    assert.equal(harness.audio.elements.length,1)
    assert.equal(harness.audio.elements[0].crossOrigin, undefined)
    assert.equal(harness.controller.status.get(),'playing')
  } finally { harness.restore() }
})

test('radio is the only supported source without a Next transport control', () => {
  assert.equal(pure.shouldShowNext({ source: 'radio' }), false)
  for (const source of ['spotify', 'local']) assert.equal(pure.shouldShowNext({ source }), true, source)
})

test('provider capabilities expose only controls each engine can honor', () => {
  assert.deepEqual(pure.mediaCapabilities({ source: 'radio' }), { play: true, previous: false, next: false, seek: false, volume: true, shuffle: false, repeat: false, device: false })
  assert.deepEqual(pure.mediaCapabilities({ source: 'local' }), { play: true, previous: true, next: true, seek: true, volume: true, shuffle: false, repeat: false, device: false })
  assert.deepEqual(pure.mediaCapabilities({ source: 'spotify' }), { play: true, previous: true, next: true, seek: true, volume: true, shuffle: true, repeat: true, device: true })
  assert.deepEqual(pure.mediaCapabilities({ source: 'unsupported' }), { play: false, previous: false, next: false, seek: false, volume: false, shuffle: false, repeat: false, device: false })
  assert.equal(pure.previousQueueIndex(3, 0), 2)
})

test('provider transport failures never expose Electron IPC or headless-backend internals', () => {
  const raw = new Error('Error invoking remote method \'hermes:api\': Error: 404: {"error":"Headless backend (hermes serve): web UI disabled — use hermes dashboard for the browser UI."}')
  assert.equal(pure.userFacingError(raw, 'Spotify playlist details are unavailable.'), 'Spotify playlist details are unavailable.')
  assert.equal(pure.userFacingError(new Error('Spotify authentication expired.'), 'Fallback'), 'Spotify authentication expired.')
})

test('diagnostics record the sanitized Spotify command and backend failure', async () => {
  const harness = makeController({ rest: async path => {
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/devices') return { ok: true, data: { devices: [] } }
    if (path === '/play') return { ok: false, error: 'Spotify rejected the playback request', status_code: 403 }
    return { ok: true, data: { is_playing: false } }
  } })
  try {
    await Promise.resolve()
    harness.controller.add({ source: 'spotify', title: 'Track', uri: 'spotify:track:3hRQVUaNrPJlnzudLutmSa' })
    await harness.controller.playAt(0)
    const failure = harness.controller.logs.get().find(entry => entry.event === 'api.failure' && entry.detail.route === '/play')
    assert.equal(failure.level, 'error')
    assert.equal(failure.detail.status, 403)
    assert.equal(failure.detail.track, 'spotify:track:3hRQVUaNrPJlnzudLutmSa')
    assert.doesNotMatch(JSON.stringify(failure), /access_token|refresh_token|Bearer /i)
  } finally { harness.restore() }
})

test('navigation uses four compact destinations and semantic Hermes-derived surfaces', () => {
  assert.doesNotMatch(source, /const NAV_(?:PRIMARY|LIBRARY) = .*?[⌂⌕◉◌▶♪◇≡⚙]/)
  assert.match(source, /const PRIMARY_NAV = \[\['browse', 'Browse'\], \['library', 'Library'\], \['queue', 'Queue'\], \['settings', 'Settings'\]\]/)
  assert.match(source, /--fm-night:color-mix\(in srgb,var\(--ui-bg-primary\)/)
})

test('single Spotify tracks retain a known album context and otherwise use the documented uris payload', () => {
  const track = 'spotify:track:3hRQVUaNrPJlnzudLutmSa'
  const album = 'spotify:album:5ht7ItJgpBH7W6vJ5BqpPr'
  assert.deepEqual(pure.spotifyPlayPayload(track), { uris: [track] })
  assert.deepEqual(pure.spotifyPlayPayload({ uri: track, contextUri: album }), { context_uri: album, offset: track })
  assert.equal(pure.normalizeQueueItem({ source: 'spotify', title: 'Track', uri: track, contextUri: album }).contextUri, album)
})

test('mixed playlists persist stable local IDs beside provider references without file paths', () => {
  const local = pure.serializePlaylistItem({ source: 'local', id: 'local:track-1', localTrackId: 'track-1', title: 'Night drive', subtitle: 'Music / Mix', filePath: 'C:\\Music\\Night.flac', mimeType: 'audio/flac' })
  assert.deepEqual(local, { source: 'local', id: 'local:track-1', localTrackId: 'track-1', title: 'Night drive', subtitle: 'Music / Mix', mimeType: 'audio/flac', durationMs: 0, unavailable: false })
  assert.equal(JSON.stringify(local).includes('C:\\Music'), false)
  const state = pure.normalizePlaylistState({ version: 2, playlists: [{ id: 'p1', name: 'After dark', description: 'Mixed', items: [local, { source: 'retired-provider', title: 'Old item' }, { source: 'spotify', title: 'Track', uri: 'spotify:track:abc123' }] }] })
  assert.equal(state.version, 3)
  assert.equal(state.playlists[0].items.length, 2)
  assert.equal(state.playlists[0].items[0].localTrackId, 'track-1')
  assert.equal(state.playlists[0].items[1].uri, 'spotify:track:abc123')
})

test('local catalog entries use Hermes internal seekable media URLs', () => {
  assert.equal(pure.isSupportedLocalAudio({ name: 'mix.FLAC', type: '' }), true)
  assert.equal(pure.isSupportedLocalAudio({ name: 'notes.txt', type: 'text/plain' }), false)
  const item = pure.localTrackItem({ id: 'track-1', title: 'Night drive', subtitle: 'Albums / Mix', path: 'C:\\Music\\track-1.flac', mime_type: 'audio/flac', available: true })
  assert.equal(item.localTrackId, 'track-1')
  assert.equal(item.unavailable, false)
  assert.deepEqual(item.playbackUrls, [
    'hermes-media://stream/C%3A%5CMusic%5Ctrack-1.flac',
    'hermes-media://remote/C%3A%5CMusic%5Ctrack-1.flac'
  ])
  assert.equal(pure.normalizeQueueItem({ source: 'local', title: 'Unsafe', objectUrl: 'file:///C:/Music/track.mp3' }), null)
})

test('removed providers are dropped while the selected queue position migrates by position', () => {
  const first = { source: 'spotify', id: 'duplicate', title: 'First', uri: 'spotify:track:first' }
  const second = { source: 'spotify', id: 'duplicate', title: 'Second', uri: 'spotify:track:second' }
  const migrated = pure.normalizeQueueSelection([first, { source: 'retired-provider', title: 'Removed' }, second], 2)
  assert.equal(migrated.items.length, 2)
  assert.equal(migrated.index, 1)
  assert.equal(migrated.items[1].uri, 'spotify:track:second')
})

test('controller immediately persists the cleaned queue with its positional selection', async () => {
  const storage = new Map([
    ['queue', [
      { source: 'spotify', id: 'duplicate', title: 'First', uri: 'spotify:track:first' },
      { source: 'retired-provider', title: 'Removed' },
      { source: 'spotify', id: 'duplicate', title: 'Second', uri: 'spotify:track:second' }
    ]],
    ['queueIndex', 2]
  ])
  const harness = makeController({ storage })
  try {
    await Promise.resolve()
    assert.equal(harness.controller.index.get(), 1)
    assert.equal(storage.get('queue').length, 2)
    assert.equal(storage.get('queueIndex'), 1)
    assert.equal(storage.get('queue')[1].uri, 'spotify:track:second')
  } finally { harness.restore() }
})

test('radio validation accepts only public credential-free HTTPS literal URLs', () => {
  for (const value of ['http://radio.example/live', 'https://user:pass@radio.example/live', 'https://localhost/live', 'https://station.local/live', 'https://127.0.0.1/live', 'https://10.0.0.1/live', 'https://169.254.1.1/live', 'https://172.16.0.1/live', 'https://192.168.1.1/live', 'https://[::1]/live', 'https://[fe80::1]/live']) assert.equal(pure.safeRadioStreamUrl(value), null, value)
  assert.equal(pure.safeRadioStreamUrl('https://radio.example/live'), 'https://radio.example/live')
})

test('adding the first item selects it paused without starting playback', async () => {
  const harness = makeController()
  try {
    await Promise.resolve()
    assert.equal(harness.controller.add({ source: 'radio', title: 'Station', streamUrl: 'https://radio.example/live' }), true)
    assert.equal(harness.controller.index.get(), 0)
    assert.equal(harness.controller.status.get(), 'paused')
    assert.equal(harness.audio.elements.length, 0)
  } finally { harness.restore() }
})

test('local tracks play in the internal audio engine and are never restored from persistent queue storage', async () => {
  const harness = makeController()
  try {
    await Promise.resolve()
    assert.equal(harness.controller.add({ source: 'local', title: 'On disk', objectUrl: 'blob:https://hermes.localhost/local-1', mimeType: 'audio/mpeg' }), true)
    await harness.controller.playAt(0)
    assert.equal(harness.audio.elements.length, 1)
    assert.equal(harness.audio.elements[0].src, 'blob:https://hermes.localhost/local-1')
    assert.equal(harness.controller.status.get(), 'playing')
    assert.deepEqual(harness.storage.get('queue'), [])
    assert.equal(harness.storage.get('queueIndex'), -1)
  } finally { harness.restore() }
})

test('local collections support create, edit, duplicate, and queue playback', async () => {
  const harness = makeController()
  try {
    await Promise.resolve()
    const playlist = harness.controller.createPlaylist('Late signal', 'Four-source mix')
    assert.equal(harness.controller.addToPlaylist(playlist.id, { source: 'radio', title: 'Station', streamUrl: 'https://radio.example/live' }), false)
    harness.controller.addToPlaylist(playlist.id, { source: 'local', id: 'local:persistent', localTrackId: 'persistent', filePath: 'C:/Music/persistent.mp3', title: 'On disk', subtitle: 'Folder', mimeType: 'audio/mpeg' })
    harness.controller.updatePlaylist(playlist.id, { name: 'Late signal II' })
    const copy = harness.controller.duplicatePlaylist(playlist.id)
    assert.equal(harness.controller.playlists.get().length, 2)
    assert.equal(copy.items.length, 1)
    assert.equal(harness.storage.get('playlistState').playlists[0].items[0].localTrackId, 'persistent')
    await harness.controller.playPlaylist(playlist.id)
    assert.equal(harness.controller.queue.get().length, 1, 'persistent local references remain playable during the session')
    assert.equal(harness.controller.current().source, 'local')
    harness.controller.deletePlaylist(copy.id)
    assert.equal(harness.controller.playlists.get().length, 1)
  } finally { harness.restore() }
})


test('Spotify uses root endpoints, source-specific payloads, bounded polls, and confirmed state', async () => {
  const calls = []
  const harness = makeController({ rest: async (path, options = {}) => {
    calls.push({ path, options })
    if (path === '/config') return { ok: true, data: { poll_interval_open: 3, poll_interval_closed: 9 } }
    if (path === '/player') return { ok: true, data: { is_playing: true, item: { name: 'Album cut', artists: [{ name: 'Artist' }] } } }
    return { ok: true, data: {} }
  } })
  try {
    await Promise.resolve()
    harness.controller.setPollingOpen(true)
    harness.controller.add({ source: 'spotify', title: 'Album', uri: 'spotify:album:abc123' })
    await harness.controller.playAt(0)
    const play = calls.find(call => call.path === '/play')
    assert.deepEqual(play.options.body, { context_uri: 'spotify:album:abc123' })
    assert.equal(harness.controller.status.get(), 'playing')
    await harness.controller.searchSpotify('night drive')
    await harness.controller.searchSpotifyCatalog('night drive')
    assert.ok(calls.some(call => call.path.includes('/search?q=night%20drive&type=track&limit=10&offset=0')))
    assert.ok(calls.some(call => call.path.includes('/search?q=night%20drive&type=track,album,artist,playlist&limit=10&offset=0')))
    assert.ok(calls.some(call => call.path === '/spotify/auth/status'))
    assert.ok(calls.filter(call => !call.path.startsWith('/spotify/auth/')).every(call => !call.path.includes('/spotify')))
    assert.ok(harness.timers.some(timer => timer.ms === 8000))
    assert.ok(harness.timers.some(timer => timer.ms === 500))
    assert.deepEqual(pure.spotifyPlayPayload('spotify:track:abc123'), { uris: ['spotify:track:abc123'] })
  } finally { harness.restore() }
})

test('Spotify polling rediscovers Connect devices that appear after startup', async () => {
  let deviceReads = 0
  const harness = makeController({ rest: async path => {
    if (path === '/config') return { ok: true, data: { poll_interval_open: 8, poll_interval_closed: 20 } }
    if (path === '/devices') {
      deviceReads += 1
      return { ok: true, data: { devices: deviceReads > 1 ? [{ id: 'phone-1', name: 'Phone', type: 'Smartphone', is_active: true }] : [] } }
    }
    if (path === '/player') return { ok: true, data: { is_playing: false } }
    return { ok: true, data: {} }
  } })
  try {
    await Promise.resolve()
    assert.deepEqual(harness.controller.spotifyDevices.get(), [])
    harness.controller.setPollingOpen(true)
    const poll = harness.timers.findLast(timer => timer.ms === 8000 && !timer.cleared)
    poll.fn()
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(harness.controller.spotifyDevices.get()[0]?.id, 'phone-1')
  } finally { harness.restore() }
})

test('Spotify polling clears a stale no-device error after playback recovers', async () => {
  let online = false
  const harness = makeController({ rest: async (path) => {
    if (path === '/config') return { ok: true, data: { poll_interval_open: 8, poll_interval_closed: 20 } }
    if (path === '/devices') return { ok: true, data: { devices: [] } }
    if (path === '/play') return { ok: false, error: 'Spotify could not find an active playback device.' }
    if (path === '/player') return online
      ? { ok: true, data: { is_playing: true, device: { id: 'phone-1', name: 'Phone' }, item: { uri: 'spotify:track:recover', name: 'Recovered', artists: [] } } }
      : { ok: true, data: { is_playing: false } }
    return { ok: true, data: {} }
  } })
  try {
    await Promise.resolve()
    harness.controller.add({ source: 'spotify', title: 'Recovered', uri: 'spotify:track:recover' })
    await harness.controller.playAt(0)
    assert.match(harness.controller.message.get(), /active playback device/)
    online = true
    harness.controller.setPollingOpen(true)
    const poll = harness.timers.findLast(timer => timer.ms === 8000 && !timer.cleared)
    poll.fn()
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(harness.controller.status.get(), 'playing')
    assert.equal(harness.controller.message.get(), '')
  } finally { harness.restore() }
})

test('Spotify progress advances from a local monotonic anchor without extra API polling', async () => {
  const track = 'spotify:track:anchor'
  let playerReads = 0
  const harness = makeController({ clock: { now: 100_000 }, rest: async path => {
    if (path === '/config') return { ok: true, data: { poll_interval_open: 8, poll_interval_closed: 20 } }
    if (path === '/player') {
      playerReads += 1
      return { ok: true, data: { is_playing: true, progress_ms: 10_000, item: { uri: track, name: 'Anchored', duration_ms: 60_000, artists: [] } } }
    }
    if (path === '/devices') return { ok: true, data: { devices: [] } }
    return { ok: true, data: {} }
  } })
  try {
    harness.controller.add({ source: 'spotify', title: 'Anchored', uri: track })
    await harness.controller.playAt(0)
    const readsAfterSnapshot = playerReads
    harness.clock.now += 2_500
    const clockTimer = harness.timers.find(timer => timer.ms === 500 && !timer.cleared)
    clockTimer.fn()
    assert.deepEqual(harness.controller.progress.get(), { positionMs: 12_500, durationMs: 60_000 })
    assert.equal(playerReads, readsAfterSnapshot)
  } finally { harness.restore() }
})

test('Spotify track completion follows the Hermes queue by default', async () => {
  const expected = 'spotify:track:expected'
  let snapshot = { is_playing: true, progress_ms: 10_000, item: { uri: expected, name: 'Expected', duration_ms: 20_000, artists: [] } }
  const calls = []
  const harness = makeController({ rest: async (path, options = {}) => {
    calls.push({ path, options })
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/player') return { ok: true, data: snapshot }
    if (path === '/devices') return { ok: true, data: { devices: [] } }
    return { ok: true, data: {} }
  } })
  try {
    harness.controller.add({ source: 'spotify', title: 'Expected', uri: expected, contextUri: 'spotify:album:context' })
    harness.controller.add({ source: 'radio', title: 'Hermes next', streamUrl: 'https://radio.example/live' })
    await harness.controller.playAt(0)
    assert.deepEqual(calls.find(call => call.path === '/play').options.body, { context_uri: 'spotify:album:context', offset: expected })
    snapshot = { is_playing: true, progress_ms: 250, item: { uri: 'spotify:track:provider-next', name: 'Provider next', duration_ms: 30_000, artists: [] } }
    await harness.controller.refreshSpotify()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(harness.controller.current().title, 'Hermes next')
    assert.equal(harness.controller.status.get(), 'playing')
    const entries = harness.controller.logs.get()
    assert.ok(entries.some(entry => entry.event === 'spotify.hermes-queue-advance' && entry.detail.reason === 'provider-track-changed'), JSON.stringify(entries))
  } finally { harness.restore() }
})

test('Spotify continuation is persisted and lets provider context continue', async () => {
  const expected = 'spotify:track:expected'
  const context = 'spotify:album:context'
  let snapshot = { is_playing: true, progress_ms: 10_000, item: { uri: expected, name: 'Expected', duration_ms: 20_000, artists: [] } }
  const calls = []
  const storage = new Map()
  const harness = makeController({ storage, rest: async (path, options = {}) => {
    calls.push({ path, options })
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/player') return { ok: true, data: snapshot }
    if (path === '/devices') return { ok: true, data: { devices: [] } }
    return { ok: true, data: {} }
  } })
  try {
    harness.controller.setSpotifyAutoplay(true)
    harness.controller.add({ source: 'spotify', title: 'Expected', uri: expected, contextUri: context })
    harness.controller.add({ source: 'radio', title: 'Hermes next', streamUrl: 'https://radio.example/live' })
    await harness.controller.playAt(0)
    assert.deepEqual(calls.find(call => call.path === '/play').options.body, { context_uri: context, offset: expected })
    snapshot = { is_playing: true, progress_ms: 250, item: { uri: 'spotify:track:provider-next', name: 'Provider next', duration_ms: 30_000, artists: [] } }
    await harness.controller.refreshSpotify()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(harness.controller.current().title, 'Expected')
    assert.equal(storage.get('spotifyAutoplay'), true)
  } finally { harness.restore() }
})

test('stale transitions cannot win and removing current stops its provider before successor start', async () => {
  const events = []
  const audio = makeAudioHarness({ analysisFails: true, events })
  const harness = makeController({ audio, rest: async (path, options = {}) => {
    events.push(`${path}:${options.method || 'GET'}`)
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/player') return { ok: true, data: { is_playing: false } }
    return { ok: true, data: {} }
  } })
  try {
    harness.controller.add({ source: 'spotify', title: 'Track', uri: 'spotify:track:abc123' })
    harness.controller.add({ source: 'radio', title: 'Station', streamUrl: 'https://radio.example/live' })
    const stale = harness.controller.playAt(1)
    const winning = harness.controller.playAt(0)
    await Promise.all([stale, winning])
    assert.equal(harness.controller.current().source, 'spotify')
    harness.controller.status.set('playing')
    await harness.controller.remove(0)
    assert.equal(harness.controller.current().source, 'radio')
    const pauseAt = events.lastIndexOf('/pause:POST')
    const radioPlayAt = events.lastIndexOf('audio:play')
    assert.ok(pauseAt >= 0 && pauseAt < radioPlayAt, events.join(', '))
  } finally { harness.restore() }
})

test('Spotify browser auth polls status, uses transient client ID, and transfers without playback', async () => {
  const calls = []
  let statusReads = 0
  const harness = makeController({ rest: async (path, options = {}) => {
    calls.push({ path, options })
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/spotify/auth/status') return { ok: true, data: { authenticated: ++statusReads > 1, client_id_configured: true } }
    if (path === '/devices') return { ok: true, data: { devices: [{ id: 'device-1', name: 'Desk', type: 'Computer', is_active: true }] } }
    if (path === '/player') return { ok: true, data: { is_playing: false } }
    return { ok: true, data: {} }
  } })
  try {
    await Promise.resolve()
    await harness.controller.startSpotifyAuth('client-id-only')
    const start = calls.find(call => call.path === '/spotify/auth/start')
    assert.deepEqual(start.options, { method: 'POST', body: { client_id: 'client-id-only' } })
    assert.ok(calls.filter(call => call.path === '/spotify/auth/status').length >= 2)
    assert.equal(harness.controller.spotifyAuth.get().authenticated, true)
    await harness.controller.transferSpotifyDevice('device-1')
    const transfer = calls.find(call => call.path === '/transfer')
    assert.deepEqual(transfer.options, { method: 'PUT', body: { device_id: 'device-1', play: false } })
    assert.equal(harness.controller.spotifyDevices.get()[0].active, true)
  } finally { harness.restore() }
})

test('Spotify playback remains pinned to the selected Connect device while Spotify device state is stale', async () => {
  const calls = []
  const storage = new Map()
  const harness = makeController({ storage, rest: async (path, options = {}) => {
    calls.push({ path, options })
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/devices') return { ok: true, data: { devices: [
      { id: 'phone-1', name: 'Phone', is_active: true },
      { id: 'desk-1', name: 'Desk', is_active: false }
    ] } }
    if (path === '/player') return { ok: true, data: { is_playing: path === '/play' } }
    return { ok: true, data: {} }
  } })
  try {
    await Promise.resolve()
    await harness.controller.transferSpotifyDevice('desk-1')
    harness.controller.add({ source: 'spotify', title: 'Track', uri: 'spotify:track:3hRQVUaNrPJlnzudLutmSa' })
    await harness.controller.playAt(0)
    const play = calls.find(call => call.path === '/play')
    assert.deepEqual(play.options.body, { uris: ['spotify:track:3hRQVUaNrPJlnzudLutmSa'], device_id: 'desk-1' })
    assert.equal(storage.get('spotifyDeviceId'), 'desk-1')
  } finally { harness.restore() }
})

test('overlapping Spotify device refreshes cannot let an older response clear a newer selection', async () => {
  const storage = new Map([['spotifyDeviceId', 'desk-1']])
  let resolveOlder
  let deviceReads = 0
  const olderDevices = new Promise(resolve => { resolveOlder = resolve })
  const harness = makeController({ storage, rest: async path => {
    if (path === '/config') return { ok: true, data: {} }
    if (path !== '/devices') return { ok: true, data: {} }
    deviceReads += 1
    if (deviceReads === 2) return olderDevices
    return { ok: true, data: { devices: [{ id: 'phone-1', name: 'Phone', is_active: true }] } }
  } })
  try {
    // The controller discovers devices during initialization; let that complete first.
    await Promise.resolve()
    const older = harness.controller.refreshSpotifyDevices()
    await Promise.resolve()
    await harness.controller.transferSpotifyDevice('phone-1')
    resolveOlder({ ok: true, data: { devices: [{ id: 'desk-1', name: 'Desk', is_active: true }] } })
    await older
    assert.equal(storage.get('spotifyDeviceId'), 'phone-1')
  } finally { harness.restore() }
})

test('Spotify clears a vanished selected Connect device only after authoritative discovery succeeds', async () => {
  const calls = []
  const storage = new Map([['spotifyDeviceId', 'desk-1']])
  const harness = makeController({ storage, rest: async (path, options = {}) => {
    calls.push({ path, options })
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/devices') return { ok: true, data: { devices: [{ id: 'phone-1', name: 'Phone', is_active: true }] } }
    if (path === '/player') return { ok: true, data: { is_playing: path === '/play' } }
    return { ok: true, data: {} }
  } })
  try {
    await harness.controller.refreshSpotifyDevices()
    harness.controller.add({ source: 'spotify', title: 'Track', uri: 'spotify:track:3hRQVUaNrPJlnzudLutmSa' })
    await harness.controller.playAt(0)
    const play = calls.find(call => call.path === '/play')
    assert.deepEqual(play.options.body, { uris: ['spotify:track:3hRQVUaNrPJlnzudLutmSa'], device_id: 'phone-1' })
    assert.equal(storage.get('spotifyDeviceId'), '')
  } finally { harness.restore() }
})

test('Spotify retains a selected restricted Connect device instead of silently retargeting it', async () => {
  const calls = []
  const harness = makeController({ storage: new Map([['spotifyDeviceId', 'desk-1']]), rest: async (path, options = {}) => {
    calls.push({ path, options })
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/devices') return { ok: true, data: { devices: [
      { id: 'desk-1', name: 'Desk', is_active: false, is_restricted: true },
      { id: 'phone-1', name: 'Phone', is_active: true }
    ] } }
    if (path === '/player') return { ok: true, data: { is_playing: true } }
    return { ok: true, data: {} }
  } })
  try {
    await harness.controller.refreshSpotifyDevices()
    harness.controller.add({ source: 'spotify', title: 'Track', uri: 'spotify:track:3hRQVUaNrPJlnzudLutmSa' })
    await harness.controller.playAt(0)
    const play = calls.find(call => call.path === '/play')
    assert.deepEqual(play.options.body, { uris: ['spotify:track:3hRQVUaNrPJlnzudLutmSa'], device_id: 'desk-1' })
  } finally { harness.restore() }
})

test('Spotify backend 401 device refresh clears devices and selection, then requires reconnect', async () => {
  const storage = new Map([['spotifyDeviceId', 'desk-1']])
  const harness = makeController({ storage, rest: async path => {
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/devices') return { ok: false, error: 'Spotify request failed', status_code: 401 }
    return { ok: true, data: {} }
  } })
  try {
    await assert.rejects(
      harness.controller.refreshSpotifyDevices({ throwOnError: true }),
      /Spotify request failed/
    )
    assert.equal(harness.controller.spotifyDevices.get().length, 0)
    assert.equal(storage.get('spotifyDeviceId'), '')
    assert.deepEqual(harness.controller.spotifyAuth.get(), { state: 'failed', authenticated: false, needsClientId: false, detail: 'Spotify request failed' })
    assert.equal(harness.controller.message.get(), 'Spotify request failed')
  } finally { harness.restore() }
})

test('Spotify transient device-refresh failure clears cached devices and selection without forcing reconnect', async () => {
  const storage = new Map([['spotifyDeviceId', 'desk-1']])
  const harness = makeController({ storage, rest: async path => {
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/devices') return { ok: false, error: 'Spotify request failed' }
    return { ok: true, data: {} }
  } })
  try {
    harness.controller.spotifyDevices.set([{ id: 'desk-1', name: 'Desk', active: true, restricted: false }])
    await harness.controller.refreshSpotifyDevices()
    assert.deepEqual(harness.controller.spotifyDevices.get(), [])
    assert.equal(storage.get('spotifyDeviceId'), '')
    assert.notEqual(harness.controller.spotifyAuth.get().state, 'failed')
  } finally { harness.restore() }
})

test('workspace navigation, auth/device normalizers, queue settings, and diagnostics are shipped', () => {
  assert.equal(pure.isWorkspaceView('library'), 'library')
  assert.equal(pure.isWorkspaceView('logs'), 'settings')
  assert.equal(pure.isWorkspaceView('unexpected'), 'browse')

  assert.equal(pure.normalizeSpotifyAuth({ client_id_configured: false }).needsClientId, true)
  assert.deepEqual(
    pure.normalizeSpotifyAuth({ auth: { logged_in: true }, setup: { client_id_required: false }, flow: { state: 'idle', error: null } }),
    { state: 'authenticated', authenticated: true, needsClientId: false, detail: '' }
  )
  assert.deepEqual(pure.normalizeSpotifyDevices({ devices: [{ id: 'a', name: 'Living room', is_active: true }] }), [{ id: 'a', name: 'Living room', type: 'Spotify Connect', active: true, restricted: false }])
  assert.match(source, /pickOpenPath\?\.\(\{ directories: true/)
  assert.match(source, /Diagnostics/)
  assert.match(source, /Let Spotify continue after a track/)
  assert.match(source, /guard\?\.expectedUri === anchor\.uri/)
  assert.match(source, /remainingMs: Math\.max\(0, snapshot\.durationMs - snapshot\.progressMs\)/)
  assert.match(source, /fluid-music-youtube/)
  assert.match(source, /id: 'media-route', area: ROUTES_AREA/)
  assert.doesNotMatch(source, /SIDEBAR_NAV_AREA/, 'no extra permanent sidebar row (design contract)')
  assert.match(source, /TITLEBAR_AREAS\.right/)
})

test('chat focus and surface changes cannot mutate the selected YouTube occurrence or issue commands', async () => {
  const previewCalls = []
  const calls = []
  const harness = makeController({
    preview: { openOrFocus: async (...args) => previewCalls.push(args), executeJavaScriptIn: async (...args) => previewCalls.push(args) },
    rest: async (path, options) => { calls.push({ path, method: options?.method || 'GET' }); return { ok: true, data: {} } },
  })
  try {
    const c = harness.controller
    c.addYouTubeItem({ source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Night set' }, true)
    await new Promise(resolve => setImmediate(resolve))
    const before = { current: JSON.stringify(c.current()), index: c.index.get(), status: c.status.get() }
    harness.ctx.focusedSessionId = 'chat-b'
    harness.ctx.activeSessionId = 'chat-c'
    harness.ctx.events?.emit?.('session:focus', 'chat-b')
    c.titlebarOpen.set(true)
    c.titlebarOpen.set(false)
    c.setPollingOpen(false)
    c.setPollingOpen(true)
    c.setWorkspaceView('queue')
    c.setWorkspaceView('browse')
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual({ current: JSON.stringify(c.current()), index: c.index.get(), status: c.status.get() }, before)
    assert.equal(previewCalls.length, 0, 'the embed architecture never opens or scripts a Browser preview')
    assert.equal(calls.filter(call => call.method !== 'GET' && call.path !== '/history').length, 0, 'no transport command from focus changes')
  } finally { harness.restore() }
})

test('YouTube embed resolution accepts only the backend loopback capability URL and rejects malformed state', async () => {
  const previewCalls = []
  let response = { ok: true, data: { url: 'http://127.0.0.1:43827/token/youtube/abcdefghijk?controls=1&enablejsapi=1' } }
  const harness = makeController({
    preview: { openOrFocus: async (...args) => previewCalls.push(args), executeJavaScriptIn: async (...args) => previewCalls.push(args) },
    rest: async path => path.startsWith('/youtube/embed-host') ? response : { ok: true, data: {} },
  })
  try {
    const c = harness.controller
    const item = { source: 'youtube', id: 'youtube:abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Night set' }
    assert.equal(await c.resolveYouTubeEmbedUrl(item), response.data.url)
    response = { ok: true, data: { url: 'https://evil.example/youtube/abcdefghijk' } }
    await assert.rejects(() => c.resolveYouTubeEmbedUrl(item), /invalid YouTube player URL/)
    response = { ok: false, error: 'FluidMusic could not start its YouTube player host' }
    await assert.rejects(() => c.resolveYouTubeEmbedUrl(item))
    await assert.rejects(() => c.resolveYouTubeEmbedUrl({ source: 'youtube', id: 'youtube:short', url: 'https://www.youtube.com/watch?v=abcdefghijk' }), /invalid video ID/)
    assert.equal(previewCalls.length, 0, 'no Browser preview is opened or scripted')
  } finally { harness.restore() }
})

test('new collections accept local library tracks only while v3 mixed lists remain legacy read-only', () => {
  const storage = new Map([['playlistState', { version: 3, playlists: [{ id: 'legacy', name: 'Old mix', items: [{ source: 'spotify', uri: 'spotify:track:a' }, { source: 'radio', streamUrl: 'https://radio.example/live' }] }] }]])
  const harness = makeController({ storage })
  try {
    const collection = harness.controller.createPlaylist('Local shelf')
    assert.equal(harness.controller.addToPlaylist(collection.id, { source: 'spotify', uri: 'spotify:track:new' }), false)
    assert.equal(harness.controller.addToPlaylist(collection.id, { source: 'local', id: 'local:a', localTrackId: 'a', filePath: 'C:/Music/a.mp3' }), true)
    assert.equal(harness.controller.playlists.get().find(entry => entry.legacy).name, 'Old mix')
    assert.equal(harness.controller.updatePlaylist('legacy', { name: 'Changed' }), null)
    assert.equal(harness.controller.deletePlaylist('legacy'), false)
  } finally { harness.restore() }
})

test('radio capabilities hide queue transport, seek, shuffle, repeat, and devices', () => {
  assert.deepEqual(pure.mediaCapabilities({ source: 'radio' }), { play: true, previous: false, next: false, seek: false, volume: true, shuffle: false, repeat: false, device: false })
  assert.equal(pure.mediaCapabilities({ source: 'spotify' }).device, true)
  assert.equal(pure.mediaCapabilities({ source: 'local' }).seek, true)
})

test('YouTube queue items require credential-free HTTPS watch URLs and persist safe metadata', () => {
  const valid = pure.normalizeQueueItem({ source: 'youtube', url: 'https://youtu.be/abcdefghijk?t=12', title: 'Night set', subtitle: 'Channel', durationMs: 90000, artwork: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' })
  assert.equal(valid.source, 'youtube')
  assert.equal(valid.id, 'youtube:abcdefghijk')
  assert.equal(valid.url, 'https://youtu.be/abcdefghijk?t=12')
  assert.equal(valid.title, 'Night set')
  for (const url of ['http://www.youtube.com/watch?v=abcdefghijk', 'https://user:pass@www.youtube.com/watch?v=abcdefghijk', 'https://youtube.com.evil.example/watch?v=abcdefghijk', 'https://www.youtube.com/', 'https://youtu.be/not-valid']) assert.equal(pure.normalizeQueueItem({ source: 'youtube', url }), null, url)
  // FM-12: YouTube joins the ONE shared transport vocabulary; commands flow
  // through the registered surface sink (embed bridge / owned watch handle),
  // never provider REST or internal audio. URL/metadata safety is unchanged.
  assert.deepEqual(pure.mediaCapabilities(valid), { play: true, previous: true, next: true, seek: true, volume: true, shuffle: false, repeat: false, device: false })
})

test('YouTube resolve results enqueue safe restart-safe metadata without handles or auto-play', async () => {
  const storage = new Map()
  const calls = []
  const resolved = { id: 'youtube:abcdefghijk', source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Night set', subtitle: 'Channel', durationMs: 90000, artwork: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' }
  const harness = makeController({
    storage,
    rest: async (path, options) => {
      calls.push({ path, method: options?.method || 'GET' })
      return path === '/youtube/resolve' ? { ok: true, data: { item: resolved } } : { ok: true, data: {} }
    },
  })
  try {
    assert.equal(await harness.controller.addYouTubeUrl('https://www.youtube.com/watch?v=abcdefghijk', false), true)
    assert.equal(harness.controller.queue.get()[0].source, 'youtube')
    const stored = harness.storage.get('queue')[0]
    assert.equal(stored.url, 'https://www.youtube.com/watch?v=abcdefghijk')
    assert.equal(stored.title, 'Night set')
    assert.ok(!JSON.stringify(stored).includes('127.0.0.1'), 'no ephemeral capability URL is persisted')
    assert.equal(calls.filter(call => call.method !== 'GET' && call.path !== '/history' && call.path !== '/youtube/resolve').length, 0, 'enqueue never starts playback')
  } finally { harness.restore() }
  const restarted = makeController({ storage })
  try {
    assert.equal(restarted.controller.queue.get()[0].source, 'youtube')
    assert.equal(restarted.controller.queue.get()[0].id, 'youtube:abcdefghijk')
    assert.equal(restarted.controller.status.get(), 'idle', 'restart never auto-plays')
  } finally { restarted.restore() }
})

test('radio to YouTube handoff stops the radio engine and leaves playback to the embed surface', async () => {
  const events = []
  const previewCalls = []
  const harness = makeController({
    audio: makeAudioHarness({ events }),
    preview: { openOrFocus: async (...args) => previewCalls.push(args), executeJavaScriptIn: async (...args) => previewCalls.push(args) },
  })
  try {
    const c = harness.controller
    c.add({ source: 'radio', streamUrl: 'https://radio.example/live', title: 'Radio' })
    await c.playAt(0)
    assert.equal(c.status.get(), 'playing')
    c.addYouTubeItem({ source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Night set' }, true)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(events.includes('audio:pause'), 'the radio engine is stopped before the YouTube selection settles')
    assert.equal(c.current().source, 'youtube')
    assert.equal(c.status.get(), 'paused', 'embed surface owns YouTube playback; the coordinator does not fake playing')
    assert.equal(c.youtube.get().playing, false)
    assert.ok(harness.audio.elements.every(element => element.removed), 'no internal audio engine survives the handoff')
    // The embed surface (FM-04 bridge) will report playing through the atom;
    // handing back to radio must reset that state and restart exactly one engine.
    c.youtube.set({ ...c.youtube.get(), playing: true, ended: true })
    await c.playAt(0)
    assert.equal(c.current().source, 'radio')
    assert.equal(c.youtube.get().playing, false, 'leaving YouTube clears its reported playback state')
    assert.equal(c.youtube.get().ended, false)
    assert.equal(c.status.get(), 'playing')
    assert.equal(harness.audio.elements.filter(element => !element.removed).length, 1, 'exactly one live engine')
    assert.equal(previewCalls.length, 0)
  } finally { harness.restore() }
})

test('invalid YouTube input and backend failures are honest and never enqueue foreign page data', async () => {
  const harness = makeController({ rest: async path => path === '/youtube/resolve' ? { ok: false, error: 'YouTube video details could not be loaded' } : { ok: true, data: {} } })
  try {
    const c = harness.controller
    assert.throws(() => c.addYouTubeItem({ source: 'youtube', url: 'https://evil.example/watch?v=abcdefghijk', title: 'Wrong origin' }), /valid YouTube video/)
    assert.equal(c.queue.get().length, 0)
    await assert.rejects(() => c.addYouTubeUrl('https://www.youtube.com/watch?v=abcdefghijk'), /could not be loaded/)
    assert.equal(c.queue.get().length, 0, 'failed resolution never enqueues page data')
    assert.throws(() => c.addYouTubeItem({ source: 'youtube', url: 'https://user:pass@www.youtube.com/watch?v=abcdefghijk' }), /valid YouTube video/)
    assert.equal(c.queue.get().length, 0)
  } finally { harness.restore() }
})

test('no controller-side YouTube polling exists and compact surfaces create no observation timers', async () => {
  const timers = []
  const previewCalls = []
  const harness = makeController({ timers, preview: { openOrFocus: async (...args) => previewCalls.push(args), executeJavaScriptIn: async (...args) => previewCalls.push(args) } })
  try {
    const c = harness.controller
    c.addYouTubeItem({ source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Night set' }, true)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(timers.find(timer => timer.ms === 2000), undefined, 'the retired owned-tab poll is gone; embed observation is surface-owned')
    c.titlebarOpen.set(true)
    c.setPollingOpen(true)
    c.titlebarOpen.set(false)
    c.setPollingOpen(false)
    assert.equal(timers.find(timer => timer.ms === 2000), undefined)
    assert.ok(timers.some(timer => timer.ms === 20000 && !timer.cleared), 'Spotify observation continues at the closed cadence')
    c.setPollingOpen(true)
    assert.ok(timers.some(timer => timer.ms === 8000 && !timer.cleared), 'open cadence resumes without any YouTube timer')
    assert.equal(previewCalls.length, 0)
  } finally { harness.restore() }
})

test('bulk and queue collection mutations reject mixed or session-only inputs without partial saves', () => {
  const harness = makeController()
  try {
    const c = harness.controller
    const playlist = c.createPlaylist('Local only')
    const local = { source: 'local', id: 'local:a', localTrackId: 'a', title: 'A' }
    const spotify = { source: 'spotify', uri: 'spotify:track:abc123', title: 'Cloud' }
    const session = { source: 'local', objectUrl: 'blob:session', title: 'Session' }
    assert.equal(c.addManyToPlaylist(playlist.id, [local, spotify]), 0)
    assert.equal(c.playlistItems(playlist.id).length, 0)
    assert.equal(c.addManyToPlaylist(playlist.id, [local, session]), 0)
    assert.equal(c.playlistItems(playlist.id).length, 0)
    c.add(local)
    c.add(spotify)
    assert.equal(c.saveQueueAsPlaylist('Mixed queue'), null)
    assert.equal(c.playlists.get().length, 1)
    assert.match(c.message.get(), /indexed local tracks only/)
  } finally { harness.restore() }
})

test('legacy collections reject every mutation while retaining enqueue and export', () => {
  const storage = new Map([['playlistState', { version: 3, playlists: [{ id: 'legacy', name: 'Old mix', items: [{ source: 'youtube', url: 'https://youtu.be/abcdefghijk', title: 'Old video' }] }] }]])
  const harness = makeController({ storage })
  try {
    const c = harness.controller
    assert.equal(c.addToPlaylist('legacy', { source: 'local', id: 'local:a', localTrackId: 'a' }), false)
    assert.equal(c.addManyToPlaylist('legacy', [{ source: 'local', id: 'local:a', localTrackId: 'a' }]), 0)
    assert.equal(c.updatePlaylist('legacy', { name: 'No' }), null)
    assert.equal(c.deletePlaylist('legacy'), false)
    assert.equal(c.duplicatePlaylist('legacy'), null)
    assert.equal(c.removeFromPlaylist('legacy', 0), 0)
    assert.equal(c.moveInPlaylist('legacy', 0, 1), false)
    assert.equal(c.deduplicatePlaylist('legacy'), 0)
    assert.equal(c.enqueuePlaylist('legacy'), 1)
    assert.match(c.exportPlaylists('legacy'), /Old video/)
  } finally { harness.restore() }
})

test('production bundle contains no retired footer player implementation or CSS', () => {
  assert.doesNotMatch(source, /function PlayerDock/)
  assert.doesNotMatch(source, /\.fluid-player\{/)
  assert.doesNotMatch(source, /fluid-player-(?:track|cover|title|subtitle|source|center|side|device)/)
  assert.doesNotMatch(source, /fluid-primary-action/)
  assert.doesNotMatch(source, /Persistent player/)
})

test('Spotify discovery copy never promises forbidden FluidMusic collection saves', () => {
  assert.doesNotMatch(source, /Save individual tracks or whole contexts/)
  assert.doesNotMatch(source, /Save tracks to FluidMusic to build a mixed collection/)
  assert.match(source, /Play Spotify results now or add them to your temporary Up Next queue/)
  assert.match(source, /Your Spotify playlists stay on Spotify/)
})

test('YouTube controller transport never mutates media, issues provider commands, or scripts a Browser', async () => {
  const calls = []
  const previewCalls = []
  const harness = makeController({
    rest: async (path, options) => { calls.push({ path, method: options?.method || 'GET' }); return { ok: true, data: {} } },
    preview: { openOrFocus: async (...args) => previewCalls.push(args), executeJavaScriptIn: async (...args) => previewCalls.push(args) },
  })
  try {
    const c = harness.controller
    c.add({ source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Video' })
    await c.playAt(0)
    calls.length = 0
    await c.toggle()
    await c.seekTo(3000)
    c.setVolume(.2)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls.filter(call => call.method !== 'GET').length, 0, 'embed media is never driven through provider REST commands')
    assert.equal(previewCalls.length, 0)
    assert.equal(harness.audio.elements.length, 0, 'no internal audio engine is created for YouTube')
    assert.match(c.message.get(), /YouTube player is not ready/, 'without a registered surface the shared transport is honestly not-ready, never a fake action')
  } finally { harness.restore() }
})

test('a different YouTube video is a distinct occurrence and never overwrites the selected one', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.addYouTubeItem({ source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Selected video' }, true)
    await new Promise(resolve => setImmediate(resolve))
    c.addYouTubeItem({ source: 'youtube', url: 'https://www.youtube.com/watch?v=lmnopqrstuv', title: 'Different video' }, false)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(c.queue.get().length, 2)
    assert.equal(c.current().id, 'youtube:abcdefghijk', 'enqueueing another video never retargets the selection')
    assert.equal(c.index.get(), 0)
    await c.playAt(1)
    assert.equal(c.current().id, 'youtube:lmnopqrstuv', 'play-at selects the exact occurrence')
    assert.equal(c.index.get(), 1)
  } finally { harness.restore() }
})

for (const previousSource of ['radio', 'spotify']) {
  test(`${previousSource} to explicit YouTube play stops the active provider before the embed selection`, async () => {
    const events = []
    const previewCalls = []
    const harness = makeController({
      audio: makeAudioHarness({ events }),
      rest: async (path, options = {}) => {
        events.push(`${path}:${options.method || 'GET'}`)
        return { ok: true, data: path === '/player' ? { is_playing: true, item: { uri: 'spotify:track:active', name: 'Active' } } : {} }
      },
      preview: { openOrFocus: async (...args) => previewCalls.push(args), executeJavaScriptIn: async (...args) => previewCalls.push(args) },
    })
    try {
      const c = harness.controller
      c.add(previousSource === 'radio'
        ? { source: 'radio', title: 'Live', streamUrl: 'https://radio.example/live' }
        : { source: 'spotify', title: 'Cloud', uri: 'spotify:track:active' })
      await c.playAt(0)
      events.length = 0
      c.addYouTubeItem({ source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Night set' }, true)
      await new Promise(resolve => setImmediate(resolve))
      const stopAt = previousSource === 'radio' ? events.indexOf('audio:pause') : events.indexOf('/pause:POST')
      assert.ok(stopAt >= 0, `prior ${previousSource} engine is stopped: ${events.join(', ')}`)
      assert.equal(c.current().source, 'youtube')
      assert.equal(c.index.get(), c.queue.get().findIndex(item => item.source === 'youtube'))
      assert.equal(c.status.get(), 'paused', 'the embed surface owns playback; no fake playing state')
      assert.equal(c.youtube.get().playing, false)
      assert.ok(!events.some(entry => String(entry).startsWith('youtube:')), 'no Browser-scripted YouTube play exists')
      assert.equal(previewCalls.length, 0)
      assert.equal(harness.audio.elements.filter(element => !element.removed).length, 0, 'no internal engine runs alongside the embed')
    } finally { harness.restore() }
  })
}

test('duplicate local ended events advance the queue and start the successor exactly once', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.add({ source: 'local', id: 'local:a', localTrackId: 'a', objectUrl: 'blob:fixture-a', title: 'One' })
    c.add({ source: 'local', id: 'local:b', localTrackId: 'b', objectUrl: 'blob:fixture-b', title: 'Two' })
    await c.playAt(0)
    assert.equal(c.status.get(), 'playing')
    const element = harness.audio.elements.at(-1)
    // A duplicate completion delivery must not double-advance or restart twice.
    element.listeners.get('ended')()
    element.listeners.get('ended')()
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(c.index.get(), 1, 'exactly one completion advance')
    assert.equal(c.current().title, 'Two')
    assert.equal(harness.audio.elements.length, 2, 'the successor engine is started exactly once')
    assert.equal(c.status.get(), 'playing')
  } finally { harness.restore() }
})

test('a late YouTube metadata resolve cannot overwrite a newer selection or advance the queue', async () => {
  let resolveItem
  const pending = new Promise(resolve => { resolveItem = resolve })
  const storage = new Map([
    ['queue', [
      { source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'YouTube video' },
      { source: 'radio', streamUrl: 'https://radio.example/live', title: 'New source' },
    ]],
    ['queueIndex', 1],
  ])
  const harness = makeController({
    storage,
    rest: async path => path === '/youtube/resolve' ? pending : { ok: true, data: {} },
  })
  try {
    const c = harness.controller
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(c.current().title, 'New source', 'the newer radio selection is active while metadata is pending')
    resolveItem({ ok: true, data: { item: { id: 'youtube:abcdefghijk', source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Resolved title', subtitle: 'Channel', durationMs: 90000 } } })
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(c.current().title, 'New source', 'late metadata never retargets the selection')
    assert.equal(c.index.get(), 1)
    assert.equal(c.queue.get()[0].title, 'Resolved title', 'matching occurrence metadata still updates')
    assert.equal(c.queue.get()[1].title, 'New source')
    assert.equal(c.status.get(), 'idle', 'no implicit playback or advance from metadata refresh')
  } finally { harness.restore() }
})

test('legacy playlist records survive startup, local edits, deletion, and export without shape changes', () => {
  const legacy = {
    id: 'legacy', name: 'Unknown mix', legacy: true, future: { nested: ['keep', { byteShape: 7 }] },
    items: [
      { source: 'future-provider', opaque: { token: 'retain-me' } },
      { source: 'spotify', uri: 'spotify:track:a', extra: { providerField: true } }
    ]
  }
  const initial = { version: 3, rootFuture: { keep: true }, playlists: [legacy] }
  const storage = new Map([['playlistState', structuredClone(initial)]])
  const harness = makeController({ storage })
  try {
    const c = harness.controller
    assert.deepEqual(storage.get('playlistState'), initial, 'initialization does not normalize persistence')
    const local = c.createPlaylist('Writable')
    c.addToPlaylist(local.id, { source: 'local', id: 'local:a', localTrackId: 'a', title: 'A' })
    c.updatePlaylist(local.id, { name: 'Renamed' })
    assert.deepEqual(storage.get('playlistState').playlists[0], legacy)
    assert.deepEqual(storage.get('playlistState').rootFuture, initial.rootFuture)
    assert.deepEqual(JSON.parse(c.exportPlaylists('legacy')).playlists[0], legacy)
    c.deletePlaylist(local.id)
    assert.deepEqual(storage.get('playlistState'), initial)
  } finally { harness.restore() }
})
