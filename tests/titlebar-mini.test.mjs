import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-14 titlebar popover + dockable mini-player fixtures. Static bundle/CSS
// proofs plus a headless controller-region check that popover/session changes
// never stop observation or issue commands. These are labelled cloud fixtures:
// live focus behavior, rendered pixels and audio on the owner's packaged
// Desktop remain an explicit FM-25 review gate, not claims made here.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const css = source.match(/const CSS = `([\s\S]*?)`/)?.[1]
assert.ok(css, 'CSS template is present')
const fn = (name, next) => {
  const start = source.indexOf(`function ${name}(`)
  const end = source.indexOf(`function ${next}(`)
  assert.ok(start >= 0 && end > start, `${name} boundary`)
  return source.slice(start, end)
}
const popover = fn('PlayerPopover', 'TitlebarPlayer')
const titlebar = source.slice(source.indexOf('function TitlebarPlayer('), source.indexOf('export default'))
const mini = fn('MiniPlayer', 'YouTubeControls')
const miniBar = fn('MiniControlBar', 'YouTubeTransport')

test('quiet titlebar trigger carries real title/state; popover is viewport-safe and restores trigger focus', () => {
  assert.match(titlebar, /'aria-expanded': open/)
  assert.match(titlebar, /'aria-haspopup': 'dialog'/)
  assert.match(titlebar, /'aria-controls': open \? 'fluid-title-popover' : undefined/)
  assert.match(titlebar, /className: 'fluid-titlebar-title'/, 'actual selected title on the trigger')
  assert.match(titlebar, /className: 'fluid-status-dot', 'data-state': state/, 'actual playback state, not color alone')
  assert.match(titlebar, /kind: \['playing', 'loading'\]\.includes\(state\) \? 'pause' : 'play'/, 'explicit play/pause beside the trigger')
  assert.match(titlebar, /event\.key === 'Escape'/, 'Escape dismissal')
  assert.match(titlebar, /document\.addEventListener\('pointerdown', onPointerDown\)/, 'outside-click dismissal')
  assert.match(titlebar, /rootRef\.current\?\.contains\(event\.target\)/, 'outside means outside the whole trigger+popover root')
  assert.match(titlebar, /trigger\.focus\(\)/, 'dismissal restores trigger focus')
  assert.match(titlebar, /popover\?\.querySelector\('button:not\(\[disabled\]\), input:not\(\[disabled\]\), \[tabindex="0"\]'\)\?\.focus\(\)/, 'open moves focus into the popover')
  assert.match(popover, /id: 'fluid-title-popover'/)
  assert.match(popover, /role: 'dialog', 'aria-label': 'FluidMusic quick controls'/)
  assert.match(css, /\.fluid-title-popover\{[^}]*width:min\(390px,calc\(100vw - 24px\)\)/)
  assert.match(css, /\.fluid-title-popover\{[^}]*max-height:min\(680px,calc\(100vh - 72px\)\)/)
  assert.match(css, /\.fluid-titlebar-source\{display:none\}/, 'source label hides before actual transport')
})

test('popover shares the ONE transport vocabulary, a playable short queue, and never opens a Browser', () => {
  assert.match(popover, /h\(Transport, \{ controller \}\)/)
  assert.match(popover, /h\(SeekBar, \{ controller \}\)/)
  assert.match(popover, /h\(VolumeControl, \{ controller \}\)/, 'usable full volume, not a tiny range')
  assert.match(popover, /queue\.slice\(at \+ 1, at \+ 4\)/, 'short queue preview')
  assert.match(popover, /h\('button', \{ type: 'button', className: 'fluid-next-row'/, 'queue rows are keyboard-reachable actions')
  assert.match(popover, /controller\.playAt\(at \+ offset \+ 1\)/, 'queue play goes through the shared coordinator')
  assert.match(popover, /'aria-label': `Play \$\{next\.title\}`/)
  assert.match(popover, /Open Queue/)
  assert.match(popover, /Open Media/)
  assert.doesNotMatch(popover + titlebar, /preview\.|openOrFocus/, 'no owned-Browser shortcut from the popover path')
})

test('exactly ONE dockable mini pane for every source; no second YouTube pane', () => {
  assert.equal((source.match(/id: 'mini-player'/g) || []).length, 1)
  assert.match(source, /id: 'mini-player', area: 'panes', title: 'FluidMusic player', data: \{ placement: 'right', width: '320px', height: '420px' \}/)
  assert.equal((source.match(/area: 'panes'/g) || []).length, 2, 'mini pane plus the gated SDK-incompatible fallback only')
  const gate = source.indexOf('if (!SDK_COMPATIBLE)')
  const fallback = source.indexOf("id: 'media-sdk-fallback'")
  const miniReg = source.indexOf("id: 'mini-player'")
  assert.ok(gate >= 0 && fallback > gate && miniReg > fallback, 'fallback pane stays inside the incompatibility gate')
  assert.match(mini, /fluid-youtube-player/, 'YouTube renders inside the SAME mini player surface')
  assert.match(mini, /EmbeddedYouTubeFrame/)
  assert.match(mini, /OwnedWatchSurface/)
  assert.doesNotMatch(source, /id: 'youtube-(?:pane|player|video)'/, 'no dedicated YouTube pane registration')
})

test('mini pane adapts art/video to pane size above anchored controls; video minimum is declared, not faked', () => {
  assert.match(css, /\.fluid-mini-player\{container:mini \/ size\}/, 'container HEIGHT queries, not window guesses')
  assert.match(css, /\.fluid-youtube-player\{grid-template-rows:minmax\(200px,1fr\) auto;overflow:auto\}/, 'video row never collapses below 200px; short panes scroll instead of clipping controls')
  assert.match(css, /\.fluid-youtube-frame\{min-width:200px;min-height:200px\}/, 'official 200x200 video minimum')
  assert.match(css, /\.fluid-youtube-frame-wrap\{min-height:200px\}/)
  assert.match(css, /@container mini \(max-height:359px\)\{\.fluid-mini-expand-note\{display:block\}\}/, 'honest expand note below the ~360px video target')
  assert.match(mini, /fluid-mini-expand-note/, 'note is rendered by the player itself')
  assert.match(mini, /about 360px or more/)
  assert.match(css, /@container mini \(max-height:240px\)\{[\s\S]*?\.fluid-mini-summary \.fluid-mini-art\{width:40px;height:40px\}/, 'short audio pane shrinks art within the 40-64px band')
  assert.match(css, /@container mini \(max-height:170px\)\{[\s\S]*?\.fluid-mini-summary \.fluid-mini-art\{display:none\}\}/, 'very short pane drops decorative art before controls')
  assert.match(css, /\.fluid-mini-body\{overflow:auto\}/, 'body scrolls rather than silently clipping')
  assert.match(css, /\.fluid-mini-controls\{[^}]*border-top:1px solid var\(--fm-line\)/, 'controls stay the anchored bottom row')
  assert.match(css, /@container mini \(max-width:360px\)\{\.fluid-mini-controls\{[^}]*grid-template-areas:"controls links" "volume volume"/, 'narrow pane reflows volume to its own full row')
  assert.match(css, /\.fluid-mini-controls>\.fluid-volume\{grid-area:volume;width:100%;min-width:0\}/)
  assert.match(miniBar, /h\(VolumeControl, \{ controller, compact: true \}\)/, 'same shared VolumeControl as the main bar')
  assert.match(miniBar, /kind: 'previous'/)
  assert.match(miniBar, /kind: 'next'/)
  assert.match(miniBar, /'aria-label': playing \? 'Pause' : 'Play'/)
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.fluid-root \*,\.fluid-mini-player \*,\.fluid-titlebar \*/, 'reduced motion covers every touched surface')
})

// Headless controller-region fixture (labelled test doubles: fake audio,
// stubbed REST/timers, in-memory storage). Proves only that the registration-
// level controller keeps observing while the popover is hidden and the Media
// route is unmounted — not real provider polling or packaged-Desktop behavior.
const between = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start, `${startMarker} boundary is present`)
  return source.slice(start + startMarker.length, end)
}
const pureText = between('/* PURE_FUNCTIONS_START */', '/* PURE_FUNCTIONS_END */')
const controllerText = between('/* CONTROLLER_START */', '/* CONTROLLER_END */')
const pure = new Function(`const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' };\n${pureText}\nreturn { clampVolume, normalizeQueueItem, normalizeQueue, normalizeQueueSelection, nextQueueIndex, previousQueueIndex, sourceLabel, safeRadioStreamUrl, spotifyPlayPayload, isWorkspaceView, normalizeSpotifyAuth, normalizeSpotifyDevices, shouldShowNext, isSupportedLocalAudio, mediaCapabilities, normalizePlaylistState, serializePlaylistItem, userFacingError, localPlaybackUrls, localTrackItem, classifyYouTubeFailure, classifySpotifyFailure, spotifyLocalPlaybackCapability, spotifyEntryUnavailableReason, QUEUE_ORIGINS, normalizeListeningSessions, makeId, isLongFormEligible, mediaKeyFor, normalizeResumePosition, normalizeBookmark, formatPositionMs, boundedSleepMinutes, SLEEP_MAX_CUSTOM_MIN, retryGate, retryConsumed, normalizeHealthRow, RETRY_COOLDOWN_MS };`)()

function atom(initial) {
  let value = initial
  return { get: () => value, set: next => { value = next } }
}

const MEDIA_COMMAND_ROUTES = new Set(['/play', '/pause', '/next', '/previous', '/transfer', '/queue', '/seek', '/volume', '/shuffle', '/repeat'])

function makeHarness() {
  const restCalls = []
  const previewCalls = []
  const timers = []
  const disposers = []
  const original = { Audio: globalThis.Audio, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now }
  class FakeAudio {
    constructor() { this.listeners = new Map() }
    addEventListener(name, handler) { this.listeners.set(name, handler) }
    pause() { this.listeners.get('pause')?.() }
    removeAttribute() {}
    load() {}
    remove() {}
    async play() { this.listeners.get('playing')?.() }
  }
  globalThis.Audio = FakeAudio
  globalThis.setInterval = (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer }
  globalThis.clearInterval = timer => { if (timer) timer.cleared = true }
  globalThis.setTimeout = (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer }
  globalThis.clearTimeout = timer => { if (timer) timer.cleared = true }
  const rest = async (path, options) => {
    restCalls.push({ path, method: String(options?.method || 'GET').toUpperCase(), options })
    const route = path.split('?')[0]
    if (route === '/config') return { ok: true, data: { poll_interval_open: 8, poll_interval_closed: 20 } }
    if (route === '/player') return { ok: true, data: { is_playing: false } }
    if (route === '/local/roots') return { ok: true, data: { roots: [] } }
    if (route.startsWith('/local/tracks')) return { ok: true, data: { items: [], total: 0 } }
    if (route === '/history') return { ok: true, data: { items: [], total: 0 } }
    if (route === '/spotify/auth/status') return { ok: true, data: { auth: { logged_in: false }, setup: {}, flow: { state: 'idle', error: null } } }
    if (route === '/devices') return { ok: true, data: { devices: [] } }
    return { ok: true, data: {} }
  }
  const storage = new Map()
  const ctx = {
    storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) },
    rest,
    os: { pickOpenPath: async () => null },
    preview: { navigate: (...args) => previewCalls.push(args) },
    onDispose: fn => disposers.push(fn),
  }
  const factory = new Function('atom', 'normalizeQueue', 'normalizeQueueSelection', 'clampVolume', 'normalizeQueueItem', 'nextQueueIndex', 'previousQueueIndex', 'safeText', 'spotifyPlayPayload', 'normalizeSpotifyAuth', 'normalizeSpotifyDevices', 'normalizePlaylistState', 'serializePlaylistItem', 'mediaCapabilities', 'localTrackItem', 'localPlaybackUrls', 'userFacingError', 'isWorkspaceView', 'isSupportedLocalAudio', 'classifyYouTubeFailure', 'classifySpotifyFailure', 'spotifyLocalPlaybackCapability', 'spotifyEntryUnavailableReason', 'QUEUE_ORIGINS', 'normalizeListeningSessions', 'makeId', 'isLongFormEligible', 'mediaKeyFor', 'normalizeResumePosition', 'normalizeBookmark', 'formatPositionMs', 'boundedSleepMinutes', 'SLEEP_MAX_CUSTOM_MIN', 'retryGate', 'retryConsumed', 'normalizeHealthRow', 'RETRY_COOLDOWN_MS', `${controllerText}\nreturn createController;`)(atom, pure.normalizeQueue, pure.normalizeQueueSelection, pure.clampVolume, pure.normalizeQueueItem, pure.nextQueueIndex, pure.previousQueueIndex, (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback, pure.spotifyPlayPayload, pure.normalizeSpotifyAuth, pure.normalizeSpotifyDevices, pure.normalizePlaylistState, pure.serializePlaylistItem, pure.mediaCapabilities, pure.localTrackItem, pure.localPlaybackUrls, pure.userFacingError, pure.isWorkspaceView, pure.isSupportedLocalAudio, pure.classifyYouTubeFailure, pure.classifySpotifyFailure, pure.spotifyLocalPlaybackCapability, pure.spotifyEntryUnavailableReason, pure.QUEUE_ORIGINS, pure.normalizeListeningSessions, pure.makeId, pure.isLongFormEligible, pure.mediaKeyFor, pure.normalizeResumePosition, pure.normalizeBookmark, pure.formatPositionMs, pure.boundedSleepMinutes, pure.SLEEP_MAX_CUSTOM_MIN, pure.retryGate, pure.retryConsumed, pure.normalizeHealthRow, pure.RETRY_COOLDOWN_MS)
  const controller = factory(ctx)
  const flush = () => new Promise(resolve => process.nextTick(resolve))
  const mediaCalls = () => restCalls.filter(call => call.method !== 'GET' && MEDIA_COMMAND_ROUTES.has(call.path.split('?')[0]))
  return {
    controller, restCalls, previewCalls, timers, flush, mediaCalls,
    dispose: () => disposers.forEach(fn => fn()),
    restore() { globalThis.Audio = original.Audio; globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.dateNow },
  }
}

test('hidden popover and unmounted Media never stop active-source observation or issue commands', async () => {
  const harness = makeHarness()
  try {
    const { controller } = harness
    assert.equal(controller.add({ source: 'radio', id: 'a', title: 'Station A', streamUrl: 'https://radio.example/a' }), true)
    await harness.flush() // let loadConfig settle
    const livePoll = () => harness.timers.filter(timer => !timer.cleared && [8_000, 20_000].includes(timer.ms))
    assert.ok(livePoll().length >= 1, 'registration-level polling is running')
    const snapshot = { item: JSON.stringify(controller.current()), index: controller.index.get(), status: controller.status.get() }
    const timersBefore = harness.timers.length
    controller.titlebarOpen.set(true)
    await harness.flush()
    controller.titlebarOpen.set(false)
    await harness.flush()
    assert.equal(harness.timers.length, timersBefore, 'popover open/close creates and clears no timers')
    controller.setPollingOpen(false) // Media route unmounts while the popover stays hidden
    await harness.flush()
    assert.ok(livePoll().some(timer => timer.ms === 20_000), 'closed popover + unmounted Media still observe at the closed cadence')
    controller.setPollingOpen(true)
    await harness.flush()
    assert.ok(livePoll().some(timer => timer.ms === 8_000), 'remount restores the open cadence without a gap in ownership')
    for (const timer of livePoll()) { timer.fn(); await harness.flush() }
    assert.equal(JSON.stringify(controller.current()), snapshot.item, 'observation preserves the exact occurrence')
    assert.equal(controller.index.get(), snapshot.index)
    assert.equal(controller.status.get(), snapshot.status)
    assert.equal(harness.mediaCalls().length, 0, 'no transport command from popover/session changes or observation')
    assert.equal(harness.previewCalls.length, 0, 'no Browser navigation')
    harness.dispose()
    await harness.flush()
    controller.titlebarOpen.set(true)
    controller.setPollingOpen(true)
    await harness.flush()
    assert.ok(harness.timers.every(timer => timer.cleared), 'after disposal nothing resurrects, popover included')
  } finally { harness.restore() }
})
