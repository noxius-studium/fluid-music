import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-19 keyboard/icon/error/disposal fixtures. Labelled headless controller
// doubles (fake audio/URL/timers, stubbed REST, in-memory storage) plus static
// bundle proofs. Real keyboard focus, rendered pixels and packaged-Desktop
// behavior remain explicit FM-25 owner-review gates.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, sourceLabel, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, shouldShowNext, isSupportedLocalAudio, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

function makeHarness({ storage = new Map(), rest } = {}) {
  const calls = []
  const elements = []
  const timers = []
  const disposers = []
  const createdUrls = []
  const revokedUrls = []
  let urlSequence = 0
  const original = {
    Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL,
  }
  class FakeAudio {
    constructor() { this.listeners = new Map(); this.ended = false; elements.push(this) }
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
  globalThis.setTimeout = (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer }
  globalThis.clearTimeout = timer => { if (timer) timer.cleared = true }
  URL.createObjectURL = () => { const url = `blob:fixture-${++urlSequence}`; createdUrls.push(url); return url }
  URL.revokeObjectURL = url => { revokedUrls.push(url) }
  const ctx = {
    storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) },
    rest: async (path, options) => {
      calls.push({ path, method: String(options?.method || 'GET').toUpperCase() })
      if (rest) return rest(path, options)
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
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  return {
    controller, storage, calls, elements, timers, createdUrls, revokedUrls, flush,
    dispose: () => disposers.forEach(fn => fn()),
    restore() {
      globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval
      globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout
      URL.createObjectURL = original.createObjectURL; URL.revokeObjectURL = original.revokeObjectURL
    },
  }
}

const sessionFile = name => ({ name, type: 'audio/mpeg', size: 1024 })
const youtubeItem = { source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'YouTube video' }

test('disposal cleans timers, object URLs and player ownership; late async work after disposal is inert', async () => {
  let resolveMeta
  const metaGate = new Promise(resolve => { resolveMeta = resolve })
  const storedYoutube = { source: 'youtube', id: 'youtube:abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'YouTube video', subtitle: 'YouTube', durationMs: 0, artwork: '' }
  const storage = new Map([['queue', [storedYoutube]], ['queueIndex', 0]])
  const harness = makeHarness({
    storage,
    rest: async (path) => {
      if (path === '/youtube/resolve') {
        await metaGate
        return { ok: true, data: { item: { source: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Resolved title', subtitle: 'Channel' } } }
      }
      if (path.startsWith('/local/tracks')) return { ok: true, data: { items: [], total: 0 } }
      if (path === '/local/roots') return { ok: true, data: { roots: [] } }
      if (path === '/history') return { ok: true, data: { items: [], total: 0 } }
      if (path === '/spotify/auth/status') return { ok: true, data: { auth: { logged_in: false }, setup: {}, flow: { state: 'idle', error: null } } }
      return { ok: true, data: {} }
    },
  })
  try {
    const c = harness.controller
    await harness.flush()
    // Initialization already started the stale-title metadata refresh; it is
    // held at the gated /youtube/resolve request until after disposal below.
    assert.equal(c.current().source, 'youtube')
    assert.equal(c.openLocalFiles([sessionFile('One.mp3'), sessionFile('Two.mp3')]), 2)
    assert.equal(harness.createdUrls.length, 2)
    const sinkCalls = []
    c.setYouTubeCommandSink((func, args) => { sinkCalls.push(func); return true })
    await c.toggle()
    assert.ok(sinkCalls.length > 0, 'a registered sink drives the YouTube surface while alive')
    const storedQueue = JSON.stringify(harness.storage.get('queue'))
    const queueTitle = c.queue.get().find(item => item.source === 'youtube').title
    harness.dispose()
    resolveMeta()
    await harness.flush()
    await harness.flush()
    assert.equal(c.queue.get().find(item => item.source === 'youtube').title, queueTitle, 'a late metadata resolve cannot rewrite the queue after disposal')
    assert.equal(JSON.stringify(harness.storage.get('queue')), storedQueue, 'no post-disposal persistence')
    assert.equal(c.reportYouTubeState({ kind: 'state', videoId: 'abcdefghijk', playing: true, ended: false, positionMs: 10, durationMs: 100 }), false, 'stale player reports are ignored after disposal')
    const lateSink = []
    c.setYouTubeCommandSink(func => { lateSink.push(func); return true })
    await c.toggle()
    assert.equal(lateSink.length, 0, 'a late surface cannot register a command sink after disposal')
    assert.ok(harness.timers.every(timer => timer.cleared), 'every controller timer is cleared on disposal')
    assert.deepEqual([...harness.revokedUrls].sort(), [...harness.createdUrls].sort(), 'every session object URL is revoked on disposal')
    assert.equal(harness.revokedUrls.length, 2, 'each URL revoked exactly once')
  } finally { harness.restore() }
})

test('session blob ownership: queue removal keeps the session file usable; disposal revokes once', async () => {
  const harness = makeHarness()
  try {
    const c = harness.controller
    await harness.flush()
    c.openLocalFiles([sessionFile('Session.mp3')])
    const url = harness.createdUrls[0]
    assert.equal(c.queue.get().length, 1)
    await c.remove(0)
    assert.equal(c.queue.get().length, 0)
    assert.deepEqual(harness.revokedUrls, [], 'the session still owns the file; queue removal must not kill its blob URL')
    assert.equal(c.sessionTracks.get().length, 1)
    assert.equal(c.add(c.sessionTracks.get()[0]), true, 'the session file can be re-added without reopening')
    assert.equal(c.queue.get()[0].objectUrl, url)
    harness.dispose()
    assert.deepEqual(harness.revokedUrls, [url], 'disposal revokes the session URL exactly once')
  } finally { harness.restore() }
})

test('keyboard, icon, dialog and error anatomy is named, focusable and honest (static evidence)', () => {
  assert.match(source, /function Action\(\{ label, kind, onClick, disabled = false, compact = false, primary = false \}\)/)
  assert.match(source, /'aria-label': label, title: label/, 'every icon-only Action is named for assistive tech and hover')
  assert.match(source, /'aria-hidden': true/, 'decorative icons are hidden from assistive tech')
  assert.match(source, /'aria-label': compact \? 'Status bar volume' : 'Player volume'/)
  assert.match(source, /'aria-valuetext': `\$\{Math\.round\(volume \* 100\)\} percent`/, 'volume ranges announce a real value')
  assert.match(source, /'aria-label': 'Seek through current track'/)
  assert.match(source, /'ArrowLeft',\s*'ArrowRight',\s*'ArrowUp',\s*'ArrowDown',\s*'Home',\s*'End',\s*'PageUp',\s*'PageDown',/, 'seek commits on the full keyboard range vocabulary')
  assert.match(source, /dialog\.showModal\(\)/, 'dialogs use the native modal focus contract')
  assert.match(source, /onCancel: \(event\) => \{\s*event\.preventDefault\(\)\s*onClose\(\)/, 'Escape closes dialogs through the owner callback')
  assert.match(source, /previous instanceof HTMLElement && previous\.isConnected\) previous\.focus\(\)/, 'dialog close restores the previous focus')
  assert.match(source, /busy \? 'Working…' : title/, 'destructive confirms show a real busy state')
  assert.match(source, /error && h\('p', \{ role: 'alert' \}, error\)/, 'dialog failures are announced, never swallowed into success')
  assert.match(source, /role: 'tablist'/)
  assert.match(source, /'aria-selected': value === id/)
  assert.match(source, /label: `Play \$\{item\.title\}`/)
  assert.match(source, /label: `Add \$\{item\.title\} to queue`/)
  assert.match(source, /'aria-label': `Select \$\{item\.title\}`/)
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)\{\.fluid-root \*,\.fluid-mini-player \*,\.fluid-titlebar \*/)
  assert.match(controllerText, /transitionChain = transitionChain\.catch\(\(\) => \{\}\)\.then\(\(\) => disposed \? false : work\(token\)\)\.catch\(error => \{\s*if \(!disposed && token === transition\) \{ status\.set\('error'\); message\.set\(userFacingError\(error\)\) \}/, 'transition failures surface honestly; programming defects are not caught into success')
})
