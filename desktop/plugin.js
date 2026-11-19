import * as HermesSDK from '@hermes/plugin-sdk'
import { createElement as h, useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

/* SDK_BOUNDARY_START */
const HOST_CONTRACT = {
  contractVersion: 1,
  sdk: '@hermes/plugin-sdk',
  required: ['atom', 'useValue', 'host', 'ROUTES_AREA', 'TITLEBAR_AREAS'],
  optional: {
    Button: 'plain-button fallback with the same actions',
    'host.navigate': 'navigation shortcuts degrade; in-pane view switching still works',
    'TITLEBAR_AREAS.right': 'titlebar surface skipped; route and mini-player remain',
    OwnedMediaView: 'first-party YouTube watch fallback reports unavailable',
    'host.mediaSession': 'first-party YouTube watch fallback reports unavailable',
    'window.hermesDesktop.getEmbedHostOrigin': 'direct embed URL fallback',
    'window.Spotify.Player': 'in-plugin Spotify audio assessed as unsupported; Connect control remains',
  },
  minimum: 'Namespace SDK exposing atom, useValue, host, ROUTES_AREA and TITLEBAR_AREAS; React createElement/hooks are stable platform imports, not optional host exports.',
  policy: 'Current/next/absent capability fixtures guard the declared doors. Unknown arbitrary future breaking releases are not guaranteed; an incompatible host gets a precise recovery surface, never silent data deletion or rewritten product scope.',
}
const resolveSdk = namespace => {
  const sdk = namespace && typeof namespace === 'object' ? namespace : {}
  const missing = HOST_CONTRACT.required.filter(name => sdk[name] == null)
  const optional = {
    button: typeof sdk.Button === 'function',
    navigate: typeof sdk.host?.navigate === 'function',
    titlebarRight: sdk.TITLEBAR_AREAS?.right != null,
  }
  return { sdk, missing, compatible: missing.length === 0, optional }
}
/* SDK_BOUNDARY_END */
// Namespace import + capability check before any export is referenced: a
// missing named ESM binding would abort the whole plugin at link time, while
// this boundary lets registration render an honest fallback instead. Button
// is optional (WorkspaceButton and the titlebar summary fall back to a plain
// button); the rest are required for the current surfaces. React bindings
// above are stable platform APIs, not optional host exports.
const { sdk: SDK, missing: SDK_MISSING, compatible: SDK_COMPATIBLE, optional: SDK_OPTIONAL } = resolveSdk(HermesSDK)
const atom = SDK.atom
const useValue = SDK.useValue
const host = SDK.host
const ROUTES_AREA = SDK.ROUTES_AREA
const TITLEBAR_AREAS = SDK.TITLEBAR_AREAS
const Button = SDK.Button
const HOST_NAVIGATE = SDK_OPTIONAL.navigate ? SDK.host.navigate.bind(SDK.host) : null
const TITLEBAR_RIGHT = SDK_OPTIONAL.titlebarRight ? SDK.TITLEBAR_AREAS.right : null

const ID = 'fluid-music'
const ROUTE = '/media'
const SOURCES = { spotify: 'Spotify Connect', radio: 'Live radio', local: 'Local music', youtube: 'YouTube' }

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

const LONG_FORM_MIN_MS = 600000
const SLEEP_PRESETS_MIN = [15, 30, 60]
const SLEEP_MAX_CUSTOM_MIN = 720
function isLongFormEligible(item) {
  // Resume/bookmarks apply to eligible long-form YouTube/local items only.
  // LIVE radio is never seekable; Spotify Connect position is provider-owned.
  return Boolean(item && (item.source === 'youtube' || item.source === 'local') && !item.unavailable && Number(item.durationMs) >= LONG_FORM_MIN_MS)
}
function mediaKeyFor(item) {
  if (!item) return ''
  if (item.source === 'youtube') {
    const id = safeText(item.id).replace(/^youtube:/, '')
    return id ? `youtube:${id}` : ''
  }
  if (item.source === 'local' && item.localTrackId) return `local:${item.localTrackId}`
  return ''
}
function normalizeResumePosition(value) {
  if (!value || typeof value !== 'object') return null
  const mediaKey = safeText(value.media_key ?? value.mediaKey)
  if (!mediaKey) return null
  return {
    mediaKey,
    positionMs: Math.max(0, Math.min(86400000, Number(value.position_ms ?? value.positionMs) || 0)),
    durationMs: Math.max(0, Math.min(86400000, Number(value.duration_ms ?? value.durationMs) || 0)),
  }
}
function normalizeBookmark(value) {
  if (!value || typeof value !== 'object') return null
  const id = Number(value.id)
  if (!Number.isInteger(id) || id <= 0) return null
  return {
    id,
    mediaKey: safeText(value.media_key ?? value.mediaKey),
    positionMs: Math.max(0, Math.min(86400000, Number(value.position_ms ?? value.positionMs) || 0)),
    label: safeText(value.label).slice(0, 120),
    createdAt: safeText(value.created_at ?? value.createdAt),
  }
}
function formatPositionMs(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0) / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = Math.floor(total % 60)
  const pad = value => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}
function boundedSleepMinutes(value) {
  const minutes = Math.round(Number(value))
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > SLEEP_MAX_CUSTOM_MIN) return 0
  return minutes
}

const RETRY_MAX_ATTEMPTS = 3
const RETRY_COOLDOWN_MS = 30000
const HEALTH_SOURCES = ['spotify', 'youtube', 'local', 'radio', 'backend']
const HEALTH_STATES = ['ready', 'degraded', 'unavailable', 'unknown']
function retryGate(budget, nowMs) {
  const state = budget && typeof budget === 'object' ? budget : { attempts: 0, cooldownUntil: 0 }
  const cooldownUntil = Math.max(0, Number(state.cooldownUntil) || 0)
  if (cooldownUntil > nowMs) return { allowed: false, remainingMs: cooldownUntil - nowMs, attempts: Math.max(0, Number(state.attempts) || 0), cooldownUntil }
  const attempts = cooldownUntil > 0 ? 0 : Math.max(0, Number(state.attempts) || 0)
  return { allowed: true, remainingMs: 0, attempts, cooldownUntil: 0 }
}
function retryConsumed(budget, nowMs) {
  const gate = retryGate(budget, nowMs)
  const attempts = gate.attempts + 1
  if (attempts >= RETRY_MAX_ATTEMPTS) return { attempts: 0, cooldownUntil: nowMs + RETRY_COOLDOWN_MS }
  return { attempts, cooldownUntil: 0 }
}
function normalizeHealthRow(value) {
  if (!value || typeof value !== 'object') return null
  const source = safeText(value.source)
  if (!HEALTH_SOURCES.includes(source)) return null
  return {
    source,
    state: HEALTH_STATES.includes(value.state) ? value.state : 'unknown',
    detail: safeText(value.detail).slice(0, 200),
    action: safeText(value.action),
    lastEvidenceAt: safeText(value.lastEvidenceAt),
  }
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

const CSS = `
.fluid-root,.fluid-dialog,.fluid-mini-player{--fm-panel:color-mix(in srgb,var(--ui-bg-secondary) 80%,transparent);--fm-soft:color-mix(in srgb,var(--ui-accent) 9%,transparent);--fm-line:var(--ui-stroke-secondary);color:var(--ui-text-primary);font-family:inherit;font-size:13px;line-height:1.5}
.fluid-root{container:fluid / inline-size;height:100%;min-height:0;min-width:0}.fluid-app{height:100%;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:transparent;overflow:hidden}.fluid-root *,.fluid-dialog *,.fluid-mini-player *{box-sizing:border-box}.fluid-root button,.fluid-root input,.fluid-root textarea,.fluid-root select,.fluid-dialog input,.fluid-dialog textarea,.fluid-dialog select{font:inherit}.fluid-root :focus-visible,.fluid-dialog :focus-visible,.fluid-mini-player :focus-visible{outline:2px solid var(--ui-accent);outline-offset:3px}
.fluid-nav-button{display:flex;gap:10px;align-items:center;border:0;border-radius:6px;background:transparent;color:var(--ui-text-secondary);padding:10px 12px;cursor:pointer;text-align:left;min-height:38px}.fluid-nav-button:hover{background:var(--fm-soft)}.fluid-nav-button[data-active=true]{color:var(--ui-text-primary);background:var(--fm-soft);box-shadow:inset 2px 0 var(--ui-accent);font-weight:650}.fluid-provider-state{display:flex;gap:8px;align-items:center;color:var(--ui-text-secondary);font-size:11px}.fluid-state-dot,.fluid-status-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--ui-text-quaternary);flex:none}.fluid-state-dot[data-on=true],.fluid-status-dot[data-state=playing]{background:var(--ui-accent)}
.fluid-content{min-width:0;overflow:auto;padding:18px clamp(14px,2cqw,28px) 28px;scrollbar-gutter:stable}.fluid-content-inner{max-width:1360px;margin:0 auto}.fluid-page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px}.fluid-kicker{display:none}.fluid-page-title{font-size:clamp(19px,2cqw,25px);line-height:1.2;letter-spacing:-.03em;font-weight:650;margin:0}.fluid-page-subtitle{color:var(--ui-text-secondary);font-size:12px;max-width:680px;margin:5px 0 0;line-height:1.45}.fluid-section-title{font-size:17px;font-weight:650;letter-spacing:-.025em;margin:0}.fluid-section-copy{margin:6px 0 0;color:var(--ui-text-secondary);font-size:12px}.fluid-section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.fluid-actions,.fluid-row-actions,.fluid-tile-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.fluid-row-actions{gap:2px;flex-wrap:nowrap}.fluid-actions>button{white-space:nowrap}.fluid-muted{font-size:12px;color:var(--ui-text-secondary);line-height:1.6}.fluid-error{font-size:13px;color:var(--ui-text-primary);border-left:3px solid var(--ui-accent);padding:12px;background:var(--fm-soft)}.fluid-panel{border:1px solid var(--fm-line);border-radius:10px;min-width:0;background:var(--fm-panel)}.fluid-panel-pad{padding:22px}.fluid-empty{padding:24px 18px;border:1px dashed var(--fm-line);border-radius:9px;text-align:center;color:var(--ui-text-secondary);font-size:13px;line-height:1.7}.fluid-empty>svg{width:30px;height:30px;margin-bottom:12px;color:var(--ui-accent)}.fluid-empty strong{display:block;color:var(--ui-text-primary);font-size:18px;letter-spacing:-.025em;margin-bottom:8px}.fluid-empty .fluid-actions{justify-content:center;margin-top:20px}.fluid-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;margin:0 0 18px;background:var(--fm-soft);border-left:2px solid var(--ui-accent);font-size:12px;overflow-wrap:anywhere}.fluid-notice>span{min-width:0}
.fluid-now-title{font-size:clamp(19px,2cqw,25px);line-height:1.2;letter-spacing:-.03em;margin:0 0 6px;overflow-wrap:anywhere}.fluid-now-subtitle{color:var(--ui-text-secondary);margin:0 0 8px;font-size:12px}.fluid-result-section{margin-top:32px}.fluid-result-section>.fluid-section-title{margin-bottom:16px}.fluid-collection-icon{width:52px;height:52px;flex:none;background:var(--fm-soft);border:1px solid var(--fm-line);display:grid;place-items:center;border-radius:6px;color:var(--ui-accent)}.fluid-collection-icon>svg{width:25px;height:25px}
.fluid-input,.fluid-select,.fluid-textarea{width:100%;min-width:0;border:1px solid var(--fm-line);border-radius:6px;background:var(--ui-bg-secondary);color:var(--ui-text-primary);padding:10px 12px}.fluid-input::placeholder,.fluid-textarea::placeholder{color:var(--ui-text-tertiary)}.fluid-textarea{min-height:90px;resize:vertical}.fluid-searchbar{display:flex;align-items:center;gap:10px;margin:18px 0}.fluid-searchbar>.fluid-input{flex:1}.fluid-field{display:flex;flex-direction:column;gap:8px;font-size:12px;margin:18px 0}.fluid-field small{color:var(--ui-text-secondary)}.fluid-filter{max-width:300px}.fluid-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:18px}.fluid-media-tile{min-width:0;padding:0 0 12px}.fluid-tile-art{aspect-ratio:1;display:grid;place-items:center;background:var(--fm-soft);border:1px solid var(--fm-line);border-radius:8px;overflow:hidden;margin-bottom:12px}.fluid-tile-art>svg{width:36px;height:36px;color:var(--ui-accent)}.fluid-tile-title{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:13px}.fluid-tile-detail{display:block;color:var(--ui-text-secondary);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:11px;margin:4px 0 10px}
.fluid-track-list{border-top:1px solid var(--fm-line)}.fluid-track-row{display:grid;grid-template-columns:24px 40px minmax(0,1fr) 52px 40px auto;gap:12px;align-items:center;padding:12px 4px;border-bottom:1px solid var(--fm-line);min-width:0}.fluid-track-row:hover{background:var(--fm-soft)}.fluid-track-row[data-missing=true] .fluid-row-title{color:var(--ui-text-tertiary)}.fluid-track-number,.fluid-track-duration,.fluid-row-index{font-size:10px;color:var(--ui-text-tertiary);font-variant-numeric:tabular-nums}.fluid-source-tag{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--ui-text-secondary)}.fluid-mini-cover{width:40px;height:40px;border-radius:5px;overflow:hidden;background:var(--fm-soft);display:grid;place-items:center}.fluid-row-copy{min-width:0}.fluid-row-title{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;font-weight:550}.fluid-row-detail{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--ui-text-secondary);margin-top:4px}.fluid-queue-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:12px;padding:12px;border-bottom:1px solid var(--fm-line);align-items:center}.fluid-queue-row[data-current=true]{background:var(--fm-soft);box-shadow:inset 2px 0 var(--ui-accent)}.fluid-track-link{border:0;background:transparent;color:inherit;text-align:left;min-width:0;cursor:pointer;padding:0}.fluid-track-link:disabled{cursor:not-allowed}.fluid-mini-cover img,.fluid-tile-art img,.fluid-now-cover img,.fluid-library-cover img,.fluid-mini-art img{width:100%;height:100%;object-fit:cover}
.fluid-playlist-layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:28px}.fluid-playlist-browser{border-right:1px solid var(--fm-line);padding-right:20px;min-width:0}.fluid-playlist-list{display:flex;flex-direction:column;gap:5px;max-height:55vh;overflow:auto}.fluid-playlist-button{display:flex;align-items:center;gap:12px;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:12px;min-width:0}.fluid-playlist-button:hover{background:var(--fm-soft)}.fluid-playlist-button[data-active=true]{background:var(--fm-soft);border-color:var(--fm-line)}.fluid-playlist-button>svg{flex:none;color:var(--ui-accent)}.fluid-playlist-button strong{display:block;font-size:12px;overflow-wrap:anywhere}.fluid-playlist-button span span{display:block;font-size:10px;color:var(--ui-text-secondary)}.fluid-playlist-editor{min-width:0}.fluid-playlist-heading{display:flex;gap:20px;align-items:center;padding:8px 0 22px;border-bottom:1px solid var(--fm-line)}.fluid-playlist-heading .fluid-collection-icon{width:80px;height:80px}.fluid-library-title{font-size:clamp(24px,3cqw,38px);letter-spacing:-.045em;line-height:1.1;margin:0;overflow-wrap:anywhere}.fluid-library-facts{font-size:11px;color:var(--ui-text-secondary);margin:10px 0 0}.fluid-playlist-toolbar{display:flex;flex-direction:column;gap:12px;padding:20px 0}.fluid-editor-filters{display:flex;gap:12px;align-items:center;margin:6px 0 18px}.fluid-selection-bar{display:flex;gap:10px;align-items:center;background:var(--fm-soft);padding:10px;margin-bottom:12px}.fluid-library-hero{display:flex;gap:24px;align-items:center;border-bottom:1px solid var(--fm-line);padding:0 0 24px;margin-bottom:24px}.fluid-library-cover{width:140px;aspect-ratio:1;flex:none;overflow:hidden;background:var(--fm-soft);display:grid;place-items:center;border-radius:8px}.fluid-device-list{display:grid;gap:8px}.fluid-device{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--fm-line);min-width:0}.fluid-device-copy{flex:1;min-width:0}.fluid-device-copy strong{font-size:12px;display:block;overflow-wrap:anywhere}.fluid-device-copy span{font-size:11px;color:var(--ui-text-secondary)}.fluid-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.fluid-switch-row{display:flex;gap:12px;align-items:flex-start;margin:16px 0;cursor:pointer}.fluid-switch-row strong{display:block;font-size:12px}.fluid-switch-row small{display:block;font-size:11px;color:var(--ui-text-secondary);margin-top:5px}.fluid-switch-row input{margin-top:4px;accent-color:var(--ui-accent)}.fluid-boundaries dt{font-weight:650;margin:16px 0 4px}.fluid-boundaries dd{margin:0;color:var(--ui-text-secondary);font-size:12px}.fluid-settings-grid hr{border:0;border-top:1px solid var(--fm-line);margin:22px 0}
.fluid-player-controls{display:flex;gap:12px;align-items:center;justify-content:center}.fluid-player-progress{display:grid;grid-template-columns:36px minmax(0,1fr) 36px;gap:10px;align-items:center;font:10px/1.5 var(--font-mono,monospace);color:var(--ui-text-secondary);margin-top:8px}.fluid-player-progress>span:last-child{text-align:right}.fluid-range{height:16px;width:100%;min-width:0;accent-color:var(--ui-accent);cursor:pointer;margin:0}.fluid-player-hint{font-size:10px;color:var(--ui-text-tertiary);text-align:center;margin:8px 0 0}.fluid-volume{display:flex;align-items:center;gap:6px;width:170px;max-width:100%}.fluid-volume-value{font:10px var(--font-mono,monospace);color:var(--ui-text-secondary);min-width:30px;text-align:right}.fluid-volume-compact{width:150px}.fluid-volume-compact .fluid-range{width:auto;flex:1;min-width:70px}.fluid-volume-compact .fluid-volume-value{font-size:9px;min-width:25px}
.fluid-bottom-bar{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:14px;align-items:center;min-height:68px;padding:8px 12px;border-top:1px solid var(--fm-line);background:var(--fm-panel);min-width:0}
.fluid-bottom-item{display:flex;gap:10px;align-items:center;min-width:0}
.fluid-bottom-center{display:flex;flex-direction:column;gap:2px;align-items:center;min-width:0;width:min(420px,42cqw)}
.fluid-bottom-center .fluid-player-progress{margin-top:0;width:100%}
.fluid-bottom-center .fluid-live-line{margin:0;font-size:10px;color:var(--ui-text-tertiary)}
.fluid-bottom-right{display:flex;gap:10px;align-items:center;justify-content:flex-end;min-width:0}
@container fluid (max-width:720px){.fluid-bottom-bar{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"item right" "center center";min-height:96px}.fluid-bottom-item{grid-area:item}.fluid-bottom-center{grid-area:center;width:100%}.fluid-bottom-right{grid-area:right}}
@container fluid (max-width:460px){.fluid-bottom-bar{grid-template-columns:1fr;grid-template-areas:"item" "center" "right";min-height:112px}.fluid-bottom-right{justify-content:flex-start}.fluid-bottom-right .fluid-volume{width:100%}}
.fluid-dialog{position:fixed;inset:0;margin:auto;height:fit-content;width:min(560px,calc(100vw - 32px));max-height:85vh;overflow:auto;border:1px solid var(--fm-line);border-radius:12px;background:var(--ui-bg-elevated,var(--ui-bg-secondary));background:rgb(from var(--ui-bg-elevated,var(--ui-bg-secondary)) r g b / 1);color:var(--ui-text-primary);padding:24px;box-shadow:0 24px 90px color-mix(in srgb,var(--ui-text-primary) 12%,transparent)}.fluid-dialog::backdrop{background:color-mix(in srgb,var(--ui-bg-primary) 65%,transparent);backdrop-filter:blur(4px)}.fluid-dialog-actions{display:flex;justify-content:flex-end;gap:10px;align-items:center;margin-top:24px}.fluid-segmented{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--fm-line);padding-bottom:10px}.fluid-segmented button{border:0;border-radius:5px;padding:8px 12px;background:transparent;color:var(--ui-text-secondary);cursor:pointer}.fluid-segmented button[aria-pressed=true]{background:var(--fm-soft);color:var(--ui-text-primary)}.fluid-picker-list{max-height:340px;overflow:auto}.fluid-picker-row{display:grid;grid-template-columns:20px 40px minmax(0,1fr);gap:12px;align-items:center;padding:10px;border-bottom:1px solid var(--fm-line);cursor:pointer}.fluid-picker-row:hover{background:var(--fm-soft)}.fluid-log-list{display:grid;gap:8px;margin-top:18px}.fluid-log-row{display:grid;grid-template-columns:75px 50px minmax(80px,.6fr) minmax(0,1fr);gap:12px;padding:14px;border:1px solid var(--fm-line);border-radius:6px;font:10px/1.6 var(--font-mono,monospace)}.fluid-log-row[data-level=error]{border-left:3px solid var(--ui-accent)}.fluid-log-row time,.fluid-log-level{color:var(--ui-text-tertiary)}.fluid-log-row pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ui-text-secondary)}
.fluid-mini-player{container:mini / inline-size;height:100%;overflow:auto;padding:18px;min-width:0}.fluid-mini-art{width:min(100%,200px);aspect-ratio:1;display:grid;place-items:center;background:var(--fm-soft);border-radius:8px;overflow:hidden;margin:0 auto 18px}.fluid-mini-art>svg{width:48px;height:48px;color:var(--ui-accent)}.fluid-mini-title{font-size:20px;letter-spacing:-.035em;line-height:1.2;text-align:center;margin:0;overflow-wrap:anywhere}.fluid-mini-subtitle{font-size:12px;text-align:center;color:var(--ui-text-secondary);margin:8px 0 18px;overflow-wrap:anywhere}.fluid-mini-player>.fluid-volume{margin:18px auto}.fluid-mini-player .fluid-notice{margin-top:14px}
.fluid-save-source{display:flex;align-items:center;gap:12px;margin:18px 0}.fluid-save-destinations{border:0;min-width:0;margin:20px 0}.fluid-save-choice{width:100%;border:1px solid var(--fm-line);margin:6px 0}.fluid-save-choice[aria-pressed=true]{border-color:var(--ui-accent);background:var(--fm-soft)}.fluid-save-destinations legend{font-size:12px;font-weight:650;margin-bottom:8px}.fluid-save-destinations .fluid-playlist-list{max-height:220px}.fluid-queue-context{padding:20px 12px 24px 24px;border-left:2px solid var(--ui-accent);background:var(--fm-panel);margin:0 0 18px 14px}.fluid-queue-row>.fluid-row-actions{flex-wrap:wrap;justify-content:flex-end}
@container fluid (max-width:1080px){.fluid-playlist-layout{grid-template-columns:1fr;gap:20px}.fluid-playlist-browser{border-right:0;border-bottom:1px solid var(--fm-line);padding:0 0 16px}.fluid-playlist-browser>.fluid-input{max-width:320px}.fluid-playlist-browser .fluid-playlist-list{flex-direction:row;overflow:auto;max-height:120px}.fluid-playlist-browser .fluid-playlist-button{flex:0 0 170px}.fluid-playlist-toolbar{flex-direction:row;justify-content:space-between;flex-wrap:wrap}.fluid-settings-grid{grid-template-columns:1fr}.fluid-page-head{flex-wrap:wrap}}
@container fluid (max-width:800px){.fluid-content{padding:24px 18px}.fluid-track-row{grid-template-columns:24px 36px minmax(0,1fr) auto;gap:8px}.fluid-track-row>.fluid-source-tag,.fluid-track-row>.fluid-track-duration{display:none}.fluid-editor-filters{flex-wrap:wrap}.fluid-log-row{grid-template-columns:70px 50px minmax(0,1fr)}.fluid-log-row pre{grid-column:1/-1}}
@container fluid (max-width:580px){.fluid-brand,.fluid-nav-label,.fluid-nav-button{flex:none;padding:7px 9px;font-size:11px;min-height:30px;gap:6px}.fluid-content{padding:22px 14px;flex:1;min-height:0}.fluid-page-title{font-size:28px}.fluid-page-subtitle{font-size:12px}.fluid-track-row{grid-template-columns:20px 32px minmax(0,1fr);gap:8px}.fluid-track-row>.fluid-row-actions{grid-column:3;justify-content:flex-start;flex-wrap:wrap}.fluid-mini-cover{width:32px;height:32px}.fluid-track-row{padding:12px 2px}.fluid-row-title{font-size:12px}.fluid-row-detail{font-size:10px}.fluid-playlist-heading{gap:14px}.fluid-playlist-heading .fluid-collection-icon{width:48px;height:48px}.fluid-library-title{font-size:25px}.fluid-player-progress{margin-top:5px}.fluid-library-cover{width:90px}.fluid-library-hero{gap:14px}.fluid-section-head{flex-wrap:wrap}.fluid-filter{max-width:none}.fluid-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fluid-queue-row{grid-template-columns:32px minmax(0,1fr)}.fluid-queue-row>.fluid-row-actions{grid-column:2}.fluid-panel-pad{padding:16px}}
.fluid-mini-summary{display:flex;gap:12px;align-items:center;margin-bottom:18px}.fluid-mini-summary .fluid-mini-art{width:48px;height:48px;margin:0;flex:none}.fluid-mini-summary .fluid-mini-art>svg{width:24px;height:24px}.fluid-mini-summary .fluid-mini-title{font-size:16px;text-align:left;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.fluid-mini-summary .fluid-mini-subtitle{font-size:11px;text-align:left;margin:6px 0 0}.fluid-mini-player>.fluid-section-head{margin-bottom:12px}.fluid-mini-player>.fluid-volume{margin:12px auto}
@container mini (max-width:210px){.fluid-mini-art{width:100px}.fluid-mini-title{font-size:16px}}
@container mini (max-width:520px){.fluid-youtube-player{grid-template-columns:1fr;overflow:auto}.fluid-youtube-frame{height:auto;aspect-ratio:16/9}.fluid-youtube-side{overflow:visible}.fluid-mini-player:not(.fluid-youtube-player){display:flex;padding:12px;overflow:auto}.fluid-mini-player:not(.fluid-youtube-player)>.fluid-mini-summary,.fluid-mini-player:not(.fluid-youtube-player)>.fluid-player-controls,.fluid-mini-player:not(.fluid-youtube-player)>.fluid-player-progress,.fluid-mini-player:not(.fluid-youtube-player)>.fluid-player-hint,.fluid-mini-player:not(.fluid-youtube-player)>.fluid-volume,.fluid-mini-player:not(.fluid-youtube-player)>.fluid-mini-links{margin:0;justify-self:auto}}
.fluid-root,.fluid-mini-player,.fluid-title-popover{--fm-night:color-mix(in srgb,var(--ui-bg-primary) 92%, transparent);--fm-graphite:var(--ui-bg-secondary);--fm-ink:var(--ui-text-primary);--fm-coral:var(--ui-accent);--fm-violet:var(--ui-accent);--fm-line:var(--ui-stroke-secondary)}
.fluid-app{display:grid;grid-template-rows:auto minmax(0,1fr);background:transparent;color:var(--fm-ink)}
.fluid-topbar{height:42px;display:flex;align-items:center;gap:18px;padding:0 clamp(12px,2cqw,24px);border-bottom:1px solid var(--fm-line);background:var(--fm-graphite)}
.fluid-wordmark{display:flex;align-items:center;gap:9px;border:0;background:transparent;color:var(--fm-ink);font:700 14px/1 inherit;letter-spacing:-.02em;cursor:pointer}.fluid-wordmark svg{color:var(--fm-coral)}
.fluid-primary-nav{display:flex;gap:3px;min-width:0}.fluid-primary-nav .fluid-nav-button{min-height:30px;padding:6px 12px;border-radius:4px;font-size:12px}.fluid-primary-nav .fluid-nav-button[data-active=true]{box-shadow:inset 0 -2px var(--fm-coral);background:transparent;color:var(--fm-ink)}
.fluid-content{padding:14px clamp(12px,2cqw,26px) 28px}.fluid-content-inner{max-width:1360px}.fluid-page-head{margin:16px 0 12px}.fluid-page-title{font-size:clamp(18px,1.8cqw,23px)}
.fluid-now-band{display:grid;grid-template-columns:160px minmax(240px,1fr) minmax(220px,.65fr);gap:clamp(16px,2cqw,28px);align-items:center;min-height:154px;padding:14px 0 18px;border-bottom:1px solid var(--fm-line)}
.fluid-orbit{position:relative;width:160px;min-width:160px;aspect-ratio:1;border-radius:50%;padding:9px;background:var(--fm-graphite);border:1px solid var(--fm-line);box-shadow:5px 8px 22px color-mix(in srgb,var(--ui-text-primary) 10%,transparent)}.fluid-orbit::after{content:'';position:absolute;inset:46%;border-radius:50%;background:var(--fm-night);border:1px solid var(--fm-line)}.fluid-orbit-art{width:100%;height:100%;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:var(--fm-night)}.fluid-orbit-art img{width:100%;height:100%;object-fit:cover}.fluid-orbit-art svg{width:54px;height:54px;color:var(--fm-violet)}.fluid-orbit[data-playing=true]{animation:fluid-spin 22s linear infinite}@keyframes fluid-spin{to{transform:rotate(360deg)}}
.fluid-source-chip{display:inline-flex;width:max-content;padding:3px 7px;border:1px solid var(--fm-line);border-radius:3px;color:var(--ui-text-secondary);font-size:9px;letter-spacing:.08em;text-transform:uppercase}.fluid-source-chip[data-source=radio]{color:var(--fm-coral)}.fluid-source-chip[data-source=spotify],.fluid-source-chip[data-source=youtube]{color:var(--fm-violet)}
.fluid-now-title{font-size:clamp(21px,2.4cqw,31px);line-height:1.08;letter-spacing:-.03em;margin:6px 0 4px}.fluid-now-subtitle{margin:0 0 10px;color:var(--ui-text-secondary);font-size:12px}.fluid-now-main .fluid-player-controls{justify-content:flex-start}.fluid-live-line{color:var(--fm-coral);font-size:11px;letter-spacing:.1em;text-transform:uppercase}.fluid-device-line{color:var(--ui-text-secondary);font-size:11px}
.fluid-up-next{align-self:stretch;padding:8px 12px;border-left:1px solid var(--fm-line);min-width:0}.fluid-next-row{width:100%;display:flex;align-items:center;gap:8px;padding:6px 0;border:0;border-bottom:1px solid var(--fm-line);background:transparent;color:inherit;text-align:left;cursor:pointer;min-width:0}.fluid-next-row>span{min-width:0}.fluid-next-row strong,.fluid-next-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fluid-next-row small{color:var(--ui-text-secondary);font-size:10px;margin-top:3px}
.fluid-secondary-tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid var(--fm-line);margin-bottom:14px}
.fluid-compact-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0}.fluid-panel-pad{padding:14px}.fluid-section-head{margin-bottom:10px}.fluid-searchbar{margin:10px 0}.fluid-history-time{font-size:9px;color:var(--ui-text-tertiary);white-space:nowrap}.fluid-youtube-results{margin-top:12px}.fluid-secondary-tabs button{flex:none;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--ui-text-secondary);padding:9px 12px;cursor:pointer}.fluid-secondary-tabs button[aria-selected=true]{color:var(--fm-ink);border-bottom-color:var(--fm-violet)}
.fluid-titlebar{position:relative;display:flex;align-items:center;gap:2px;width:210px;max-width:210px;height:22px;overflow:visible}.fluid-titlebar-summary{display:flex;align-items:center;gap:4px;flex:1 1 auto;min-width:0;max-width:176px;height:20px;padding:2px 5px!important;overflow:hidden}.fluid-titlebar>button:not(.fluid-titlebar-summary){flex:none}.fluid-titlebar-source{display:none}.fluid-titlebar-title{display:block;min-width:0;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:1}.fluid-title-popover{position:absolute;z-index:1000;right:0;top:calc(100% + 8px);width:min(390px,calc(100vw - 24px));max-height:min(680px,calc(100vh - 72px));overflow:auto;padding:18px;border:1px solid var(--fm-line);border-radius:8px;background:var(--ui-bg-elevated,var(--ui-bg-secondary));color:var(--fm-ink);box-shadow:8px 16px 46px color-mix(in srgb,var(--ui-text-primary) 16%,transparent)}.fluid-popover-now{display:grid;grid-template-columns:76px minmax(0,1fr);gap:14px;align-items:center}.fluid-orbit-small{width:76px;min-width:76px;padding:7px}.fluid-popover-title{display:block;font-size:17px;line-height:1.2;margin:7px 0 2px}.fluid-title-popover .fluid-player-controls{justify-content:flex-start;margin:16px 0}.fluid-title-popover .fluid-volume{margin:12px 0}.fluid-popover-upnext{margin-top:14px;border-top:1px solid var(--fm-line)}.fluid-popover-upnext h3{font-size:12px}.fluid-source-shortcuts,.fluid-mini-links{display:flex;gap:7px;flex-wrap:wrap;margin-top:16px}.fluid-youtube-title{display:block;margin:8px 0 16px}.fluid-youtube-compact{padding:0}.fluid-settings-grid{align-items:start}
.fluid-mini-player{background:transparent;color:var(--fm-ink)}.fluid-mini-player:not(.fluid-youtube-player){display:grid;grid-template-rows:minmax(0,1fr) 40px;height:100%;padding:6px 8px;overflow:hidden}.fluid-mini-body{min-height:0;overflow:hidden}.fluid-mini-body>.fluid-mini-summary{margin:0}.fluid-mini-body>.fluid-player-progress{margin:7px 0 0}.fluid-mini-body>.fluid-player-hint{margin:6px 0 0}.fluid-mini-body>.fluid-notice{margin:6px 0 0;padding:7px 8px;font-size:10px}.fluid-mini-controls{display:grid;grid-template-columns:auto minmax(150px,1fr) auto;align-items:center;gap:9px;min-width:0;border-top:1px solid var(--fm-line);padding-top:5px}.fluid-mini-controls .fluid-player-controls{justify-self:start;gap:5px}.fluid-mini-controls>.fluid-volume,.fluid-mini-controls>.fluid-mini-volume{width:auto;min-width:150px;margin:0}.fluid-mini-controls .fluid-volume-compact .fluid-range,.fluid-mini-controls .fluid-mini-volume .fluid-range{width:auto;flex:1;min-width:70px}.fluid-mini-controls>.fluid-mini-links{justify-self:end;justify-content:flex-end;flex-wrap:nowrap;gap:4px;margin:0}.fluid-mini-controls>.fluid-mini-links button{padding-inline:7px}.fluid-mini-art{border-radius:50%}.fluid-mini-links{justify-content:center}.fluid-youtube-player{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) 40px;gap:6px;height:100%;padding:6px 8px;overflow:hidden}.fluid-youtube-frame-wrap{min-width:0;min-height:0;height:100%;overflow:hidden;display:grid;place-items:stretch}.fluid-youtube-frame{display:block;width:100%;height:100%;min-height:0;border:1px solid var(--fm-line);border-radius:5px;background:var(--ui-bg-secondary)}.fluid-youtube-frame-loading{display:grid;place-content:center;text-align:center;color:var(--ui-text-secondary);font-size:12px}.fluid-youtube-side{min-width:0;min-height:0;overflow:hidden;padding:3px 2px}.fluid-youtube-summary{margin:0}.fluid-youtube-summary .fluid-mini-title,.fluid-youtube-summary .fluid-mini-subtitle{text-align:left}.fluid-youtube-summary .fluid-mini-title{font-size:14px;line-height:1.18;margin-top:5px}.fluid-youtube-summary .fluid-mini-subtitle{font-size:10px;line-height:1.35;margin:5px 0 0}.fluid-youtube-side .fluid-notice{margin:8px 0 0;padding:7px 8px;font-size:10px}.fluid-youtube-controls{grid-column:1/-1;display:grid;grid-template-columns:1fr minmax(110px,.7fr) 1fr;align-items:center;gap:10px;min-width:0;border-top:1px solid var(--fm-line);padding-top:5px}.fluid-youtube-controls .fluid-player-controls{justify-self:start;gap:6px}.fluid-mini-volume{display:flex;align-items:center;gap:7px;min-width:0}.fluid-youtube-controls .fluid-mini-links{justify-self:end;justify-content:flex-end;flex-wrap:nowrap;gap:5px;margin:0}
@container mini (max-width:360px){.fluid-mini-controls{grid-template-columns:auto 1fr;grid-template-areas:"controls links" "volume volume"}.fluid-mini-controls>.fluid-player-controls{grid-area:controls}.fluid-mini-controls>.fluid-volume{grid-area:volume;width:100%;min-width:0}.fluid-mini-controls>.fluid-mini-links{grid-area:links}.fluid-mini-controls .fluid-mini-links button{padding-inline:7px}}
@container mini (max-width:280px){.fluid-mini-controls .fluid-volume-value{display:none}.fluid-mini-controls>.fluid-mini-links button{padding-inline:6px}}
@container fluid (max-width:980px){.fluid-now-band{grid-template-columns:96px minmax(0,1fr)}.fluid-up-next{grid-column:1/-1;border-left:0;border-top:1px solid var(--fm-line);padding:8px 0}.fluid-orbit{width:96px;min-width:96px}}
@container fluid (max-width:720px){.fluid-topbar{gap:10px;padding:0 8px}.fluid-wordmark span{display:none}.fluid-primary-nav{flex:1;justify-content:space-between}.fluid-primary-nav .fluid-nav-button{padding:5px 7px}.fluid-now-band{grid-template-columns:72px minmax(0,1fr);gap:12px;min-height:0}.fluid-orbit{width:72px;min-width:72px;padding:6px}.fluid-now-title{font-size:22px}.fluid-content{padding:12px 10px 24px}.fluid-page-head{margin-top:12px}.fluid-track-row{grid-template-columns:20px 36px minmax(0,1fr);}.fluid-track-row>.fluid-row-actions{grid-column:3;justify-content:flex-start;flex-wrap:wrap}.fluid-track-row>.fluid-source-tag,.fluid-track-row>.fluid-track-duration{display:none}}
@container fluid (max-width:460px){.fluid-topbar{height:auto;min-height:42px}.fluid-primary-nav .fluid-nav-button{font-size:11px}.fluid-now-band{grid-template-columns:72px minmax(0,1fr);padding-top:10px}.fluid-orbit{width:72px;min-width:72px}.fluid-up-next{grid-column:1/-1}.fluid-now-main .fluid-volume{width:100%}.fluid-page-title{font-size:20px}.fluid-log-row{grid-template-columns:1fr}.fluid-log-row pre{grid-column:1}.fluid-titlebar-source{display:none}}
.fluid-mini-player{container:mini / size}
.fluid-mini-body{overflow:auto}
.fluid-youtube-player{grid-template-rows:minmax(200px,1fr) auto;overflow:auto}
.fluid-youtube-frame-wrap{min-height:200px}
.fluid-youtube-frame{min-width:200px;min-height:200px}
.fluid-mini-expand-note{display:none;margin:0;padding:6px 8px;border-left:2px solid var(--ui-accent);background:var(--fm-soft);color:var(--ui-text-secondary);font-size:10px;line-height:1.5}
@container mini (max-height:359px){.fluid-mini-expand-note{display:block}}
@container mini (max-height:240px){.fluid-mini-summary{gap:8px;margin-bottom:8px}.fluid-mini-summary .fluid-mini-art{width:40px;height:40px}.fluid-mini-summary .fluid-mini-art>svg{width:20px;height:20px}.fluid-mini-summary .fluid-mini-title{font-size:13px;-webkit-line-clamp:1}.fluid-mini-summary .fluid-mini-subtitle{display:none}.fluid-mini-body>.fluid-player-progress{margin:4px 0 0}.fluid-mini-body>.fluid-player-hint{margin:3px 0 0}.fluid-mini-body>.fluid-notice{margin:4px 0 0;padding:5px 6px}}
@container mini (max-height:170px){.fluid-mini-summary{margin-bottom:4px}.fluid-mini-summary .fluid-mini-art{display:none}}
.fluid-queue-origin{display:block;font-size:9px;color:var(--ui-text-tertiary);letter-spacing:.04em;margin-top:2px;text-transform:uppercase}
.fluid-queue-row[data-selectable=true]{grid-template-columns:20px 40px minmax(0,1fr) auto}
.fluid-queue-row input[type=checkbox]{accent-color:var(--ui-accent);width:16px;height:16px;margin:0}
.fluid-session-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:12px;border-bottom:1px solid var(--fm-line);align-items:center;min-width:0}
@container fluid (max-width:580px){.fluid-queue-row[data-selectable=true]{grid-template-columns:18px 32px minmax(0,1fr)}.fluid-queue-row[data-selectable=true]>.fluid-row-actions{grid-column:3}.fluid-session-row{grid-template-columns:1fr}.fluid-session-row>.fluid-row-actions{justify-content:flex-start;flex-wrap:wrap}}
.fluid-player-extras{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 0 2px;border-top:1px solid var(--fm-line);font-size:11px;min-width:0}
.fluid-resume-offer{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--ui-text-secondary);min-width:0}
.fluid-sleep-chip{display:inline-flex;align-items:center;gap:6px;color:var(--ui-text-secondary)}
.fluid-sleep-chip[data-armed=true]{color:var(--ui-accent)}
.fluid-bookmark-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--fm-line);min-width:0}
.fluid-history-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:end}
.fluid-filter-field{display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--ui-text-tertiary);min-width:0}
.fluid-filter-field .fluid-input{min-width:0}
.fluid-history-pager{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fluid-health-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:12px;border-bottom:1px solid var(--fm-line);align-items:center;min-width:0}
.fluid-health-row[data-state=ready] .fluid-row-title{color:var(--ui-text-primary)}
.fluid-health-row[data-state=degraded] .fluid-row-title{color:var(--ui-accent)}
.fluid-health-row[data-state=unavailable] .fluid-row-title{color:var(--ui-text-secondary)}
@container fluid (max-width:580px){.fluid-health-row{grid-template-columns:1fr}.fluid-health-row>.fluid-row-actions{justify-content:flex-start;flex-wrap:wrap}}
@container fluid (max-width:580px){.fluid-player-extras{padding:4px 0 2px}.fluid-history-filters{flex-direction:column;align-items:stretch}.fluid-bookmark-row{grid-template-columns:auto minmax(0,1fr)}.fluid-bookmark-row>.fluid-row-actions{grid-column:2;justify-content:flex-start;flex-wrap:wrap}}
@media(prefers-reduced-motion:reduce){.fluid-root *,.fluid-mini-player *,.fluid-titlebar *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`

function Icon({ kind }) {
  const paths = {
    check: 'M5 12l4 4L19 6',
    close: 'M6 6l12 12M6 18L18 6', up: 'M6 14l6-6 6 6', down: 'M6 10l6 6 6-6',
    forward: 'M5 12h14M13 6l6 6-6 6', copy: 'M8 8h12v12H8zM4 16V4h12', download: 'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',
    mute: 'M5 10v4h4l5 4V6l-5 4zM18 9l5 6M23 9l-5 6', wave: 'M3 12h3l2-7 4 14 4-14 2 7h3', device: 'M3 4h18v13H3zM8 21h8M12 17v4',
    play: 'M8 5v14l11-7z', pause: 'M8 5v14M16 5v14', next: 'M6 6l9 6-9 6zM18 6v12', previous: 'M18 6l-9 6 9 6zM6 6v12',
    plus: 'M12 5v14M5 12h14', heart: 'M12 20S4 15 4 9.5C4 6.8 6 5 8.3 5c1.5 0 2.8.8 3.7 2.1C12.9 5.8 14.2 5 15.7 5 18 5 20 6.8 20 9.5 20 15 12 20 12 20z',
    music: 'M9 17V5l10-2v12M9 9l10-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6M16 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    home: 'M3 11.5L12 4l9 7.5M5.5 10v10h13V10M9 20v-6h6v6',
    back: 'M19 12H5M11 18l-6-6 6-6',
    external: 'M14 5h5v5M19 5l-9 9M18 13v6H5V6h6',
    spotify: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M7 9.5c3.7-1 7.6-.7 10.5 1M7.8 13c3-.8 6.1-.5 8.5.8M8.8 16.2c2.1-.5 4.2-.3 6 .6',
    radio: 'M6 19h12M8 19l2-10h4l2 10M12 9V5M8.5 7.5a5 5 0 0 1 7 0M5.5 5a9 9 0 0 1 13 0',

    local: 'M4 7h6l2 2h8v10H4zM15 12v5M15 13l3-.7M12.5 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
    playlist: 'M4 6h10M4 11h10M4 16h7M18 5v11M15.5 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
    search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l5 5', queue: 'M4 6h12M4 12h12M4 18h8M19 16v6M16 19h6', volume: 'M5 10v4h4l5 4V6l-5 4zM18 9c1 2 1 4 0 6',
    shuffle: 'M4 7h3c4 0 5 10 9 10h4M17 14l3 3-3 3M4 17h3c1.5 0 2.5-1.4 3.4-3M15 7h5M17 4l3 3-3 3', repeat: 'M4 8l3-3 3 3M7 5h9a4 4 0 0 1 4 4v2M20 16l-3 3-3-3M17 19H8a4 4 0 0 1-4-4v-2',
    trash: 'M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14', logs: 'M5 5h14M5 10h14M5 15h9M5 20h12', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2', bookmark: 'M7 4h10v16l-5-4-5 4z', edit: 'M4 20l4-1L20 7l-3-3L5 16l-1 4zM14 6l3 3', settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 13.5l2 1.5-2 3.5-2.4-1a8 8 0 0 1-2.1 1.2L14.2 21h-4.4l-.3-2.3a8 8 0 0 1-2.1-1.2l-2.4 1L3 15l2-1.5a8 8 0 0 1 0-3L3 9l2-3.5 2.4 1a8 8 0 0 1 2.1-1.2L9.8 3h4.4l.3 2.3a8 8 0 0 1 2.1 1.2l2.4-1L21 9l-2 1.5a8 8 0 0 1 0 3z'
  }
  return jsx('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: kind === 'play' || kind === 'next' || kind === 'previous' ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, children: jsx('path', { d: paths[kind] || paths.music }) })
}

function Action({ label, kind, onClick, disabled = false, compact = false, primary = false }) {
  return jsx(Button, { type: 'button', variant: primary ? 'default' : 'ghost', size: compact ? 'icon-xs' : 'sm', disabled, onClick, 'aria-label': label, title: label, children: compact ? jsx(Icon, { kind }) : jsxs('span', { children: [jsx(Icon, { kind }), ' ', label] }) })
}

/* CONTROLLER_START */
function createController(ctx, hostCapabilities = {}) {
  // Owned first-party watch capability is negotiated at registration from the
  // PUBLIC SDK namespace; absent capability is an honest unavailable state,
  // never a hidden reduced-scope fallback or an external app.
  const watchCapability = hostCapabilities.watchCapability || { available: false, missing: ['OwnedMediaView', 'host.mediaSession'] }
  let youtubeEngine = 'embed'
  let watchAttempts = 0
  // The active YouTube surface registers its real command channel here; the
  // shared transport drives it instead of provider-specific copies.
  let youtubeCommandSink = null
  const rawStoredQueue = ctx.storage.get('queue', [])
  const storedSelection = normalizeQueueSelection(rawStoredQueue, ctx.storage.get('queueIndex', -1))
  const rawStoredPlaylistState = ctx.storage.get('playlistState', { version: 2, playlists: [] })
  const storedPlaylists = normalizePlaylistState(rawStoredPlaylistState)
  const rawPlaylistRoot = rawStoredPlaylistState && typeof rawStoredPlaylistState === 'object' ? rawStoredPlaylistState : { version: 2, playlists: [] }
  const rawPlaylistEntries = Array.isArray(rawPlaylistRoot.playlists) ? rawPlaylistRoot.playlists : []
  const rawLegacyPlaylists = new Map()
  storedPlaylists.playlists.forEach((entry, at) => {
    if (entry.legacy && rawPlaylistEntries[at] && typeof rawPlaylistEntries[at] === 'object') rawLegacyPlaylists.set(entry.id, rawPlaylistEntries[at])
  })
  const queue = atom(storedSelection.items)
  const index = atom(storedSelection.index)
  const favorites = atom(normalizeQueue(ctx.storage.get('favorites', [])))
  const volume = atom(clampVolume(ctx.storage.get('volume', .5)))
  const workspaceView = atom(isWorkspaceView(ctx.storage.get('workspaceView', 'browse')))
  const selectedPlaylist = atom(safeText(ctx.storage.get('selectedPlaylist', '')))
  const undoState = atom(null)
  const queueUndo = atom(null)
  const listeningSessions = atom(normalizeListeningSessions(ctx.storage.get('listeningSessions', [])))
  const resumeOffer = atom(null)
  const bookmarks = atom([])
  const sleepTimer = atom({ mode: 'off', remainingMs: 0, label: '' })
  const historyRetention = atom(0)
  const historyFilters = atom({ query: '', source: '', since: '', until: '' })
  const historyOffset = atom(0)
  const sourceHealth = atom({})
  const retryState = atom({})
  let unmutedVolume = clampVolume(ctx.storage.get('unmutedVolume', .5)) || .5
  let volumeTimer = null
  let volumeVersion = 0
  let sleepInterval = null
  let sleepDeadline = 0
  let sleepBound = null
  let sleepEndedFor = null
  let lastResumeSaveAt = 0
  const retryBudgets = new Map()
  let spotifyStartedUri = ''
  let localRefreshVersion = 0
  const status = atom('idle')
  const message = atom('')
  const logs = atom([])
  const spotify = atom({ connected: false, title: '', subtitle: '', playing: false })
  const spotifyAuth = atom({ state: 'loading', authenticated: false, needsClientId: false, detail: '' })
  const spotifyDevices = atom([])
  const spotifyFailure = atom(null)
  const spotifyLocalCapability = atom({ state: 'unverified', reasons: [], localAudio: null })
  const titlebarOpen = atom(false)
  const youtube = atom({ status: 'closed', title: 'YouTube', playing: false, nextAvailable: false, error: '' })
  const progress = atom({ positionMs: 0, durationMs: 0 })
  const playlists = atom(storedPlaylists.playlists)
  const localTracks = atom([])
  const sessionTracks = atom([])
  const localRoots = atom([])
  const history = atom([])
  const historyTotal = atom(0)
  const shuffle = atom(false)
  const repeat = atom('off')
  const spotifyAutoplay = atom(Boolean(ctx.storage.get('spotifyAutoplay', false)))
  let audio = null
  let audioSource = null

  let disposed = false
  let radioGeneration = 0
  let radioTimeout = null
  let spotifyTimer = null
  let spotifyProgressTimer = null
  let authTimer = null
  let authAttempts = 0
  let pollIntervalOpen = 8
  let pollIntervalClosed = 20
  let pollOpen = false
  let spotifyDeviceId = safeText(ctx.storage.get('spotifyDeviceId', ''))
  let spotifyDeviceRefreshVersion = 0
  let spotifyStateFingerprint = ''
  let requestSequence = 0
  let spotifyProgressAnchor = null
  let spotifyQueueGuard = null
  let youtubeQueueGuard = null
  let youtubeHistoryRecorded = false
  let transition = 0
  let transitionChain = Promise.resolve()
  let lastHistory = { key: '', at: 0 }
  const localRegistry = new Map()

  const addLog = (level, event, detail = {}) => {
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      level,
      event,
      detail
    }
    logs.set([entry, ...logs.get()].slice(0, 250))
    return entry
  }
  const clearLogs = () => logs.set([])
  const diagnosticBody = body => {
    if (!body || typeof body !== 'object') return {}
    const device = safeText(body.device_id)
    return {
      context: safeText(body.context_uri),
      track: safeText(body.uri || body.uris?.[0] || (typeof body.offset === 'string' ? body.offset : body.offset?.uri)),
      device: device ? `…${device.slice(-6)}` : ''
    }
  }

  const current = () => {
    const items = queue.get()
    const at = index.get()
    return at >= 0 && at < items.length ? items[at] : null
  }
  const persist = () => {
    const persistentQueue = []
    let persistentIndex = -1
    queue.get().forEach((value, at) => {
      const item = serializePlaylistItem(value)
      if (!item || (item.source === 'local' && !item.localTrackId)) return
      if (at === index.get()) persistentIndex = persistentQueue.length
      persistentQueue.push(item)
    })
    ctx.storage.set('queue', persistentQueue)
    ctx.storage.set('queueIndex', persistentIndex)
    ctx.storage.set('favorites', favorites.get().filter(item => item.source !== 'local'))
    ctx.storage.set('volume', volume.get())
    ctx.storage.set('spotifyAutoplay', spotifyAutoplay.get())
  }
  const playlistStorageState = entries => ({
    ...rawPlaylistRoot,
    version: 3,
    playlists: entries.map(entry => rawLegacyPlaylists.get(entry.id) || entry)
  })
  const persistPlaylists = () => ctx.storage.set('playlistState', playlistStorageState(playlists.get()))
  persist()
  const revokeLocal = item => {
    if (item?.source !== 'local' || !item.objectUrl) return
    try { URL.revokeObjectURL(item.objectUrl) } catch { /* Session object URL cleanup is best-effort. */ }
  }
  const api = (path, options) => ctx.rest(path, options)
  const request = async (path, options) => {
    const method = safeText(options?.method, 'GET').toUpperCase()
    const route = safeText(path).split('?')[0]
    const requestId = `r${++requestSequence}`
    const started = Date.now()
    const quiet = method === 'GET' && ['/player', '/devices', '/spotify/auth/status', '/config'].includes(route)
      || method === 'PUT' && ['/volume', '/seek'].includes(route)
    try {
      const response = await api(path, options)
      if (response && response.ok === false) {
        const detail = typeof response.error === 'string' ? response.error : safeText(response.error?.message)
        const failure = new Error(userFacingError(detail))
        failure.statusCode = Number(response.status_code) || 0
        throw failure
      }
      if (!quiet) addLog('info', 'api.success', { requestId, method, route, status: Number(response?.status_code || response?.data?.status_code) || 200, durationMs: Date.now() - started, ...diagnosticBody(options?.body) })
      if (sourceHealth.get().backend?.state === 'unavailable') recordHealth('backend', 'ready', 'Backend reachable again.')
      return response && Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response
    } catch (error) {
      const failure = new Error(userFacingError(error, 'FluidMusic could not reach its backend. Retry after Hermes finishes reloading.'))
      failure.statusCode = Number(error?.statusCode) || 0
      addLog('error', 'api.failure', { requestId, method, route, status: failure.statusCode, durationMs: Date.now() - started, error: failure.message, ...diagnosticBody(options?.body) })
      recordHealth('backend', 'unavailable', 'A backend request failed. Hermes may be reloading or offline.', 'retry')
      throw failure
    }
  }
  const spotifyRequest = request
  const recordHistory = item => {
    const serialized = serializePlaylistItem(item)
    if (!serialized) return
    const key = `${serialized.source}:${serialized.id || serialized.uri || serialized.url || serialized.title}`
    const now = Date.now()
    if (lastHistory.key === key && now - lastHistory.at < 5000) return
    lastHistory = { key, at: now }
    void request('/history', { method: 'POST', body: { item: serialized } })
      .then(data => {
        const entry = data?.entry
        if (entry?.item) history.set([{ id: entry.id, playedAt: safeText(entry.played_at), item: normalizeQueueItem(entry.item) }, ...history.get()].filter(value => value.item).slice(0, 500))
      })
      .catch(() => {})
  }
  const refreshHistory = async (filters = null, offset = 0) => {
    if (filters) historyFilters.set({ query: safeText(filters.query), source: safeText(filters.source), since: safeText(filters.since), until: safeText(filters.until) })
    const active = historyFilters.get()
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0))
    historyOffset.set(safeOffset)
    const params = new URLSearchParams({ limit: '50', offset: String(safeOffset) })
    if (active.query) params.set('query', active.query)
    if (active.source) params.set('source', active.source)
    if (active.since) params.set('since', active.since)
    if (active.until) params.set('until', active.until)
    const data = await request(`/history?${params.toString()}`)
    const entries = (Array.isArray(data?.items) ? data.items : []).map(entry => {
      const item = normalizeQueueItem(entry?.item)
      return item ? { id: entry.id, playedAt: safeText(entry.played_at), item } : null
    }).filter(Boolean)
    history.set(entries)
    historyTotal.set(Math.max(0, Number(data?.total) || 0))
    return entries
  }
  const clearHistory = async () => {
    await request('/history', { method: 'DELETE' })
    history.set([])
    historyTotal.set(0)
    historyOffset.set(0)
  }
  const removeHistoryEntry = async id => {
    await request(`/history/${Number(id)}`, { method: 'DELETE' })
    history.set(history.get().filter(entry => entry.id !== Number(id)))
    historyTotal.set(Math.max(0, historyTotal.get() - 1))
  }
  const loadHistoryRetention = async () => {
    const data = await request('/history/retention')
    historyRetention.set(Math.max(0, Number(data?.days) || 0))
    return historyRetention.get()
  }
  const setHistoryRetention = async days => {
    const data = await request('/history/retention', { method: 'PUT', body: { days } })
    historyRetention.set(Math.max(0, Number(data?.days) || 0))
    message.set(Number(data?.removed) > 0 ? `Retention updated: ${data.removed} older entry(s) removed.` : 'History retention updated.')
    await refreshHistory(null, 0).catch(() => {})
    return historyRetention.get()
  }
  const spotifyCommandBody = (body = {}) => {
    const active = spotifyDevices.get().find(device => device.active && !device.restricted)
    // An explicit user choice is authoritative even while Spotify's device list is stale.
    // If Spotify rejects it as unavailable, surface that error; never retarget another device.
    const deviceId = spotifyDeviceId || active?.id || ''
    return deviceId ? { ...body, device_id: deviceId } : body
  }
  const clearSpotifyDeviceSelection = () => {
    spotifyDeviceId = ''
    ctx.storage.set('spotifyDeviceId', '')
  }
  const isSpotifyAuthFailure = error => Number(error?.statusCode) === 401 || /(?:authentication|auth).*(?:expired|required)|(?:expired|reconnect).*(?:authentication|auth)|reconnect required/i.test(error?.message || '')

  function armSpotifyQueueGuard(item, token = transition) {
    spotifyProgressAnchor = null
    progress.set({ positionMs: 0, durationMs: Math.max(0, Number(item?.durationMs) || 0) })
    spotifyQueueGuard = /^spotify:track:/.test(item?.uri || '')
      ? { token, expectedUri: item.uri, seenExpected: false, advancing: false }
      : null
  }

  function requestHermesQueueAdvance(reason, observedUri = '') {
    const guard = spotifyQueueGuard
    if (spotifyAutoplay.get() || !guard || guard.token !== transition || !guard.seenExpected || guard.advancing) return
    guard.advancing = true
    addLog('state', 'spotify.hermes-queue-advance', { reason, expectedTrack: guard.expectedUri, observedTrack: observedUri || 'none' })
    void next().catch(error => {
      guard.advancing = false
      message.set(error?.message || 'FluidMusic could not advance to the next queue item.')
    })
  }

  function armYouTubeQueueGuard(item, token = transition) {
    youtubeQueueGuard = item?.source === 'youtube' ? { token, itemId: item.id, advancing: false } : null
  }

  function requestYouTubeQueueAdvance() {
    const guard = youtubeQueueGuard
    if (!guard || guard.token !== transition || guard.itemId !== current()?.id || guard.advancing) return
    guard.advancing = true
    addLog('state', 'youtube.hermes-queue-advance', { item: guard.itemId })
    void next().catch(error => {
      guard.advancing = false
      message.set(error?.message || 'FluidMusic could not advance to the next queue item.')
    })
  }

  function updateSpotifyProgress() {
    const anchor = spotifyProgressAnchor
    if (!anchor || current()?.source !== 'spotify') return
    const elapsed = anchor.playing ? Math.max(0, Date.now() - anchor.receivedAt) : 0
    const positionMs = Math.min(anchor.durationMs || Number.MAX_SAFE_INTEGER, anchor.positionMs + elapsed)
    progress.set({ positionMs, durationMs: anchor.durationMs })
    const guard = spotifyQueueGuard
    if (anchor.playing && anchor.durationMs > 0 && positionMs >= anchor.durationMs && guard?.expectedUri === anchor.uri) {
      if (sleepTimer.get().mode === 'end-of-item' && sleepBoundMatches(current())) {
        finishSleepAtEndOfItem(current())
        void spotifyRequest('/pause', { method: 'POST', body: spotifyCommandBody() }).catch(() => {})
      } else requestHermesQueueAdvance('projected-end', anchor.uri)
    }
  }

  function setSpotifyAutoplay(value) {
    const enabled = Boolean(value)
    spotifyAutoplay.set(enabled)
    ctx.storage.set('spotifyAutoplay', enabled)
    if (enabled) {
      spotifyQueueGuard = null
    } else {
      const item = current()
      armSpotifyQueueGuard(item)
      if (spotifyQueueGuard && spotify.get().uri === spotifyQueueGuard.expectedUri) spotifyQueueGuard.seenExpected = true
    }
  }

  function stopInternalAudio() {
    radioGeneration += 1
    if (radioTimeout) clearTimeout(radioTimeout)
    radioTimeout = null
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audio.remove()
      audio = null
      audioSource = null
    }

  }

  async function startRadio(item, _analyse, token) {
    stopInternalAudio()
    if (!item || item.source !== 'radio' || disposed || token !== transition) return
    const generation = radioGeneration
    let historyRecorded = false
    // Radio Browser directory etiquette: register one click per play attempt
    // for directory stations (canonical UUID ids). Presets and custom streams
    // are not directory entries. Fire-and-forget and failure-tolerant: this
    // never gates playback and never proxies the stream itself.
    const stationId = safeText(item.id)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stationId)) {
      void ctx.rest(`/radio/click/${encodeURIComponent(stationId)}`, { method: 'POST' }).catch(() => {})
    }
    const element = new Audio()
    audio = element
    audioSource = 'radio'
    element.preload = 'none'
    element.volume = volume.get()
    progress.set({ positionMs: 0, durationMs: 0 })
    status.set('loading')
    const isCurrent = () => !disposed && generation === radioGeneration && element === audio
    const finishFailure = (detail = '') => {
      if (!isCurrent()) return

      status.set('error')
      message.set(detail || 'This HTTPS radio stream could not connect. Choose another station or retry.')
      recordHealth('radio', 'degraded', detail || 'This HTTPS radio stream could not connect.', 'retry')
    }
    // Report the REAL failure boundary from the media element instead of one
    // generic notice: network reachability, decode/codec support, and
    // unsupported format-or-origin (the honest codec/CORS boundary) differ.
    const reportMediaError = () => {
      const code = Number(element.error?.code) || 0
      const detail = code === 2 ? 'The radio stream could not be reached (network boundary). Check the connection, then retry or choose another station.'
        : code === 3 ? 'This radio stream could not be decoded here (codec boundary). Try another station or format.'
        : code === 4 ? 'This stream is not playable here — its format or origin is unsupported (codec/CORS boundary). Try another station.'
        : ''
      finishFailure(detail)
    }
    radioTimeout = setTimeout(finishFailure, 15000)
    element.addEventListener('playing', () => {
      if (!isCurrent()) return
      clearTimeout(radioTimeout)
      recordHealth('radio', 'ready', 'Live stream playing.')
      radioTimeout = null
      status.set('playing')
      message.set('')
      if (!historyRecorded) { historyRecorded = true; recordHistory(item) }
    })
    element.addEventListener('pause', () => { if (isCurrent() && !element.ended && status.get() === 'playing') status.set('paused') })
    element.addEventListener('error', reportMediaError)
    element.addEventListener('ended', () => finishFailure('The live stream ended unexpectedly. Retry to reconnect.'))
    element.src = item.streamUrl
    try {
      await element.play()
    } catch {
      finishFailure()
    }
  }

  async function startLocal(item, token) {
    stopInternalAudio()
    if (!item || item.source !== 'local' || disposed || token !== transition) return
    const sources = [item.objectUrl, ...(Array.isArray(item.playbackUrls) ? item.playbackUrls : localPlaybackUrls(item.filePath))].filter(Boolean)
    if (item.unavailable || !sources.length) {
      status.set('error')
      message.set('This local track is unavailable. Rescan its music folder to restore it.')
      recordHealth('local', 'degraded', 'A local track is missing. Rescan its folder.', 'rescan')
      return
    }
    const generation = radioGeneration
    let historyRecorded = false
    const element = new Audio()
    audio = element
    audioSource = 'local'
    element.preload = 'metadata'
    element.volume = volume.get()
    progress.set({ positionMs: 0, durationMs: Math.max(0, Number(item.durationMs) || 0) })
    status.set('loading')
    let sourceIndex = 0
    let played = false
    const isCurrent = () => !disposed && generation === radioGeneration && element === audio && current()?.id === item.id
    const playSource = async () => {
      if (!isCurrent()) return
      element.src = sources[sourceIndex]
      try {
        await element.play()
      } catch {
        if (isCurrent() && sourceIndex + 1 < sources.length) {
          sourceIndex += 1
          await playSource()
        } else if (isCurrent()) {
          status.set('error')
          message.set('Hermes could not start this local audio file. Rescan it or check Chromium format support.')
        }
      }
    }
    element.addEventListener('playing', () => {
      if (!isCurrent()) return
      played = true
      sleepEndedFor = null
      status.set('playing')
      message.set('')
      if (!historyRecorded) { historyRecorded = true; recordHistory(item) }
    })
    element.addEventListener('loadedmetadata', () => {
      if (isCurrent()) progress.set({ positionMs: Math.max(0, Number(element.currentTime) || 0) * 1000, durationMs: Math.max(0, Number(element.duration) || 0) * 1000 })
    })
    element.addEventListener('timeupdate', () => {
      if (isCurrent()) {
        progress.set({ positionMs: Math.max(0, Number(element.currentTime) || 0) * 1000, durationMs: Math.max(0, Number(element.duration) || 0) * 1000 })
        saveResumePosition(false)
      }
    })
    element.addEventListener('pause', () => { if (isCurrent() && !element.ended) { status.set('paused'); saveResumePosition(false) } })
    element.addEventListener('ended', () => {
      if (!isCurrent()) return
      clearResumeOnEnded(item)
      if (sleepTimer.get().mode === 'end-of-item' && sleepBoundMatches(item)) { finishSleepAtEndOfItem(item); return }
      if (sleepEndedFor === item.id) return
      void next()
    })
    element.addEventListener('error', () => {
      if (!isCurrent()) return
      if (!played && sourceIndex + 1 < sources.length) {
        sourceIndex += 1
        void playSource()
        return
      }

      status.set('error')
      message.set('This local track is unavailable. Rescan its music folder and retry.')
    })
    await playSource()
  }

  async function refreshSpotify(token = transition) {
    try {
      const data = await spotifyRequest('/player')
      const state = data?.player || data || {}
      const item = state.item || state.currently_playing || {}
      const snapshot = {
        connected: Boolean(state.device || item.name || state.is_playing),
        title: safeText(item.name),
        subtitle: safeText((item.artists || []).map(entry => entry.name).join(', '), safeText(state.device?.name)),
        playing: Boolean(state.is_playing),
        artwork: safeText(item.album?.images?.[0]?.url),
        album: safeText(item.album?.name),
        context: safeText(state.context?.type),
        uri: safeText(item.uri),
        progressMs: Math.max(0, Number(state.progress_ms) || 0),
        durationMs: Math.max(0, Number(item.duration_ms) || 0),
        device: safeText(state.device?.name),
        deviceType: safeText(state.device?.type),
        volumePercent: Math.max(0, Math.min(100, Number(state.device?.volume_percent) || 0)),
        shuffle: Boolean(state.shuffle_state),
        repeat: safeText(state.repeat_state, 'off')
      }
      spotify.set(snapshot)
      spotifyFailure.set(null)
      shuffle.set(snapshot.shuffle)
      repeat.set(['off', 'context', 'track'].includes(snapshot.repeat) ? snapshot.repeat : 'off')
      const fingerprint = `${snapshot.playing}:${snapshot.uri}:${snapshot.device}`
      if (fingerprint !== spotifyStateFingerprint) {
        spotifyStateFingerprint = fingerprint
        addLog('state', 'spotify.playback', { playing: snapshot.playing, track: snapshot.uri, device: snapshot.device || 'none', context: snapshot.context || 'none', positionMs: snapshot.progressMs, durationMs: snapshot.durationMs, remainingMs: Math.max(0, snapshot.durationMs - snapshot.progressMs) })
      }
      if (token === transition && current()?.source === 'spotify') {
        spotifyProgressAnchor = { uri: snapshot.uri, positionMs: snapshot.progressMs, durationMs: snapshot.durationMs, playing: snapshot.playing, receivedAt: Date.now() }
        progress.set({ positionMs: snapshot.progressMs, durationMs: snapshot.durationMs })
        const guard = spotifyQueueGuard
        if (guard && guard.token === transition) {
          if (snapshot.uri === guard.expectedUri) {
            guard.seenExpected = true
          } else if (guard.seenExpected && snapshot.uri) {
            requestHermesQueueAdvance('provider-track-changed', snapshot.uri)
          }
          if (guard.seenExpected && !snapshot.playing && snapshot.durationMs > 0 && snapshot.progressMs >= snapshot.durationMs - 1000) {
            requestHermesQueueAdvance('provider-reported-end', snapshot.uri)
          }
        }
        status.set(snapshot.playing ? 'playing' : 'paused')
        if (snapshot.device) message.set('')
      }
      recordHealth('spotify', snapshot.connected ? 'ready' : 'unknown', snapshot.connected ? 'Spotify Connect responded.' : 'No active Connect session reported.', snapshot.connected ? '' : 'choose-device')
      return snapshot
    } catch (error) {
      const failure = classifySpotifyFailure(error)
      spotifyFailure.set(failure)
      recordHealth('spotify', ['auth-required', 'insufficient-scope'].includes(failure.reason) ? 'unavailable' : 'degraded', failure.message, failure.action)
      if (token === transition && current()?.source === 'spotify') {
        status.set('error')
        message.set(error?.message || 'Spotify Connect state could not be confirmed.')
      }
      return null
    }
  }

  async function refreshSpotifyAuth() {
    try {
      const snapshot = normalizeSpotifyAuth(await spotifyRequest('/spotify/auth/status'))
      spotifyAuth.set(snapshot)
      recordHealth('spotify', snapshot.authenticated ? 'ready' : 'unavailable', snapshot.authenticated ? 'Spotify sign-in confirmed.' : 'Not signed in to Spotify.', snapshot.authenticated ? '' : 'reconnect')
      return snapshot
    } catch (error) {
      const snapshot = { state: 'failed', authenticated: false, needsClientId: false, detail: error?.message || 'Spotify authentication status is unavailable.' }
      spotifyAuth.set(snapshot)
      recordHealth('spotify', 'unavailable', 'Spotify authentication status is unavailable.', 'reconnect')
      return snapshot
    }
  }

  async function refreshSpotifyDevices({ throwOnError = false } = {}) {
    const refreshVersion = ++spotifyDeviceRefreshVersion
    const hadSelectedDevice = Boolean(spotifyDeviceId)
    try {
      const devices = normalizeSpotifyDevices(await spotifyRequest('/devices'))
      // Discovery may be started by initialization, polling, a manual refresh,
      // or transfer. A late completion must never overwrite newer intent/state.
      if (refreshVersion !== spotifyDeviceRefreshVersion) return devices
      spotifyDevices.set(devices)
      const selectionVanished = hadSelectedDevice && !devices.some(device => device.id === spotifyDeviceId)
      if (selectionVanished) clearSpotifyDeviceSelection()
      if (!spotifyDeviceId && !hadSelectedDevice) {
        const active = devices.find(device => device.active && !device.restricted)
        if (active) {
          spotifyDeviceId = active.id
          ctx.storage.set('spotifyDeviceId', spotifyDeviceId)
        }
      }
      if (!current() && status.get() !== 'error') message.set('')
      return devices
    } catch (error) {
      if (refreshVersion !== spotifyDeviceRefreshVersion) {
        if (throwOnError) throw error
        return []
      }
      spotifyDevices.set([])
      clearSpotifyDeviceSelection()
      spotifyFailure.set(classifySpotifyFailure(error))
      if (isSpotifyAuthFailure(error)) {
        spotifyAuth.set({ state: 'failed', authenticated: false, needsClientId: false, detail: error?.message || 'Spotify authentication has expired. Reconnect to continue.' })
      }
      message.set(error?.message || 'Spotify devices could not be refreshed.')
      if (throwOnError) throw error
      return []
    }
  }

  function clearAuthPoll() { if (authTimer) clearTimeout(authTimer); authTimer = null }
  async function pollSpotifyAuth() {
    const snapshot = await refreshSpotifyAuth()
    if (disposed) { clearAuthPoll(); return snapshot }
    if (snapshot.authenticated || snapshot.state === 'failed') { clearAuthPoll(); return snapshot }
    authAttempts += 1
    if (authAttempts >= 80) {
      const timeout = { ...snapshot, state: 'timeout', detail: 'Spotify sign-in timed out. Reconnect to try again.' }
      spotifyAuth.set(timeout); clearAuthPoll(); return timeout
    }
    authTimer = setTimeout(() => void pollSpotifyAuth(), 1500)
    return snapshot
  }
  async function startSpotifyAuth(clientId = '') {
    clearAuthPoll(); authAttempts = 0
    spotifyAuth.set({ ...spotifyAuth.get(), state: 'connecting', detail: 'Waiting for browser approval…' })
    const value = safeText(clientId)
    await spotifyRequest('/spotify/auth/start', { method: 'POST', body: value ? { client_id: value } : {} })
    return pollSpotifyAuth()
  }
  async function transferSpotifyDevice(deviceId) {
    const id = safeText(deviceId)
    if (!id) throw new Error('Choose a Spotify device first.')
    await spotifyRequest('/transfer', { method: 'PUT', body: { device_id: id, play: false } })
    spotifyDeviceId = id
    ctx.storage.set('spotifyDeviceId', id)
    await refreshSpotify()
    return refreshSpotifyDevices()
  }

  function hydrateLocalReferences(items) {
    return items.map(item => {
      if (item?.source !== 'local' || item.objectUrl?.startsWith('blob:')) return item
      return localRegistry.get(item.localTrackId) || localRegistry.get(item.id) || { ...item, unavailable: true, filePath: '', playbackUrls: [] }
    })
  }

  async function refreshLocalLibrary() {
    const version = ++localRefreshVersion
    let rootsData
    let tracksData
    try {
      [rootsData, tracksData] = await Promise.all([
        request('/local/roots'),
        request('/local/tracks?include_missing=true&limit=5000&offset=0')
      ])
    } catch (error) {
      recordHealth('local', 'degraded', 'The local library could not be read. Rescan or retry.', 'rescan')
      throw error
    }
    if (disposed || version !== localRefreshVersion) return { roots: localRoots.get(), tracks: localTracks.get() }
    const roots = Array.isArray(rootsData?.roots) ? rootsData.roots : []
    const tracks = (Array.isArray(tracksData?.items) ? tracksData.items : []).map(localTrackItem).filter(Boolean)
    localRoots.set(roots)
    localTracks.set(tracks)
    const sessionTracks = [...localRegistry.values()].filter(item => item.objectUrl?.startsWith('blob:'))
    localRegistry.clear()
    sessionTracks.forEach(item => localRegistry.set(item.id, item))
    tracks.forEach(item => {
      if (item.localTrackId) localRegistry.set(item.localTrackId, item)
      localRegistry.set(item.id, item)
    })
    queue.set(hydrateLocalReferences(queue.get()))
    persist()
    recordHealth('local', 'ready', `${tracks.length} indexed track(s) in ${roots.length} approved folder(s).`)
    return { roots, tracks }
  }

  function openLocalFiles(files) {
    const selected = Array.from(files || [])
    const supported = selected.filter(file => isSupportedLocalAudio(file) && file.size > 0)
    if (sessionTracks.get().length + supported.length > 500) throw new Error('Open up to 500 session files. Restart or use indexed folders for larger libraries.')
    const opened = []
    try {
      supported.forEach(file => {
        const objectUrl = URL.createObjectURL(file)
        const item = normalizeQueueItem({ source: 'local', id: `session:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`, title: file.name.replace(/\.[^.]+$/, ''), subtitle: 'Opened file · this session only', objectUrl, mimeType: file.type })
        if (item) opened.push({ ...item, origin: 'session' })
        else URL.revokeObjectURL(objectUrl)
      })
    } catch (error) { opened.forEach(revokeLocal); throw new Error(userFacingError(error, 'Those files could not be opened.')) }
    if (opened.length) rememberQueueEdit('Open files')
    const before = queue.get().length
    opened.forEach(item => localRegistry.set(item.id, item))
    sessionTracks.set([...sessionTracks.get(), ...opened])
    queue.set([...queue.get(), ...opened])
    if (index.get() < 0 && opened.length) { index.set(before); status.set('paused') }
    persist()
    message.set(opened.length ? `Opened ${opened.length} audio file(s). Session files must be reopened after restart.${selected.length > opened.length ? ` Skipped ${selected.length - opened.length} unsupported/empty file(s).` : ''}` : 'Choose non-empty supported audio files.')
    return opened.length
  }

  async function addLocalRoot(path) {
    const folder = safeText(path)
    if (!folder) throw new Error('Choose a music folder first.')
    await request('/local/roots', { method: 'POST', body: { path: folder }, timeoutMs: 120000 })
    return refreshLocalLibrary()
  }

  async function chooseLocalRoot() {
    const path = await ctx.os?.pickOpenPath?.({ directories: true, multiple: false, title: 'Choose a music folder' })
    if (!path) return null
    return addLocalRoot(path)
  }

  async function rescanLocalLibrary(rootId = '') {
    await request('/local/rescan', { method: 'POST', body: rootId ? { root_id: rootId } : {}, timeoutMs: 120000 })
    return refreshLocalLibrary()
  }

  async function removeLocalRoot(rootId) {
    const id = safeText(rootId)
    if (!id) return false
    await request(`/local/roots/${encodeURIComponent(id)}`, { method: 'DELETE' })
    await refreshLocalLibrary()
    return true
  }

  async function stopActive(item) {
    if (item?.source === 'radio' || item?.source === 'local') stopInternalAudio()
    if (item?.source === 'spotify') {
      await spotifyRequest('/pause', { method: 'POST', body: spotifyCommandBody() })
    }
    if (item?.source === 'youtube') {
      // The embed surface owns the engine; leaving the item clears its reported
      // state so a stale iframe snapshot can never describe the next source.
      youtube.set({ ...youtube.get(), playing: false, ended: false })
    }
  }

  function runTransition(work) {
    const token = ++transition
    transitionChain = transitionChain.catch(() => {}).then(() => disposed ? false : work(token)).catch(error => {
      if (!disposed && token === transition) { status.set('error'); message.set(userFacingError(error)) }
      return false
    })
    return transitionChain
  }

  async function startSelected(nextIndex, token, contextPosition = null) {
    const item = queue.get()[nextIndex]
    if (!item || token !== transition || disposed) return
    const previousItem = current()
    if (previousItem && previousItem.id !== item.id) saveResumePosition(true)
    if (sleepBound && (sleepBound.id !== item.id || sleepBound.source !== item.source)) cancelSleepTimer('The source changed, so the sleep timer was cancelled. It never controls another device.')
    sleepEndedFor = null
    void loadResumeContext(item, token)
    index.set(nextIndex)
    persist()
    message.set('')
    if (item.source !== 'spotify') {
      spotifyProgressAnchor = null
      spotifyQueueGuard = null
    }
    if (item.source !== 'youtube') youtubeQueueGuard = null
    if (item.source === 'radio') {
      await startRadio(item, true, token)
      return
    }
    if (item.source === 'local') {
      await startLocal(item, token)
      return
    }
    if (item.source === 'youtube') {
      armYouTubeQueueGuard(item, token)
      youtubeEngine = 'embed'
      watchAttempts = 0
      youtube.set({ status: 'ready', engine: 'embed', watchUnavailable: false, url: item.url, title: item.title, subtitle: item.subtitle, artwork: item.artwork, durationMs: item.durationMs, playing: false, ended: false, error: '', reason: '', reloadToken: Number(youtube.get().reloadToken) || 0, item })
      progress.set({ positionMs: 0, durationMs: item.durationMs })
      status.set('paused')
      message.set('YouTube is loading in the FluidMusic player pane.')
      youtubeHistoryRecorded = false
      return
    }
    if (item.source === 'spotify') {
      armSpotifyQueueGuard(item, token)
      status.set('loading')
      try {
        const payload = Number.isInteger(contextPosition) ? { context_uri: item.uri, offset: contextPosition } : spotifyPlayPayload(item)
        await spotifyRequest('/play', { method: 'POST', body: spotifyCommandBody(payload) })
        recordHistory(item)
        spotifyStartedUri = item.uri
        if (token === transition) await refreshSpotify(token)
      } catch (error) {
        if (token === transition) {
          status.set('error')
          message.set(error?.message || 'Spotify Connect could not start this item. Open Spotify on a Connect device and try again.')
        }
      }
      return
    }
  }

  function playAt(nextIndex) {
    if (nextIndex < 0 || nextIndex >= queue.get().length) {
      status.set('idle')
      message.set('Add Spotify, radio, or local music to start a mixed queue.')
      return Promise.resolve()
    }
    return runTransition(async token => {
      if (token !== transition) return
      const previous = current()
      await stopActive(previous)
      if (token !== transition) return
      await startSelected(nextIndex, token)
    })
  }

  function toggle() {
    return runTransition(async token => {
      if (token !== transition) return
      const item = current()
      saveResumePosition(true)
      if (!item) { status.set('idle'); return }

      if (item.source === 'radio') {
        if (status.get() === 'playing' || status.get() === 'loading') {
          stopInternalAudio()
          if (token === transition) status.set('paused')
        } else {
          await startRadio(item, true, token)
        }
        return
      }
      if (item.source === 'local') {
        if ((status.get() === 'playing' || status.get() === 'loading') && audioSource === 'local' && audio) {
          audio.pause()
          if (token === transition) status.set('paused')
        } else if (audioSource === 'local' && audio) {
          try { await audio.play() } catch { if (token === transition) status.set('error') }
        } else {
          await startLocal(item, token)
        }
        return
      }
      if (item.source === 'youtube') {
        const playing = Boolean(youtube.get().playing)
        const sent = youtubeCommandSink ? youtubeCommandSink(playing ? 'pauseVideo' : 'playVideo', []) : false
        if (!sent && token === transition) message.set('The YouTube player is not ready yet. Open the player pane or retry.')
        return
      }
      const pause = status.get() === 'playing'
      status.set('loading')
      try {
        if (!pause) armSpotifyQueueGuard(item, token)
        const resume = spotifyStartedUri === item.uri
        await spotifyRequest(pause ? '/pause' : '/play', { method: 'POST', body: spotifyCommandBody(pause || resume ? {} : spotifyPlayPayload(item)) })
        if (!pause) recordHistory(item)
        if (!pause) spotifyStartedUri = item.uri
        if (token === transition) await refreshSpotify(token)
      } catch (error) {
        if (token === transition) {
          status.set('error')
          message.set(error?.message || 'Spotify Connect did not accept the transport request.')
        }
      }
    })
  }

  function next() {
    const item = current()
    if (item?.source === 'spotify' && (spotifyAutoplay.get() || /^spotify:(album|playlist):/.test(item.uri))) {
      return runTransition(async token => {
        if (token !== transition) return false
        await spotifyRequest('/next', { method: 'POST', body: spotifyCommandBody() })
        if (token === transition) await refreshSpotify(token)
      })
    }
    const nextIndex = nextQueueIndex(queue.get().length, index.get())
    return nextIndex < 0 ? playAt(-1) : playAt(nextIndex)
  }

  function previous() {
    const item = current()
    if (item?.source === 'spotify') {
      return runTransition(async token => {
        status.set('loading')
        try {
          await spotifyRequest('/previous', { method: 'POST', body: spotifyCommandBody() })
          if (token === transition) await refreshSpotify(token)
        } catch (error) {
          if (token === transition) { status.set('error'); message.set(error?.message || 'Spotify could not move to the previous track.') }
        }
      })
    }
    const previousIndex = previousQueueIndex(queue.get().length, index.get())
    return previousIndex < 0 ? playAt(-1) : playAt(previousIndex)
  }

  async function seekTo(positionMs) {
    const item = current()
    const durationMs = progress.get().durationMs
    const target = Math.max(0, Math.min(durationMs || 86_400_000, Number(positionMs) || 0))
    if (item?.source === 'local' && audioSource === 'local' && audio) {
      audio.currentTime = target / 1000
      progress.set({ positionMs: target, durationMs })
      return
    }
    if (item?.source === 'youtube') {
      const sent = youtubeCommandSink ? youtubeCommandSink('seekTo', [Math.round(target / 1000)]) : false
      if (sent) progress.set({ positionMs: target, durationMs })
      else message.set('The YouTube player is not ready yet. Open the player pane or retry.')
      return
    }
    if (item?.source === 'spotify') {
      await spotifyRequest('/seek', { method: 'PUT', body: spotifyCommandBody({ position_ms: Math.round(target) }) })
      progress.set({ positionMs: target, durationMs })
      await refreshSpotify()
    }

  }

  async function setShuffle(value) {
    if (current()?.source !== 'spotify') return
    const state = Boolean(value)
    await spotifyRequest('/shuffle', { method: 'PUT', body: spotifyCommandBody({ state }) })
    shuffle.set(state)
  }

  async function setRepeat(value) {
    if (current()?.source !== 'spotify') return
    const state = ['off', 'context', 'track'].includes(value) ? value : 'off'
    await spotifyRequest('/repeat', { method: 'PUT', body: spotifyCommandBody({ state }) })
    repeat.set(state)
  }

  function add(item, play = false, origin = '') {
    let normalized = normalizeQueueItem(item)
    if (normalized?.source === 'local' && normalized.localTrackId && !normalized.objectUrl) {
      // Durable history/queue references carry only the library ID; replay
      // revalidates availability against the CURRENT indexed library.
      const linked = localRegistry.get(normalized.localTrackId) || localRegistry.get(normalized.id)
      if (linked) normalized = normalizeQueueItem({ ...normalized, filePath: linked.filePath, objectUrl: linked.objectUrl, mimeType: linked.mimeType || normalized.mimeType, durationMs: linked.durationMs || normalized.durationMs, unavailable: linked.unavailable })
    }
    if (!normalized) {
      message.set('That item is not a supported public Spotify, HTTPS radio, or indexed local audio entry.')
      return false
    }
    if (normalized.source === 'local' && normalized.unavailable) {
      message.set('That local track is unavailable. Rescan its music folder first.')
      return false
    }
    if (normalized.source === 'local') {
      localRegistry.set(normalized.id, normalized)
      if (normalized.localTrackId) localRegistry.set(normalized.localTrackId, normalized)
    }
    if (origin && QUEUE_ORIGINS[origin]) normalized = { ...normalized, origin }
    rememberQueueEdit('Add to queue')
    const next = [...queue.get(), normalized]
    queue.set(next)
    if (index.get() === -1) {
      index.set(next.length - 1)
      status.set('paused')
    }
    persist()
    if (play) void playAt(next.length - 1)
    return true
  }

  function remove(at) {
    const items = queue.get()
    if (!Number.isInteger(at) || at < 0 || at >= items.length) return Promise.resolve(false)
    rememberQueueEdit('Remove from queue')
    if (at !== index.get()) {
      queue.set(items.filter((_, position) => position !== at))
      if (at < index.get()) index.set(index.get() - 1)
      persist()
      return Promise.resolve(true)
    }
    const wasPlaying = ['playing', 'loading'].includes(status.get())
    return runTransition(async token => {
      const items = queue.get()
      if (at < 0 || at >= items.length || token !== transition) return
      const currentIndex = index.get()
      const removingCurrent = at === currentIndex
      const previous = removingCurrent ? current() : null
      if (removingCurrent) await stopActive(previous)
      if (token !== transition) return
      const nextItems = items.filter((_, itemIndex) => itemIndex !== at)
      queue.set(nextItems)
      if (!nextItems.length) {
        index.set(-1)
        status.set('idle')
        persist()
        return
      }
      if (!removingCurrent) {
        if (at < currentIndex) index.set(currentIndex - 1)
        persist()
        return
      }
      const successor = Math.min(at, nextItems.length - 1)
      index.set(successor)
      persist()
      progress.set({ positionMs: 0, durationMs: 0 })
      spotifyQueueGuard = null
      spotifyProgressAnchor = null
      if (wasPlaying) await startSelected(successor, token)
      else status.set('paused')
    })
  }

  function move(at, direction) {
    const items = [...queue.get()]
    const target = at + direction
    if (!Number.isInteger(at) || !Number.isInteger(direction) || at < 0 || at >= items.length || target < 0 || target >= items.length) return
    rememberQueueEdit('Reorder queue')
    ;[items[at], items[target]] = [items[target], items[at]]
    const currentIndex = index.get()
    queue.set(items)
    if (currentIndex === at) index.set(target)
    else if (currentIndex === target) index.set(at)
    persist()
  }

  function toggleMute() {
    setVolume(volume.get() > 0 ? 0 : unmutedVolume)
  }

  function setVolume(value) {
    const next = clampVolume(value)
    volume.set(next)
    if (next > 0) { unmutedVolume = next; ctx.storage.set('unmutedVolume', next) }
    const version = ++volumeVersion
    if (volumeTimer) clearTimeout(volumeTimer)
    if (audio) audio.volume = next
    if (current()?.source === 'spotify') {
      const body = spotifyCommandBody({ volume_percent: Math.round(next * 100) })
      volumeTimer = setTimeout(() => {
        if (disposed || version !== volumeVersion || current()?.source !== 'spotify') return
        void spotifyRequest('/volume', { method: 'PUT', body }).catch(error => { if (version === volumeVersion) message.set(error?.message || 'Spotify volume could not be changed.') })
      }, 180)
    }
    if (current()?.source === 'youtube' && youtubeCommandSink) youtubeCommandSink('setVolume', [Math.round(next * 100)])

    persist()
  }

  function toggleFavorite(item) {
    const normalized = normalizeQueueItem(item)
    if (!normalized || normalized.source === 'local') return
    const existing = favorites.get()
    const has = existing.some(entry => entry.id === normalized.id)
    favorites.set(has ? existing.filter(entry => entry.id !== normalized.id) : [...existing, normalized])
    persist()
  }

  function clearQueue() {
    return runTransition(async token => {
      if (token !== transition) return false
      rememberQueueEdit('Clear queue')
      await stopActive(current())
      if (token !== transition) return false
      queue.set([])
      index.set(-1)
      spotifyQueueGuard = null
      youtubeQueueGuard = null
      spotifyProgressAnchor = null
      spotifyStartedUri = ''
      progress.set({ positionMs: 0, durationMs: 0 })
      status.set('idle')
      message.set('')
      persist()
      return true
    })
  }

  function resetSavedRadio() {
    favorites.set(favorites.get().filter(item => item.source !== 'radio'))
    persist()
  }

  function createPlaylist(name, description = '') {
    undoState.set(null)
    const now = new Date().toISOString()
    const playlist = { id: `playlist:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: safeText(name, 'Untitled collection'), description: safeText(description), createdAt: now, updatedAt: now, items: [], legacy: false }
    playlists.set([...playlists.get(), playlist])
    persistPlaylists()
    return playlist
  }

  function isEditablePlaylist(id) {
    return playlists.get().some(entry => entry.id === id && !entry.legacy)
  }

  function updatePlaylist(id, changes = {}) {
    if (!isEditablePlaylist(id)) return null
    undoState.set(null)
    let updated = null
    playlists.set(playlists.get().map(entry => {
      if (entry.id !== id) return entry
      updated = { ...entry, name: safeText(changes.name, entry.name), description: typeof changes.description === 'string' ? changes.description.trim() : entry.description, updatedAt: new Date().toISOString() }
      return updated
    }))
    persistPlaylists()
    return updated
  }

  function deletePlaylist(id) {
    const before = playlists.get()
    if (!before.some(entry => entry.id === id && !entry.legacy)) return false
    rememberPlaylistEdit('Delete playlist')
    playlists.set(before.filter(entry => entry.id !== id))
    persistPlaylists()
    return playlists.get().length !== before.length
  }

  function duplicatePlaylist(id) {
    const original = playlists.get().find(entry => entry.id === id)
    if (!original || original.legacy) return null
    const copy = createPlaylist(`${original.name} copy`, original.description)
    const items = original.items.map(item => ({ ...item }))
    playlists.set(playlists.get().map(entry => entry.id === copy.id ? { ...entry, items } : entry))
    persistPlaylists()
    return playlists.get().find(entry => entry.id === copy.id)
  }

  function addToPlaylist(id, value) {
    if (!isEditablePlaylist(id)) return false
    undoState.set(null)
    const normalized = normalizeQueueItem(value)
    if (!normalized) return false
    if (normalized.source !== 'local') { message.set('New FluidMusic collections are local-only. Use Up Next for cross-source listening.'); return false }
    if (normalized.source === 'local' && !normalized.localTrackId) { message.set('Session files cannot be saved to playlists. Index their folder to create persistent references.'); return false }
    if (normalized.source === 'local' && !normalized.unavailable) {
      localRegistry.set(normalized.id, normalized)
      if (normalized.localTrackId) localRegistry.set(normalized.localTrackId, normalized)
    }
    const stored = serializePlaylistItem(normalized)
    let found = false
    playlists.set(playlists.get().map(entry => {
      if (entry.id !== id) return entry
      found = true
      return { ...entry, items: [...entry.items, stored], updatedAt: new Date().toISOString() }
    }))
    if (found) persistPlaylists()
    return found
  }

  function removeFromPlaylist(id, at) {
    return removePlaylistItems(id, [at])
  }

  function moveInPlaylist(id, at, direction) {
    if (!isEditablePlaylist(id)) return false
    undoState.set(null)
    playlists.set(playlists.get().map(entry => {
      if (entry.id !== id) return entry
      const items = [...entry.items]
      const target = at + direction
      if (!Number.isInteger(at) || !Number.isInteger(direction) || at < 0 || at >= items.length || target < 0 || target >= items.length) return entry
      ;[items[at], items[target]] = [items[target], items[at]]
      return { ...entry, items, updatedAt: new Date().toISOString() }
    }))
    persistPlaylists()
  }

  function playlistItems(id) {
    const playlist = playlists.get().find(entry => entry.id === id)
    return hydrateLocalReferences(playlist?.items || [])
  }

  function playPlaylist(id, startAt = 0) {
    const items = playlistItems(id)
    if (!Number.isInteger(startAt) || startAt < 0 || startAt >= items.length) {
      message.set('This playlist is empty. Add tracks before playing it.')
      return Promise.resolve(false)
    }
    const selected = items[startAt]
    const playable = items.filter(item => item && !item.unavailable)
    if (!playable.length || selected?.unavailable) {
      message.set('The selected local track is missing. Rescan its folder or choose another track. Your queue has not changed.')
      return Promise.resolve(false)
    }
    const nextIndex = items.slice(0, startAt).filter(item => !item.unavailable).length
    return runTransition(async token => {
      if (token !== transition) return false
      rememberQueueEdit('Play collection')
      await stopActive(current())
      if (token !== transition) return false
      queue.set(playable.map(item => ({ ...item, origin: 'collection' })))
      index.set(nextIndex)
      persist()
      await startSelected(nextIndex, token)
      if (items.length !== playable.length) message.set(`${items.length - playable.length} missing local track(s) skipped. Saved playlist unchanged.`)
      return token === transition && status.get() !== 'error'
    })
  }

  function enqueuePlaylist(id) {
    const items = playlistItems(id)
    const playable = items.filter(item => !item.unavailable)
    if (!playable.length) { message.set('No playable tracks to add. Your queue has not changed.'); return 0 }
    rememberQueueEdit('Add collection')
    const before = queue.get().length
    queue.set([...queue.get(), ...playable.map(item => ({ ...item, origin: 'collection' }))])
    if (index.get() < 0) { index.set(before); status.set('paused') }
    persist()
    message.set(`Added ${playable.length} item(s) to the queue.${items.length > playable.length ? ` Skipped ${items.length - playable.length} missing track(s).` : ''}`)
    return playable.length
  }

  function saveQueueAsPlaylist(name) {
    const queued = queue.get()
    if (queued.some(item => item.source !== 'local' || !item.localTrackId)) {
      message.set('Collections accept indexed local tracks only. Remove cloud, radio, YouTube, and session-only items before saving this queue.')
      return null
    }
    const items = queued.map(serializePlaylistItem).filter(Boolean)
    if (!items.length) { message.set('There are no persistent items to save.'); return null }
    const playlist = createPlaylist(name)
    playlists.set(playlists.get().map(entry => entry.id === playlist.id ? { ...entry, items } : entry))
    persistPlaylists()
    return playlists.get().find(entry => entry.id === playlist.id)
  }

  function addManyToPlaylist(id, values) {
    if (!isEditablePlaylist(id)) return 0
    const raw = Array.isArray(values) ? values : []
    const items = raw.map(normalizeQueueItem)
    if (!raw.length || items.some(item => !item || item.source !== 'local' || !item.localTrackId)) {
      message.set('Collections accept indexed local tracks only. Nothing was saved.')
      return 0
    }
    undoState.set(null)
    let count = 0
    // Commit once, preserving duplicate occurrences and their order.
    playlists.set(playlists.get().map(entry => {
      if (entry.id !== id) return entry
      const stored = items.map(item => {
        if (!item.unavailable) {
          localRegistry.set(item.id, item)
          localRegistry.set(item.localTrackId, item)
        }
        return serializePlaylistItem(item)
      }).filter(Boolean)
      count = stored.length
      return { ...entry, items: [...entry.items, ...stored], updatedAt: new Date().toISOString() }
    }))
    if (count) persistPlaylists()
    return count
  }

  function rememberPlaylistEdit(label) {
    undoState.set({ label, playlists: playlists.get().map(entry => ({ ...entry, items: entry.items.map(item => ({ ...item })) })) })
  }

  function undoPlaylistEdit() {
    const saved = undoState.get()
    if (!saved) return false
    playlists.set(saved.playlists)
    undoState.set(null)
    persistPlaylists()
    return true
  }

  function removePlaylistItems(id, positions) {
    if (!isEditablePlaylist(id)) return 0
    const selected = new Set(positions.filter(Number.isInteger))
    if (!selected.size) return 0
    rememberPlaylistEdit('Remove tracks')
    let removed = 0
    playlists.set(playlists.get().map(entry => {
      if (entry.id !== id) return entry
      const items = entry.items.filter((_, at) => !selected.has(at))
      removed = entry.items.length - items.length
      return { ...entry, items, updatedAt: new Date().toISOString() }
    }))
    persistPlaylists()
    return removed
  }

  function deduplicatePlaylist(id) {
    const playlist = playlists.get().find(entry => entry.id === id)
    if (!playlist || playlist.legacy) return 0
    const seen = new Set()
    const duplicates = []
    playlist.items.forEach((item, at) => {
      const key = `${item.source}:${item.uri || item.localTrackId || item.streamUrl || item.id}`
      if (seen.has(key)) duplicates.push(at)
      else seen.add(key)
    })
    return removePlaylistItems(id, duplicates)
  }

  function exportPlaylists(id = '') {
    const entries = playlists.get().filter(entry => !id || entry.id === id).map(entry => {
      const raw = rawLegacyPlaylists.get(entry.id)
      return raw || normalizePlaylistState({ playlists: [entry] }).playlists[0]
    })
    return JSON.stringify({ format: 'fluid-music', version: 3, playlists: entries }, null, 2)
  }

  function importPlaylists(text) {
    if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Choose a FluidMusic JSON file smaller than 2 MB.')
    let data
    try { data = JSON.parse(text) } catch { throw new Error('That file is not valid JSON.') }
    if (data?.format !== 'fluid-music' || !Array.isArray(data.playlists) || data.playlists.length > 200) throw new Error('Choose a FluidMusic playlist export (up to 200 playlists).')
    if (data.playlists.some(entry => !entry || typeof entry.name !== 'string' || !Array.isArray(entry.items) || entry.items.length > 10000)) throw new Error('Invalid playlist structure or too many tracks.')
    const normalized = normalizePlaylistState(data)
    const supplied = data.playlists.reduce((count, entry) => count + entry.items.length, 0)
    const accepted = normalized.playlists.reduce((count, entry) => count + entry.items.length, 0)
    if (accepted !== supplied) throw new Error('The file contains unsupported or invalid tracks. Nothing was imported.')
    rememberPlaylistEdit('Import playlists')
    const imported = normalized.playlists.map((entry, at) => {
      const id = `playlist:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
      if (entry.legacy) rawLegacyPlaylists.set(id, { ...data.playlists[at], id })
      return { ...entry, id }
    })
    playlists.set([...playlists.get(), ...imported])
    persistPlaylists()
    return imported
  }

  function setWorkspaceView(view) {
    const next = isWorkspaceView(view)
    workspaceView.set(next)
    ctx.storage.set('workspaceView', next)
  }

  function selectPlaylist(id) {
    selectedPlaylist.set(id)
    ctx.storage.set('selectedPlaylist', id)
  }


  function addYouTubeItem(value, select = true) {
    const item = normalizeQueueItem(value)
    if (!item || item.source !== 'youtube') throw new Error('Choose a valid YouTube video.')
    const before = queue.get().length
    if (!add(item, false)) return false
    if (select) void playAt(before)
    message.set(`Added “${item.title}” from YouTube.`)
    return true
  }

  async function addYouTubeUrl(url, select = true) {
    const data = await request('/youtube/resolve', { method: 'POST', body: { url } })
    return addYouTubeItem(data?.item, select)
  }

  async function searchYouTube(query) {
    const data = await request(`/youtube/search?q=${encodeURIComponent(query)}&limit=12`)
    return (Array.isArray(data?.items) ? data.items : []).map(normalizeQueueItem).filter(item => item?.source === 'youtube')
  }

  async function resolveYouTubeEmbedUrl(item) {
    const videoId = item?.source === 'youtube' ? safeText(item.id).replace(/^youtube:/, '') : ''
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('This YouTube item has an invalid video ID.')
    const data = await request(`/youtube/embed-host?video_id=${encodeURIComponent(videoId)}`)
    const url = safeText(data?.url)
    if (!url.startsWith('http://127.0.0.1:')) throw new Error('FluidMusic returned an invalid YouTube player URL.')
    return url
  }

  async function refreshQueuedYouTubeMetadata() {
    const stale = queue.get().filter(item => item.source === 'youtube' && (item.title === 'YouTube video' || item.subtitle === 'Embedded player'))
    if (!stale.length) return
    let changed = false
    for (const item of stale) {
      if (disposed) return
      try {
        const data = await request('/youtube/resolve', { method: 'POST', body: { url: item.url } })
        if (disposed) return
        const resolved = normalizeQueueItem(data?.item)
        if (!resolved) continue
        queue.set(queue.get().map(value => value.id === item.id ? resolved : value))
        if (current()?.id === resolved.id) youtube.set({ ...youtube.get(), title: resolved.title, subtitle: resolved.subtitle, artwork: resolved.artwork, item: resolved })
        changed = true
      } catch { /* Old queue labels remain usable when metadata is temporarily unavailable. */ }
    }
    if (changed && !disposed) persist()
  }

  const spotifyTrack = track => normalizeQueueItem({
    source: 'spotify', id: track?.id, title: track?.name, subtitle: (track?.artists || []).map(artist => artist.name).join(', '), uri: track?.uri,
    contextUri: track?.album?.uri, artwork: track?.album?.images?.[0]?.url, album: track?.album?.name, durationMs: track?.duration_ms, kind: 'track', explicit: track?.explicit
  })

  function setYouTubeCommandSink(sink) {
    youtubeCommandSink = !disposed && typeof sink === 'function' ? sink : null
  }

  function reportYouTubeState(state) {
    // Embed bridge adapter: surface relay reports bind to the exact selected
    // occurrence and the current transition generation; stale or foreign
    // reports are ignored, and completion advances the queue exactly once.
    if (!state || typeof state !== 'object' || disposed) return false
    const item = current()
    if (!item || item.source !== 'youtube') return false
    const expectedVideoId = safeText(item.id).replace(/^youtube:/, '')
    if (state.videoId && state.videoId !== expectedVideoId) return false
    if (state.engine && state.engine !== youtubeEngine) return false
    if (state.kind === 'ready') {
      youtube.set({ ...youtube.get(), status: 'ready', error: '', reason: '' })
      return true
    }
    const guard = youtubeQueueGuard
    if (guard && guard.token !== transition) return false
    if (state.kind === 'error' || state.kind === 'autoplay-blocked') {
      const failure = classifyYouTubeFailure(state.kind === 'error' ? { kind: 'player-error', errorCode: state.errorCode } : { kind: 'autoplay-blocked' })
      youtube.set({ ...youtube.get(), status: failure.reason === 'autoplay-blocked' ? 'paused' : 'error', reason: failure.reason, error: failure.message, action: failure.action, retryable: failure.retryable, fallbackEligible: failure.fallbackEligible })
      recordHealth('youtube', failure.retryable ? 'degraded' : 'unavailable', failure.message, failure.action)
      if (failure.message) message.set(`${failure.message} ${failure.remedy}`.trim())
      return true
    }
    if (state.kind !== 'state') return false
    youtube.set({ ...youtube.get(), playing: Boolean(state.playing), ended: Boolean(state.ended) })
    if (state.playing) recordHealth('youtube', 'ready', 'YouTube player reporting playback.')
    progress.set({ positionMs: Math.max(0, Number(state.positionMs) || 0), durationMs: Math.max(0, Number(state.durationMs) || 0) })
    saveResumePosition(false)
    status.set(state.playing ? 'playing' : 'paused')
    if (state.playing && !youtubeHistoryRecorded) {
      youtubeHistoryRecorded = true
      recordHistory(item)
    }
    if (state.ended) {
      clearResumeOnEnded(item)
      if (sleepTimer.get().mode === 'end-of-item' && sleepBoundMatches(item)) finishSleepAtEndOfItem(item)
      else requestYouTubeQueueAdvance()
    }
    return true
  }

  function attemptYouTubeWatchFallback() {
    const item = current()
    if (!item || item.source !== 'youtube' || youtubeEngine === 'watch') return false
    if (!youtube.get().fallbackEligible) return false
    if (!watchCapability.available) {
      youtube.set({ ...youtube.get(), watchUnavailable: true })
      message.set('First-party watch fallback needs an owned host view capability this Hermes build does not provide. Skip or choose another video.')
      recordHealth('youtube', 'degraded', 'Owned first-party watch view is not available on this host.', 'diagnose')
      return false
    }
    if (watchAttempts >= 1) {
      message.set('The first-party watch fallback was already tried for this video. Skip or choose another video.')
      return false
    }
    watchAttempts += 1
    youtubeEngine = 'watch'
    // Position and the once-per-transition history flag survive the switch;
    // exactly one engine is active because the surface renders either/or.
    youtube.set({ ...youtube.get(), engine: 'watch', status: 'switching', error: '', reason: '' })
    status.set('loading')
    message.set('Switching player…')
    return true
  }

  async function assessSpotifyLocalPlayback() {
    let product = ''
    try {
      const data = await request('/spotify/local-capability')
      product = safeText(data?.account_product)
    } catch { product = '' }
    let sdkPresent = false
    let emeSupported = false
    let checked = false
    try {
      if (typeof window !== 'undefined') {
        sdkPresent = typeof window.Spotify?.Player === 'function'
        if (typeof navigator !== 'undefined' && typeof navigator.requestMediaKeySystemAccess === 'function') {
          try {
            await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4;codecs="avc1.42E01E"' }] }])
            emeSupported = true
          } catch { emeSupported = false }
        }
        checked = true
      }
    } catch { checked = false }
    const capability = spotifyLocalPlaybackCapability({ product, sdkPresent, emeSupported, checked })
    spotifyLocalCapability.set(capability)
    return capability
  }

  function retryYouTube() {
    const item = current()
    if (!item || item.source !== 'youtube') return Promise.resolve(false)
    if (!tryRetry('youtube')) return Promise.resolve(false)
    youtube.set({ ...youtube.get(), status: 'loading', error: '', reason: '', reloadToken: (Number(youtube.get().reloadToken) || 0) + 1 })
    return playAt(index.get()).then(() => true)
  }

  async function searchSpotify(query) {
    const data = await spotifyRequest(`/search?q=${encodeURIComponent(query)}&type=track&limit=10&offset=0`)
    const tracks = data?.tracks?.items || []
    return tracks.map(spotifyTrack).filter(Boolean)
  }

  async function searchSpotifyCatalog(query, offset = 0) {
    const data = await spotifyRequest(`/search?q=${encodeURIComponent(query)}&type=track,album,artist,playlist&limit=10&offset=${Math.max(0, Number(offset) || 0)}`)
    const tracks = (data?.tracks?.items || []).map(spotifyTrack).filter(Boolean)
    const albums = (data?.albums?.items || []).map(album => normalizeQueueItem({ source: 'spotify', id: album.id, title: album.name, subtitle: (album.artists || []).map(artist => artist.name).join(', '), uri: album.uri, artwork: album.images?.[0]?.url, kind: 'album' })).filter(Boolean)
    const spotifyPlaylists = (data?.playlists?.items || []).filter(Boolean).map(playlist => normalizeQueueItem({ source: 'spotify', id: playlist.id, title: playlist.name, subtitle: playlist.owner?.display_name || 'Spotify playlist', uri: playlist.uri, artwork: playlist.images?.[0]?.url, kind: 'playlist' })).filter(Boolean)
    const artists = (data?.artists?.items || []).map(artist => ({ id: safeText(artist.id), source: 'spotify', kind: 'artist', title: safeText(artist.name, 'Artist'), subtitle: `${Number(artist.followers?.total || 0).toLocaleString()} followers`, artwork: safeText(artist.images?.[0]?.url), uri: safeText(artist.uri), genres: Array.isArray(artist.genres) ? artist.genres.slice(0, 3) : [] }))
    const cursors = { tracks: Boolean(data?.tracks?.next), albums: Boolean(data?.albums?.next), playlists: Boolean(data?.playlists?.next), artists: Boolean(data?.artists?.next) }
    return { tracks, albums, playlists: spotifyPlaylists, artists, cursors, offset: Math.max(0, Number(offset) || 0) }
  }

  async function loadSpotifyPlaylists(offset = 0) {
    const data = await spotifyRequest(`/playlists?limit=50&offset=${Math.max(0, Number(offset) || 0)}`)
    return { items: (data?.items || []).filter(Boolean).map(playlist => ({ id: safeText(playlist.id), name: safeText(playlist.name, 'Untitled playlist'), description: safeText(playlist.description), owner: safeText(playlist.owner?.display_name, safeText(playlist.owner?.id)), artwork: safeText(playlist.images?.[0]?.url), uri: safeText(playlist.uri), visibility: playlist.public === true ? 'Public' : playlist.public === false ? 'Private' : 'Unlisted', collaborative: Boolean(playlist.collaborative), trackCount: Math.max(0, Number(playlist.items?.total ?? playlist.tracks?.total) || 0) })), total: Math.max(0, Number(data?.total) || 0), next: Boolean(data?.next) }
  }

  async function loadSpotifyPlaylist(playlist, offset = 0) {
    const uri = safeText(playlist?.uri)
    const id = /^spotify:playlist:[A-Za-z0-9]+$/.test(uri) ? uri.split(':')[2] : safeText(playlist?.id)
    if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error('Choose a valid Spotify playlist first.')
    const start = Math.max(0, Math.floor(Number(offset) || 0))
    const data = await spotifyRequest(`/playlists/${encodeURIComponent(id)}/tracks?limit=50&offset=${start}`)
    if (!Array.isArray(data?.items)) throw new Error('Spotify did not return playlist tracks. Retry or reconnect Spotify.')
    const tracks = [], unavailable = []
    data.items.forEach((entry, at) => {
      // An explicit null track/item means removed/unavailable — never fall
      // back to the wrapper object itself.
      const raw = entry && typeof entry === 'object' && ('track' in entry || 'item' in entry) ? (entry.track ?? entry.item) : entry
      const position = start + at
      const contextUri = `spotify:playlist:${id}`
      const track = spotifyTrack(raw)
      if (!track || raw?.is_playable === false || raw?.is_local) {
        // Unknown/unavailable/restricted entries stay visible at their exact
        // occurrence position — never silently dropped, never playable.
        unavailable.push({ ...(track || {}), source: 'spotify', kind: 'unavailable', unavailable: true, playable: false, id: track?.id || `unavailable:${id}:${position}`, title: track?.title || 'Unavailable track', unavailableReason: spotifyEntryUnavailableReason(raw), contextUri, contextPosition: position })
        return
      }
      tracks.push({ ...track, relinked: Boolean(raw?.linked_from), subtitle: raw?.linked_from ? `${track.subtitle} · relinked by Spotify` : track.subtitle, contextUri, contextPosition: position })
    })
    const rows = [...tracks, ...unavailable].sort((a, b) => a.contextPosition - b.contextPosition)
    const total = Number.isFinite(data.total) ? Math.max(0, data.total) : start + data.items.length
    const nextOffset = start + data.items.length
    return { playlist, tracks, unavailable, rows, total, next: Boolean(data.next) || nextOffset < total, nextOffset, skipped: unavailable.length }
  }

  function playSpotifyPlaylistTrack(queueItem, track) {
    if (track?.unavailable || track?.playable === false) {
      message.set(track?.unavailableReason || 'That entry is unavailable on Spotify.')
      return Promise.resolve(false)
    }
    if (!/^spotify:playlist:[A-Za-z0-9]+$/.test(queueItem?.uri || '') || track?.contextUri !== queueItem.uri || !Number.isInteger(track.contextPosition) || track.contextPosition < 0 || track.contextPosition > 10000) {
      message.set('Refresh this Spotify playlist before choosing the track.')
      return Promise.resolve(false)
    }
    return runTransition(async token => {
      if (token !== transition) return false
      let at = queue.get().indexOf(queueItem)
      if (at < 0) { message.set('That playlist is no longer in the queue.'); return false }
      const previous = current()
      if (previous?.source !== 'spotify') await stopActive(previous)
      if (token !== transition) return false
      at = queue.get().indexOf(queueItem)
      if (at < 0) return false
      await startSelected(at, token, track.contextPosition)
      return token === transition && status.get() !== 'error'
    })
  }

  async function resolvePlaylistSave(item, mode, options = {}) {
    const normalized = normalizeQueueItem(item)
    if (!normalized) throw new Error('Choose a supported track or playlist.')
    if (normalized.source !== 'local') throw new Error('New FluidMusic collections accept indexed local tracks only.')
    if (!normalized.localTrackId) throw new Error('Index this file’s folder before saving it to a playlist.')
    const checkCancelled = () => { if (disposed || options.signal?.aborted) throw new Error('Save cancelled. Nothing was changed.') }
    checkCancelled()
    return { items: [serializePlaylistItem(normalized)], skipped: 0 }
  }

  async function saveToPlaylist({ id = '', name = '', item, mode = 'tracks', signal, onProgress } = {}) {
    // Resolve all pages first. No empty destination or partial copy is published on failure/cancel.
    if (!id && !safeText(name)) throw new Error('Enter a playlist name.')
    if (id && playlists.get().some(entry => entry.id === id && entry.legacy)) throw new Error('Legacy mixes are read-only and cannot be save destinations.')
    if (id && !playlists.get().some(entry => entry.id === id && !entry.legacy)) throw new Error('Choose an existing writable local collection.')
    const resolved = await resolvePlaylistSave(item, mode, { signal, onProgress })
    if (disposed || signal?.aborted) throw new Error('Save cancelled. Nothing was changed.')
    const existing = playlists.get()
    if (id && !existing.some(entry => entry.id === id)) throw new Error('The destination was deleted. Nothing was saved.')
    const now = new Date().toISOString()
    const destinationId = id || `playlist:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    const next = id ? existing.map(entry => entry.id === id ? { ...entry, items: [...entry.items, ...resolved.items], updatedAt: now } : entry) : [...existing, { id: destinationId, name: safeText(name), description: '', createdAt: now, updatedAt: now, items: resolved.items, legacy: false }]
    const state = playlistStorageState(next)
    ctx.storage.set('playlistState', state)
    if (JSON.stringify(ctx.storage.get('playlistState', null)) !== JSON.stringify(state)) throw new Error('Playlist storage could not confirm the save. Check available storage and retry.')
    undoState.set(null)
    playlists.set(next)
    return { playlist: next.find(entry => entry.id === destinationId), added: resolved.items.length, skipped: resolved.skipped }
  }

  function restartSpotifyPolling() {
    if (spotifyTimer) clearInterval(spotifyTimer)
    spotifyTimer = null
    // A disposed controller must never resurrect polling (late surface
    // unmount/remount after plugin disposal is not playback intent).
    if (disposed) return
    spotifyTimer = setInterval(() => {
      void refreshSpotify()
      void refreshSpotifyDevices()
    }, 1000 * (pollOpen ? pollIntervalOpen : pollIntervalClosed))
  }

  function setPollingOpen(open) {
    pollOpen = Boolean(open)
    restartSpotifyPolling()
  }

  async function loadConfig() {
    try {
      const config = await request('/config')
      if (disposed) return
      const settings = config?.settings || config || {}
      pollIntervalOpen = Math.max(8, Number(settings.poll_interval_open) || pollIntervalOpen)
      pollIntervalClosed = Math.max(20, Number(settings.poll_interval_closed) || pollIntervalClosed)
      restartSpotifyPolling()
    } catch { /* Default polling intervals remain safe when config is unavailable. */ }
  }

  restartSpotifyPolling()
  spotifyProgressTimer = setInterval(updateSpotifyProgress, 500)
  void loadConfig()
  void refreshSpotify()
  void refreshSpotifyAuth()
  void refreshSpotifyDevices()
  void refreshLocalLibrary().catch(() => {})
  void refreshHistory().catch(() => {})
  void loadHistoryRetention().catch(() => {})
  void refreshQueuedYouTubeMetadata()
  ctx.onDispose(() => {
    disposed = true
    transition += 1
    clearInterval(spotifyTimer)
    clearInterval(spotifyProgressTimer)
    clearInterval(sleepInterval)
    sleepInterval = null
    clearAuthPoll()
    clearTimeout(volumeTimer)
    stopInternalAudio()
    youtubeCommandSink = null
    new Set([...queue.get(), ...localRegistry.values()]).forEach(revokeLocal)

  })

  // ---- Queue editing, one-step undo and provenance (FM-20) ----
  function rememberQueueEdit(label) {
    queueUndo.set({ label, queue: queue.get().map(item => ({ ...item })), index: index.get() })
  }

  function addNext(item, origin = '') {
    let normalized = normalizeQueueItem(item)
    if (!normalized) { message.set('That item is not a supported public Spotify, HTTPS radio, or indexed local audio entry.'); return false }
    if (normalized.source === 'local' && normalized.unavailable) { message.set('That local track is unavailable. Rescan its music folder first.'); return false }
    if (normalized.source === 'local') {
      localRegistry.set(normalized.id, normalized)
      if (normalized.localTrackId) localRegistry.set(normalized.localTrackId, normalized)
    }
    if (origin && QUEUE_ORIGINS[origin]) normalized = { ...normalized, origin }
    rememberQueueEdit('Play next')
    const items = queue.get()
    const at = index.get()
    const insertAt = at >= 0 && at < items.length ? at + 1 : items.length
    queue.set([...items.slice(0, insertAt), normalized, ...items.slice(insertAt)])
    if (index.get() < 0) { index.set(insertAt); status.set('paused') }
    persist()
    message.set(`Added “${normalized.title}” to play next.`)
    return true
  }

  function removeQueueItems(positions) {
    const items = queue.get()
    const set = new Set((Array.isArray(positions) ? positions : []).filter(p => Number.isInteger(p) && p >= 0 && p < items.length))
    if (!set.size) return false
    rememberQueueEdit('Remove selected')
    const at = index.get()
    const previous = current()
    const removingCurrent = set.has(at)
    const nextItems = items.filter((_, p) => !set.has(p))
    let nextIndex = -1
    if (nextItems.length) {
      if (!removingCurrent) {
        nextIndex = at - [...set].filter(p => p < at).length
      } else {
        const after = items.findIndex((_, p) => p > at && !set.has(p))
        const before = items.map((_, p) => p).filter(p => p < at && !set.has(p)).pop()
        nextIndex = nextItems.indexOf(items[after >= 0 ? after : before])
      }
    }
    const wasPlaying = ['playing', 'loading'].includes(status.get())
    return runTransition(async token => {
      if (token !== transition) return false
      if (removingCurrent) await stopActive(previous)
      if (token !== transition) return false
      queue.set(nextItems)
      index.set(nextIndex)
      persist()
      if (!nextItems.length) { status.set('idle'); message.set(''); return true }
      if (removingCurrent) {
        progress.set({ positionMs: 0, durationMs: 0 })
        spotifyQueueGuard = null
        spotifyProgressAnchor = null
        if (wasPlaying) await startSelected(nextIndex, token)
        else { status.set('paused'); message.set(`Removed ${set.size} item(s). Press play to resume.`) }
      } else message.set(`Removed ${set.size} item(s) from the queue.`)
      return true
    })
  }

  function moveQueueItems(positions, direction) {
    const items = queue.get()
    const set = new Set((Array.isArray(positions) ? positions : []).filter(p => Number.isInteger(p) && p >= 0 && p < items.length))
    if (!set.size || (direction !== -1 && direction !== 1)) return false
    if ((direction === -1 && Math.min(...set) === 0) || (direction === 1 && Math.max(...set) === items.length - 1)) return false
    rememberQueueEdit('Move selected')
    const next = [...items]
    const order = [...set].sort((a, b) => direction === -1 ? a - b : b - a)
    for (const p of order) { const t = p + direction; [next[p], next[t]] = [next[t], next[p]] }
    const currentItem = items[index.get()]
    const nextIndex = currentItem ? next.indexOf(currentItem) : index.get()
    queue.set(next)
    if (nextIndex >= 0) index.set(nextIndex)
    persist()
    return true
  }

  function clearUpcoming() {
    const items = queue.get()
    const at = index.get()
    if (at < 0 || at >= items.length - 1) return false
    rememberQueueEdit('Clear upcoming')
    queue.set(items.slice(0, at + 1))
    persist()
    message.set('Cleared everything after the current item. The current item keeps playing.')
    return true
  }

  function undoQueueEdit() {
    const saved = queueUndo.get()
    if (!saved) return false
    queueUndo.set(null)
    const previous = current()
    const restored = saved.queue[saved.index] || null
    queue.set(saved.queue)
    index.set(saved.index)
    persist()
    const sameOccurrence = previous && restored && previous.id === restored.id && previous.source === restored.source
    if (sameOccurrence) { message.set(`Undone: ${saved.label}.`); return true }
    if (!previous) {
      status.set(saved.queue.length ? 'paused' : 'idle')
      message.set(`Undone: ${saved.label}.`)
      return true
    }
    // The edit changed which occurrence is current: stop the engine the edit
    // started and pause honestly. Undo never auto-resumes playback.
    return runTransition(async token => {
      if (token !== transition) return false
      await stopActive(previous)
      if (token === transition) { status.set(saved.queue.length ? 'paused' : 'idle'); message.set(`Undone: ${saved.label}. Press play to resume.`) }
      return true
    })
  }

  // ---- Resumable listening sessions (FM-20): safe-reference snapshots ----
  const persistSessions = () => ctx.storage.set('listeningSessions', listeningSessions.get())

  function saveListeningSession(name) {
    const queued = queue.get()
    // Session-only opened files have no durable reference: skip them honestly
    // instead of persisting dead unavailable entries.
    const durable = queued.filter(item => item && !(item.source === 'local' && !item.localTrackId))
    const items = durable.map(serializePlaylistItem).filter(Boolean)
    const skipped = queued.length - items.length
    if (!items.length) { message.set('There are no durable items to save. Index session-only files first.'); return null }
    const session = { id: makeId('session', Date.now().toString(36)), name: safeText(name, 'Listening session').slice(0, 120), createdAt: new Date().toISOString(), items }
    listeningSessions.set([session, ...listeningSessions.get()].slice(0, 50))
    persistSessions()
    message.set(`Saved “${session.name}” (${items.length} item(s)${skipped ? `, ${skipped} session-only skipped` : ''}).`)
    return session
  }

  function listeningSessionPreview(id) {
    const session = listeningSessions.get().find(entry => entry.id === id)
    if (!session) return null
    const rows = session.items.map(reference => {
      const normalized = normalizeQueueItem(reference)
      if (!normalized) return { item: reference, available: false, reason: 'Unsupported reference' }
      if (normalized.source === 'local') {
        const linked = localRegistry.get(normalized.localTrackId) || localRegistry.get(normalized.id)
        if (!linked || linked.unavailable) return { item: normalized, available: false, reason: 'Missing local file · rescan its folder' }
        return { item: { ...normalized, filePath: linked.filePath, objectUrl: linked.objectUrl, mimeType: linked.mimeType || normalized.mimeType, durationMs: linked.durationMs || normalized.durationMs }, available: true }
      }
      return { item: normalized, available: true }
    })
    return { session, rows, unavailable: rows.filter(row => !row.available) }
  }

  function restoreListeningSession(id, mode) {
    const preview = listeningSessionPreview(id)
    if (!preview) return false
    const playable = preview.rows.filter(row => row.available).map(row => row.item)
    if (!playable.length) { message.set('Nothing in this session is currently available. Rescan local folders or reconnect providers, then try again.'); return false }
    const skipped = preview.rows.length - playable.length
    if (mode === 'append') {
      rememberQueueEdit('Append session')
      const before = queue.get().length
      queue.set([...queue.get(), ...playable])
      if (index.get() < 0) { index.set(before); status.set('paused') }
      persist()
      message.set(`Appended ${playable.length} item(s)${skipped ? `; ${skipped} unavailable skipped` : ''}. Press play to listen.`)
      return true
    }
    rememberQueueEdit('Restore session')
    return runTransition(async token => {
      if (token !== transition) return false
      await stopActive(current())
      if (token !== transition) return false
      queue.set(playable)
      index.set(0)
      status.set('paused')
      persist()
      message.set(`Restored “${preview.session.name}” (${playable.length} item(s)${skipped ? `, ${skipped} unavailable skipped` : ''}). Press play to listen.`)
      return true
    })
  }

  function deleteListeningSession(id) {
    const before = listeningSessions.get()
    const next = before.filter(entry => entry.id !== id)
    if (next.length === before.length) return false
    listeningSessions.set(next)
    persistSessions()
    return true
  }

  // ---- Long-form resume, bookmarks and source-aware sleep timer (FM-21) ----
  const monotonicNow = () => (typeof performance === 'object' && performance && typeof performance.now === 'function' ? performance.now() : Date.now())

  function sleepBoundMatches(item) {
    return Boolean(sleepBound && item && sleepBound.id === item.id && sleepBound.source === item.source)
  }

  function loadResumeContext(item, token) {
    const key = mediaKeyFor(item)
    if (!isLongFormEligible(item) || !key) {
      if (token === transition && current()?.id === item.id) { resumeOffer.set(null); bookmarks.set([]) }
      return Promise.resolve()
    }
    return Promise.all([
      request(`/resume?media_key=${encodeURIComponent(key)}`).catch(() => null),
      request(`/bookmarks?media_key=${encodeURIComponent(key)}`).catch(() => null),
    ]).then(([resumeData, bookmarkData]) => {
      if (token !== transition || current()?.id !== item.id) return
      const saved = normalizeResumePosition(resumeData?.resume)
      const position = saved && saved.mediaKey === key ? saved.positionMs : 0
      const duration = saved && saved.mediaKey === key && saved.durationMs > 0 ? saved.durationMs : Number(item.durationMs) || 0
      // Explicit Resume/Start over only — never an automatic seek on selection.
      const offerable = position >= 15000 && (duration <= 0 || position < duration - 15000)
      resumeOffer.set(offerable ? { mediaKey: key, positionMs: position, durationMs: duration, title: item.title } : null)
      bookmarks.set((Array.isArray(bookmarkData?.items) ? bookmarkData.items : []).map(normalizeBookmark).filter(Boolean))
    })
  }

  function saveResumePosition(force = false) {
    const item = current()
    const key = mediaKeyFor(item)
    if (!isLongFormEligible(item) || !key) return
    if (!force && monotonicNow() - lastResumeSaveAt < 15000) return
    const { positionMs, durationMs } = progress.get()
    if (positionMs < 15000) return
    if (durationMs > 0 && positionMs >= durationMs - 15000) return
    lastResumeSaveAt = monotonicNow()
    void request('/resume', { method: 'PUT', body: { media_key: key, position_ms: Math.round(positionMs), duration_ms: Math.round(durationMs) } }).catch(() => {})
  }

  function clearResumeOnEnded(item) {
    const key = mediaKeyFor(item)
    if (!isLongFormEligible(item) || !key) return
    if (current()?.id === item.id) resumeOffer.set(null)
    void request(`/resume?media_key=${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {})
  }

  function resumeHere() {
    const offer = resumeOffer.get()
    if (!offer || mediaKeyFor(current()) !== offer.mediaKey) return false
    resumeOffer.set(null)
    void seekTo(offer.positionMs)
    message.set(`Resumed at ${formatPositionMs(offer.positionMs)}.`)
    return true
  }

  function startOver() {
    const offer = resumeOffer.get()
    const key = offer && mediaKeyFor(current()) === offer.mediaKey ? offer.mediaKey : mediaKeyFor(current())
    if (!key) return false
    resumeOffer.set(null)
    void request(`/resume?media_key=${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {})
    void seekTo(0)
    message.set('Starting over from the beginning.')
    return true
  }

  const sortBookmarks = entries => [...entries].sort((a, b) => a.positionMs - b.positionMs || a.id - b.id)

  function refreshBookmarks() {
    const key = mediaKeyFor(current())
    if (!key) { bookmarks.set([]); return Promise.resolve([]) }
    return request(`/bookmarks?media_key=${encodeURIComponent(key)}`)
      .then(data => {
        const items = (Array.isArray(data?.items) ? data.items : []).map(normalizeBookmark).filter(Boolean)
        if (mediaKeyFor(current()) === key) bookmarks.set(items)
        return items
      })
      .catch(() => [])
  }

  async function addBookmark(label = '') {
    const item = current()
    const key = mediaKeyFor(item)
    if (!isLongFormEligible(item) || !key) { message.set('Bookmarks are available for long-form YouTube and local items (10 minutes or longer).'); return null }
    const positionMs = Math.round(progress.get().positionMs)
    try {
      const data = await request('/bookmarks', { method: 'POST', body: { media_key: key, position_ms: positionMs, label } })
      const bookmark = normalizeBookmark(data?.bookmark)
      if (bookmark && mediaKeyFor(current()) === key) bookmarks.set(sortBookmarks([...bookmarks.get(), bookmark]))
      message.set(`Bookmark saved at ${formatPositionMs(positionMs)}.`)
      return bookmark
    } catch (error) { message.set(userFacingError(error, 'That bookmark could not be saved.')); return null }
  }

  async function editBookmark(id, changes = {}) {
    const body = {}
    if (changes.positionMs !== undefined) body.position_ms = Math.round(Number(changes.positionMs) || 0)
    if (changes.label !== undefined) body.label = changes.label
    try {
      const data = await request(`/bookmarks/${Number(id)}`, { method: 'PUT', body })
      const bookmark = normalizeBookmark(data?.bookmark)
      if (bookmark) bookmarks.set(sortBookmarks(bookmarks.get().map(entry => entry.id === bookmark.id ? bookmark : entry)))
      return bookmark
    } catch (error) { message.set(userFacingError(error, 'That bookmark could not be updated.')); return null }
  }

  async function deleteBookmark(id) {
    try {
      await request(`/bookmarks/${Number(id)}`, { method: 'DELETE' })
      bookmarks.set(bookmarks.get().filter(entry => entry.id !== Number(id)))
      return true
    } catch (error) { message.set(userFacingError(error, 'That bookmark could not be deleted.')); return false }
  }

  function jumpToBookmark(id) {
    const bookmark = bookmarks.get().find(entry => entry.id === Number(id))
    if (!bookmark) return false
    void seekTo(bookmark.positionMs)
    message.set(`Jumped to ${formatPositionMs(bookmark.positionMs)}${bookmark.label ? ` · ${bookmark.label}` : ''}.`)
    return true
  }

  function disarmSleepTimer() {
    if (sleepInterval) { clearInterval(sleepInterval); sleepInterval = null }
    sleepDeadline = 0
    sleepBound = null
    sleepTimer.set({ mode: 'off', remainingMs: 0, label: '' })
  }

  function cancelSleepTimer(reason = 'Sleep timer cancelled.') {
    if (sleepTimer.get().mode === 'off') return false
    disarmSleepTimer()
    message.set(reason)
    return true
  }

  function pauseForSleep() {
    const item = current()
    if (!item) return
    if (item.source === 'radio') { stopInternalAudio(); status.set('paused'); return }
    if (item.source === 'local') { if (audio) audio.pause(); status.set('paused'); return }
    if (item.source === 'youtube') {
      const sent = youtubeCommandSink ? youtubeCommandSink('pauseVideo', []) : false
      if (!sent) message.set('The YouTube player is not ready, so the sleep timer could not pause it.')
      return
    }
    if (item.source === 'spotify') void spotifyRequest('/pause', { method: 'POST', body: spotifyCommandBody() }).catch(() => {})
  }

  function finishSleepAtEndOfItem(item) {
    // Consume the advance guards so repeated ended reports can never push the
    // queue forward after the sleep timer chose to stop at this item.
    sleepEndedFor = item?.id || null
    if (youtubeQueueGuard) youtubeQueueGuard.advancing = true
    spotifyProgressAnchor = null
    spotifyQueueGuard = null
    disarmSleepTimer()
    status.set('paused')
    message.set('Sleep timer finished at the end of the item. Playback paused.')
  }

  function sleepTick() {
    if (disposed) { disarmSleepTimer(); return }
    const state = sleepTimer.get()
    if (state.mode !== 'duration') return
    if (!sleepBoundMatches(current())) { cancelSleepTimer('The source changed, so the sleep timer was cancelled. It never controls another device.'); return }
    const remainingMs = Math.max(0, sleepDeadline - monotonicNow())
    if (remainingMs <= 0) {
      disarmSleepTimer()
      pauseForSleep()
      message.set('Sleep timer finished. Playback paused.')
      return
    }
    sleepTimer.set({ ...state, remainingMs })
  }

  function armSleepTimer(mode, minutes = 0) {
    const item = current()
    if (!item) { message.set('Choose something to play before starting a sleep timer.'); return false }
    if (mode === 'end-of-item') {
      if (item.source === 'radio') { message.set('Live radio has no end-of-item. Choose a duration instead.'); return false }
      disarmSleepTimer()
      sleepBound = { id: item.id, source: item.source }
      sleepTimer.set({ mode: 'end-of-item', remainingMs: 0, label: 'End of item' })
      message.set(`Sleep timer armed: pause at the end of “${item.title}”.`)
      return true
    }
    const bounded = boundedSleepMinutes(minutes)
    if (!bounded) { message.set(`Choose 1–${SLEEP_MAX_CUSTOM_MIN} minutes for the sleep timer.`); return false }
    disarmSleepTimer()
    sleepBound = { id: item.id, source: item.source }
    sleepDeadline = monotonicNow() + bounded * 60000
    sleepTimer.set({ mode: 'duration', remainingMs: bounded * 60000, label: `${bounded} min` })
    sleepInterval = setInterval(sleepTick, 1000)
    message.set(`Sleep timer armed: pause in ${bounded} minute(s).`)
    return true
  }

  // ---- Recovery center: evidence-based health and bounded retries (FM-22) ----
  function recordHealth(source, state, detail, action = '') {
    const row = normalizeHealthRow({ source, state, detail, action, lastEvidenceAt: new Date().toISOString() })
    if (row) sourceHealth.set({ ...sourceHealth.get(), [source]: row })
  }

  function tryRetry(key) {
    const now = monotonicNow()
    const gate = retryGate(retryBudgets.get(key), now)
    if (!gate.allowed) {
      message.set(`Retry is cooling down for ${Math.ceil(gate.remainingMs / 1000)}s. Wait, then try again.`)
      return false
    }
    const consumed = retryConsumed(retryBudgets.get(key), now)
    retryBudgets.set(key, consumed)
    retryState.set({ ...retryState.get(), [key]: { ...consumed, cooldownUntilWall: consumed.cooldownUntil > 0 ? Date.now() + (consumed.cooldownUntil - now) : 0 } })
    addLog('state', 'recovery.retry', { key, attempt: gate.attempts + 1, cooldownMs: consumed.cooldownUntil > 0 ? RETRY_COOLDOWN_MS : 0 })
    return true
  }

  function retryRadio() {
    const item = current()
    if (!item || item.source !== 'radio') return Promise.resolve(false)
    if (!tryRetry('radio')) return Promise.resolve(false)
    return playAt(index.get()).then(() => true)
  }

  function retrySpotify() {
    if (!tryRetry('spotify')) return Promise.resolve(false)
    return refreshSpotify().then(() => true).catch(() => false)
  }

  function copyDiagnostics() {
    const rows = Object.values(sourceHealth.get()).map(row => `  ${row.source}: ${row.state} — ${row.detail}${row.lastEvidenceAt ? ` (evidence ${row.lastEvidenceAt})` : ''}`)
    const events = logs.get().slice(0, 40).map(entry => `  ${entry.at} ${entry.level} ${entry.event} ${JSON.stringify(entry.detail)}`)
    return [
      'FluidMusic diagnostics (sanitized — no tokens, credentials or raw history)',
      `Generated: ${new Date().toISOString()}`,
      `Status: ${status.get()} · Current source: ${current()?.source || 'none'}`,
      'Source health:',
      ...(rows.length ? rows : ['  no evidence recorded yet']),
      'Recent events:',
      ...(events.length ? events : ['  none']),
    ].join('\n')
  }

  return {
    workspaceView, setWorkspaceView, selectedPlaylist, selectPlaylist, undoState, undoPlaylistEdit, toggleMute, titlebarOpen,
    playlistItems, enqueuePlaylist, saveQueueAsPlaylist, addManyToPlaylist, removePlaylistItems, deduplicatePlaylist, exportPlaylists, importPlaylists,
    queue, index, favorites, volume, status, message, logs, spotify, spotifyAuth, spotifyDevices, progress, playlists, localTracks, localRoots, history, historyTotal, shuffle, repeat, spotifyAutoplay, youtube, spotifyFailure, spotifyLocalCapability, assessSpotifyLocalPlayback,
    current, add, remove, move, clearQueue, resetSavedRadio, next, previous, playAt, toggle, seekTo, setVolume, setShuffle, setRepeat, setSpotifyAutoplay,
    queueUndo, addNext, removeQueueItems, moveQueueItems, clearUpcoming, undoQueueEdit,
    listeningSessions, saveListeningSession, listeningSessionPreview, restoreListeningSession, deleteListeningSession,
    resumeOffer, bookmarks, sleepTimer, historyRetention, historyFilters, historyOffset,
    resumeHere, startOver, addBookmark, editBookmark, deleteBookmark, jumpToBookmark, refreshBookmarks,
    armSleepTimer, cancelSleepTimer, removeHistoryEntry, loadHistoryRetention, setHistoryRetention,
    sourceHealth, retryState, retryRadio, retrySpotify, copyDiagnostics,
    toggleFavorite, refreshSpotify, refreshSpotifyAuth, refreshSpotifyDevices, startSpotifyAuth, transferSpotifyDevice, addYouTubeUrl, addYouTubeItem, searchYouTube, resolveYouTubeEmbedUrl, reportYouTubeState, setYouTubeCommandSink, retryYouTube, attemptYouTubeWatchFallback, youtubeWatchCapability: () => watchCapability,
    sessionTracks, openLocalFiles, refreshLocalLibrary, addLocalRoot, chooseLocalRoot, rescanLocalLibrary, removeLocalRoot,
    searchSpotify, searchSpotifyCatalog, loadSpotifyPlaylists, loadSpotifyPlaylist, playSpotifyPlaylistTrack, saveToPlaylist,
    createPlaylist, updatePlaylist, deletePlaylist, duplicatePlaylist, addToPlaylist, removeFromPlaylist, moveInPlaylist, playPlaylist,
    capabilities: () => mediaCapabilities(current()), clearLogs, refreshHistory, clearHistory, setPollingOpen, rest: api, polling: () => ({ open: pollIntervalOpen, closed: pollIntervalClosed })
  }
}
/* CONTROLLER_END */
function WorkspaceButton({ children, primary = false, danger = false, ...props }) {
  // Button is an optional host SDK export; fall back to a plain button rather
  // than crashing when a host build does not provide it.
  return h(
    Button || 'button',
    {
      type: 'button',
      ...(Button ? { variant: danger ? 'destructive' : primary ? 'default' : 'secondary', size: 'sm' } : {}),
      ...props,
    },
    children,
  )
}
function PageHead({ kicker, title, subtitle, actions }) {
  return h(
    'header',
    { className: 'fluid-page-head' },
    h(
      'div',
      {},
      h('h1', { className: 'fluid-page-title' }, title),
      h('p', { className: 'fluid-page-subtitle' }, subtitle),
    ),
    h('div', { className: 'fluid-actions' }, actions),
  )
}
function Artwork({ item, className = 'fluid-tile-art' }) {
  const art = item?.artwork || item?.favicon
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [art])
  return h(
    'div',
    { className },
    art && !failed
      ? h('img', {
          src: art,
          alt: '',
          loading: 'lazy',
          referrerPolicy: 'no-referrer',
          onError: () => setFailed(true),
        })
      : h(Icon, { kind: item?.source || 'music' }),
  )
}
function Empty({ title, children }) {
  return h(
    'div',
    { className: 'fluid-empty' },
    h(Icon, { kind: 'music' }),
    h('strong', {}, title),
    h('div', {}, children),
  )
}
function Modal({ title, children, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    dialog.showModal()
    dialog.querySelector('[autofocus], input:not([type="hidden"]), textarea')?.focus()
    return () => {
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  return h(
    'dialog',
    {
      ref,
      className: 'fluid-dialog',
      'aria-label': title,
      onCancel: (event) => {
        event.preventDefault()
        onClose()
      },
    },
    h(
      'header',
      { className: 'fluid-section-head' },
      h('h2', { className: 'fluid-section-title' }, title),
      h(Action, {
        kind: 'close',
        label: 'Close dialog',
        compact: true,
        onClick: onClose,
      }),
    ),
    children,
  )
}
function Confirm({ title, children, action, onClose }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return h(
    Modal,
    {
      title,
      onClose: () => {
        if (!busy) onClose()
      },
    },
    h('p', { className: 'fluid-muted' }, children),
    error && h('p', { role: 'alert' }, error),
    h(
      'div',
      { className: 'fluid-dialog-actions' },
      h(WorkspaceButton, { disabled: busy, onClick: onClose }, 'Cancel'),
      h(
        WorkspaceButton,
        {
          danger: true,
          disabled: busy,
          onClick: async () => {
            setBusy(true)
            try {
              const result = await action()
              if (result === false)
                throw new Error(
                  'The action could not complete. Check the player message and retry.',
                )
              onClose()
            } catch (reason) {
              setError(userFacingError(reason))
              setBusy(false)
            }
          },
        },
        busy ? 'Working…' : title,
      ),
    ),
  )
}
function Notice({ controller }) {
  const text = useValue(controller.message)
  return text
    ? h(
        'div',
        { className: 'fluid-notice', role: 'status' },
        h('span', {}, text),
        h(Action, {
          compact: true,
          kind: 'close',
          label: 'Dismiss message',
          onClick: () => controller.message.set(''),
        }),
      )
    : null
}
function AddToPlaylist({ controller, item }) {
  const [open, setOpen] = useState(false)
  if (item.source !== 'local' || !item.localTrackId) return null
  return h(
    'span',
    {},
    h(Action, {
      compact: true,
      kind: 'playlist',
      label: `Save ${item.title} to playlist`,
      onClick: () => setOpen(true),
    }),
    open &&
      h(SavePlaylistDialog, {
        controller,
        item,
        onClose: () => setOpen(false),
      }),
  )
}
function SavePlaylistDialog({ controller, item, onClose }) {
  const playlists = useValue(controller.playlists).filter(entry => !entry.legacy)
  const [destination, setDestination] = useState(playlists[0]?.id || 'new')
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState(null)

  const operation = useRef(null),
    mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
      operation.current?.abort()
    },
    [],
  )
  const cancel = () => {
    operation.current?.abort()
    onClose()
  }
  const valid =
    destination === 'new'
      ? Boolean(name.trim())
      : playlists.some((entry) => entry.id === destination)
  const save = async (event) => {
    event.preventDefault()
    if (!valid || operation.current) return
    const abort = new AbortController()
    operation.current = abort
    setBusy(true)
    setError('')
    setProgress(null)
    try {
      const result = await controller.saveToPlaylist({
        id: destination === 'new' ? '' : destination,
        name,
        item,

        signal: abort.signal,
        onProgress: (value) => {
          if (mounted.current) setProgress(value)
        },
      })
      if (mounted.current) {
        controller.message.set(
          `Saved ${result.added} ${result.added === 1 ? 'item' : 'items'} to “${result.playlist.name}”.${result.skipped ? ` Skipped ${result.skipped} unsupported or unavailable entries.` : ''}`,
        )
        onClose()
      }
    } catch (reason) {
      if (mounted.current && !abort.signal.aborted) setError(userFacingError(reason))
    } finally {
      operation.current = null
      if (mounted.current) setBusy(false)
    }
  }
  return h(
    Modal,
    { title: 'Save to playlist', onClose: cancel },
    h(
      'div',
      { className: 'fluid-save-source' },
      h(Artwork, { item, className: 'fluid-mini-cover' }),
      h(
        'div',
        { className: 'fluid-row-copy' },
        h('strong', { className: 'fluid-row-title' }, item.title),
        h(
          'span',
          { className: 'fluid-row-detail' },
          sourceLabel(item),
        ),
      ),
    ),
    h(
      'form',
      { onSubmit: save },

      h(
        'fieldset',
        { className: 'fluid-save-destinations', disabled: busy },
        h('legend', { className: 'fluid-label' }, 'Choose a destination'),
        h(
          'div',
          { className: 'fluid-playlist-list' },
          playlists.map((entry) =>
            h(
              'button',
              {
                type: 'button',
                className: 'fluid-playlist-button fluid-save-choice',
                key: entry.id,
                'aria-pressed': destination === entry.id,
                onClick: () => setDestination(entry.id),
              },
              h(Icon, {
                kind: destination === entry.id ? 'check' : 'playlist',
              }),
              h(
                'span',
                { className: 'fluid-row-copy' },
                h('strong', {}, entry.name),
                h('span', {}, `${entry.items.length} items`),
              ),
            ),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'fluid-playlist-button fluid-save-choice',
            'aria-pressed': destination === 'new',
            onClick: () => setDestination('new'),
          },
          h(Icon, { kind: destination === 'new' ? 'check' : 'plus' }),
          'Create a new playlist',
        ),
        destination === 'new' &&
          h(
            'label',
            { className: 'fluid-field' },
            'New playlist name',
            h('input', {
              className: 'fluid-input',
              value: name,
              maxLength: 120,
              required: true,
              onChange: (event) => setName(event.target.value),
              placeholder: 'Name your playlist',
            }),
          ),
      ),
      error && h('p', { className: 'fluid-error', role: 'alert' }, error),
      busy &&
        h(
          'p',
          { className: 'fluid-muted', role: 'status' },
          progress
            ? `Loading songs: ${progress.loaded} / ${progress.total}`
            : 'Preparing your save…',
        ),
      h(
        'div',
        { className: 'fluid-dialog-actions' },
        h(WorkspaceButton, { onClick: cancel }, 'Cancel'),
        h(
          WorkspaceButton,
          { primary: true, type: 'submit', disabled: busy || !valid },
          busy ? 'Saving…' : destination === 'new' ? 'Create & save' : 'Save',
        ),
      ),
    ),
  )
}

function TrackRow({
  controller,
  item,
  at = 0,
  onPlay,
  extraActions,
  selectable,
  checked,
  onSelect,
  hideSave = false,
  origin = '',
}) {
  return h(
    'div',
    { className: 'fluid-track-row', 'data-missing': Boolean(item.unavailable) },
    selectable
      ? h('input', {
          type: 'checkbox',
          checked,
          onChange: onSelect,
          'aria-label': `Select ${item.title}`,
        })
      : h('span', { className: 'fluid-track-number' }, String(at + 1).padStart(2, '0')),
    h(Artwork, { item, className: 'fluid-mini-cover' }),
    h(
      'div',
      { className: 'fluid-row-copy' },
      h('span', { className: 'fluid-row-title', title: item.title }, item.title),
      h(
        'span',
        { className: 'fluid-row-detail', title: item.subtitle },
        item.unavailable ? item.unavailableReason || 'Missing file · rescan its folder' : item.subtitle || sourceLabel(item),
      ),
    ),
    h('span', { className: 'fluid-source-tag' }, item.source),
    h(
      'span',
      { className: 'fluid-track-duration' },
      item.durationMs ? formatClock(item.durationMs) : item.source === 'radio' ? 'LIVE' : '—',
    ),
    h(
      'div',
      { className: 'fluid-row-actions' },
      h(Action, {
        compact: true,
        kind: 'play',
        label: `Play ${item.title}`,
        disabled: item.unavailable,
        onClick: onPlay || (() => controller.add(item, true, origin)),
      }),
      h(Action, {
        compact: true,
        kind: 'plus',
        label: `Add ${item.title} to queue`,
        disabled: item.unavailable,
        onClick: () => {
          if (controller.add(item, false, origin)) controller.message.set(`Added “${item.title}” to the queue.`)
        },
      }),
      h(Action, {
        compact: true,
        kind: 'forward',
        label: `Play ${item.title} next`,
        disabled: item.unavailable,
        onClick: () => controller.addNext(item, origin),
      }),
      !hideSave && h(AddToPlaylist, { controller, item }),
      extraActions,
    ),
  )
}
function MediaTile({ controller, item, onOpen }) {
  return h(
    'article',
    { className: 'fluid-media-tile' },
    h(Artwork, { item }),
    h('strong', { className: 'fluid-tile-title' }, item.title || item.name),
    h('span', { className: 'fluid-tile-detail' }, item.subtitle || item.owner || sourceLabel(item)),
    h(
      'div',
      { className: 'fluid-tile-actions' },
      onOpen && h(WorkspaceButton, { onClick: onOpen }, 'Open'),
      item.uri &&
        h(WorkspaceButton, { primary: true, onClick: () => controller.add(item, true) }, 'Play'),
      item.uri && h(AddToPlaylist, { controller, item }),
    ),
  )
}
function VolumeControl({ controller, compact = false }) {
  const volume = useValue(controller.volume)
  return h(
    'div',
    {
      className: compact ? 'fluid-volume fluid-volume-compact' : 'fluid-volume',
    },
    h(Action, {
      compact: true,
      kind: volume === 0 ? 'mute' : 'volume',
      label: volume === 0 ? 'Unmute' : 'Mute',
      onClick: () => controller.toggleMute(),
    }),
    h('input', {
      className: 'fluid-range',
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      value: Math.round(volume * 100),
      onChange: (event) => controller.setVolume(Number(event.target.value) / 100),
      'aria-label': compact ? 'Status bar volume' : 'Player volume',
      'aria-valuetext': `${Math.round(volume * 100)} percent`,
    }),
    h('output', { className: 'fluid-volume-value' }, `${Math.round(volume * 100)}%`),
  )
}
function SeekBar({ controller }) {
  const progress = useValue(controller.progress),
    [draft, setDraft] = useState(null)
  const value = draft ?? Math.min(progress.positionMs, progress.durationMs)
  const commit = (event) => {
    const target = Number(event.currentTarget.value)
    setDraft(null)
    void controller.seekTo(target).catch((error) => controller.message.set(userFacingError(error)))
  }
  return h(
    'div',
    { className: 'fluid-player-progress' },
    h('span', {}, formatClock(value)),
    h('input', {
      className: 'fluid-range',
      type: 'range',
      min: 0,
      max: Math.max(1, progress.durationMs),
      value,
      onChange: (event) => setDraft(Number(event.target.value)),
      onPointerUp: commit,
      onKeyUp: (event) => {
        if (
          [
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Home',
            'End',
            'PageUp',
            'PageDown',
          ].includes(event.key)
        )
          commit(event)
      },
      onPointerCancel: () => setDraft(null),
      onBlur: (event) => {
        if (draft !== null) commit(event)
      },
      'aria-label': 'Seek through current track',
    }),
    h('span', {}, formatClock(progress.durationMs)),
  )
}
function Transport({ controller }) {
  const queue = useValue(controller.queue),
    at = useValue(controller.index),
    status = useValue(controller.status),
    item = queue[at],
    capabilities = mediaCapabilities(item)
  return h(
    'div',
    { className: 'fluid-player-controls' },
    capabilities.previous && h(Action, {
      compact: true,
      kind: 'previous',
      label: 'Previous',
      disabled: !item,
      onClick: () => void controller.previous(),
    }),
    h(
      WorkspaceButton,
      {
        primary: true,
        disabled: !item,
        onClick: () => void controller.toggle(),
        'aria-label': ['playing', 'loading'].includes(status) ? 'Pause' : 'Play',
      },
      h(Icon, {
        kind: ['playing', 'loading'].includes(status) ? 'pause' : 'play',
      }),
    ),
    capabilities.next && h(Action, {
      compact: true,
      kind: 'next',
      label: 'Next',
      disabled: !item,
      onClick: () => void controller.next(),
    }),
  )
}
function QueuePlaylistTracks({ controller, item }) {
  const [tracks, setTracks] = useState([]),
    [total, setTotal] = useState(0),
    [next, setNext] = useState(false),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [skipped, setSkipped] = useState(0)
  const request = useRef(0)
  const load = async (more = false) => {
    const token = ++request.current
    setBusy(true)
    setError('')
    try {
      const page = await controller.loadSpotifyPlaylist(item, more ? offset : 0)
      if (token !== request.current) return
      setTracks((previous) => (more ? [...previous, ...(page.rows || page.tracks)] : (page.rows || page.tracks)))
      setTotal(page.total)
      setNext(page.next)
      setOffset(page.nextOffset)
      setSkipped((previous) => (more ? previous + page.skipped : page.skipped))
    } catch (reason) {
      if (token === request.current) setError(userFacingError(reason))
    } finally {
      if (token === request.current) setBusy(false)
    }
  }
  useEffect(() => {
    void load()
    return () => {
      request.current++
    }
  }, [item.uri])
  return h(
    'section',
    {
      className: 'fluid-queue-context',
      'aria-label': `Songs in ${item.title}`,
    },
    h(
      'div',
      { className: 'fluid-section-head' },
      h(
        'div',
        {},
        h('h3', { className: 'fluid-section-title' }, 'Choose a song'),
        h(
          'p',
          { className: 'fluid-section-copy' },
          `${tracks.length} loaded${total ? ` / ${total} entries` : ''}${skipped ? ` · ${skipped} unavailable entries listed honestly` : ''}. Play starts at that position in Spotify.`,
        ),
      ),
      h(WorkspaceButton, { disabled: busy, onClick: () => void load() }, 'Refresh tracks'),
    ),
    error &&
      h(
        'div',
        { className: 'fluid-error', role: 'alert' },
        error,
        h(
          WorkspaceButton,
          { disabled: busy, onClick: () => void load(tracks.length > 0) },
          'Retry',
        ),
      ),
    h(
      'div',
      { className: 'fluid-track-list' },
      tracks.map((track) =>
        h(TrackRow, {
          origin: 'provider',
          controller,
          item: track,
          at: track.contextPosition,
          key: `${track.uri || track.id}-${track.contextPosition}`,
          onPlay: () => void controller.playSpotifyPlaylistTrack(item, track),
        }),
      ),
    ),
    busy && h('p', { className: 'fluid-muted', role: 'status' }, 'Loading songs…'),
    !busy &&
      !error &&
      !tracks.some((track) => !track.unavailable) &&
      h(
        Empty,
        { title: 'No playable songs found' },
        'Spotify may restrict this playlist or contain unavailable entries.',
      ),
    next &&
      h(WorkspaceButton, { disabled: busy, onClick: () => void load(true) }, 'Load more songs'),
  )
}
function QueueEntry({ controller, item, at, current, status, length, selectable, checked, onSelect }) {
  const collection = /^spotify:playlist:/.test(item.uri || '')
  const [expanded, setExpanded] = useState(collection && at === current)
  return h(
    'div',
    { className: 'fluid-queue-entry' },
    h(
      'div',
      { className: 'fluid-queue-row', 'data-current': at === current, 'data-selectable': selectable ? 'true' : undefined },
      selectable && h('input', {
        type: 'checkbox',
        checked,
        onChange: onSelect,
        'aria-label': `Select ${item.title} (position ${at + 1})`,
      }),
      h(Artwork, { item, className: 'fluid-mini-cover' }),
      h(
        'button',
        {
          type: 'button',
          className: 'fluid-track-link',
          disabled: item.unavailable,
          onClick: () => (collection ? setExpanded(!expanded) : void controller.playAt(at)),
        },
        h('span', { className: 'fluid-row-title' }, item.title),
        h(
          'span',
          { className: 'fluid-row-detail' },
          `${at === current ? `${status === 'playing' ? 'Playing' : 'Selected'} · ` : ''}${collection ? 'Spotify playlist · choose a song below' : item.unavailable ? 'Missing file' : item.subtitle || sourceLabel(item)}`,
        ),
        item.origin && queueOriginLabel(item.origin) && h('span', { className: 'fluid-queue-origin' }, queueOriginLabel(item.origin)),
      ),
      h(
        'div',
        { className: 'fluid-row-actions' },
        collection &&
          h(
            WorkspaceButton,
            {
              'aria-expanded': expanded,
              onClick: () => setExpanded(!expanded),
            },
            expanded ? 'Hide songs' : 'Show songs',
          ),
        collection &&
          h(Action, {
            compact: true,
            kind: 'play',
            label: `Play playlist ${item.title}`,
            onClick: () => void controller.playAt(at),
          }),
        h(AddToPlaylist, { controller, item }),
        h(Action, {
          compact: true,
          kind: 'up',
          label: `Move ${item.title} earlier`,
          disabled: at === 0,
          onClick: () => controller.move(at, -1),
        }),
        h(Action, {
          compact: true,
          kind: 'down',
          label: `Move ${item.title} later`,
          disabled: at === length - 1,
          onClick: () => controller.move(at, 1),
        }),
        h(Action, {
          compact: true,
          kind: 'trash',
          label: `Remove ${item.title} from queue`,
          onClick: () => void controller.remove(at),
        }),
      ),
    ),
    collection && expanded && h(QueuePlaylistTracks, { controller, item }),
  )
}
function QueueList({ controller, selected, onSelect }) {
  const queue = useValue(controller.queue),
    current = useValue(controller.index),
    status = useValue(controller.status)
  return queue.length
    ? h(
        'div',
        { className: 'fluid-queue-list' },
        queue.map((item, at) =>
          h(QueueEntry, {
            key: `${item.id}-${at}`,
            controller,
            item,
            at,
            current,
            status,
            length: queue.length,
            selectable: Boolean(selected),
            checked: Boolean(selected?.has(at)),
            onSelect: () => onSelect?.(at),
          }),
        ),
      )
    : h(
        Empty,
        { title: 'Nothing queued yet' },
        'Use + beside any track or station to build your listening session.',
      )
}
function SpotifyConnection({ controller }) {
  const auth = useValue(controller.spotifyAuth),
    devices = useValue(controller.spotifyDevices),
    localCap = useValue(controller.spotifyLocalCapability)
  const [clientId, setClientId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const run = async (work) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (reason) {
      setError(userFacingError(reason))
    } finally {
      setBusy(false)
    }
  }
  return h(
    'section',
    { className: 'fluid-panel fluid-panel-pad' },
    h(
      'div',
      { className: 'fluid-section-head' },
      h(
        'div',
        {},
        h('h2', { className: 'fluid-section-title' }, 'Spotify Connect'),
        h('p', { className: 'fluid-section-copy' }, 'Playback stays on your chosen Spotify device.'),
      ),
      h(
        'span',
        { className: 'fluid-provider-state' },
        h('i', { className: 'fluid-state-dot', 'data-on': auth.authenticated }),
        auth.authenticated ? 'Connected' : auth.state,
      ),
    ),
    h(
      'div',
      { className: 'fluid-local-playback' },
      h('p', { className: 'fluid-muted' }, `In-plugin audio: ${localCap.state}${localCap.reasons && localCap.reasons[0] ? ` — ${localCap.reasons[0]}` : ''}`),
      h(WorkspaceButton, { disabled: busy, onClick: () => void run(() => controller.assessSpotifyLocalPlayback()) }, 'Check local playback'),
    ),
    auth.needsClientId &&
      h(
        'label',
        { className: 'fluid-field' },
        'Spotify Client ID',
        h('input', {
          className: 'fluid-input',
          value: clientId,
          autoComplete: 'off',
          onChange: (event) => setClientId(event.target.value),
          placeholder: 'Public app client ID',
        }),
        h(
          'small',
          {},
          'Use http://127.0.0.1:43827/spotify/callback in the Spotify dashboard. No client secret.',
        ),
      ),
    !auth.authenticated
      ? h(
          WorkspaceButton,
          {
            primary: true,
            disabled: busy || auth.state === 'connecting',
            onClick: () =>
              void run(async () => {
                await controller.startSpotifyAuth(clientId)
                setClientId('')
              }),
          },
          auth.state === 'connecting' ? 'Waiting for browser approval…' : 'Connect Spotify',
        )
      : h(
          'div',
          {},
          h(
            'div',
            { className: 'fluid-section-head' },
            h('span', { className: 'fluid-muted' }, `${devices.length} available devices`),
            h(
              WorkspaceButton,
              {
                disabled: busy,
                onClick: () => void run(() => controller.refreshSpotifyDevices({ throwOnError: true })),
              },
              'Refresh devices',
            ),
          ),
          h(
            'div',
            { className: 'fluid-device-list' },
            devices.length
              ? devices.map((device) =>
                  h(
                    'div',
                    { className: 'fluid-device', key: device.id },
                    h(Icon, { kind: 'device' }),
                    h(
                      'div',
                      { className: 'fluid-device-copy' },
                      h('strong', {}, device.name),
                      h(
                        'span',
                        {},
                        `${device.type}${device.active ? ' · Active' : ''}${device.restricted ? ' · Restricted' : ''}`,
                      ),
                    ),
                    h(
                      WorkspaceButton,
                      {
                        disabled: busy || device.active || device.restricted,
                        onClick: () => void run(() => controller.transferSpotifyDevice(device.id)),
                      },
                      device.active ? 'Active' : 'Use device',
                    ),
                  ),
                )
              : h(
                  Empty,
                  { title: 'No devices available' },
                  'Open Spotify on your computer, phone, or speaker, then refresh.',
                ),
          ),
        ),
    auth.detail && h('p', { className: 'fluid-muted', role: 'status' }, auth.detail),
    error && h('p', { className: 'fluid-error', role: 'alert' }, error),
  )
}
function SearchPage({ controller }) {
  const auth = useValue(controller.spotifyAuth)
  const [query, setQuery] = useState(''),
    [results, setResults] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [searched, setSearched] = useState(''),
    [offset, setOffset] = useState(0),
    [next, setNext] = useState(false)
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  const search = async (event, more = false) => {
    event?.preventDefault()
    const term = more ? searched : query.trim()
    if (busy || term.length < 2 || !auth.authenticated) return
    const token = ++request.current,
      start = more ? offset : 0
    setBusy(true)
    setError('')
    try {
      const data = await controller.searchSpotifyCatalog(term, start)
      if (token === request.current) {
        setResults((previous) =>
          more && previous
            ? { tracks: [...previous.tracks, ...data.tracks], albums: [...previous.albums, ...data.albums], playlists: [...previous.playlists, ...data.playlists], artists: [...previous.artists, ...data.artists] }
            : data,
        )
        setSearched(term)
        setOffset(start + 10)
        setNext(Boolean(data.cursors && Object.values(data.cursors).some(Boolean)))
      }
    } catch (reason) {
      if (token === request.current) setError(userFacingError(reason))
    } finally {
      if (token === request.current) setBusy(false)
    }
  }
  return h(
    'div',
    {},
    h('p', { className: 'fluid-section-copy fluid-spotify-discovery' }, 'Play Spotify results now or add them to your temporary Up Next queue. FluidMusic collections are local-only; your Spotify playlists stay on Spotify.'),
    h(
      'form',
      { className: 'fluid-searchbar', onSubmit: search },
      h('input', {
        className: 'fluid-input',
        value: query,
        onChange: (event) => setQuery(event.target.value),
        placeholder: 'Song, album, artist, or playlist',
        'aria-label': 'Search Spotify',
      }),
      h(
        WorkspaceButton,
        { type: 'submit', primary: true, disabled: busy || query.trim().length < 2 || !auth.authenticated },
        busy ? 'Searching…' : 'Search',
      ),
    ),
    error && h('p', { className: 'fluid-error', role: 'alert' }, error),
    !auth.authenticated && h(SpotifyConnection, { controller }),
    results
      ? h(
          'div',
          {},
          h('p', { className: 'fluid-muted', role: 'status' }, `Results for “${searched}”`),
          !Object.values(results).some((items) => items.length) &&
            h(Empty, { title: 'No matches' }, 'Try a different title or artist.'),
          results.tracks.length > 0 &&
            h(
              'section',
              { className: 'fluid-result-section' },
              h('h2', { className: 'fluid-section-title' }, 'Songs'),
              h(
                'div',
                { className: 'fluid-track-list' },
                results.tracks.map((item, at) =>
                  h(TrackRow, { key: `${item.id}-${at}`, controller, item, at, origin: 'search' }),
                ),
              ),
            ),
          ['albums', 'playlists', 'artists'].map(
            (kind) =>
              results[kind].length > 0 &&
              h(
                'section',
                { className: 'fluid-result-section', key: kind },
                h('h2', { className: 'fluid-section-title' }, kind[0].toUpperCase() + kind.slice(1)),
                h(
                  'div',
                  { className: 'fluid-grid' },
                  results[kind].map((item, at) =>
                    kind === 'artists'
                      ? h(
                          'article',
                          { className: 'fluid-media-tile', key: `${item.id}-${at}` },
                          h(Artwork, { item }),
                          h('strong', { className: 'fluid-tile-title' }, item.title),
                          h(
                            'span',
                            { className: 'fluid-tile-detail' },
                            item.genres.join(' · ') || item.subtitle,
                          ),
                          h(
                            WorkspaceButton,
                            {
                              onClick: () => {
                                setQuery(item.title)
                                setResults(null)
                              },
                            },
                            'Search this artist',
                          ),
                        )
                      : h(MediaTile, { controller, item, key: `${item.id}-${at}` }),
                  ),
                ),
              ),
          ),
          next &&
            h(
              'div',
              { className: 'fluid-load-more' },
              h(WorkspaceButton, { disabled: busy, onClick: () => void search(null, true) }, busy ? 'Loading…' : 'Load more results'),
            ),
        )
      : auth.authenticated &&
          h(
            Empty,
            { title: 'What do you want to hear?' },
            'Search by title, artist, or a few words you remember.',
          ),
  )
}
function SpotifyLibraryPage({ controller }) {
  const auth = useValue(controller.spotifyAuth)
  const [library, setLibrary] = useState([]),
    [selected, setSelected] = useState(null),
    [detail, setDetail] = useState([]),
    [next, setNext] = useState(false),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const request = useRef(0)
  const load = async (playlist = null, more = false) => {
    const token = ++request.current,
      start = more ? offset : 0
    setBusy(true)
    setError('')
    if (!more) {
      setSelected(playlist)
      setDetail([])
      setOffset(0)
      setNext(false)
    }
    try {
      const data = playlist
        ? await controller.loadSpotifyPlaylist(playlist, start)
        : await controller.loadSpotifyPlaylists(start)
      if (token !== request.current) return
      if (playlist) setDetail((previous) => (more ? [...previous, ...(data.rows || data.tracks)] : (data.rows || data.tracks)))
      else setLibrary((previous) => (more ? [...previous, ...data.items] : data.items))
      setNext(data.next)
      setOffset(playlist ? data.nextOffset : start + 50)
    } catch (reason) {
      if (token === request.current) setError(userFacingError(reason))
    } finally {
      if (token === request.current) setBusy(false)
    }
  }
  useEffect(() => {
    if (auth.authenticated) void load()
    return () => {
      request.current++
    }
  }, [auth.authenticated])
  const context = selected && {
    source: 'spotify',
    id: selected.id,
    title: selected.name,
    subtitle: selected.owner,
    uri: selected.uri,
    artwork: selected.artwork,
    kind: 'playlist',
  }
  return h(
    'div',
    {},
    h(PageHead, {
      kicker: selected ? 'Spotify playlist' : 'Your Spotify',
      title: selected?.name || 'Your library.',
      subtitle:
        selected?.description ||
        'Your Spotify playlists stay on Spotify. Play them directly or add a playlist context to your temporary Up Next queue.',
      actions:
        auth.authenticated &&
        h(WorkspaceButton, { onClick: () => void load() }, selected ? 'All playlists' : 'Refresh'),
    }),
    !auth.authenticated
      ? h(SpotifyConnection, { controller })
      : h(
          'div',
          {},
          selected &&
            h(
              'section',
              { className: 'fluid-library-hero' },
              h(Artwork, { item: context, className: 'fluid-library-cover' }),
              h(
                'div',
                {},
                h(
                  'p',
                  { className: 'fluid-library-facts' },
                  `${selected.owner} · ${selected.trackCount} tracks · ${selected.visibility}`,
                ),
                h(
                  'div',
                  { className: 'fluid-actions' },
                  h(
                    WorkspaceButton,
                    { primary: true, onClick: () => controller.add(context, true) },
                    'Play on Spotify',
                  ),
                  h(WorkspaceButton, { onClick: () => controller.add(context) }, 'Queue playlist'),
                  h(AddToPlaylist, { controller, item: context }),
                ),
              ),
            ),
          error &&
            h(
              'div',
              { className: 'fluid-notice', role: 'alert' },
              error,
              h(WorkspaceButton, { disabled: busy, onClick: () => void load(selected) }, 'Retry'),
            ),
          selected
            ? h(
                'div',
                { className: 'fluid-track-list' },
                detail.map((item, at) => h(TrackRow, { key: `${item.id}-${at}`, controller, item, at, origin: 'provider' })),
              )
            : h(
                'div',
                { className: 'fluid-grid' },
                library.map((item) =>
                  h(MediaTile, {
                    controller,
                    item: {
                      ...item,
                      title: item.name,
                      subtitle: `${item.owner} · ${item.trackCount} tracks`,
                      source: 'spotify',
                    },
                    key: item.id,
                    onOpen: () => void load(item),
                  }),
                ),
              ),
          busy && h('p', { className: 'fluid-muted', role: 'status' }, 'Loading Spotify…'),
          !busy &&
            !error &&
            !(selected ? detail : library).length &&
            h(
              Empty,
              { title: 'No tracks or playlists here yet' },
              'Create or follow a playlist in Spotify, then refresh.',
            ),
          next &&
            h(WorkspaceButton, { disabled: busy, onClick: () => void load(selected, true) }, 'Load more'),
        ),
  )
}
function RadioPage({ controller }) {
  const [query, setQuery] = useState(''),
    [results, setResults] = useState(RADIO_PRESETS),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [searched, setSearched] = useState(''),
    [custom, setCustom] = useState(false),
    [name, setName] = useState(''),
    [url, setUrl] = useState('')
  const saved = useValue(controller.favorites).filter((item) => item.source === 'radio')
  const find = async (event) => {
    event.preventDefault()
    if (busy || query.trim().length < 2) return
    setBusy(true)
    setError('')
    try {
      const raw = await controller.rest(`/radio/search?q=${encodeURIComponent(query.trim())}`)
      if (raw?.ok === false) throw new Error(raw.error)
      const rows = raw?.data?.stations || raw?.stations || []
      setResults(
        rows
          .map((row) =>
            normalizeQueueItem({
              source: 'radio',
              id: row.id || row.stationuuid,
              title: row.name || row.title,
              subtitle: row.tags || row.provider,
              streamUrl: row.streamUrl || row.url_resolved || row.url,
              homepage: row.homepage,
              favicon: row.favicon,
              country: row.country,
              language: row.language,
              tags: row.tags,
              codec: row.codec,
              bitrate: row.bitrate,
            }),
          )
          .filter(Boolean),
      )
      setSearched(query.trim())
    } catch (reason) {
      setError(userFacingError(reason))
    } finally {
      setBusy(false)
    }
  }
  const rows = (items) =>
    h(
      'div',
      { className: 'fluid-track-list' },
      items.map((item, at) =>
        h(TrackRow, {
          key: item.id,
          controller,
          item,
          at,
          origin: 'search',
          extraActions: h(Action, {
            compact: true,
            kind: 'heart',
            label: `${saved.some((entry) => entry.id === item.id) ? 'Unpin' : 'Pin'} ${item.title}`,
            onClick: () => controller.toggleFavorite(item),
          }),
        }),
      ),
    )
  return h(
    'div',
    {},
    h('div', { className: 'fluid-compact-toolbar' },
      h('p', { className: 'fluid-muted' }, 'Search live stations or add a trusted HTTPS stream.'),
      h(
        WorkspaceButton,
        {
          onClick: () => {
            setError('')
            setCustom(true)
          },
        },
        'Add a stream',
      ),
    ),
    h(
      'form',
      { className: 'fluid-searchbar', onSubmit: find },
      h('input', {
        className: 'fluid-input',
        value: query,
        onChange: (event) => setQuery(event.target.value),
        placeholder: 'Station, genre, or country',
        'aria-label': 'Search radio',
      }),
      h(
        WorkspaceButton,
        { type: 'submit', primary: true, disabled: busy || query.trim().length < 2 },
        busy ? 'Searching…' : 'Find stations',
      ),
    ),
    error && h('p', { className: 'fluid-error', role: 'alert' }, error),
    saved.length > 0 &&
      h(
        'section',
        { className: 'fluid-result-section' },
        h('h2', { className: 'fluid-section-title' }, 'Pinned stations'),
        rows(saved),
      ),
    h(
      'section',
      { className: 'fluid-result-section' },
      h(
        'h2',
        { className: 'fluid-section-title' },
        searched ? `Results for “${searched}”` : 'A few good frequencies',
      ),
      results.length
        ? rows(results)
        : h(
            Empty,
            { title: 'No supported streams found' },
            'Try another station name or add a public HTTPS audio stream.',
          ),
    ),
    custom &&
      h(
        Modal,
        { title: 'Add an HTTPS stream', onClose: () => setCustom(false) },
        h(
          'form',
          {
            onSubmit: (event) => {
              event.preventDefault()
              if (controller.add({ source: 'radio', title: name || 'Custom station', streamUrl: url })) {
                setCustom(false)
                setName('')
                setUrl('')
                setError('')
                controller.message.set('Station added to your queue.')
              } else setError('Enter a public, credential-free HTTPS audio URL.')
            },
          },
          h(
            'label',
            { className: 'fluid-field' },
            'Station name',
            h('input', {
              className: 'fluid-input',
              value: name,
              onChange: (event) => setName(event.target.value),
            }),
          ),
          h(
            'label',
            { className: 'fluid-field' },
            'Direct HTTPS audio URL',
            h('input', {
              className: 'fluid-input',
              type: 'url',
              required: true,
              value: url,
              onChange: (event) => setUrl(event.target.value),
              placeholder: 'https://station.example/live.mp3',
            }),
          ),
          h(
            'p',
            { className: 'fluid-muted' },
            'Station advertising is preserved. Browser codec and stream restrictions still apply.',
          ),
          error && h('p', { role: 'alert' }, error),
          h(WorkspaceButton, { primary: true, type: 'submit' }, 'Add to queue'),
        ),
      ),
  )
}
function LocalPage({ controller }) {
  const files = useRef(null)
  const sessionTracks = useValue(controller.sessionTracks)
  const tracks = useValue(controller.localTracks),
    roots = useValue(controller.localRoots)
  const [path, setPath] = useState(''),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [remove, setRemove] = useState(null),
    [limit, setLimit] = useState(100)
  const run = async (work) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (reason) {
      setError(userFacingError(reason))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void run(() => controller.refreshLocalLibrary())
  }, [controller])
  const filtered = tracks.filter((item) =>
    `${item.title} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase()),
  )
  return h(
    'div',
    {},
    h(PageHead, {
      kicker: 'On your device',
      title: 'Your own collection.',
      subtitle: 'Approve a folder once. Your tracks and saved playlists stay linked across restarts.',
      actions: h(
        WorkspaceButton,
        { disabled: busy || !roots.length, onClick: () => void run(() => controller.rescanLocalLibrary()) },
        busy ? 'Working…' : 'Rescan all',
      ),
    }),
    h(
      'section',
      { className: 'fluid-panel fluid-panel-pad', style: { marginBottom: 20 } },
      h(
        'div',
        { className: 'fluid-section-head' },
        h(
          'div',
          {},
          h('h2', { className: 'fluid-section-title' }, 'Open files for this session'),
          h(
            'p',
            { className: 'fluid-section-copy' },
            'Play individual files without adding their folder to the persistent library.',
          ),
        ),
        h(WorkspaceButton, { primary: true, onClick: () => files.current?.click() }, 'Open audio files'),
      ),
      h('input', {
        ref: files,
        type: 'file',
        hidden: true,
        multiple: true,
        accept: 'audio/*,.flac,.mp3,.m4a,.aac,.wav,.ogg,.opus,.webm',
        'aria-label': 'Open session audio files',
        onChange: (event) => {
          try {
            controller.openLocalFiles(event.target.files)
            setError('')
          } catch (reason) {
            setError(userFacingError(reason))
          } finally {
            event.target.value = ''
          }
        },
      }),
      h(
        'p',
        { className: 'fluid-muted' },
        'Session only: reopen these files after restarting Hermes. They are not saved to playlists. Use indexed folders below for persistent collections.',
      ),
      sessionTracks.length > 0 &&
        h(
          'div',
          { className: 'fluid-track-list' },
          sessionTracks.slice(0, limit).map((item, at) =>
            h(TrackRow, {
              controller,
              item,
              at,
              key: item.id,
              origin: 'session',
              onPlay: () => {
                const queued = controller.queue.get().findIndex((row) => row.id === item.id)
                if (queued >= 0) void controller.playAt(queued)
                else controller.add(item, true, 'session')
              },
            }),
          ),
        ),
      sessionTracks.length > limit &&
        h(WorkspaceButton, { onClick: () => setLimit(limit + 100) }, 'Show more session files'),
    ),
    h(
      'section',
      { className: 'fluid-panel fluid-panel-pad' },
      h(
        'div',
        { className: 'fluid-section-head' },
        h(
          'div',
          {},
          h('h2', { className: 'fluid-section-title' }, 'Music folders'),
          h(
            'p',
            { className: 'fluid-section-copy' },
            'Audio stays on disk. Only folders you choose are scanned.',
          ),
        ),
        h(
          WorkspaceButton,
          { primary: true, disabled: busy, onClick: () => void run(() => controller.chooseLocalRoot()) },
          'Choose folder',
        ),
      ),
      h(
        'form',
        {
          className: 'fluid-searchbar',
          onSubmit: (event) => {
            event.preventDefault()
            if (!busy && path.trim())
              void run(async () => {
                await controller.addLocalRoot(path)
                setPath('')
              })
          },
        },
        h('input', {
          className: 'fluid-input',
          value: path,
          onChange: (event) => setPath(event.target.value),
          'aria-label': 'Music folder path',
          placeholder: 'Or enter an absolute folder path…',
        }),
        h(WorkspaceButton, { type: 'submit', disabled: busy || !path.trim() }, 'Add path'),
      ),
      h(
        'div',
        { className: 'fluid-device-list' },
        roots.map((root) =>
          h(
            'div',
            { className: 'fluid-device', key: root.id },
            h(Icon, { kind: 'local' }),
            h(
              'div',
              { className: 'fluid-device-copy' },
              h('strong', {}, root.path),
              h(
                'span',
                {},
                `${root.track_count} tracks${root.missing_count ? ` · ${root.missing_count} missing` : ''}`,
              ),
            ),
            h(
              WorkspaceButton,
              { disabled: busy, onClick: () => void run(() => controller.rescanLocalLibrary(root.id)) },
              'Rescan',
            ),
            h(Action, {
              compact: true,
              kind: 'trash',
              disabled: busy,
              label: `Remove folder ${root.path}`,
              onClick: () => setRemove(root),
            }),
          ),
        ),
      ),
    ),
    error && h('p', { className: 'fluid-error', role: 'alert' }, error),
    h(
      'section',
      { className: 'fluid-result-section' },
      h(
        'div',
        { className: 'fluid-section-head' },
        h('h2', { className: 'fluid-section-title' }, `${tracks.length} indexed tracks`),
        h('input', {
          className: 'fluid-input fluid-filter',
          type: 'search',
          value: query,
          onChange: (event) => {
            setQuery(event.target.value)
            setLimit(100)
          },
          'aria-label': 'Filter local tracks',
          placeholder: 'Filter your collection…',
        }),
      ),
      filtered.length
        ? h(
            'div',
            { className: 'fluid-track-list' },
            filtered.slice(0, limit).map((item, at) => h(TrackRow, { controller, item, at, key: item.id, origin: 'library' })),
          )
        : h(
            Empty,
            { title: query ? 'No matches' : busy ? 'Reading your folders…' : 'Bring your music along' },
            'MP3, FLAC, M4A, AAC, WAV, Ogg, Opus, and WebM audio.',
          ),
      filtered.length > limit &&
        h(
          WorkspaceButton,
          { onClick: () => setLimit(limit + 100) },
          `Show more · ${filtered.length - limit} remaining`,
        ),
    ),
    remove &&
      h(
        Confirm,
        {
          title: 'Remove folder',
          onClose: () => setRemove(null),
          action: () => controller.removeLocalRoot(remove.id),
        },
        `Remove “${remove.path}” from the catalog? Files are not deleted. Playlist references remain but may become unavailable.`,
      ),
  )
}
function PlaylistForm({ playlist, onSave, onClose }) {
  const [name, setName] = useState(playlist?.name || ''),
    [description, setDescription] = useState(playlist?.description || '')
  return h(
    Modal,
    { title: playlist ? 'Edit playlist' : 'Create playlist', onClose },
    h(
      'form',
      {
        onSubmit: (event) => {
          event.preventDefault()
          if (name.trim()) {
            onSave(name.trim(), description.trim())
            onClose()
          }
        },
      },
      h(
        'label',
        { className: 'fluid-field' },
        'Name',
        h('input', {
          className: 'fluid-input',
          autoFocus: true,
          required: true,
          maxLength: 120,
          value: name,
          onChange: (event) => setName(event.target.value),
          placeholder: 'Give this mix a name',
        }),
      ),
      h(
        'label',
        { className: 'fluid-field' },
        'Description',
        h('textarea', {
          className: 'fluid-textarea',
          maxLength: 500,
          value: description,
          onChange: (event) => setDescription(event.target.value),
          placeholder: 'What belongs here?',
        }),
      ),
      h(
        'div',
        { className: 'fluid-dialog-actions' },
        h(WorkspaceButton, { onClick: onClose }, 'Cancel'),
        h(
          WorkspaceButton,
          { type: 'submit', primary: true, disabled: !name.trim() },
          playlist ? 'Save changes' : 'Create playlist',
        ),
      ),
    ),
  )
}
function PlaylistTrackPicker({ controller, playlist, onClose }) {
  const local = useValue(controller.localTracks),
    queue = useValue(controller.queue),
    favorites = useValue(controller.favorites),
    auth = useValue(controller.spotifyAuth)
  const [source, setSource] = useState('local'),
    [query, setQuery] = useState(''),
    [results, setResults] = useState([]),
    [chosen, setChosen] = useState(new Set()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [limit, setLimit] = useState(100)
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  const base =
    source === 'queue'
      ? queue
      : source === 'local'
        ? local
        : source === 'radio'
          ? [...favorites.filter((item) => item.source === 'radio'), ...RADIO_PRESETS]
          : results
  const rows = base
    .map((item, at) => ({ item, at }))
    .filter(({ item }) => item.source !== 'local' || item.localTrackId)
    .filter(
      ({ item }) =>
        source === 'spotify' || `${item.title} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase()),
    )
  const search = async (event) => {
    event.preventDefault()
    if (busy || query.trim().length < 2) return
    const token = ++request.current
    setBusy(true)
    setError('')
    try {
      const items = await controller.searchSpotify(query.trim())
      if (token === request.current) {
        setResults(items)
        setChosen(new Set())
      }
    } catch (reason) {
      if (token === request.current) setError(userFacingError(reason))
    } finally {
      if (token === request.current) setBusy(false)
    }
  }
  return h(
    Modal,
    { title: `Add tracks to ${playlist.name}`, onClose },
    h(
      'div',
      { className: 'fluid-segmented', role: 'group', 'aria-label': 'Track source' },
      [
        ['local', 'Local music'],
      ].map(([value, label]) =>
        h(
          'button',
          {
            type: 'button',
            key: value,
            'aria-pressed': source === value,
            onClick: () => {
              request.current++
              setBusy(false)
              setError('')
              setSource(value)
              setQuery('')
              setChosen(new Set())
              setLimit(100)
            },
          },
          label,
        ),
      ),
    ),
    h(
      'form',
      {
        className: 'fluid-searchbar',
        onSubmit: source === 'spotify' ? search : (event) => event.preventDefault(),
      },
      h('input', {
        className: 'fluid-input',
        value: query,
        onChange: (event) => setQuery(event.target.value),
        'aria-label': 'Find tracks to add',
        placeholder: source === 'spotify' ? 'Search Spotify songs…' : 'Filter tracks…',
      }),
      source === 'spotify' &&
        h(
          WorkspaceButton,
          { type: 'submit', disabled: busy || !auth.authenticated || query.trim().length < 2 },
          busy ? 'Searching…' : 'Search',
        ),
    ),
    source === 'spotify' &&
      !auth.authenticated &&
      h('p', { className: 'fluid-muted' }, 'Connect Spotify in Settings to search.'),
    error && h('p', { role: 'alert', className: 'fluid-error' }, error),
    h(
      'div',
      { className: 'fluid-picker-list' },
      rows.slice(0, limit).map(({ item, at }) =>
        h(
          'label',
          { className: 'fluid-picker-row', key: `${item.id}-${at}` },
          h('input', {
            type: 'checkbox',
            checked: chosen.has(at),
            onChange: () =>
              setChosen((previous) => {
                const next = new Set(previous)
                next.has(at) ? next.delete(at) : next.add(at)
                return next
              }),
          }),
          h(Artwork, { item, className: 'fluid-mini-cover' }),
          h(
            'span',
            { className: 'fluid-row-copy' },
            h('strong', { className: 'fluid-row-title' }, item.title),
            h('span', { className: 'fluid-row-detail' }, item.subtitle || sourceLabel(item)),
          ),
        ),
      ),
    ),
    !rows.length &&
      h(
        Empty,
        { title: 'No tracks here yet' },
        source === 'queue'
          ? 'Build a queue, or choose Local music, Radio, or Spotify above.'
          : 'Search or choose another source.',
      ),
    rows.length > limit && h(WorkspaceButton, { onClick: () => setLimit(limit + 100) }, 'Show more'),
    h(
      'div',
      { className: 'fluid-dialog-actions' },
      h(WorkspaceButton, { onClick: onClose }, 'Cancel'),
      h(
        WorkspaceButton,
        {
          primary: true,
          disabled: !chosen.size,
          onClick: () => {
            const count = controller.addManyToPlaylist(
              playlist.id,
              base.filter((_, at) => chosen.has(at)),
            )
            controller.message.set(`Added ${count} item(s) to “${playlist.name}”.`)
            onClose()
          },
        },
        `Add selected · ${chosen.size}`,
      ),
    ),
  )
}
function downloadPlaylist(controller, id) {
  const url = URL.createObjectURL(new Blob([controller.exportPlaylists(id)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'fluid-music-playlists.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function PlaylistEditor({ controller, playlist }) {
  useValue(controller.localTracks)
  const [filter, setFilter] = useState(''),
    [selected, setSelected] = useState(new Set()),
    [edit, setEdit] = useState(false),
    [picker, setPicker] = useState(false),
    [confirm, setConfirm] = useState(false),
    [limit, setLimit] = useState(100)
  const items = controller.playlistItems(playlist.id)
  const rows = items
    .map((item, at) => ({ item, at }))
    .filter(({ item }) =>
      `${item.title} ${item.subtitle} ${item.source}`.toLowerCase().includes(filter.toLowerCase()),
    )
  const missing = items.filter((item) => item.unavailable).length,
    duration = items.reduce((sum, item) => sum + (item.durationMs || 0), 0)
  useEffect(() => setSelected(new Set()), [playlist.items])
  const firstPlayable = items.findIndex((item) => !item.unavailable)
  return h(
    'section',
    { className: 'fluid-playlist-editor' },
    h(
      'div',
      { className: 'fluid-playlist-heading' },
      h('div', { className: 'fluid-collection-icon' }, h(Icon, { kind: 'playlist' })),
      h(
        'div',
        { className: 'fluid-row-copy' },
        h('h2', { className: 'fluid-library-title' }, playlist.name),
        h('p', { className: 'fluid-muted' }, playlist.description || 'A mix made by you.'),
        h(
          'p',
          { className: 'fluid-library-facts' },
          `${items.length} items${duration ? ` · ${formatClock(duration)} known duration` : ''}${missing ? ` · ${missing} missing` : ''}`,
        ),
      ),
    ),
    h(
      'div',
      { className: 'fluid-playlist-toolbar' },
      h(
        'div',
        { className: 'fluid-actions' },
        h(
          WorkspaceButton,
          {
            primary: true,
            disabled: firstPlayable < 0,
            onClick: () => void controller.playPlaylist(playlist.id, firstPlayable),
          },
          h(Icon, { kind: 'play' }),
          ' Play playlist',
        ),
        h(
          WorkspaceButton,
          { disabled: firstPlayable < 0, onClick: () => controller.enqueuePlaylist(playlist.id) },
          'Add to queue',
        ),
        h(WorkspaceButton, { onClick: () => setPicker(true) }, 'Add tracks'),
      ),
      h(
        'div',
        { className: 'fluid-actions' },
        h(WorkspaceButton, { onClick: () => setEdit(true) }, 'Edit details'),
        h(Action, {
          compact: true,
          kind: 'copy',
          label: 'Duplicate playlist',
          onClick: () => {
            const copy = controller.duplicatePlaylist(playlist.id)
            if (copy) controller.selectPlaylist(copy.id)
          },
        }),
        h(Action, {
          compact: true,
          kind: 'download',
          label: 'Export playlist',
          onClick: () => downloadPlaylist(controller, playlist.id),
        }),
        h(Action, {
          compact: true,
          kind: 'trash',
          label: 'Delete playlist',
          onClick: () => setConfirm(true),
        }),
      ),
    ),
    missing > 0 &&
      h(
        'p',
        { className: 'fluid-notice' },
        'Missing local files stay saved. Rescan their folders to recover them; playback skips unavailable entries.',
      ),
    items.length > 0 &&
      h(
        'div',
        { className: 'fluid-editor-filters' },
        h('input', {
          className: 'fluid-input',
          type: 'search',
          value: filter,
          onChange: (event) => {
            setFilter(event.target.value)
            setLimit(100)
          },
          'aria-label': 'Filter playlist tracks',
          placeholder: 'Find a track in this playlist…',
        }),
        h(
          WorkspaceButton,
          {
            onClick: () => {
              const count = controller.deduplicatePlaylist(playlist.id)
              controller.message.set(
                count ? `Removed ${count} duplicate(s). Undo is available.` : 'No duplicates found.',
              )
            },
          },
          'Remove duplicates',
        ),
      ),
    selected.size > 0 &&
      h(
        'div',
        { className: 'fluid-selection-bar' },
        h('span', {}, `${selected.size} selected`),
        h(WorkspaceButton, { onClick: () => setSelected(new Set()) }, 'Deselect'),
        h(
          WorkspaceButton,
          {
            danger: true,
            onClick: () => {
              controller.removePlaylistItems(playlist.id, [...selected])
              setSelected(new Set())
            },
          },
          'Remove selected',
        ),
      ),
    rows.length
      ? h(
          'div',
          { className: 'fluid-track-list' },
          rows.slice(0, limit).map(({ item, at }) =>
            h(TrackRow, {
              controller,
              item,
              at,
              key: `${item.id}-${at}`,
              selectable: true,
              checked: selected.has(at),
              hideSave: true,
              origin: 'collection',
              onSelect: () =>
                setSelected((previous) => {
                  const next = new Set(previous)
                  next.has(at) ? next.delete(at) : next.add(at)
                  return next
                }),
              onPlay: () => void controller.playPlaylist(playlist.id, at),
              extraActions: h(
                'span',
                { className: 'fluid-row-actions' },
                h(Action, {
                  compact: true,
                  kind: 'up',
                  label: `Move ${item.title} earlier`,
                  disabled: at === 0,
                  onClick: () => controller.moveInPlaylist(playlist.id, at, -1),
                }),
                h(Action, {
                  compact: true,
                  kind: 'down',
                  label: `Move ${item.title} later`,
                  disabled: at === items.length - 1,
                  onClick: () => controller.moveInPlaylist(playlist.id, at, 1),
                }),
                h(Action, {
                  compact: true,
                  kind: 'trash',
                  label: `Remove ${item.title} from playlist`,
                  onClick: () => controller.removeFromPlaylist(playlist.id, at),
                }),
              ),
            }),
          ),
        )
      : h(
          Empty,
          { title: filter ? 'No matching tracks' : 'Every good mix starts somewhere.' },
          filter
            ? 'Try another title, artist, or source.'
            : h(WorkspaceButton, { primary: true, onClick: () => setPicker(true) }, 'Add your first tracks'),
        ),
    rows.length > limit &&
      h(
        WorkspaceButton,
        { onClick: () => setLimit(limit + 100) },
        `Show more · ${rows.length - limit} remaining`,
      ),
    edit &&
      h(PlaylistForm, {
        playlist,
        onClose: () => setEdit(false),
        onSave: (name, description) => controller.updatePlaylist(playlist.id, { name, description }),
      }),
    picker && h(PlaylistTrackPicker, { controller, playlist, onClose: () => setPicker(false) }),
    confirm &&
      h(
        Confirm,
        {
          title: 'Delete playlist',
          onClose: () => setConfirm(false),
          action: () => controller.deletePlaylist(playlist.id),
        },
        `Delete “${playlist.name}”? Audio files and Spotify playlists are untouched. You can undo this change.`,
      ),
  )
}
function LegacyPlaylist({ controller, playlist }) {
  const items = controller.playlistItems(playlist.id)
  return h('section', { className: 'fluid-playlist-editor' },
    h('div', { className: 'fluid-playlist-heading' }, h('div', { className: 'fluid-collection-icon' }, h(Icon, { kind: 'playlist' })), h('div', {}, h('span', { className: 'fluid-source-chip' }, 'Legacy mix · read only'), h('h2', { className: 'fluid-library-title' }, playlist.name), h('p', { className: 'fluid-muted' }, playlist.description || 'Preserved from FluidMusic v3.'))),
    h('p', { className: 'fluid-notice' }, 'This mixed collection is preserved without rewriting it. You can play, enqueue, or export it; new FluidMusic collections are local-only.'),
    h('div', { className: 'fluid-actions' }, h(WorkspaceButton, { primary: true, disabled: !items.length, onClick: () => void controller.playPlaylist(playlist.id) }, 'Play legacy mix'), h(WorkspaceButton, { disabled: !items.length, onClick: () => controller.enqueuePlaylist(playlist.id) }, 'Add to Up Next'), h(WorkspaceButton, { onClick: () => downloadPlaylist(controller, playlist.id) }, 'Export')),
    h('div', { className: 'fluid-track-list' }, items.map((item, at) => h(TrackRow, { controller, item, at, key: `${item.id}-${at}`, hideSave: true, origin: 'collection', onPlay: () => void controller.playPlaylist(playlist.id, at), extraActions: null }))),
  )
}
function PlaylistsPage({ controller }) {
  const playlists = useValue(controller.playlists),
    selectedId = useValue(controller.selectedPlaylist),
    undo = useValue(controller.undoState)
  const [filter, setFilter] = useState(''),
    [create, setCreate] = useState(false),
    [error, setError] = useState('')
  const file = useRef(null),
    selected = playlists.find((entry) => entry.id === selectedId) || playlists[0]
  const localCollections = playlists.filter(entry => !entry.legacy)
  const legacyCollections = playlists.filter(entry => entry.legacy)
  const filtered = playlists.filter((entry) =>
    `${entry.name} ${entry.description}`.toLowerCase().includes(filter.toLowerCase()),
  )
  const importFile = async (event) => {
    const input = event.target,
      selectedFile = input.files?.[0]
    if (!selectedFile) return
    try {
      if (selectedFile.size > 2_000_000) throw new Error('Choose a file smaller than 2 MB.')
      const imported = controller.importPlaylists(await selectedFile.text())
      if (imported[0]) controller.selectPlaylist(imported[0].id)
      setError('')
      controller.message.set(`Imported ${imported.length} playlist(s). Existing playlists were kept.`)
    } catch (reason) {
      setError(userFacingError(reason))
    } finally {
      input.value = ''
    }
  }
  return h(
    'div',
    {},
    h(PageHead, {
      kicker: 'Made by you',
      title: 'Local collections',
      subtitle: 'New collections contain indexed local tracks only. Legacy mixes stay readable without migration or data loss.',
      actions: h(
        'div',
        { className: 'fluid-actions' },
        h(WorkspaceButton, { disabled: !playlists.length, onClick: () => downloadPlaylist(controller) }, 'Export all'),
        h(WorkspaceButton, { primary: true, onClick: () => setCreate(true) }, 'New local collection'),
      ),
    }),
    h('input', {
      type: 'file',
      accept: '.json,application/json',
      ref: file,
      hidden: true,
      onChange: importFile,
      'aria-label': 'Import FluidMusic playlists',
    }),
    error && h('p', { className: 'fluid-error', role: 'alert' }, error),
    undo &&
      h(
        'div',
        { className: 'fluid-notice', role: 'status' },
        h('span', {}, `${undo.label}. Changed your mind?`),
        h(WorkspaceButton, { onClick: () => controller.undoPlaylistEdit() }, 'Undo'),
      ),
    h(
      'div',
      { className: 'fluid-playlist-layout' },
      h(
        'aside',
        { className: 'fluid-playlist-browser', 'aria-label': 'Your playlists' },
        h('input', {
          className: 'fluid-input',
          type: 'search',
          value: filter,
          onChange: (event) => setFilter(event.target.value),
          'aria-label': 'Filter playlists',
          placeholder: 'Find a playlist…',
        }),
        h('p', { className: 'fluid-muted' }, `${localCollections.length} local · ${legacyCollections.length} legacy`),
        h(
          'div',
          { className: 'fluid-playlist-list' },
          filtered.map((entry) =>
            h(
              'button',
              {
                type: 'button',
                className: 'fluid-playlist-button',
                'aria-pressed': selected?.id === entry.id,
                'data-active': selected?.id === entry.id,
                key: entry.id,
                onClick: () => controller.selectPlaylist(entry.id),
              },
              h(Icon, { kind: 'playlist' }),
              h(
                'span',
                { className: 'fluid-row-copy' },
                h('strong', {}, entry.name),
                h('span', {}, `${entry.items.length} items${entry.legacy ? ' · Legacy mix' : ' · Local only'}`),
              ),
            ),
          ),
        ),
        !filtered.length &&
          h(
            'p',
            { className: 'fluid-muted' },
            filter ? 'No matching playlists.' : 'Your collections will appear here.',
          ),
      ),
      selected
        ? selected.legacy ? h(LegacyPlaylist, { key: selected.id, controller, playlist: selected }) : h(PlaylistEditor, { key: selected.id, controller, playlist: selected })
        : h(
            Empty,
            { title: 'A home for your favourites.' },
            'Create a collection, then add indexed tracks from your local library.',
            h(
              'div',
              { className: 'fluid-actions' },
              h(WorkspaceButton, { primary: true, onClick: () => setCreate(true) }, 'Create playlist'),
            ),
          ),
    ),
    create &&
      h(PlaylistForm, {
        onClose: () => setCreate(false),
        onSave: (name, description) =>
          controller.selectPlaylist(controller.createPlaylist(name, description).id),
      }),
  )
}
function QueuePage({ controller }) {
  const queue = useValue(controller.queue),
    current = useValue(controller.index),
    undo = useValue(controller.queueUndo),
    sessions = useValue(controller.listeningSessions),
    [selected, setSelected] = useState(new Set()),
    [clear, setClear] = useState(false),
    [clearUpcoming, setClearUpcoming] = useState(false),
    [saving, setSaving] = useState(false),
    [sessionName, setSessionName] = useState(''),
    [restoring, setRestoring] = useState(''),
    [deleting, setDeleting] = useState('')
  // Queue edits shift positions: drop any stale selection (PlaylistEditor pattern).
  useEffect(() => setSelected(new Set()), [queue])
  const toggleSelect = (at) => setSelected((previous) => {
    const next = new Set(previous)
    if (next.has(at)) next.delete(at)
    else next.add(at)
    return next
  })
  const clearSelection = () => setSelected(new Set())
  const preview = restoring ? controller.listeningSessionPreview(restoring) : null
  return h(
    'div',
    {},
    h(PageHead, {
      kicker: 'Listening order',
      title: 'Up next.',
      subtitle: `${queue.length} items in your session. Reorder freely; your saved playlists stay unchanged.`,
      actions: h(
        'div',
        { className: 'fluid-actions' },
        h(WorkspaceButton, { disabled: !undo, onClick: () => { controller.undoQueueEdit(); clearSelection() } }, undo ? `Undo: ${undo.label}` : 'Undo'),
        h(WorkspaceButton, { disabled: !(current >= 0 && current < queue.length - 1), onClick: () => setClearUpcoming(true) }, 'Clear upcoming'),
        h(WorkspaceButton, { disabled: !queue.length, onClick: () => { setSessionName(''); setSaving(true) } }, 'Save session'),
        h(
          WorkspaceButton,
          { danger: true, disabled: !queue.length, onClick: () => setClear(true) },
          'Clear queue',
        ),
      ),
    }),
    selected.size > 0 && h(
      'div',
      { className: 'fluid-selection-bar', role: 'toolbar', 'aria-label': 'Selected queue items' },
      h('span', {}, `${selected.size} selected`),
      h(WorkspaceButton, { onClick: () => { controller.moveQueueItems([...selected], -1); clearSelection() } }, 'Move up'),
      h(WorkspaceButton, { onClick: () => { controller.moveQueueItems([...selected], 1); clearSelection() } }, 'Move down'),
      h(WorkspaceButton, { danger: true, onClick: () => { void controller.removeQueueItems([...selected]); clearSelection() } }, 'Remove selected'),
      h(WorkspaceButton, { onClick: clearSelection }, 'Clear selection'),
    ),
    h(QueueList, { controller, selected, onSelect: toggleSelect }),
    h(
      'section',
      { className: 'fluid-result-section', 'aria-label': 'Listening sessions' },
      h('div', { className: 'fluid-section-head' },
        h('div', {},
          h('h2', { className: 'fluid-section-title' }, 'Listening sessions'),
          h('p', { className: 'fluid-section-copy' }, 'Named snapshots of safe source references and order. Restore previews unavailable items and never starts playback automatically.')),
        h('span', { className: 'fluid-muted' }, `${sessions.length}/50`)),
      sessions.length
        ? h('div', { className: 'fluid-track-list' }, sessions.map((session) => h(
            'div',
            { className: 'fluid-session-row', key: session.id },
            h('div', { className: 'fluid-row-copy' },
              h('span', { className: 'fluid-row-title', title: session.name }, session.name),
              h('span', { className: 'fluid-row-detail' }, `${session.items.length} item(s)${session.createdAt ? ` · saved ${new Date(session.createdAt).toLocaleDateString()}` : ''}`)),
            h('div', { className: 'fluid-row-actions' },
              h(WorkspaceButton, { onClick: () => setRestoring(session.id) }, 'Restore…'),
              h(Action, { compact: true, kind: 'trash', label: `Delete session ${session.name}`, onClick: () => setDeleting(session.id) })),
          )))
        : h('p', { className: 'fluid-muted' }, 'No saved sessions yet. Use “Save session” to snapshot the current queue.'),
    ),
    clear &&
      h(
        Confirm,
        { title: 'Clear queue', onClose: () => setClear(false), action: () => controller.clearQueue() },
        'Stop playback and clear this session’s queue? Your saved playlists, sessions and files are not changed.',
      ),
    clearUpcoming &&
      h(
        Confirm,
        { title: 'Clear upcoming', onClose: () => setClearUpcoming(false), action: () => controller.clearUpcoming() },
        'Remove everything after the current item? The current item keeps playing; saved playlists and sessions are not changed.',
      ),
    saving &&
      h(
        Modal,
        { title: 'Save listening session', onClose: () => setSaving(false) },
        h('form', {
          onSubmit: (event) => {
            event.preventDefault()
            if (controller.saveListeningSession(sessionName)) { setSaving(false); setSessionName('') }
          },
        },
          h('label', { className: 'fluid-field' }, 'Session name',
            h('input', { className: 'fluid-input', value: sessionName, onChange: (event) => setSessionName(event.target.value), placeholder: 'Late night drive', 'aria-label': 'Session name' })),
          h('p', { className: 'fluid-muted' }, 'Stores safe source references and order only — no files, handles or credentials. Session-only opened files are skipped.'),
          h('div', { className: 'fluid-dialog-actions' },
            h(WorkspaceButton, { onClick: () => setSaving(false) }, 'Cancel'),
            h(WorkspaceButton, { primary: true, type: 'submit' }, 'Save session')),
        ),
      ),
    preview &&
      h(
        Modal,
        { title: `Restore “${preview.session.name}”`, onClose: () => setRestoring('') },
        h('p', { className: 'fluid-muted' }, `${preview.rows.length - preview.unavailable.length} of ${preview.rows.length} item(s) available right now.`),
        preview.unavailable.length > 0 && h('div', { className: 'fluid-track-list' }, preview.unavailable.map((row, at) => h(
          'div',
          { className: 'fluid-queue-row', key: `${row.item?.id || 'unknown'}-${at}` },
          h('div', { className: 'fluid-row-copy' },
            h('span', { className: 'fluid-row-title' }, row.item?.title || 'Unknown item'),
            h('span', { className: 'fluid-row-detail' }, row.reason)),
        ))),
        h('p', { className: 'fluid-muted' }, 'Unavailable items are skipped. Restoring loads the queue paused — press play when you are ready.'),
        h('div', { className: 'fluid-dialog-actions' },
          h(WorkspaceButton, { onClick: () => setRestoring('') }, 'Cancel'),
          h(WorkspaceButton, { onClick: () => { controller.restoreListeningSession(preview.session.id, 'append'); setRestoring(''); clearSelection() } }, 'Append to queue'),
          h(WorkspaceButton, { primary: true, onClick: () => { void controller.restoreListeningSession(preview.session.id, 'replace'); setRestoring(''); clearSelection() } }, 'Replace queue')),
      ),
    deleting &&
      h(
        Confirm,
        { title: 'Delete session', onClose: () => setDeleting(''), action: () => controller.deleteListeningSession(deleting) },
        'Delete this saved listening session? Your queue, collections and files are not changed.',
      ),
  )
}
function youtubeEmbedUrl(item) {
  const videoId = item?.source === 'youtube' ? safeText(item.id).replace(/^youtube:/, '') : ''
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return ''
  const params = new URLSearchParams({ controls: '1', enablejsapi: '1', playsinline: '1', rel: '0' })
  // The origin parameter must describe the ACTUAL embedding page, never a
  // guessed foreign origin; opaque origins omit it rather than lie.
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.origin && location.origin !== 'null') params.set('origin', location.origin)
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`
}

function EmbeddedYouTubeFrame({ controller, item, title, frameRef }) {
  const direct = youtubeEmbedUrl(item)
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true
    if (!direct) { setSrc(''); return () => { live = false } }
    controller.resolveYouTubeEmbedUrl(item).then(url => {
      if (live) setSrc(url)
    }).catch(async () => {
      const getHostOrigin = window.hermesDesktop?.getEmbedHostOrigin
      if (!live) return
      if (!getHostOrigin) { setSrc(direct); return }
      try {
        const origin = await getHostOrigin()
        if (!live) return
        const videoId = safeText(item.id).replace(/^youtube:/, '')
        const wrapper = new URL(`/youtube/${encodeURIComponent(videoId)}`, origin)
        wrapper.searchParams.set('controls', '1')
        wrapper.searchParams.set('enablejsapi', '1')
        wrapper.searchParams.set('playsinline', '1')
        wrapper.searchParams.set('rel', '0')
        setSrc(wrapper.href)
      } catch { if (live) setSrc(direct) }
    })
    return () => { live = false }
  }, [controller, direct, item?.id])
  return src
    ? h('iframe', { ref: frameRef, src, title, className: 'fluid-youtube-frame', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', loading: 'lazy', referrerPolicy: 'strict-origin-when-cross-origin', scrolling: 'no' })
    : h('div', { className: 'fluid-youtube-frame fluid-youtube-frame-loading', role: 'status' }, 'Preparing YouTube player…')
}

function MiniControlBar({ controller, playing, onToggle, disabled = false }) {
  // One shared control vocabulary for every provider: the same Transport
  // actions and the same VolumeControl as the main bottom anchor.
  return h('footer', { className: 'fluid-mini-controls', 'aria-label': 'Playback controls' },
    h('div', { className: 'fluid-player-controls' },
      h(Action, { compact: true, kind: 'previous', label: 'Previous', onClick: () => void controller.previous() }),
      h(WorkspaceButton, { primary: true, onClick: onToggle, disabled, 'aria-label': playing ? 'Pause' : 'Play' }, h(Icon, { kind: playing ? 'pause' : 'play' })),
      h(Action, { compact: true, kind: 'next', label: 'Next', onClick: () => void controller.next() }),
    ),
    h(VolumeControl, { controller, compact: true }),
    h('div', { className: 'fluid-mini-links' },
      h(WorkspaceButton, { onClick: () => { controller.setWorkspaceView('queue'); host.navigate(ROUTE) } }, 'Queue'),
      h(WorkspaceButton, { onClick: () => host.navigate(ROUTE) }, 'Media'),
    ),
  )
}

function YouTubeTransport({ controller, frameRef, item }) {
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const videoId = safeText(item?.id).replace(/^youtube:/, '')
  // Commands are bound to actual player readiness and the frame's real origin;
  // an issued message is an acknowledgement request, not proof of playback.
  const send = (func, args = []) => {
    const frame = frameRef.current
    const origin = embedFrameOrigin(frame?.src)
    const message = youTubeCommandMessage(func, args)
    if (!readyRef.current || !frame?.contentWindow || !origin || !message) return false
    frame.contentWindow.postMessage(message, origin)
    return true
  }
  useEffect(() => {
    setPlaying(false)
    setReady(false)
    readyRef.current = false
    let live = true
    const receive = event => {
      const frame = frameRef.current
      if (!live || !frame || event.source !== frame.contentWindow) return
      const origin = embedFrameOrigin(frame.src)
      if (!origin || event.origin !== origin) return
      const parsed = parseYouTubePlayerMessage(event.data, videoId)
      if (!parsed) return
      if (parsed.kind === 'ready') {
        readyRef.current = true
        setReady(true)
        send('setVolume', [Math.round(clampVolume(controller.volume.get()) * 100)])
        return
      }
      if (parsed.kind === 'state') setPlaying(parsed.playing)
      controller.reportYouTubeState({ ...parsed, engine: 'embed' })
    }
    window.addEventListener('message', receive)
    controller.setYouTubeCommandSink(send)
    const handshake = setInterval(() => {
      const frame = frameRef.current
      const origin = embedFrameOrigin(frame?.src)
      if (frame?.contentWindow && origin) frame.contentWindow.postMessage(youTubeListeningMessage(), origin)
    }, 500)
    return () => { live = false; window.removeEventListener('message', receive); clearInterval(handshake); controller.setYouTubeCommandSink(null) }
  }, [videoId, frameRef])
  return h(MiniControlBar, { controller, playing: playing && ready, disabled: !ready, onToggle: () => void controller.toggle() })
}

function OwnedWatchSurface({ controller, item, capability, controlRef }) {
  // Thin adapter over the REQUIRED public owned-view contract (see
  // youTubeWatchCapability). The host owns the persistent isolated session,
  // genuine provider login and the control bridge; the plugin never injects
  // scripts into an opaque origin and never borrows the app preview partition.
  useEffect(() => () => { controlRef.current?.dispose?.(); controlRef.current = null; controller.setYouTubeCommandSink(null) }, [])
  const attachControl = handle => {
    controlRef.current = handle
    controller.setYouTubeCommandSink(handle ? (func, args = []) => {
      if (func === 'playVideo') { handle.play?.(); return true }
      if (func === 'pauseVideo') { handle.pause?.(); return true }
      if (func === 'setVolume') { handle.setVolume?.((Number(args[0]) || 0) / 100); return true }
      return false
    } : null)
  }
  const View = capability?.OwnedMediaView
  if (typeof View !== 'function') {
    return h('p', { className: 'fluid-error', role: 'alert' }, 'The owned watch surface is unavailable on this host.')
  }
  return h(View, {
    ref: attachControl,
    src: item.url,
    sessionKey: `fluid-music-youtube-${safeText(item.id).replace(/^youtube:/, '')}`,
    title: item.title || 'YouTube video',
    className: 'fluid-youtube-frame',
    onMediaState: state => controller.reportYouTubeState({ ...state, engine: 'watch' }),
  })
}

function MiniPlayer({ controller }) {
  const queue = useValue(controller.queue)
  const at = useValue(controller.index)
  const spotify = useValue(controller.spotify)
  const status = useValue(controller.status)
  const progress = useValue(controller.progress)
  const youtubeState = useValue(controller.youtube)
  const item = queue[at]
  const capabilities = mediaCapabilities(item)
  const display = item?.source === 'spotify' && spotify.title
    ? { ...item, title: spotify.title, subtitle: spotify.subtitle, artwork: spotify.artwork }
    : item
  const embedUrl = youtubeEmbedUrl(item)
  const youtubeFrameRef = useRef(null)
  const watchControlRef = useRef(null)
  if (embedUrl) {
    const watching = youtubeState.engine === 'watch'
    return h(
      'section',
      { className: 'fluid-mini-player fluid-youtube-player', 'aria-label': 'FluidMusic YouTube player' },
      h('div', { className: 'fluid-youtube-frame-wrap' },
        watching
          ? h(OwnedWatchSurface, { controller, item, capability: controller.youtubeWatchCapability(), controlRef: watchControlRef })
          : h(EmbeddedYouTubeFrame, { key: `${item.id}-${youtubeState.reloadToken || 0}`, controller, item, title: display?.title || 'YouTube video', frameRef: youtubeFrameRef }),
      ),
      // Honest physical minimum: the video never shrinks below 200x200. When
      // the docked pane is too short, say so and keep controls reachable
      // instead of pretending everything fits or hiding the video.
      h('p', { className: 'fluid-mini-expand-note', role: 'status' }, 'This pane is too short for the full video. Expand the FluidMusic player to about 360px or more; playback controls stay available below.'),
      youtubeState.status === 'switching' && h('p', { className: 'fluid-muted', role: 'status' }, 'Switching player…'),
      youtubeState.status === 'error' && youtubeState.error && h('p', { className: 'fluid-error', role: 'alert' }, youtubeState.error),
      watching
        ? h(MiniControlBar, { controller, playing: Boolean(youtubeState.playing), onToggle: () => void controller.toggle() })
        : h(YouTubeTransport, { controller, frameRef: youtubeFrameRef, item }),
      youtubeState.status === 'error' && h('div', { className: 'fluid-actions' },
        youtubeState.retryable && h(WorkspaceButton, { onClick: () => void controller.retryYouTube() }, 'Retry'),
        youtubeState.fallbackEligible && h(WorkspaceButton, { onClick: () => controller.attemptYouTubeWatchFallback() }, 'Try watch fallback'),
        h(WorkspaceButton, { onClick: () => void controller.next() }, 'Skip')),
    )
  }
  return h(
    'section',
    { className: 'fluid-mini-player', 'aria-label': 'Dockable FluidMusic player' },
    h('div', { className: 'fluid-mini-body' },
      h('div', { className: 'fluid-mini-summary' },
        h(Artwork, { item: display, className: 'fluid-mini-art' }),
        h('div', { className: 'fluid-row-copy' },
          h('span', { className: 'fluid-source-chip', 'data-source': item?.source || 'idle' }, item ? sourceLabel(item) : 'FluidMusic'),
          h('h2', { className: 'fluid-mini-title' }, display?.title || 'Ready when you are'),
          h('p', { className: 'fluid-mini-subtitle' }, display?.subtitle || 'Choose music in the Media workspace.'),
        ),
      ),
      capabilities.seek && progress.durationMs > 0
        ? h(SeekBar, { controller })
        : h('p', { className: 'fluid-player-hint' }, item?.source === 'radio' ? 'LIVE' : status),
      h(Notice, { controller }),
    ),
    h(MiniControlBar, { controller, playing: ['playing', 'loading'].includes(status), onToggle: () => void controller.toggle() }),
  )
}function YouTubeControls({ controller, compact = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('search')
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(() => () => { request.current += 1 }, [])
  const submit = async event => {
    event?.preventDefault()
    const trimmed = query.trim()
    if (!trimmed || busy) return
    const token = ++request.current
    const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    setError('')
    setBusy(true)
    setMode(isUrl ? 'resolve' : 'search')
    try {
      if (isUrl) {
        await controller.addYouTubeUrl(trimmed, true)
        if (token === request.current) setQuery('')
      } else {
        const items = await controller.searchYouTube(trimmed)
        if (token !== request.current) return
        setResults(items)
        setSearched(true)
      }
    } catch (reason) {
      if (token === request.current) setError(userFacingError(reason))
    } finally {
      if (token === request.current) setBusy(false)
    }
  }
  return h('section', { className: compact ? 'fluid-youtube fluid-youtube-compact' : 'fluid-panel fluid-panel-pad fluid-youtube' },
    h('div', { className: 'fluid-section-head' },
      h('div', {}, h('h2', { className: 'fluid-section-title' }, 'YouTube'), h('p', { className: 'fluid-section-copy' }, 'Search songs or videos, or paste a watch URL. FluidMusic loads the real video title and channel.')),
    ),
    h('form', { className: 'fluid-searchbar', onSubmit: submit },
      h('input', { className: 'fluid-input', value: query, onChange: event => setQuery(event.target.value), placeholder: 'Search YouTube or paste a watch URL', 'aria-label': 'Search YouTube or paste a watch URL' }),
      h(WorkspaceButton, { primary: true, type: 'submit', disabled: busy || !query.trim() }, busy ? (mode === 'resolve' ? 'Resolving…' : 'Searching…') : 'Search'),
    ),
    error && h('p', { className: 'fluid-error', role: 'alert' }, error),
    searched && !busy && !error && results.length === 0 && h('p', { className: 'fluid-muted', role: 'status' }, 'No videos found. Try different words or paste a watch URL.'),
    results.length > 0 && h('div', { className: 'fluid-track-list fluid-youtube-results' }, results.map((item, at) => h(TrackRow, { controller, item, at, key: `${item.id}-${at}`, hideSave: true, origin: 'search', onPlay: () => controller.addYouTubeItem(item, true) }))),
  )
}

function HistoryPage({ controller }) {
  const entries = useValue(controller.history)
  const total = useValue(controller.historyTotal)
  const filters = useValue(controller.historyFilters)
  const offset = useValue(controller.historyOffset)
  const retention = useValue(controller.historyRetention)
  const [confirmClear, setConfirmClear] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [draft, setDraft] = useState({ query: filters.query, source: filters.source, since: filters.since, until: filters.until })
  useEffect(() => { void controller.refreshHistory().catch(() => {}) }, [controller])
  const applyFilters = () => { void controller.refreshHistory(draft, 0).catch(() => {}) }
  const resetFilters = () => {
    const empty = { query: '', source: '', since: '', until: '' }
    setDraft(empty)
    void controller.refreshHistory(empty, 0).catch(() => {})
  }
  const pageStart = total ? offset + 1 : 0
  const pageEnd = offset + entries.length
  return h('section', {},
    h('div', { className: 'fluid-compact-toolbar' },
      h('p', { className: 'fluid-muted' }, `${total} recorded play${total === 1 ? '' : 's'}${total ? ` · showing ${pageStart}–${pageEnd}` : ''}`),
      h(WorkspaceButton, { disabled: !total, onClick: () => setConfirmClear(true) }, 'Clear history')),
    h('form', { className: 'fluid-history-filters', onSubmit: (event) => { event.preventDefault(); applyFilters() } },
      h('label', { className: 'fluid-filter-field' }, 'Title',
        h('input', { className: 'fluid-input', type: 'search', value: draft.query, onChange: event => setDraft({ ...draft, query: event.target.value }), placeholder: 'Search titles…', 'aria-label': 'Filter history by title' })),
      h('label', { className: 'fluid-filter-field' }, 'Source',
        h('select', { className: 'fluid-input', value: draft.source, onChange: event => setDraft({ ...draft, source: event.target.value }), 'aria-label': 'Filter history by source' },
          [['', 'All sources'], ['spotify', 'Spotify'], ['radio', 'Radio'], ['local', 'Local'], ['youtube', 'YouTube']].map(([value, label]) => h('option', { key: value, value }, label)))),
      h('label', { className: 'fluid-filter-field' }, 'Since',
        h('input', { className: 'fluid-input', type: 'date', value: draft.since, onChange: event => setDraft({ ...draft, since: event.target.value }), 'aria-label': 'Filter history since date' })),
      h('label', { className: 'fluid-filter-field' }, 'Until',
        h('input', { className: 'fluid-input', type: 'date', value: draft.until, onChange: event => setDraft({ ...draft, until: event.target.value }), 'aria-label': 'Filter history until date' })),
      h('div', { className: 'fluid-actions' },
        h(WorkspaceButton, { type: 'submit' }, 'Apply'),
        h(WorkspaceButton, { onClick: resetFilters }, 'Reset'))),
    h('p', { className: 'fluid-muted' }, retention > 0
      ? `Retention: entries older than ${retention} days are removed automatically. Change this in Settings › Playback.`
      : 'Retention: keep forever (up to 5000 entries). Change this in Settings › Playback.'),
    entries.length ? h('div', { className: 'fluid-track-list' }, entries.map((entry, at) => h(TrackRow, {
      controller,
      item: entry.item,
      at,
      key: entry.id,
      hideSave: true,
      origin: 'history',
      onPlay: () => controller.add(entry.item, true, 'history'),
      extraActions: h('div', { className: 'fluid-row-actions' },
        h('time', { className: 'fluid-history-time', dateTime: entry.playedAt }, entry.playedAt ? new Date(entry.playedAt).toLocaleString() : ''),
        h(Action, { compact: true, kind: 'trash', label: `Remove ${entry.item.title} from history`, onClick: () => setRemoving(entry) })),
    }))) : h(Empty, { title: 'Nothing played yet' }, 'Spotify, radio, local music, and YouTube plays will appear here.'),
    total > 0 && h('div', { className: 'fluid-history-pager' },
      h(WorkspaceButton, { disabled: offset <= 0, onClick: () => void controller.refreshHistory(null, Math.max(0, offset - 50)).catch(() => {}) }, 'Back'),
      h(WorkspaceButton, { disabled: offset + entries.length >= total, onClick: () => void controller.refreshHistory(null, offset + 50).catch(() => {}) }, 'Next'),
      h('span', { className: 'fluid-muted' }, `Page ${Math.floor(offset / 50) + 1} of ${Math.max(1, Math.ceil(total / 50))}`)),
    confirmClear && h(Confirm, {
      title: 'Clear history',
      action: () => controller.clearHistory(),
      onClose: () => setConfirmClear(false),
    }, `This removes ${total} recorded play${total === 1 ? '' : 's'} from this profile's listening history. Queues, collections, and provider history are not affected.`),
    removing && h(Confirm, {
      title: 'Remove history entry',
      action: () => controller.removeHistoryEntry(removing.id),
      onClose: () => setRemoving(null),
    }, `Remove “${removing.item.title}” from this profile's listening history? The media itself and provider history are not affected.`),
  )
}

function HistoryRetention({ controller }) {
  const days = useValue(controller.historyRetention)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void controller.loadHistoryRetention().catch(() => {}) }, [controller])
  return h('div', { className: 'fluid-filter-field' },
    h('strong', {}, 'History retention'),
    h('small', { className: 'fluid-muted' }, 'How long this profile keeps played-history entries. Media files, queues and provider history are never touched.'),
    h('select', {
      className: 'fluid-input', value: String(days), disabled: busy, 'aria-label': 'History retention',
      onChange: (event) => {
        setBusy(true)
        setError('')
        void controller.setHistoryRetention(Number(event.target.value))
          .catch(err => setError(err?.message || 'Retention could not be updated.'))
          .finally(() => setBusy(false))
      },
    }, [[0, 'Keep forever'], [30, '30 days'], [90, '90 days'], [365, '1 year']].map(([value, label]) => h('option', { key: value, value: String(value) }, label))),
    error && h('p', { className: 'fluid-error', role: 'alert' }, error))
}

function PlayerExtras({ controller }) {
  const queue = useValue(controller.queue)
  const at = useValue(controller.index)
  const offer = useValue(controller.resumeOffer)
  const sleep = useValue(controller.sleepTimer)
  const bookmarks = useValue(controller.bookmarks)
  const progress = useValue(controller.progress)
  const item = queue[at]
  const eligible = isLongFormEligible(item)
  const [sleepOpen, setSleepOpen] = useState(false)
  const [custom, setCustom] = useState('45')
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [editing, setEditing] = useState(null)
  const [editLabel, setEditLabel] = useState('')
  const [editPosition, setEditPosition] = useState('')
  if (!item && !offer && sleep.mode === 'off') return null
  return h('div', { className: 'fluid-player-extras' },
    offer && h('div', { className: 'fluid-resume-offer', role: 'status' },
      h('span', {}, `Resume “${offer.title}” at ${formatPositionMs(offer.positionMs)}?`),
      h(WorkspaceButton, { onClick: () => controller.resumeHere() }, 'Resume'),
      h(WorkspaceButton, { onClick: () => controller.startOver() }, 'Start over')),
    eligible && h(WorkspaceButton, { onClick: () => { setLabel(''); setBookmarksOpen(true) } }, `Bookmarks${bookmarks.length ? ` · ${bookmarks.length}` : ''}`),
    h('button', {
      type: 'button', className: 'fluid-sleep-chip', 'data-armed': sleep.mode !== 'off' ? 'true' : undefined,
      'aria-label': sleep.mode === 'duration' ? `Sleep timer: ${formatPositionMs(sleep.remainingMs)} remaining. Open sleep timer controls`
        : sleep.mode === 'end-of-item' ? 'Sleep timer: end of item. Open sleep timer controls' : 'Open sleep timer',
      onClick: () => setSleepOpen(true),
    },
      h(Icon, { kind: 'clock' }),
      sleep.mode === 'duration' ? `Sleep · ${formatPositionMs(sleep.remainingMs)}` : sleep.mode === 'end-of-item' ? 'Sleep · end of item' : 'Sleep'),
    sleep.mode !== 'off' && h(WorkspaceButton, { onClick: () => controller.cancelSleepTimer() }, 'Cancel timer'),
    sleepOpen && h(Modal, { title: 'Sleep timer', onClose: () => setSleepOpen(false) },
      h('p', { className: 'fluid-muted' }, 'Pauses only the current player when it finishes. Changing the source cancels the timer; it never takes over another device. The timer is not restored after a reload.'),
      h('div', { className: 'fluid-actions' },
        SLEEP_PRESETS_MIN.map(minutes => h(WorkspaceButton, { key: minutes, onClick: () => { if (controller.armSleepTimer('duration', minutes)) setSleepOpen(false) } }, `${minutes} min`)),
        h(WorkspaceButton, { disabled: item?.source === 'radio', onClick: () => { if (controller.armSleepTimer('end-of-item')) setSleepOpen(false) } }, 'End of item')),
      item?.source === 'radio' && h('p', { className: 'fluid-muted' }, 'Live radio has no end-of-item; choose a duration.'),
      h('form', { onSubmit: (event) => { event.preventDefault(); if (controller.armSleepTimer('duration', Number(custom))) setSleepOpen(false) } },
        h('label', { className: 'fluid-field' }, 'Custom minutes (1–720)',
          h('input', { className: 'fluid-input', type: 'number', min: 1, max: 720, value: custom, onChange: event => setCustom(event.target.value), 'aria-label': 'Custom sleep minutes' })),
        h('div', { className: 'fluid-dialog-actions' },
          h(WorkspaceButton, { onClick: () => setSleepOpen(false) }, 'Close'),
          h(WorkspaceButton, { primary: true, type: 'submit' }, 'Start'))),
      sleep.mode !== 'off' && h('div', { className: 'fluid-dialog-actions' },
        h(WorkspaceButton, { danger: true, onClick: () => { controller.cancelSleepTimer(); setSleepOpen(false) } }, 'Cancel timer'))),
    bookmarksOpen && h(Modal, { title: `Bookmarks · ${item?.title || ''}`, onClose: () => { setBookmarksOpen(false); setEditing(null) } },
      h('p', { className: 'fluid-muted' }, 'Timestamp bookmarks for this long-form item. Jump seeks the current player; nothing is downloaded.'),
      h('form', { onSubmit: (event) => { event.preventDefault(); void controller.addBookmark(label).then(result => { if (result) setLabel('') }) } },
        h('label', { className: 'fluid-field' }, `Bookmark at ${formatPositionMs(progress.positionMs)}`,
          h('input', { className: 'fluid-input', value: label, onChange: event => setLabel(event.target.value), placeholder: 'Optional label', 'aria-label': 'Bookmark label' })),
        h('div', { className: 'fluid-dialog-actions' }, h(WorkspaceButton, { primary: true, type: 'submit' }, 'Add bookmark'))),
      bookmarks.length ? h('div', { className: 'fluid-track-list' }, bookmarks.map(entry => h('div', { className: 'fluid-bookmark-row', key: entry.id },
        h(WorkspaceButton, { onClick: () => controller.jumpToBookmark(entry.id) }, formatPositionMs(entry.positionMs)),
        editing === entry.id
          ? h('form', { onSubmit: (event) => { event.preventDefault(); void controller.editBookmark(entry.id, { label: editLabel, positionMs: Number(editPosition) * 1000 }).then(result => { if (result) setEditing(null) }) } },
            h('input', { className: 'fluid-input', value: editLabel, onChange: event => setEditLabel(event.target.value), 'aria-label': 'Bookmark label' }),
            h('input', { className: 'fluid-input', type: 'number', min: 0, value: editPosition, onChange: event => setEditPosition(event.target.value), 'aria-label': 'Bookmark position in seconds' }),
            h('div', { className: 'fluid-dialog-actions' },
              h(WorkspaceButton, { onClick: () => setEditing(null) }, 'Cancel'),
              h(WorkspaceButton, { primary: true, type: 'submit' }, 'Save')))
          : h('span', { className: 'fluid-row-title' }, entry.label || 'Untitled bookmark'),
        h('div', { className: 'fluid-row-actions' },
          h(Action, { compact: true, kind: 'edit', label: `Edit bookmark at ${formatPositionMs(entry.positionMs)}`, onClick: () => { setEditing(entry.id); setEditLabel(entry.label); setEditPosition(String(Math.round(entry.positionMs / 1000))) } }),
          h(Action, { compact: true, kind: 'trash', label: `Delete bookmark at ${formatPositionMs(entry.positionMs)}`, onClick: () => void controller.deleteBookmark(entry.id) })))))
        : h('p', { className: 'fluid-muted' }, 'No bookmarks yet. Add one at the current position.')),
  )
}

function NowPlayingBand({ controller }) {
  const queue = useValue(controller.queue)
  const at = useValue(controller.index)
  const status = useValue(controller.status)
  const spotify = useValue(controller.spotify)
  const item = queue[at]
  const display = item?.source === 'spotify' && spotify.title ? { ...item, title: spotify.title, subtitle: spotify.subtitle, artwork: spotify.artwork } : item
  const upcoming = queue.slice(at + 1, at + 4)
  return h('section', { className: 'fluid-now-band', 'aria-label': 'Now playing' },
    h('div', { className: 'fluid-orbit', 'data-playing': status === 'playing' }, h(Artwork, { item: display, className: 'fluid-orbit-art' })),
    h('div', { className: 'fluid-now-main' },
      h('span', { className: 'fluid-source-chip', 'data-source': item?.source || 'idle' }, item ? sourceLabel(item) : 'FluidMusic'),
      h('h1', { className: 'fluid-now-title' }, display?.title || 'Choose what plays next'),
      h('p', { className: 'fluid-now-subtitle' }, display?.subtitle || 'Spotify, live radio, local music, and embedded YouTube playback.'),
      item?.source === 'spotify' && h('p', { className: 'fluid-device-line' }, spotify.device ? `Playing on ${spotify.device}` : 'Choose an available Spotify Connect device in Settings.'),
    ),
    h('aside', { className: 'fluid-up-next', 'aria-label': 'Up next preview' },
      h('div', { className: 'fluid-section-head' }, h('h2', { className: 'fluid-section-title' }, 'Up Next'), h('span', {}, `${Math.max(0, queue.length - at - 1)}`)),
      upcoming.length ? upcoming.map((next, offset) => h('button', { type: 'button', className: 'fluid-next-row', key: `${next.id}-${offset}`, onClick: () => void controller.playAt(at + offset + 1) }, h(Artwork, { item: next, className: 'fluid-mini-cover' }), h('span', {}, h('strong', {}, next.title), h('small', {}, sourceLabel(next))))) : h('p', { className: 'fluid-muted' }, 'Nothing queued after this.'),
      h('div', { className: 'fluid-actions' }, h(WorkspaceButton, { onClick: () => controller.setWorkspaceView('queue') }, 'Open Queue')),
    ),
  )
}

function BottomTransport({ controller }) {
  // The ONE persistent player bar: content scrolls above it, it never scrolls
  // away. Same capability table and shared components as every other surface.
  const queue = useValue(controller.queue)
  const at = useValue(controller.index)
  const status = useValue(controller.status)
  const spotify = useValue(controller.spotify)
  const progress = useValue(controller.progress)
  const item = queue[at]
  const capabilities = mediaCapabilities(item)
  const display = item?.source === 'spotify' && spotify.title ? { ...item, title: spotify.title, subtitle: spotify.subtitle, artwork: spotify.artwork } : item
  return h('footer', { className: 'fluid-bottom-bar', 'aria-label': 'Player' },
    h('div', { className: 'fluid-bottom-item' },
      h(Artwork, { item: display, className: 'fluid-mini-cover' }),
      h('div', { className: 'fluid-row-copy' },
        h('span', { className: 'fluid-row-title', title: display?.title || '' }, display?.title || 'Nothing selected'),
        h('span', { className: 'fluid-row-detail', title: display?.subtitle || '' }, display?.subtitle || 'Choose music in Browse.'),
      ),
    ),
    h('div', { className: 'fluid-bottom-center' },
      h(Transport, { controller }),
      capabilities.seek && progress.durationMs > 0 ? h(SeekBar, { controller }) : h('p', { className: 'fluid-live-line' }, item?.source === 'radio' ? 'LIVE · station broadcast' : item ? status : 'idle'),
    ),
    h('div', { className: 'fluid-bottom-right' },
      capabilities.volume && h(VolumeControl, { controller }),
      item && h('span', { className: 'fluid-source-chip', 'data-source': item.source }, sourceLabel(item)),
    ),
    h(PlayerExtras, { controller }),
  )
}

function SecondaryTabs({ label, value, onChange, items }) {
  return h('div', { className: 'fluid-secondary-tabs', role: 'tablist', 'aria-label': label }, items.map(([id, text]) => h('button', { type: 'button', role: 'tab', key: id, 'aria-selected': value === id, onClick: () => onChange(id) }, text)))
}

function BrowsePage({ controller }) {
  const [tab, setTab] = useState('spotify')
  return h('div', {}, h(PageHead, { title: 'Browse', subtitle: 'Search Spotify, YouTube, or live radio.' }), h(SecondaryTabs, { label: 'Browse sources', value: tab, onChange: setTab, items: [['spotify', 'Spotify'], ['youtube', 'YouTube'], ['radio', 'Radio']] }), tab === 'spotify' ? h(SearchPage, { controller }) : tab === 'youtube' ? h(YouTubeControls, { controller }) : h(RadioPage, { controller }))
}

function LibraryPage({ controller }) {
  const [tab, setTab] = useState('spotify')
  return h('div', {}, h(PageHead, { title: 'Library', subtitle: 'Playlists, local music, collections, and listening history.' }), h(SecondaryTabs, { label: 'Library sources', value: tab, onChange: setTab, items: [['spotify', 'Spotify'], ['local', 'Local'], ['collections', 'Collections'], ['history', 'History']] }), tab === 'spotify' ? h(SpotifyLibraryPage, { controller }) : tab === 'local' ? h(LocalPage, { controller }) : tab === 'history' ? h(HistoryPage, { controller }) : h(PlaylistsPage, { controller }))
}

function RecoveryPage({ controller, onOpenDiagnostics }) {
  const health = useValue(controller.sourceHealth)
  const retries = useValue(controller.retryState)
  const queue = useValue(controller.queue)
  const at = useValue(controller.index)
  const [copied, setCopied] = useState('')
  const rows = ['spotify', 'youtube', 'local', 'radio', 'backend'].map(source => health[source] || { source, state: 'unknown', detail: 'No evidence yet — health updates only from real requests and playback.', action: '', lastEvidenceAt: '' })
  const cooldownFor = key => {
    const entry = retries[key]
    return entry && entry.cooldownUntilWall > Date.now() ? Math.ceil((entry.cooldownUntilWall - Date.now()) / 1000) : 0
  }
  const retryAction = source => {
    if (source === 'spotify') return () => void controller.retrySpotify()
    if (source === 'youtube') return () => void controller.retryYouTube()
    if (source === 'radio') return () => void controller.retryRadio()
    if (source === 'local') return () => void controller.rescanLocalLibrary().catch(() => {})
    return () => void controller.refreshHistory().catch(() => {})
  }
  const copy = () => {
    const text = controller.copyDiagnostics()
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => setCopied('Sanitized diagnostics copied.'))
        .catch(() => setCopied('Clipboard was refused — diagnostics remain in the Diagnostics tab.'))
    } else setCopied('Clipboard is unavailable here — diagnostics remain in the Diagnostics tab.')
  }
  return h('section', { className: 'fluid-panel fluid-panel-pad', 'aria-label': 'Recovery center' },
    h('div', { className: 'fluid-section-head' },
      h('div', {},
        h('h2', { className: 'fluid-section-title' }, 'Recovery'),
        h('p', { className: 'fluid-section-copy' }, 'One quiet place for source health and bounded retries. Rows reflect the last real evidence — never a fake all-online badge. Retries cool down after three attempts.')),
      h('div', { className: 'fluid-actions' },
        h(WorkspaceButton, { onClick: copy }, 'Copy diagnostics'),
        h(WorkspaceButton, { onClick: onOpenDiagnostics }, 'Open diagnostics'))),
    copied && h('p', { className: 'fluid-muted', role: 'status' }, copied),
    h('div', { className: 'fluid-track-list' }, rows.map(row => h('div', { className: 'fluid-health-row', key: row.source, 'data-state': row.state },
      h('div', { className: 'fluid-row-copy' },
        h('span', { className: 'fluid-row-title' }, `${sourceLabel({ source: row.source })} · ${row.state}`),
        h('span', { className: 'fluid-row-detail' }, row.detail),
        row.lastEvidenceAt && h('span', { className: 'fluid-row-detail' }, `Last evidence: ${new Date(row.lastEvidenceAt).toLocaleString()}`)),
      h('div', { className: 'fluid-row-actions' },
        h(WorkspaceButton, { disabled: cooldownFor(row.source) > 0, onClick: retryAction(row.source) }, cooldownFor(row.source) > 0 ? `Retry (${cooldownFor(row.source)}s)` : 'Retry'),
        row.source === 'spotify' && row.action === 'reconnect' && h(WorkspaceButton, { onClick: () => void controller.startSpotifyAuth() }, 'Reconnect'),
        row.source === 'local' && h(WorkspaceButton, { onClick: () => void controller.rescanLocalLibrary().catch(() => {}) }, 'Rescan'),
        queue.length > at + 1 && h(WorkspaceButton, { onClick: () => void controller.next() }, 'Skip'))))),
    h('p', { className: 'fluid-muted' }, 'Skipping advances the queue once; it never edits provider playlists. Diagnostics are sanitized — no tokens, credentials or raw history.'),
  )
}

function SettingsPage({ controller }) {
  const [tab, setTab] = useState('providers')
  const autoplay = useValue(controller.spotifyAutoplay)
  return h('div', {}, h(PageHead, { title: 'Settings', subtitle: 'Connections, playback behavior, and diagnostics.' }), h(SecondaryTabs, { label: 'Settings sections', value: tab, onChange: setTab, items: [['providers', 'Providers'], ['playback', 'Playback'], ['recovery', 'Recovery'], ['diagnostics', 'Diagnostics']] }),
    tab === 'providers' ? h('div', { className: 'fluid-settings-grid' }, h(SpotifyConnection, { controller }), h(YouTubeControls, { controller })) :
    tab === 'playback' ? h('section', { className: 'fluid-panel fluid-panel-pad' }, h('h2', { className: 'fluid-section-title' }, 'Playback'), h(VolumeControl, { controller }), h('label', { className: 'fluid-switch-row' }, h('input', { type: 'checkbox', checked: autoplay, onChange: event => controller.setSpotifyAutoplay(event.target.checked) }), h('span', {}, h('strong', {}, 'Let Spotify continue after a track'), h('small', {}, 'Otherwise FluidMusic advances its temporary Up Next queue.'))), h(HistoryRetention, { controller })) :
    tab === 'recovery' ? h(RecoveryPage, { controller, onOpenDiagnostics: () => setTab('diagnostics') }) : h(LogsPage, { controller }))
}

function LogsPage({ controller }) {
  const entries = useValue(controller.logs)
  return h('section', { className: 'fluid-panel fluid-panel-pad' },
    h('div', { className: 'fluid-section-head' }, h('div', {}, h('h2', { className: 'fluid-section-title' }, `Diagnostics · ${entries.length}`), h('p', { className: 'fluid-section-copy' }, 'Sanitized provider commands and playback transitions.')), h(WorkspaceButton, { disabled: !entries.length, onClick: () => controller.clearLogs() }, 'Clear logs')),
    h('div', { className: 'fluid-log-list' }, entries.map(entry => h('article', { className: 'fluid-log-row', 'data-level': entry.level, key: entry.id }, h('time', { dateTime: entry.at }, new Date(entry.at).toLocaleTimeString()), h('span', { className: 'fluid-log-level' }, entry.level), h('strong', {}, entry.event), h('pre', {}, JSON.stringify(entry.detail, null, 2))))),
    !entries.length && h(Empty, { title: 'No diagnostics yet' }, 'Provider activity appears here when you use playback controls.'),
  )
}

const PRIMARY_NAV = [['browse', 'Browse'], ['library', 'Library'], ['queue', 'Queue'], ['settings', 'Settings']]
function TopNavigation({ controller, view }) {
  return h('header', { className: 'fluid-topbar' },
    h('button', { type: 'button', className: 'fluid-wordmark', onClick: () => controller.setWorkspaceView('browse') }, h(Icon, { kind: 'music' }), h('span', {}, 'FluidMusic')),
    h('nav', { className: 'fluid-primary-nav', 'aria-label': 'FluidMusic' }, PRIMARY_NAV.map(([id, label]) => h('button', { type: 'button', className: 'fluid-nav-button', key: id, 'data-active': view === id, 'aria-current': view === id ? 'page' : undefined, onClick: () => controller.setWorkspaceView(id) }, label))),
  )
}

function MediaPage({ controller }) {
  const view = useValue(controller.workspaceView)
  useEffect(() => { controller.setPollingOpen(true); return () => controller.setPollingOpen(false) }, [controller])
  const pages = { browse: BrowsePage, library: LibraryPage, queue: QueuePage, settings: SettingsPage }
  const Page = pages[view] || BrowsePage
  return h('div', { className: 'fluid-root' }, h('main', { className: 'fluid-app' },
    h(TopNavigation, { controller, view }),
    h('section', { className: 'fluid-content' }, h('div', { className: 'fluid-content-inner' }, h(Notice, { controller }), view === 'browse' && h(NowPlayingBand, { controller }), h(Page, { controller }))),
    h(BottomTransport, { controller }),
  ))
}

function PlayerPopover({ controller, popoverRef }) {
  const queue = useValue(controller.queue)
  const at = useValue(controller.index)
  const item = queue[at]
  const progress = useValue(controller.progress)
  const spotify = useValue(controller.spotify)
  const state = useValue(controller.status)
  const capabilities = mediaCapabilities(item)
  const upcoming = queue.slice(at + 1, at + 4)
  const display = item?.source === 'spotify' && spotify.title ? { ...item, title: spotify.title, subtitle: spotify.subtitle, artwork: spotify.artwork } : item
  return h('div', { ref: popoverRef, id: 'fluid-title-popover', className: 'fluid-title-popover', role: 'dialog', 'aria-label': 'FluidMusic quick controls' },
    h('div', { className: 'fluid-popover-now' }, h('div', { className: 'fluid-orbit fluid-orbit-small', 'data-playing': state === 'playing' }, h(Artwork, { item: display, className: 'fluid-orbit-art' })), h('div', { className: 'fluid-row-copy' }, h('span', { className: 'fluid-source-chip', 'data-source': item?.source || 'idle' }, item ? sourceLabel(item) : 'FluidMusic'), h('strong', { className: 'fluid-popover-title' }, display?.title || 'Nothing selected'), h('span', { className: 'fluid-row-detail' }, display?.subtitle || 'Open Media to choose something.'))),
    item && h(Transport, { controller }),
    capabilities.seek && progress.durationMs > 0 ? h(SeekBar, { controller }) : item?.source === 'radio' && h('p', { className: 'fluid-live-line' }, 'LIVE'),
    capabilities.volume && h(VolumeControl, { controller }),
    item?.source === 'spotify' && h('p', { className: 'fluid-device-line' }, spotify.device || 'No confirmed Connect device'),
    upcoming.length > 0 && h('section', { className: 'fluid-popover-upnext', 'aria-label': 'Up next preview' }, h('h3', {}, 'Up Next'), upcoming.map((next, offset) => h('button', { type: 'button', className: 'fluid-next-row', key: `${next.id}-${offset}`, title: next.title, 'aria-label': `Play ${next.title}`, onClick: () => void controller.playAt(at + offset + 1) }, h('span', {}, h('strong', {}, next.title), h('small', {}, sourceLabel(next)))))),
    h(Notice, { controller }),
    h('div', { className: 'fluid-source-shortcuts' }, h(WorkspaceButton, { onClick: () => { controller.setWorkspaceView('browse'); HOST_NAVIGATE?.(ROUTE) } }, 'YouTube in Media'), h(WorkspaceButton, { onClick: () => { controller.setWorkspaceView('queue'); HOST_NAVIGATE?.(ROUTE) } }, 'Open Queue'), h(WorkspaceButton, { disabled: !HOST_NAVIGATE, title: HOST_NAVIGATE ? 'Open Media' : 'Host navigation is unavailable on this build', onClick: () => HOST_NAVIGATE?.(ROUTE) }, 'Open Media')),
  )
}

function TitlebarPlayer({ controller }) {
  const queue = useValue(controller.queue)
  const at = useValue(controller.index)
  const state = useValue(controller.status)
  const spotify = useValue(controller.spotify)
  const open = useValue(controller.titlebarOpen)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const item = queue[at]
  const title = item?.source === 'spotify' && spotify.title ? spotify.title : item?.title || 'FluidMusic'
  useEffect(() => {
    if (!open) return undefined
    const trigger = triggerRef.current
    const popover = popoverRef.current
    popover?.querySelector('button:not([disabled]), input:not([disabled]), [tabindex="0"]')?.focus()
    const dismiss = () => controller.titlebarOpen.set(false)
    const onKeyDown = event => { if (event.key === 'Escape') { event.preventDefault(); dismiss() } }
    const onPointerDown = event => { if (!rootRef.current?.contains(event.target)) dismiss() }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      if (trigger instanceof HTMLElement && trigger.isConnected) setTimeout(() => trigger.isConnected && trigger.focus(), 0)
    }
  }, [open, controller])
  return h('div', { ref: rootRef, className: 'fluid-titlebar' },
    h(Button || 'button', { ref: triggerRef, type: 'button', ...(Button ? { variant: 'ghost', size: 'micro' } : {}), className: 'fluid-titlebar-summary', title, 'aria-expanded': open, 'aria-haspopup': 'dialog', 'aria-controls': open ? 'fluid-title-popover' : undefined, onClick: () => controller.titlebarOpen.set(!open) }, h('span', { className: 'fluid-status-dot', 'data-state': state, 'aria-hidden': true }), h('span', { className: 'fluid-titlebar-source' }, item ? sourceLabel(item) : 'Media'), h('span', { className: 'fluid-titlebar-title' }, title)),
    mediaCapabilities(item).play && h(Action, { compact: true, kind: ['playing', 'loading'].includes(state) ? 'pause' : 'play', label: ['playing', 'loading'].includes(state) ? 'Pause' : 'Play', onClick: () => void controller.toggle() }),
    open && h(PlayerPopover, { controller, popoverRef }),
  )
}

export default {
  id: ID,
  name: 'FluidMusic',
  description: 'Source-aware listening for Spotify Connect, radio, local music, and embedded YouTube playback.',
  defaultEnabled: true,
  register(ctx) {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.append(style)
    ctx.onDispose(() => style.remove())
    if (!SDK_COMPATIBLE) {
      // Honest incompatibility surface: no controller, no media commands, no
      // polling. Never reference the missing exports beyond this message.
      const renderFallback = () => h('div', { className: 'fluid-root', role: 'alert' },
        h('main', { className: 'fluid-app' },
          h('p', { className: 'fluid-error' }, `FluidMusic cannot start on this Hermes build: missing plugin SDK exports (${SDK_MISSING.join(', ')}). Required by host contract v${HOST_CONTRACT.contractVersion}: ${HOST_CONTRACT.required.join(', ')}. Update Hermes, then reopen Media. Your saved data is untouched.`)))
      if (ROUTES_AREA != null) {
        ctx.register({ id: 'media-route', area: ROUTES_AREA, data: { path: ROUTE }, render: renderFallback })
      } else {
        ctx.register({ id: 'media-sdk-fallback', area: 'panes', title: 'FluidMusic', data: { placement: 'right', width: '320px', height: '160px' }, render: renderFallback })
      }
      return
    }
    const controller = createController(ctx, { watchCapability: youTubeWatchCapability(SDK) })
    ctx.register({ id: 'media-route', area: ROUTES_AREA, data: { path: ROUTE }, render: () => h(MediaPage, { controller }) })
    if (TITLEBAR_RIGHT != null) {
      ctx.register({ id: 'media-titlebar', area: TITLEBAR_RIGHT, order: 18, render: () => h(TitlebarPlayer, { controller }) })
    }
    // One dockable pane for every source. 320px is the audio-only target width;
    // 420px keeps the YouTube video above its 200px minimum plus controls. The
    // pane itself declares shorter-height behavior honestly (see CSS).
    ctx.register({ id: 'mini-player', area: 'panes', title: 'FluidMusic player', data: { placement: 'right', width: '320px', height: '420px' }, render: () => h(MiniPlayer, { controller }) })
  },
}