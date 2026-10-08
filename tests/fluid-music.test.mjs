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
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, sourceLabel, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, shouldShowNext, isSupportedLocalAudio, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem };`)()

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

function makeController({ rest, audio = makeAudioHarness(), timers = [], storage = new Map(), clock = { now: 0 } } = {}) {
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
    onDispose: fn => disposers.push(fn)
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio)
  const controller = factory(ctx)
  return { controller, audio, timers, storage, clock, restore() { disposers.forEach(fn => fn()); globalThis.Audio = original.Audio; globalThis.AudioContext = original.AudioContext; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow } }
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

test('analysed radio uses one volume stage, not squared gain', async () => {
  const harness = makeController()
  try {
    harness.controller.setVolume(0.5)
    harness.controller.add({ source: 'radio', streamUrl: 'https://radio.example/live' })
    await harness.controller.playAt(0)
    assert.equal(harness.audio.elements.at(-1).volume, 1)
  } finally { harness.restore() }
})

test('playlist bulk editing, deduplication, export/import and undo preserve saved data', async () => {
  const harness = makeController()
  try {
    const c = harness.controller, p = c.createPlaylist('Collection')
    const a = { source: 'spotify', title: 'A', uri: 'spotify:track:a' }, b = { source: 'spotify', title: 'B', uri: 'spotify:track:b' }
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
    const item = { source: 'radio', title: 'Station', streamUrl: 'https://radio.example/live' }
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
    c.addToPlaylist(p.id, { source: 'radio', streamUrl: 'https://radio.example/live' })
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

test('visualization uses reference-counted demand and does zero sample work when hidden', async () => {
  const harness = makeController()
  try {
    const c = harness.controller
    c.add({ source: 'radio', streamUrl: 'https://radio.example/live' })
    await c.playAt(0)
    assert.deepEqual(c.visualDiagnostics(), { consumers: 0, analyser: false, reads: 0 })
    const releaseStatus = c.acquireVisualizer(), releasePane = c.acquireVisualizer()
    assert.equal(c.visualDiagnostics().consumers, 2)
    assert.ok(c.visualSamples('wave'))
    releaseStatus()
    assert.equal(c.visualDiagnostics().analyser, true)
    releasePane(); releasePane()
    assert.equal(c.visualDiagnostics().analyser, false)
    const reads = c.visualDiagnostics().reads
    assert.equal(c.visualSamples(), null)
    assert.equal(c.visualDiagnostics().reads, reads)
    c.setStatusVisualizer(false); c.setMiniVisualizer(false); c.setVisualizerStyle('mirror')
    assert.equal(harness.storage.get('statusVisualizer'), false)
    assert.equal(harness.storage.get('miniVisualizer'), false)
    assert.equal(harness.storage.get('visualizerStyle'), 'mirror')
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
  try { second.controller.toggleMute(); assert.equal(second.controller.volume.get(), .37); assert.equal(second.controller.workspaceView.get(), 'playlists') } finally { second.restore() }
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
    const release = c.acquireVisualizer()
    assert.ok(c.visualSamples('wave'))
    release()
    assert.equal(c.visualDiagnostics().analyser, false)
    await c.refreshLocalLibrary()
    assert.equal(c.sessionTracks.get().length, 1)
    assert.equal(c.current().unavailable, false)
  } finally { harness.restore() }
})

test('showing and hiding visuals never disconnects or reroutes the audible gain path', async () => {
  const events = [], harness = makeController({ audio: makeAudioHarness({ events }) })
  try {
    const c = harness.controller
    c.add({ source: 'radio', streamUrl: 'https://radio.example/live' })
    await c.playAt(0)
    events.length = 0
    const release = c.acquireVisualizer()
    c.setVisualizerStyle('wave')
    release()
    assert.ok(!events.includes('source:disconnect:all'), events.join(', '))
    assert.ok(!events.includes('source:connect:gain'), events.join(', '))
    assert.equal(c.status.get(), 'playing')
    assert.equal(harness.audio.elements.length, 1)
    c.setVolume(.4)
    assert.ok(events.includes('gain:ramp'), 'volume should use a smoothed gain transition')
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

test('copying a Spotify collection is paginated, ordered, duplicate-safe and survives restart', async () => {
  const storage = new Map(), requests = []
  const rest = async path => {
    if (!path.startsWith('/playlists/')) return {ok:true,data:{}}
    requests.push(path)
    return {ok:true,data: path.includes('offset=0') ? {items:[{track:null},{track:{uri:'spotify:track:a',name:'First A'}}], total:3, next:'page2'} : {items:[{track:{uri:'spotify:track:a',name:'Second A'}}],total:3,next:null}}
  }
  const harness = makeController({storage,rest})
  let id
  try {
    const result = await harness.controller.saveToPlaylist({name:'My copies',item:{source:'spotify',uri:'spotify:playlist:list'},mode:'tracks'})
    id = result.playlist.id
    assert.equal(result.added, 2); assert.equal(result.skipped, 1)
    assert.deepEqual(result.playlist.items.map(item => item.title), ['First A','Second A'])
    assert.ok(result.playlist.items.every(item => !item.contextUri))
    assert.ok(requests[1].endsWith('offset=2'))
    const referenced = await harness.controller.saveToPlaylist({id,item:{source:'spotify',uri:'spotify:playlist:list'},mode:'reference'})
    assert.equal(referenced.added,1); assert.equal(requests.length,2)
  } finally { harness.restore() }
  const restarted = makeController({storage})
  try {
    assert.deepEqual(restarted.controller.playlists.get().find(p=>p.id===id).items.map(item=>item.uri), ['spotify:track:a','spotify:track:a','spotify:playlist:list'])
  } finally { restarted.restore() }
})

test('a failed later Spotify page leaves both destination and storage unchanged', async () => {
  let fail = false
  const harness = makeController({rest:async path => !path.startsWith('/playlists/') ? {ok:true,data:{}} : path.includes('offset=0') ? {ok:true,data:{items:[{track:{uri:'spotify:track:a'}}],total:2,next:'page2'}} : fail ? {ok:false,error:'Provider unavailable'} : {ok:true,data:{items:[{track:{uri:'spotify:track:b'}}],total:2,next:null}}})
  try {
    const c = harness.controller, dest = c.createPlaylist('Existing'), original = JSON.stringify(harness.storage.get('playlistState'))
    fail = true
    await assert.rejects(c.saveToPlaylist({id:dest.id,item:{source:'spotify',uri:'spotify:playlist:list'}}), /Provider unavailable/)
    await assert.rejects(c.saveToPlaylist({name:'Must not appear',item:{source:'spotify',uri:'spotify:playlist:list'}}), /Provider unavailable/)
    assert.equal(JSON.stringify(harness.storage.get('playlistState')), original)
    assert.equal(c.playlists.get().length,1); assert.equal(c.playlists.get()[0].items.length,0)
  } finally { harness.restore() }
})

test('cancelled and deleted-destination saves never publish late results', async () => {
  let resolvePage
  const harness = makeController({rest:async path => path.startsWith('/playlists/') ? await new Promise(resolve=>{resolvePage=resolve}) : {ok:true,data:{}}})
  const page = {ok:true,data:{items:[{track:{uri:'spotify:track:a'}}],total:1,next:null}}
  try {
    const c = harness.controller, abort = new AbortController()
    const pending = c.saveToPlaylist({name:'Cancelled',item:{source:'spotify',uri:'spotify:playlist:list'},signal:abort.signal})
    abort.abort(); resolvePage(page)
    await assert.rejects(pending,/cancelled/)
    assert.equal(c.playlists.get().length,0)
    const destination = c.createPlaylist('Deleted')
    const pendingDelete = c.saveToPlaylist({id:destination.id,item:{source:'spotify',uri:'spotify:playlist:list'}})
    c.deletePlaylist(destination.id); resolvePage(page)
    await assert.rejects(pendingDelete,/destination was deleted/)
    assert.equal(c.playlists.get().length,0)
  } finally { harness.restore() }
})

test('storage refusal, ephemeral files and empty Spotify pages cannot report a successful save', async () => {
  class RefusingStorage extends Map { refuse = false; set(key,value) { return key === 'playlistState' && this.refuse ? this : super.set(key,value) } }
  const storage = new RefusingStorage(), harness = makeController({storage,rest:async path=>({ok:true,data:path.startsWith('/playlists/')?{items:[],total:0,next:null}:{}})})
  try {
    storage.refuse = true
    await assert.rejects(harness.controller.saveToPlaylist({name:'No room',item:{source:'spotify',uri:'spotify:track:a'}}),/could not confirm/)
    await assert.rejects(harness.controller.saveToPlaylist({name:'Temporary',item:{source:'local',objectUrl:'blob:test'}}),/Index this file/)
    await assert.rejects(harness.controller.saveToPlaylist({name:'Empty',item:{source:'spotify',uri:'spotify:playlist:empty'}}),/no supported tracks/)
    assert.equal(harness.controller.playlists.get().length,0)
  } finally { harness.restore() }
})

test('indexed playback bypasses unsupported analysis without a failing first attempt', async () => {
  const harness = makeController({rest:async path=>({ok:true,data:path.startsWith('/local/tracks')?{items:[{id:'indexed',title:'Indexed file',path:'C:/Music/test.mp3',available:true}],total:1}:{}})})
  try {
    harness.controller.add({source:'local', localTrackId:'indexed', filePath:'C:/Music/test.mp3'})
    await harness.controller.playAt(0)
    assert.equal(harness.audio.elements.length,1)
    assert.equal(harness.audio.elements[0].crossOrigin, undefined)
    assert.equal(harness.controller.visualDiagnostics().analyser, false)
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

test('navigation uses SVG icons and the application surface inherits the active Hermes theme', () => {
  assert.doesNotMatch(source, /const NAV_(?:PRIMARY|LIBRARY) = .*?[⌂⌕◉◌▶♪◇≡⚙]/)
  assert.ok(source.includes("h(Icon, { kind: icon })"))
  assert.match(source, /\.fluid-app\{[^\n]*background:transparent/)
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

test('custom playlists support create, edit, duplicate, mixed items, and queue playback', async () => {
  const harness = makeController()
  try {
    await Promise.resolve()
    const playlist = harness.controller.createPlaylist('Late signal', 'Four-source mix')
    harness.controller.addToPlaylist(playlist.id, { source: 'radio', title: 'Station', streamUrl: 'https://radio.example/live' })
    harness.controller.addToPlaylist(playlist.id, { source: 'local', id: 'local:persistent', localTrackId: 'persistent', filePath: 'C:/Music/persistent.mp3', title: 'On disk', subtitle: 'Folder', mimeType: 'audio/mpeg' })
    harness.controller.updatePlaylist(playlist.id, { name: 'Late signal II' })
    const copy = harness.controller.duplicatePlaylist(playlist.id)
    assert.equal(harness.controller.playlists.get().length, 2)
    assert.equal(copy.items.length, 2)
    assert.equal(harness.storage.get('playlistState').playlists[0].items[1].localTrackId, 'persistent')
    await harness.controller.playPlaylist(playlist.id)
    assert.equal(harness.controller.queue.get().length, 2, 'persistent local references remain playable during the session')
    assert.equal(harness.controller.current().source, 'radio')
    harness.controller.deletePlaylist(copy.id)
    assert.equal(harness.controller.playlists.get().length, 1)
  } finally { harness.restore() }
})

test('persistent local tracks and Spotify tracks survive together in one FluidMusic playlist', async () => {
  const storage = new Map()
  const rest = async path => {
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/local/roots') return { ok: true, data: { roots: [{ id: 'root-1', path: 'C:\\Music', track_count: 1, missing_count: 0 }] } }
    if (path.startsWith('/local/tracks')) return { ok: true, data: { items: [{ id: 'track-1', title: 'On disk', subtitle: 'Album', path: 'C:\\Music\\track.mp3', mime_type: 'audio/mpeg', available: true }], total: 1 } }
    if (path === '/player') return { ok: true, data: { is_playing: false } }
    return { ok: true, data: {} }
  }
  const first = makeController({ rest, storage })
  try {
    await first.controller.refreshLocalLibrary()
    const playlist = first.controller.createPlaylist('Hybrid')
    first.controller.addToPlaylist(playlist.id, first.controller.localTracks.get()[0])
    first.controller.addToPlaylist(playlist.id, { source: 'spotify', title: 'Cloud track', uri: 'spotify:track:abc123' })
    const saved = storage.get('playlistState').playlists[0].items
    assert.equal(saved[0].localTrackId, 'track-1')
    assert.equal(Object.hasOwn(saved[0], 'filePath'), false)
    assert.equal(saved[1].uri, 'spotify:track:abc123')
  } finally { first.restore() }

  const restarted = makeController({ rest, storage })
  try {
    await restarted.controller.refreshLocalLibrary()
    await restarted.controller.playPlaylist(restarted.controller.playlists.get()[0].id)
    assert.deepEqual(restarted.controller.queue.get().map(item => item.source), ['local', 'spotify'])
    assert.equal(restarted.controller.current().localTrackId, 'track-1')
    assert.equal(restarted.controller.status.get(), 'playing')
  } finally { restarted.restore() }
})

test('radio analyser fallback has no crossOrigin property and tears down the failed element', async () => {
  const audio = makeAudioHarness({ analysisFails: true })
  const harness = makeController({ audio })
  try {
    harness.controller.add({ source: 'radio', title: 'Station', streamUrl: 'https://radio.example/live' })
    await harness.controller.playAt(0)
    assert.equal(audio.elements.length, 2)
    assert.equal(audio.elements[0].removed, true)
    assert.equal(Object.hasOwn(audio.elements[1], 'crossOrigin'), false)
    assert.equal(harness.controller.status.get(), 'playing')
    assert.equal(harness.controller.radioMeter.get(), 'unavailable')
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
  assert.equal(pure.isWorkspaceView('logs'), 'logs')
  assert.equal(pure.isWorkspaceView('unexpected'), 'home')

  assert.equal(pure.normalizeSpotifyAuth({ client_id_configured: false }).needsClientId, true)
  assert.deepEqual(
    pure.normalizeSpotifyAuth({ auth: { logged_in: true }, setup: { client_id_required: false }, flow: { state: 'idle', error: null } }),
    { state: 'authenticated', authenticated: true, needsClientId: false, detail: '' }
  )
  assert.deepEqual(pure.normalizeSpotifyDevices({ devices: [{ id: 'a', name: 'Living room', is_active: true }] }), [{ id: 'a', name: 'Living room', type: 'Spotify Connect', active: true, restricted: false }])
  assert.match(source, /pickOpenPath\?\.\(\{ directories: true/)
  assert.match(source, /title: `Logs · \$\{entries\.length\}`/)
  assert.match(source, /Let Spotify continue after a track/)
  assert.match(source, /guard\?\.expectedUri === anchor\.uri/)
  assert.match(source, /remainingMs: Math\.max\(0, snapshot\.durationMs - snapshot\.progressMs\)/)
  assert.doesNotMatch(source, /youtube/i)
  assert.match(source, /codicon: 'music'/)
  assert.match(source, /compact\s*\?\s*'Status bar volume'/)
})
