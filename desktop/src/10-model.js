
/* PURE_FUNCTIONS_START */
const LOCAL_AUDIO_EXTENSIONS = /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i
function clampVolume(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5
}

function safeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function userFacingError(value, fallback = 'The provider request failed.') {
  const text = safeText(value?.message || value)
  if (!text) return fallback
  if (/error invoking remote method|hermes:api|headless backend|web ui disabled|^\s*(?:404:\s*)?\{/i.test(text)) return fallback
  return text.length > 240 ? fallback : text
}

function makeId(prefix, value) {
  const text = safeText(value, '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
  return `${prefix}:${text || Date.now().toString(36)}`
}

function localPlaybackUrls(value) {
  const filePath = safeText(value)
  if (!filePath || !/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(filePath)) return []
  const encoded = encodeURIComponent(filePath)
  return [`hermes-media://stream/${encoded}`, `hermes-media://remote/${encoded}`]
}

function localTrackItem(value) {
  if (!value || typeof value !== 'object') return null
  return normalizeQueueItem({
    source: 'local',
    id: value.id ? `local:${value.id}` : '',
    localTrackId: value.id,
    title: value.title,
    subtitle: value.subtitle || value.relative_path,
    filePath: value.path,
    mimeType: value.mime_type,
    durationMs: value.duration_ms,
    unavailable: value.available === false
  })
}

function safeYouTubeWatchUrl(value) {
  try {
    const url = new URL(safeText(value))
    if (url.protocol !== 'https:' || url.username || url.password) return null
    let videoId = ''
    if (url.hostname === 'www.youtube.com' && url.pathname === '/watch') videoId = safeText(url.searchParams.get('v'))
    else if (url.hostname === 'youtu.be' && /^\/[A-Za-z0-9_-]{11}$/.test(url.pathname)) videoId = url.pathname.slice(1)
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null
    return { url: url.href, videoId }
  } catch {
    return null
  }
}

function safeHttpsMetadataUrl(value) {
  try {
    const url = new URL(safeText(value))
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

function normalizeQueueItem(value) {
  if (!value || typeof value !== 'object') return null
  const source = value.source
  if (!['spotify', 'radio', 'local', 'youtube'].includes(source)) return null
  const title = safeText(value.title, source === 'radio' ? 'Untitled station' : source === 'local' ? 'Untitled local track' : source === 'youtube' ? 'YouTube video' : 'Untitled track').slice(0, 300)
  if (source === 'spotify') {
    const uri = safeText(value.uri)
    if (!/^spotify:(track|album|playlist):[A-Za-z0-9]+$/.test(uri)) return null
    const contextUri = /^spotify:(album|playlist):[A-Za-z0-9]+$/.test(safeText(value.contextUri)) ? safeText(value.contextUri) : ''
    return { id: safeText(value.id, makeId('spotify', uri)), source, title, subtitle: safeText(value.subtitle), uri, contextUri, artwork: safeText(value.artwork), album: safeText(value.album), durationMs: Math.max(0, Number(value.durationMs) || 0), kind: safeText(value.kind, uri.split(':')[1]), explicit: Boolean(value.explicit) }
  }
  if (source === 'radio') {
    const streamUrl = safeRadioStreamUrl(value.streamUrl)
    if (!streamUrl) return null
    return { id: safeText(value.id, makeId('radio', streamUrl)), source, title, subtitle: safeText(value.subtitle, safeText(value.provider)), streamUrl, homepage: safeText(value.homepage), favicon: safeText(value.favicon), artwork: safeText(value.artwork, safeText(value.favicon)), country: safeText(value.country), language: safeText(value.language), tags: safeText(value.tags), codec: safeText(value.codec), bitrate: safeText(value.bitrate) }
  }
  if (source === 'youtube') {
    const watch = safeYouTubeWatchUrl(value.url)
    if (!watch) return null
    return { id: `youtube:${watch.videoId}`, source, url: watch.url, title, subtitle: safeText(value.subtitle, 'YouTube').slice(0, 300), durationMs: Math.max(0, Math.min(86_400_000, Number(value.durationMs) || 0)), artwork: safeHttpsMetadataUrl(value.artwork) }
  }
  if (source === 'local') {
    const objectUrl = safeText(value.objectUrl)
    const localTrackId = safeText(value.localTrackId)
    const filePath = safeText(value.filePath)
    const playbackUrls = localPlaybackUrls(filePath)
    if (!objectUrl.startsWith('blob:') && !localTrackId && !value.unavailable) return null
    return {
      id: safeText(value.id, localTrackId ? `local:${localTrackId}` : makeId('local', objectUrl)),
      source,
      title,
      subtitle: safeText(value.subtitle),
      localTrackId,
      filePath,
      objectUrl: objectUrl.startsWith('blob:') ? objectUrl : '',
      playbackUrls,
      mimeType: safeText(value.mimeType),
      durationMs: Math.max(0, Number(value.durationMs) || 0),
      unavailable: Boolean(value.unavailable || (!objectUrl.startsWith('blob:') && (!filePath || playbackUrls.length === 0)))
    }
  }
}

function normalizeQueue(values) {
  return Array.isArray(values) ? values.map(normalizeQueueItem).filter(Boolean) : []
}

function normalizeQueueSelection(values, selectedIndex) {
  const raw = Array.isArray(values) ? values : []
  const selected = Number.isInteger(selectedIndex) ? selectedIndex : -1
  const items = []
  let index = -1
  raw.forEach((value, at) => {
    const item = normalizeQueueItem(value)
    if (!item) return
    if (at === selected) index = items.length
    items.push(item)
  })
  return { items, index }
}

function nextQueueIndex(length, current) {
  if (!Number.isInteger(length) || length < 1) return -1
  return (Number.isInteger(current) && current >= 0 ? current + 1 : 0) % length
}

function previousQueueIndex(length, current) {
  if (!Number.isInteger(length) || length < 1) return -1
  return (Number.isInteger(current) && current >= 0 ? current - 1 + length : 0) % length
}

function sourceLabel(item) {
  return item ? SOURCES[item.source] || 'Media' : 'Media'
}

function shouldShowNext(item) {
  return item?.source !== 'radio'
}

function mediaCapabilities(item) {
  const source = item?.source
  return {
    play: source === 'spotify' || source === 'radio' || source === 'local' || source === 'youtube',
    previous: source === 'spotify' || source === 'local' || source === 'youtube',
    next: source === 'spotify' || source === 'local' || source === 'youtube',
    seek: source === 'spotify' || source === 'local' || source === 'youtube',
    volume: source === 'spotify' || source === 'radio' || source === 'local' || source === 'youtube',
    shuffle: source === 'spotify',
    repeat: source === 'spotify',
    device: source === 'spotify'
  }
}

function formatClock(milliseconds) {
  const seconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function isSupportedLocalAudio(file) {
  if (!file || typeof file !== 'object') return false
  return safeText(file.type).toLowerCase().startsWith('audio/') || LOCAL_AUDIO_EXTENSIONS.test(safeText(file.name))
}

function isBlockedRadioHost(hostname) {
  const host = safeText(hostname).toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.local')) return true
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number)
    if (octets.some(octet => octet > 255)) return true
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
  }
  // URL.hostname exposes IPv6 literals bracketed. This is literal-only filtering;
  // the renderer does not perform or claim DNS resolution.
  return host === '::' || host === '::1' || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host)
}

function safeRadioStreamUrl(value) {
  try {
    const url = new URL(safeText(value))
    return url.protocol === 'https:' && !url.username && !url.password && !isBlockedRadioHost(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

function spotifyPlayPayload(value) {
  const uri = safeText(value?.uri || value)
  const contextUri = safeText(value?.contextUri)
  if (/^spotify:track:/.test(uri) && /^spotify:(album|playlist):/.test(contextUri)) {
    return { context_uri: contextUri, offset: uri }
  }
  return /^spotify:track:/.test(uri) ? { uris: [uri] } : { context_uri: uri }
}

function isWorkspaceView(value) {
  const aliases = { home: 'browse', search: 'browse', radio: 'browse', playlists: 'library', local: 'library', logs: 'settings' }
  const next = aliases[value] || value
  return ['browse', 'library', 'queue', 'settings'].includes(next) ? next : 'browse'
}

function serializePlaylistItem(value) {
  const item = normalizeQueueItem(value)
  if (!item) return null
  if (item.source !== 'local') return item
  return {
    source: 'local',
    id: item.id,
    localTrackId: item.localTrackId,
    title: item.title,
    subtitle: item.subtitle,
    mimeType: item.mimeType,
    durationMs: item.durationMs,
    unavailable: !item.localTrackId
  }
}

function normalizePlaylistState(value) {
  const root = value && typeof value === 'object' ? value : {}
  const playlists = Array.isArray(root.playlists) ? root.playlists : []
  return {
    version: 3,
    playlists: playlists.map((entry, at) => {
      const rawItems = Array.isArray(entry?.items) ? entry.items : []
      const items = rawItems.map(item => serializePlaylistItem(item)).filter(Boolean)
      const legacy = entry?.legacy === true || rawItems.some(value => {
        const item = normalizeQueueItem(value)
        return !item || item.source !== 'local' || !item.localTrackId
      })
      return { id: safeText(entry?.id, makeId('playlist', `${at}`)), name: safeText(entry?.name, 'Untitled collection'), description: safeText(entry?.description), createdAt: safeText(entry?.createdAt), updatedAt: safeText(entry?.updatedAt), items, legacy }
    })
  }
}

const QUEUE_ORIGINS = { search: 'From search', history: 'From history', collection: 'From collection', provider: 'From provider', library: 'From local library', session: 'Opened this session' }
function queueOriginLabel(origin) {
  return QUEUE_ORIGINS[origin] || ''
}
function normalizeListeningSessions(value) {
  // Listening sessions are durable snapshots of SAFE references only. Stored
  // data is re-serialized on load so blob handles, raw paths or capability
  // URLs can never survive into a restored session, and bounds are enforced.
  const list = Array.isArray(value) ? value : []
  return list.slice(0, 50).map(entry => {
    if (!entry || typeof entry !== 'object') return null
    const items = (Array.isArray(entry.items) ? entry.items : []).map(serializePlaylistItem).filter(item => item && !(item.source === 'local' && !item.localTrackId)).slice(0, 500)
    if (!items.length) return null
    return { id: safeText(entry.id, makeId('session', 'restored')), name: safeText(entry.name, 'Listening session').slice(0, 120), createdAt: safeText(entry.createdAt), items }
  }).filter(Boolean)
}

function normalizeSpotifyAuth(value) {
  const root = value?.data || value || {}
  const data = root.auth || root.spotify || root
  const flow = root.flow || {}
  const status = safeText(data.status || flow.state).toLowerCase()
  const authenticated = Boolean(data.authenticated || data.connected || data.logged_in || status === 'authenticated')
  const failed = Boolean(data.failed || status === 'failed' || status === 'error')
  const configured = data.client_id_configured ?? data.clientIdConfigured ?? data.client_configured ?? data.configured
  const needsClientId = root.setup?.client_id_required === true || configured === false || status === 'missing_client_id'
  return { state: authenticated ? 'authenticated' : failed ? 'failed' : status || 'disconnected', authenticated, needsClientId, detail: safeText(flow.error || data.message || data.detail || data.error) }
}

function normalizeSpotifyDevices(value) {
  const devices = value?.devices || value?.data?.devices || value || []
  return Array.isArray(devices) ? devices.filter(device => device && safeText(device.id)).map(device => ({ id: safeText(device.id), name: safeText(device.name, 'Unnamed device'), type: safeText(device.type, 'Spotify Connect'), active: Boolean(device.is_active || device.active), restricted: Boolean(device.is_restricted) })) : []
}


const YOUTUBE_COMMAND_FUNCS = ['playVideo', 'pauseVideo', 'seekTo', 'setVolume', 'mute', 'unMute', 'stopVideo']
function youTubeCommandMessage(func, args = []) {
  if (!YOUTUBE_COMMAND_FUNCS.includes(func)) return null
  return JSON.stringify({ event: 'command', func, args: Array.isArray(args) ? args : [], id: 'fluid-music', channel: 'fluid-music' })
}
function youTubeListeningMessage() {
  return JSON.stringify({ event: 'listening', id: 'fluid-music', channel: 'fluid-music' })
}
function embedFrameOrigin(src) {
  try {
    const url = new URL(safeText(src))
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : ''
  } catch {
    return ''
  }
}
function parseYouTubePlayerMessage(value, expectedVideoId = '') {
  let data = value
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { return null }
  }
  if (!data || typeof data !== 'object') return null
  const info = data.info && typeof data.info === 'object' ? data.info : null
  if (data.event === 'onReady') return { kind: 'ready', videoId: safeText(info?.videoData?.video_id) }
  if (data.event === 'onError') {
    const errorCode = Number(data.info)
    return Number.isInteger(errorCode) && errorCode >= 0 ? { kind: 'error', errorCode } : null
  }
  if (data.event === 'onAutoplayBlocked') return { kind: 'autoplay-blocked' }
  if (data.event !== 'infoDelivery' || !info) return null
  const videoId = safeText(info.videoData?.video_id)
  if (expectedVideoId && videoId && videoId !== expectedVideoId) return null
  const playerState = Number(info.playerState)
  if (!Number.isInteger(playerState) || playerState < -1 || playerState > 5) return null
  return {
    kind: 'state',
    videoId,
    playerState,
    playing: playerState === 1,
    ended: playerState === 0,
    positionMs: Math.max(0, Number(info.currentTime) || 0) * 1000,
    durationMs: Math.max(0, Number(info.duration) || 0) * 1000
  }
}

const YOUTUBE_FAILURES = {
  'invalid-video-id': { action: 'skip', retryable: false, fallbackEligible: false, contentAvailable: null, message: 'That YouTube link or video ID is invalid.', remedy: 'Check the URL or choose another video.' },
  'html5-player-failure': { action: 'retry', retryable: true, fallbackEligible: true, contentAvailable: null, message: 'The YouTube player failed to start this video.', remedy: 'Retry once; if it keeps failing, use Skip or another video.' },
  'video-not-found': { action: 'skip', retryable: false, fallbackEligible: false, contentAvailable: false, message: 'This video was removed or is not found.', remedy: 'Skip it or choose another video.' },
  'embed-denied-by-owner': { action: 'fallback', retryable: false, fallbackEligible: true, contentAvailable: null, message: "This video's owner disabled embedding.", remedy: 'Use Skip, or try the first-party watch fallback when available.' },
  'missing-referer-identification': { action: 'fix-configuration', retryable: true, fallbackEligible: false, contentAvailable: null, message: 'YouTube rejected the player identification (Referer/origin).', remedy: 'Reload the player; if it persists, report diagnostics.' },
  'autoplay-blocked': { action: 'interact', retryable: false, fallbackEligible: false, contentAvailable: null, message: 'The browser blocked autoplay.', remedy: 'Press play in the FluidMusic player to start.' },
  'wrong-video-state': { action: 'retry', retryable: true, fallbackEligible: false, contentAvailable: null, message: 'The player is showing a different video than selected.', remedy: 'Retry to reload the selected video.' },
  'origin-mismatch': { action: 'fix-configuration', retryable: true, fallbackEligible: false, contentAvailable: null, message: 'The player origin does not match the embedded frame.', remedy: 'Reload the player; if it persists, report diagnostics.' },
  'player-not-ready': { action: 'wait', retryable: false, fallbackEligible: false, contentAvailable: null, message: 'The YouTube player is not ready yet.', remedy: 'Wait for the player to finish loading.' },
  'stale-generation': { action: 'ignore', retryable: false, fallbackEligible: false, contentAvailable: null, message: '', remedy: '' },
  'content-unavailable': { action: 'skip', retryable: false, fallbackEligible: false, contentAvailable: false, message: 'This video is unavailable.', remedy: 'Skip it or choose another video.' },
  'private-video': { action: 'skip', retryable: false, fallbackEligible: false, contentAvailable: false, message: 'This video is private.', remedy: 'Skip it; private videos cannot be played.' },
  'consent-required': { action: 'sign-in', retryable: false, fallbackEligible: true, contentAvailable: null, message: 'This video requires YouTube sign-in or age confirmation.', remedy: 'Sign in on the first-party watch surface when available, or skip.' },
  'rate-limited': { action: 'wait', retryable: true, fallbackEligible: false, contentAvailable: null, message: 'YouTube is rate-limiting requests.', remedy: 'Wait a moment, then retry.' },
  'network-error': { action: 'retry', retryable: true, fallbackEligible: false, contentAvailable: null, message: 'YouTube could not be reached.', remedy: 'Check the connection and retry.' },
  'undetermined': { action: 'diagnose', retryable: false, fallbackEligible: false, contentAvailable: null, message: 'YouTube playback failed for an undetermined reason.', remedy: 'Retry once or copy diagnostics; the cause is not yet known.' }
}
function classifyYouTubeFailure(signal) {
  // Documented IFrame API semantics (PROVIDER_RESEARCH): 2 invalid ID,
  // 5 HTML5 failure, 100 removed/not found, 101/150 owner embed denial,
  // 153 missing Referer/API-client identification. Unknown stays unknown —
  // an iframe that did not start is NOT evidence of removed/private content.
  let reason = 'undetermined'
  if (signal && typeof signal === 'object') {
    if (signal.kind === 'player-error') {
      const code = Number(signal.errorCode)
      reason = code === 2 ? 'invalid-video-id'
        : code === 5 ? 'html5-player-failure'
        : code === 100 ? 'video-not-found'
        : code === 101 || code === 150 ? 'embed-denied-by-owner'
        : code === 153 ? 'missing-referer-identification'
        : 'undetermined'
    } else if (signal.kind === 'autoplay-blocked') {
      reason = 'autoplay-blocked'
    } else if (signal.kind === 'bridge') {
      reason = signal.reason === 'wrong-video' ? 'wrong-video-state'
        : signal.reason === 'wrong-origin' ? 'origin-mismatch'
        : signal.reason === 'not-ready' ? 'player-not-ready'
        : signal.reason === 'stale-generation' ? 'stale-generation'
        : 'undetermined'
    } else if (signal.kind === 'provider' && YOUTUBE_FAILURES[signal.code]) {
      reason = signal.code
    }
  }
  return { reason, ...YOUTUBE_FAILURES[reason] }
}

// REQUIRED public host contract for an owned first-party watch surface.
// NONE of these exports exist in the current public Hermes Desktop SDK
// (verified against apps/desktop/src/sdk/index.ts: the only sanctioned embed
// primitive is SandboxedFrame — an opaque-origin iframe that forbids
// allow-same-origin, so it can never hold a genuine provider login; raw
// <webview> is explicitly rejected because it shares the app preview
// partition). Full-scope FM-08 acceptance is gated on the host shipping this
// contract; until then the adapter reports an honest unavailable state and
// never opens an external app, focused-chat tab, or duplicate pane.
function youTubeWatchCapability(namespace) {
  const sdk = namespace && typeof namespace === 'object' ? namespace : {}
  const hostApi = sdk.host && typeof sdk.host === 'object' ? sdk.host : {}
  const missing = []
  if (typeof sdk.OwnedMediaView !== 'function') missing.push('OwnedMediaView')
  const session = hostApi.mediaSession
  if (!session || typeof session.ensurePartition !== 'function' || typeof session.openLogin !== 'function' || typeof session.dispose !== 'function') missing.push('host.mediaSession')
  return { available: missing.length === 0, missing, OwnedMediaView: sdk.OwnedMediaView, mediaSession: session }
}

function classifySpotifyFailure(value) {
  // Distinct remediation per official Web API status semantics; unknown stays
  // unknown. Connect control errors are never evidence about local audio.
  const status = Number(value?.statusCode ?? value?.status_code)
  const text = safeText(value?.message).toLowerCase()
  let reason = 'undetermined'
  if (status === 401 || /(?:authentication|auth).*(?:expired|required)|reconnect/.test(text)) reason = 'auth-required'
  else if (status === 429) reason = 'rate-limited'
  else if (status === 403 && /scope/.test(text)) reason = 'insufficient-scope'
  else if (status === 403) reason = 'forbidden'
  else if (status === 410 || (status === 404 && /device|player/.test(text)) || text.includes('no active device') || text.includes('no device')) reason = 'no-device'
  else if (status === 404) reason = 'not-found'
  else if (status >= 500 && status <= 599) reason = 'transient'
  const matrix = {
    'auth-required': { action: 'reconnect', retryable: false, message: 'Spotify sign-in expired or is required.', remedy: 'Reconnect Spotify in Settings.' },
    'rate-limited': { action: 'wait', retryable: true, message: 'Spotify is rate-limiting requests.', remedy: 'Wait a moment, then retry.' },
    'insufficient-scope': { action: 'reconnect', retryable: false, message: 'Spotify sign-in is missing a permission this action needs.', remedy: 'Reconnect Spotify to grant the required scopes.' },
    'forbidden': { action: 'check-account', retryable: false, message: 'Spotify refused this action for the account or device.', remedy: 'Check Premium eligibility and device restrictions; choose another device.' },
    'no-device': { action: 'choose-device', retryable: true, message: 'No active Spotify Connect device is available.', remedy: 'Open Spotify on a device, then retry or transfer playback.' },
    'not-found': { action: 'skip', retryable: false, message: 'That Spotify item was not found.', remedy: 'Skip it or choose another item.' },
    'transient': { action: 'retry', retryable: true, message: 'Spotify had a temporary problem.', remedy: 'Retry in a moment.' },
    'undetermined': { action: 'diagnose', retryable: false, message: 'Spotify request failed for an undetermined reason.', remedy: 'Retry once or copy diagnostics; the cause is not yet known.' }
  }
  return { reason, ...matrix[reason] }
}
function spotifyEntryUnavailableReason(track) {
  if (!track || typeof track !== 'object') return 'Removed or unavailable on Spotify.'
  if (track.is_local) return 'Local file — not synced to Spotify streaming.'
  const restriction = safeText(track?.restrictions?.reason)
  if (restriction === 'market') return 'Not available in your market.'
  if (restriction === 'product') return 'Requires a different Spotify subscription.'
  if (restriction === 'explicit') return 'Blocked by explicit-content settings.'
  if (track.is_playable === false) return 'Not playable on your account right now.'
  return 'Unavailable on Spotify.'
}

function spotifyLocalPlaybackCapability(signals) {
  // Official Web Playback SDK requirements: Premium account, encrypted-media
  // (Widevine) in the ACTUAL packaged runtime, SDK presence, and Spotify's
  // prior written approval for commercial use. Connect remote control is NOT
  // decoded in-plugin audio. Without owner-side audio proof the best honest
  // state is 'eligible-unproven' — never a silent full-audio certification.
  const product = safeText(signals?.product).toLowerCase()
  if (product && product !== 'premium') {
    return { state: 'ineligible-account', reasons: ['Spotify Web Playback SDK requires a Premium account.'], localAudio: false }
  }
  if (signals?.checked && (!signals.sdkPresent || !signals.emeSupported)) {
    const reasons = []
    if (!signals.sdkPresent) reasons.push('The Spotify Web Playback SDK is not available in this runtime.')
    if (!signals.emeSupported) reasons.push('Encrypted-media (Widevine) support was not detected in this runtime.')
    return { state: 'unsupported-runtime', reasons, localAudio: false }
  }
  if (signals?.checked && signals.sdkPresent && signals.emeSupported && product === 'premium') {
    return { state: 'eligible-unproven', reasons: ['Account and runtime checks pass; actual in-plugin audio still needs owner Desktop proof and provider approval.'], localAudio: null }
  }
  return { state: 'unverified', reasons: ['Local playback capability has not been checked on this runtime.'], localAudio: null }
}

const RADIO_PRESETS = [
  { source: 'radio', id: 'fluid-chillsynth', title: 'Chillsynth', subtitle: 'Soft focus · warm synths', streamUrl: 'https://stream.nightride.fm/chillsynth.mp3', homepage: 'https://nightride.fm/?station=chillsynth' },
  { source: 'radio', id: 'fluid-nightride', title: 'Nightride', subtitle: 'Synthwave · after hours', streamUrl: 'https://stream.nightride.fm/nightride.mp3', homepage: 'https://nightride.fm/' },
  { source: 'radio', id: 'fluid-paradise', title: 'Radio Paradise', subtitle: 'Eclectic · human selected', streamUrl: 'https://stream.radioparadise.com/aac-128', homepage: 'https://radioparadise.com/' }
]
/* PURE_FUNCTIONS_END */