import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-18 Settings/diagnostics fixtures. Labelled headless controller doubles
// with in-memory storage and stubbed REST/timers only — no live provider,
// account or backend calls. Real Settings rendering and OAuth flows on the
// owner's Desktop remain explicit FM-25 review gates.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, sourceLabel, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, shouldShowNext, isSupportedLocalAudio, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason, QUEUE_ORIGINS, normalizeListeningSessions, makeId, isLongFormEligible, mediaKeyFor, normalizeResumePosition, normalizeBookmark, formatPositionMs, boundedSleepMinutes, SLEEP_MAX_CUSTOM_MIN };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

function makeHarness({ storage = new Map(), rest } = {}) {
  const calls = []
  const elements = []
  const disposers = []
  const original = { Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
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
      calls.push({ path, method: String(options?.method || 'GET').toUpperCase(), body: options?.body })
      if (rest) return rest(path, options)
      if (path.startsWith('/local/tracks')) return { ok: true, data: { items: [], total: 0 } }
      if (path === '/local/roots') return { ok: true, data: { roots: [] } }
      if (path === '/history') return { ok: true, data: { items: [], total: 0 } }
      if (path === '/spotify/auth/status') return { ok: true, data: { auth: { logged_in: false }, setup: {}, flow: { state: 'idle', error: null } } }
      if (path.startsWith('/playlists')) return { ok: true, data: { items: [], next: false } }
      if (path === '/player') return { ok: true, data: { is_playing: false } }
      if (path === '/devices') return { ok: true, data: { devices: [] } }
      return { ok: true, data: {} }
    },
    os: { pickOpenPath: async () => null },
    preview: { navigate: () => {} },
    onDispose: fn => disposers.push(fn),
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', 'QUEUE_ORIGINS', 'normalizeListeningSessions', 'makeId', 'isLongFormEligible', 'mediaKeyFor', 'normalizeResumePosition', 'normalizeBookmark', 'formatPositionMs', 'boundedSleepMinutes', 'SLEEP_MAX_CUSTOM_MIN', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason, pure.QUEUE_ORIGINS, pure.normalizeListeningSessions, pure.makeId, pure.isLongFormEligible, pure.mediaKeyFor, pure.normalizeResumePosition, pure.normalizeBookmark, pure.formatPositionMs, pure.boundedSleepMinutes, pure.SLEEP_MAX_CUSTOM_MIN)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  return {
    controller, storage, calls, elements, flush,
    dispose: () => disposers.forEach(fn => fn()),
    restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout },
  }
}

test('settings have real effects, persist, and restore on a fresh registration', async () => {
  const storage = new Map()
  const first = makeHarness({ storage })
  try {
    const c = first.controller
    await first.flush()
    c.setVolume(0.3)
    assert.equal(c.volume.get(), 0.3)
    assert.equal(storage.get('volume'), 0.3)
    c.toggleMute()
    assert.equal(c.volume.get(), 0)
    c.toggleMute()
    assert.equal(c.volume.get(), 0.3, 'unmute restores the last positive volume')
    c.setVolume(5)
    assert.equal(c.volume.get(), 1, 'volume is clamped, never out of range')
    c.setVolume(-2)
    assert.equal(c.volume.get(), 0)
    c.setSpotifyAutoplay(true)
    assert.equal(c.spotifyAutoplay.get(), true)
    assert.equal(storage.get('spotifyAutoplay'), true)
    c.setSpotifyAutoplay(false)
    assert.equal(storage.get('spotifyAutoplay'), false)
    c.setWorkspaceView('home')
    assert.equal(c.workspaceView.get(), 'browse', 'legacy view aliases migrate honestly')
    c.setWorkspaceView('logs')
    assert.equal(c.workspaceView.get(), 'settings')
    c.setWorkspaceView('not-a-view')
    assert.equal(c.workspaceView.get(), 'browse')
    assert.equal(storage.get('workspaceView'), 'browse')
  } finally { first.restore() }
  const second = makeHarness({ storage })
  try {
    await second.flush()
    const c = second.controller
    assert.equal(c.volume.get(), 0, 'exact persisted volume restored')
    assert.equal(c.spotifyAutoplay.get(), false)
    assert.equal(c.workspaceView.get(), 'browse')
  } finally { second.restore() }
})

test('diagnostics are structured, sanitized and bounded; clearing them touches nothing else', async () => {
  const harness = makeHarness({
    rest: async (path) => {
      if (path.startsWith('/youtube/embed-host')) return { ok: true, data: { url: 'http://127.0.0.1:43111/youtube/abcdefghijk?token=CAPABILITY-SECRET' } }
      if (path.startsWith('/playlists')) return { ok: false, error: 'error invoking remote method hermes:api raw provider dump {token:OAUTH-SECRET}' }
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
    await c.transferSpotifyDevice('abcdef1234567890')
    await harness.flush()
    const transferLog = c.logs.get().find(entry => entry.detail.route === '/transfer')
    assert.ok(transferLog, 'the transfer command is logged')
    assert.equal(transferLog.detail.device, '…567890', 'device ids are masked to a short suffix')
    assert.ok(!JSON.stringify(c.logs.get()).includes('abcdef1234567890'), 'the full device id never enters diagnostics')
    await c.resolveYouTubeEmbedUrl({ source: 'youtube', id: 'youtube:abcdefghijk' })
    const embedLog = c.logs.get().find(entry => entry.detail.route === '/youtube/embed-host')
    assert.ok(embedLog, 'the embed-host request is logged by route only')
    assert.ok(!JSON.stringify(c.logs.get()).includes('CAPABILITY-SECRET'), 'capability tokens in responses/queries never enter diagnostics')
    assert.ok(!JSON.stringify(c.logs.get()).includes('video_id='), 'query strings are stripped from logged routes')
    await assert.rejects(() => c.loadSpotifyPlaylists())
    const failureLog = c.logs.get().find(entry => entry.event === 'api.failure')
    assert.ok(failureLog, 'failures are logged with remediation context')
    assert.ok(!JSON.stringify(c.logs.get()).includes('OAUTH-SECRET'), 'raw provider payloads never enter diagnostics')
    assert.ok(!JSON.stringify(c.logs.get()).includes('error invoking remote method'), 'host-internal error shapes are replaced by a safe fallback')
    for (let at = 0; at < 260; at += 1) await c.refreshHistory()
    assert.equal(c.logs.get().length, 250, 'diagnostics are bounded to the newest 250 entries')
    const queueSnapshot = JSON.stringify(c.queue.get())
    const playlistSnapshot = JSON.stringify(c.playlists.get())
    const storageSnapshot = JSON.stringify([...harness.storage.entries()])
    c.clearLogs()
    assert.equal(c.logs.get().length, 0)
    assert.equal(JSON.stringify(c.queue.get()), queueSnapshot, 'clearing diagnostics never touches the queue')
    assert.equal(JSON.stringify(c.playlists.get()), playlistSnapshot, 'clearing diagnostics never touches collections')
    assert.equal(JSON.stringify([...harness.storage.entries()]), storageSnapshot, 'clearing diagnostics never rewrites persisted data')
  } finally { harness.restore() }
})

test('Spotify auth/device failure is truthful and cannot erase other source status', async () => {
  const harness = makeHarness({
    rest: async (path) => {
      if (path === '/spotify/auth/status') return { ok: false, error: 'Spotify authentication expired. Reconnect to continue.', status_code: 401 }
      if (path === '/devices') return { ok: false, error: 'Spotify authentication expired. Reconnect to continue.', status_code: 401 }
      if (path.startsWith('/local/tracks')) return { ok: true, data: { items: [], total: 0 } }
      if (path === '/local/roots') return { ok: true, data: { roots: [] } }
      if (path === '/history') return { ok: true, data: { items: [], total: 0 } }
      return { ok: true, data: {} }
    },
  })
  try {
    const c = harness.controller
    await harness.flush()
    const auth = await c.refreshSpotifyAuth()
    assert.equal(auth.state, 'failed')
    assert.equal(auth.authenticated, false)
    assert.match(auth.detail, /authentication expired/)
    const devices = await c.refreshSpotifyDevices()
    assert.deepEqual(devices, [])
    assert.equal(c.spotifyFailure.get().reason, 'auth-required', 'the failure is classified with a real remedy')
    assert.equal(c.spotifyFailure.get().action, 'reconnect')
    assert.equal(c.status.get(), 'idle', 'a provider status failure is not a playback error')
    assert.equal(c.add({ source: 'radio', id: 'a', title: 'Station', streamUrl: 'https://radio.example/a.mp3' }, true), true)
    await harness.flush()
    assert.equal(c.status.get(), 'playing', 'radio remains fully usable while Spotify is failed')
    assert.equal(c.current().source, 'radio')
    assert.equal(c.add({ source: 'local', id: 'local:x', localTrackId: 'x', title: 'Local', filePath: 'C:/Music/x.mp3' }, true), true)
    await harness.flush()
    assert.equal(c.status.get(), 'playing', 'local remains fully usable while Spotify is failed')
    assert.equal(c.current().source, 'local')
    assert.equal(c.spotifyAuth.get().state, 'failed', 'the failed provider status stays visible, never silently erased')
  } finally { harness.restore() }
})

test('Settings is a dedicated destination with owned provider status and sanitized diagnostics copy', () => {
  const settings = source.slice(source.indexOf('function SettingsPage('), source.indexOf('function LogsPage('))
  assert.match(settings, /\['providers', 'Providers'\], \['playback', 'Playback'\], \['diagnostics', 'Diagnostics'\]/)
  assert.match(settings, /h\(SpotifyConnection, \{ controller \}\)/, 'the owned FluidMusic connection card, not another plugin')
  assert.match(settings, /Let Spotify continue after a track/, 'queue-behavior setting with an honest explanation')
  const logs = source.slice(source.indexOf('function LogsPage('), source.indexOf('const PRIMARY_NAV'))
  assert.match(logs, /Sanitized provider commands and playback transitions/)
  assert.match(logs, /Clear logs/)
  const connection = source.slice(source.indexOf('function SpotifyConnection('), source.indexOf('function SearchPage('))
  assert.match(connection, /Connect Spotify/)
  assert.match(connection, /Waiting for browser approval…/, 'connecting state is truthful, never a static connected badge')
  assert.match(connection, /No devices available/)
  assert.match(connection, /Check local playback/, 'in-plugin audio capability is assessed, not promised')
  assert.doesNotMatch(source, /from ['"]\.\.\/.*spotify/i, 'no sibling-plugin Spotify import')
})
