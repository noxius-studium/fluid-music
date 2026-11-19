import * as HermesSDK from '@hermes/plugin-sdk'
import { createElement as h, useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

/* SDK_BOUNDARY_START */
const resolveSdk = namespace => {
  const sdk = namespace && typeof namespace === 'object' ? namespace : {}
  const required = ['atom', 'useValue', 'host', 'ROUTES_AREA', 'TITLEBAR_AREAS']
  const missing = required.filter(name => sdk[name] == null)
  return { sdk, missing, compatible: missing.length === 0 }
}
/* SDK_BOUNDARY_END */
// Namespace import + capability check before any export is referenced: a
// missing named ESM binding would abort the whole plugin at link time, while
// this boundary lets registration render an honest fallback instead. Button
// is optional (WorkspaceButton falls back to a plain button); the rest are
// required for the current surfaces. React bindings above are stable platform
// APIs, not optional host exports.
const { sdk: SDK, missing: SDK_MISSING, compatible: SDK_COMPATIBLE } = resolveSdk(HermesSDK)
const atom = SDK.atom
const useValue = SDK.useValue
const host = SDK.host
const ROUTES_AREA = SDK.ROUTES_AREA
const TITLEBAR_AREAS = SDK.TITLEBAR_AREAS
const Button = SDK.Button

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
    play: source === 'spotify' || source === 'radio' || source === 'local',
    previous: source === 'spotify' || source === 'local',
    next: source === 'spotify' || source === 'local',
    seek: source === 'spotify' || source === 'local',
    volume: source === 'spotify' || source === 'radio' || source === 'local',
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

const RADIO_PRESETS = [
  { source: 'radio', id: 'fluid-chillsynth', title: 'Chillsynth', subtitle: 'Soft focus · warm synths', streamUrl: 'https://stream.nightride.fm/chillsynth.mp3', homepage: 'https://nightride.fm/?station=chillsynth' },
  { source: 'radio', id: 'fluid-nightride', title: 'Nightride', subtitle: 'Synthwave · after hours', streamUrl: 'https://stream.nightride.fm/nightride.mp3', homepage: 'https://nightride.fm/' },
  { source: 'radio', id: 'fluid-paradise', title: 'Radio Paradise', subtitle: 'Eclectic · human selected', streamUrl: 'https://stream.radioparadise.com/aac-128', homepage: 'https://radioparadise.com/' }
]
/* PURE_FUNCTIONS_END */

const CSS = `
.fluid-root,.fluid-dialog,.fluid-mini-player{--fm-panel:color-mix(in srgb,var(--ui-bg-secondary) 80%,transparent);--fm-soft:color-mix(in srgb,var(--ui-accent) 9%,transparent);--fm-line:var(--ui-stroke-secondary);color:var(--ui-text-primary);font-family:inherit;font-size:13px;line-height:1.5}
.fluid-root{container:fluid / inline-size;height:100%;min-height:0;min-width:0}.fluid-app{height:100%;min-height:0;display:grid;grid-template-rows:minmax(0,1fr) auto;background:transparent;overflow:hidden}.fluid-root *,.fluid-dialog *,.fluid-mini-player *{box-sizing:border-box}.fluid-root button,.fluid-root input,.fluid-root textarea,.fluid-root select,.fluid-dialog input,.fluid-dialog textarea,.fluid-dialog select{font:inherit}.fluid-root :focus-visible,.fluid-dialog :focus-visible,.fluid-mini-player :focus-visible{outline:2px solid var(--ui-accent);outline-offset:3px}
.fluid-nav-button{display:flex;gap:10px;align-items:center;border:0;border-radius:6px;background:transparent;color:var(--ui-text-secondary);padding:10px 12px;cursor:pointer;text-align:left;min-height:38px}.fluid-nav-button:hover{background:var(--fm-soft)}.fluid-nav-button[data-active=true]{color:var(--ui-text-primary);background:var(--fm-soft);box-shadow:inset 2px 0 var(--ui-accent);font-weight:650}.fluid-provider-state{display:flex;gap:8px;align-items:center;color:var(--ui-text-secondary);font-size:11px}.fluid-state-dot,.fluid-status-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--ui-text-quaternary);flex:none}.fluid-state-dot[data-on=true],.fluid-status-dot[data-state=playing]{background:var(--ui-accent)}
.fluid-content{min-width:0;overflow:auto;padding:18px clamp(14px,2cqw,28px) 28px;scrollbar-gutter:stable}.fluid-content-inner{max-width:1360px;margin:0 auto}.fluid-page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px}.fluid-kicker{display:none}.fluid-page-title{font-size:clamp(19px,2cqw,25px);line-height:1.2;letter-spacing:-.03em;font-weight:650;margin:0}.fluid-page-subtitle{color:var(--ui-text-secondary);font-size:12px;max-width:680px;margin:5px 0 0;line-height:1.45}.fluid-section-title{font-size:17px;font-weight:650;letter-spacing:-.025em;margin:0}.fluid-section-copy{margin:6px 0 0;color:var(--ui-text-secondary);font-size:12px}.fluid-section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.fluid-actions,.fluid-row-actions,.fluid-tile-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.fluid-row-actions{gap:2px;flex-wrap:nowrap}.fluid-actions>button{white-space:nowrap}.fluid-muted{font-size:12px;color:var(--ui-text-secondary);line-height:1.6}.fluid-error{font-size:13px;color:var(--ui-text-primary);border-left:3px solid var(--ui-accent);padding:12px;background:var(--fm-soft)}.fluid-panel{border:1px solid var(--fm-line);border-radius:10px;min-width:0;background:var(--fm-panel)}.fluid-panel-pad{padding:22px}.fluid-empty{padding:24px 18px;border:1px dashed var(--fm-line);border-radius:9px;text-align:center;color:var(--ui-text-secondary);font-size:13px;line-height:1.7}.fluid-empty>svg{width:30px;height:30px;margin-bottom:12px;color:var(--ui-accent)}.fluid-empty strong{display:block;color:var(--ui-text-primary);font-size:18px;letter-spacing:-.025em;margin-bottom:8px}.fluid-empty .fluid-actions{justify-content:center;margin-top:20px}.fluid-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;margin:0 0 18px;background:var(--fm-soft);border-left:2px solid var(--ui-accent);font-size:12px;overflow-wrap:anywhere}.fluid-notice>span{min-width:0}
.fluid-now-title{font-size:clamp(25px,3.4cqw,46px);line-height:1.1;letter-spacing:-.05em;margin:0 0 12px;overflow-wrap:anywhere}.fluid-now-subtitle{color:var(--ui-text-secondary);margin:0 0 20px;font-size:14px}.fluid-result-section{margin-top:32px}.fluid-result-section>.fluid-section-title{margin-bottom:16px}.fluid-collection-icon{width:52px;height:52px;flex:none;background:var(--fm-soft);border:1px solid var(--fm-line);display:grid;place-items:center;border-radius:6px;color:var(--ui-accent)}.fluid-collection-icon>svg{width:25px;height:25px}
.fluid-input,.fluid-select,.fluid-textarea{width:100%;min-width:0;border:1px solid var(--fm-line);border-radius:6px;background:var(--ui-bg-secondary);color:var(--ui-text-primary);padding:10px 12px}.fluid-input::placeholder,.fluid-textarea::placeholder{color:var(--ui-text-tertiary)}.fluid-textarea{min-height:90px;resize:vertical}.fluid-searchbar{display:flex;align-items:center;gap:10px;margin:18px 0}.fluid-searchbar>.fluid-input{flex:1}.fluid-field{display:flex;flex-direction:column;gap:8px;font-size:12px;margin:18px 0}.fluid-field small{color:var(--ui-text-secondary)}.fluid-filter{max-width:300px}.fluid-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:18px}.fluid-media-tile{min-width:0;padding:0 0 12px}.fluid-tile-art{aspect-ratio:1;display:grid;place-items:center;background:var(--fm-soft);border:1px solid var(--fm-line);border-radius:8px;overflow:hidden;margin-bottom:12px}.fluid-tile-art>svg{width:36px;height:36px;color:var(--ui-accent)}.fluid-tile-title{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:13px}.fluid-tile-detail{display:block;color:var(--ui-text-secondary);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:11px;margin:4px 0 10px}
.fluid-track-list{border-top:1px solid var(--fm-line)}.fluid-track-row{display:grid;grid-template-columns:24px 40px minmax(0,1fr) 52px 40px auto;gap:12px;align-items:center;padding:12px 4px;border-bottom:1px solid var(--fm-line);min-width:0}.fluid-track-row:hover{background:var(--fm-soft)}.fluid-track-row[data-missing=true] .fluid-row-title{color:var(--ui-text-tertiary)}.fluid-track-number,.fluid-track-duration,.fluid-row-index{font-size:10px;color:var(--ui-text-tertiary);font-variant-numeric:tabular-nums}.fluid-source-tag{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--ui-text-secondary)}.fluid-mini-cover{width:40px;height:40px;border-radius:5px;overflow:hidden;background:var(--fm-soft);display:grid;place-items:center}.fluid-row-copy{min-width:0}.fluid-row-title{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;font-weight:550}.fluid-row-detail{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--ui-text-secondary);margin-top:4px}.fluid-queue-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:12px;padding:12px;border-bottom:1px solid var(--fm-line);align-items:center}.fluid-queue-row[data-current=true]{background:var(--fm-soft);box-shadow:inset 2px 0 var(--ui-accent)}.fluid-track-link{border:0;background:transparent;color:inherit;text-align:left;min-width:0;cursor:pointer;padding:0}.fluid-track-link:disabled{cursor:not-allowed}.fluid-mini-cover img,.fluid-tile-art img,.fluid-now-cover img,.fluid-library-cover img,.fluid-mini-art img{width:100%;height:100%;object-fit:cover}
.fluid-playlist-layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:28px}.fluid-playlist-browser{border-right:1px solid var(--fm-line);padding-right:20px;min-width:0}.fluid-playlist-list{display:flex;flex-direction:column;gap:5px;max-height:55vh;overflow:auto}.fluid-playlist-button{display:flex;align-items:center;gap:12px;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:12px;min-width:0}.fluid-playlist-button:hover{background:var(--fm-soft)}.fluid-playlist-button[data-active=true]{background:var(--fm-soft);border-color:var(--fm-line)}.fluid-playlist-button>svg{flex:none;color:var(--ui-accent)}.fluid-playlist-button strong{display:block;font-size:12px;overflow-wrap:anywhere}.fluid-playlist-button span span{display:block;font-size:10px;color:var(--ui-text-secondary)}.fluid-playlist-editor{min-width:0}.fluid-playlist-heading{display:flex;gap:20px;align-items:center;padding:8px 0 22px;border-bottom:1px solid var(--fm-line)}.fluid-playlist-heading .fluid-collection-icon{width:80px;height:80px}.fluid-library-title{font-size:clamp(24px,3cqw,38px);letter-spacing:-.045em;line-height:1.1;margin:0;overflow-wrap:anywhere}.fluid-library-facts{font-size:11px;color:var(--ui-text-secondary);margin:10px 0 0}.fluid-playlist-toolbar{display:flex;flex-direction:column;gap:12px;padding:20px 0}.fluid-editor-filters{display:flex;gap:12px;align-items:center;margin:6px 0 18px}.fluid-selection-bar{display:flex;gap:10px;align-items:center;background:var(--fm-soft);padding:10px;margin-bottom:12px}.fluid-library-hero{display:flex;gap:24px;align-items:center;border-bottom:1px solid var(--fm-line);padding:0 0 24px;margin-bottom:24px}.fluid-library-cover{width:140px;aspect-ratio:1;flex:none;overflow:hidden;background:var(--fm-soft);display:grid;place-items:center;border-radius:8px}.fluid-device-list{display:grid;gap:8px}.fluid-device{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--fm-line);min-width:0}.fluid-device-copy{flex:1;min-width:0}.fluid-device-copy strong{font-size:12px;display:block;overflow-wrap:anywhere}.fluid-device-copy span{font-size:11px;color:var(--ui-text-secondary)}.fluid-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.fluid-switch-row{display:flex;gap:12px;align-items:flex-start;margin:16px 0;cursor:pointer}.fluid-switch-row strong{display:block;font-size:12px}.fluid-switch-row small{display:block;font-size:11px;color:var(--ui-text-secondary);margin-top:5px}.fluid-switch-row input{margin-top:4px;accent-color:var(--ui-accent)}.fluid-boundaries dt{font-weight:650;margin:16px 0 4px}.fluid-boundaries dd{margin:0;color:var(--ui-text-secondary);font-size:12px}.fluid-settings-grid hr{border:0;border-top:1px solid var(--fm-line);margin:22px 0}
.fluid-player-controls{display:flex;gap:12px;align-items:center;justify-content:center}.fluid-player-progress{display:grid;grid-template-columns:36px minmax(0,1fr) 36px;gap:10px;align-items:center;font:10px/1.5 var(--font-mono,monospace);color:var(--ui-text-secondary);margin-top:8px}.fluid-player-progress>span:last-child{text-align:right}.fluid-range{height:16px;width:100%;min-width:0;accent-color:var(--ui-accent);cursor:pointer;margin:0}.fluid-player-hint{font-size:10px;color:var(--ui-text-tertiary);text-align:center;margin:8px 0 0}.fluid-volume{display:flex;align-items:center;gap:6px;width:170px;max-width:100%}.fluid-volume-value{font:10px var(--font-mono,monospace);color:var(--ui-text-secondary);min-width:30px;text-align:right}.fluid-volume-compact{width:118px}.fluid-volume-compact .fluid-range{width:60px;flex:none}.fluid-volume-compact .fluid-volume-value{font-size:9px;min-width:25px}
.fluid-dialog{position:fixed;inset:0;margin:auto;height:fit-content;width:min(560px,calc(100vw - 32px));max-height:85vh;overflow:auto;border:1px solid var(--fm-line);border-radius:12px;background:var(--ui-bg-elevated,var(--ui-bg-secondary));background:rgb(from var(--ui-bg-elevated,var(--ui-bg-secondary)) r g b / 1);color:var(--ui-text-primary);padding:24px;box-shadow:0 24px 90px color-mix(in srgb,var(--ui-text-primary) 12%,transparent)}.fluid-dialog::backdrop{background:color-mix(in srgb,var(--ui-bg-primary) 65%,transparent);backdrop-filter:blur(4px)}.fluid-dialog-actions{display:flex;justify-content:flex-end;gap:10px;align-items:center;margin-top:24px}.fluid-segmented{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--fm-line);padding-bottom:10px}.fluid-segmented button{border:0;border-radius:5px;padding:8px 12px;background:transparent;color:var(--ui-text-secondary);cursor:pointer}.fluid-segmented button[aria-pressed=true]{background:var(--fm-soft);color:var(--ui-text-primary)}.fluid-picker-list{max-height:340px;overflow:auto}.fluid-picker-row{display:grid;grid-template-columns:20px 40px minmax(0,1fr);gap:12px;align-items:center;padding:10px;border-bottom:1px solid var(--fm-line);cursor:pointer}.fluid-picker-row:hover{background:var(--fm-soft)}.fluid-log-list{display:grid;gap:8px;margin-top:18px}.fluid-log-row{display:grid;grid-template-columns:75px 50px minmax(80px,.6fr) minmax(0,1fr);gap:12px;padding:14px;border:1px solid var(--fm-line);border-radius:6px;font:10px/1.6 var(--font-mono,monospace)}.fluid-log-row[data-level=error]{border-left:3px solid var(--ui-accent)}.fluid-log-row time,.fluid-log-level{color:var(--ui-text-tertiary)}.fluid-log-row pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ui-text-secondary)}
.fluid-mini-player{container:mini / inline-size;height:100%;overflow:auto;padding:18px;min-width:0}.fluid-mini-art{width:min(100%,200px);aspect-ratio:1;display:grid;place-items:center;background:var(--fm-soft);border-radius:8px;overflow:hidden;margin:0 auto 18px}.fluid-mini-art>svg{width:48px;height:48px;color:var(--ui-accent)}.fluid-mini-title{font-size:20px;letter-spacing:-.035em;line-height:1.2;text-align:center;margin:0;overflow-wrap:anywhere}.fluid-mini-subtitle{font-size:12px;text-align:center;color:var(--ui-text-secondary);margin:8px 0 18px;overflow-wrap:anywhere}.fluid-mini-player>.fluid-volume{margin:18px auto}.fluid-mini-player .fluid-notice{margin-top:14px}
.fluid-save-source{display:flex;align-items:center;gap:12px;margin:18px 0}.fluid-save-destinations{border:0;min-width:0;margin:20px 0}.fluid-save-choice{width:100%;border:1px solid var(--fm-line);margin:6px 0}.fluid-save-choice[aria-pressed=true]{border-color:var(--ui-accent);background:var(--fm-soft)}.fluid-save-destinations legend{font-size:12px;font-weight:650;margin-bottom:8px}.fluid-save-destinations .fluid-playlist-list{max-height:220px}.fluid-queue-context{padding:20px 12px 24px 24px;border-left:2px solid var(--ui-accent);background:var(--fm-panel);margin:0 0 18px 14px}.fluid-queue-row>.fluid-row-actions{flex-wrap:wrap;justify-content:flex-end}
@container fluid (max-width:1080px){.fluid-playlist-layout{grid-template-columns:1fr;gap:20px}.fluid-playlist-browser{border-right:0;border-bottom:1px solid var(--fm-line);padding:0 0 16px}.fluid-playlist-browser>.fluid-input{max-width:320px}.fluid-playlist-browser .fluid-playlist-list{flex-direction:row;overflow:auto;max-height:120px}.fluid-playlist-browser .fluid-playlist-button{flex:0 0 170px}.fluid-playlist-toolbar{flex-direction:row;justify-content:space-between;flex-wrap:wrap}.fluid-settings-grid{grid-template-columns:1fr}.fluid-page-head{flex-wrap:wrap}}
@container fluid (max-width:800px){.fluid-content{padding:24px 18px}.fluid-track-row{grid-template-columns:24px 36px minmax(0,1fr) auto;gap:8px}.fluid-track-row>.fluid-source-tag,.fluid-track-row>.fluid-track-duration{display:none}.fluid-editor-filters{flex-wrap:wrap}.fluid-log-row{grid-template-columns:70px 50px minmax(0,1fr)}.fluid-log-row pre{grid-column:1/-1}}
@container fluid (max-width:580px){.fluid-brand,.fluid-nav-label,.fluid-nav-button{flex:none;padding:7px 9px;font-size:11px;min-height:30px;gap:6px}.fluid-content{padding:22px 14px;flex:1;min-height:0}.fluid-page-title{font-size:28px}.fluid-page-subtitle{font-size:12px}.fluid-track-row{grid-template-columns:20px 32px minmax(0,1fr);gap:8px}.fluid-track-row>.fluid-row-actions{grid-column:3;justify-content:flex-start;flex-wrap:wrap}.fluid-mini-cover{width:32px;height:32px}.fluid-track-row{padding:12px 2px}.fluid-row-title{font-size:12px}.fluid-row-detail{font-size:10px}.fluid-playlist-heading{gap:14px}.fluid-playlist-heading .fluid-collection-icon{width:48px;height:48px}.fluid-library-title{font-size:25px}.fluid-player-progress{margin-top:5px}.fluid-library-cover{width:90px}.fluid-library-hero{gap:14px}.fluid-section-head{flex-wrap:wrap}.fluid-filter{max-width:none}.fluid-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fluid-queue-row{grid-template-columns:32px minmax(0,1fr)}.fluid-queue-row>.fluid-row-actions{grid-column:2}.fluid-panel-pad{padding:16px}}
.fluid-mini-summary{display:flex;gap:12px;align-items:center;margin-bottom:18px}.fluid-mini-summary .fluid-mini-art{width:48px;height:48px;margin:0;flex:none}.fluid-mini-summary .fluid-mini-art>svg{width:24px;height:24px}.fluid-mini-summary .fluid-mini-title{font-size:16px;text-align:left;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.fluid-mini-summary .fluid-mini-subtitle{font-size:11px;text-align:left;margin:6px 0 0}.fluid-mini-player>.fluid-section-head{margin-bottom:12px}.fluid-mini-player>.fluid-volume{margin:12px auto}
@container mini (max-width:210px){.fluid-mini-art{width:100px}.fluid-mini-title{font-size:16px}}
@container mini (max-width:520px){.fluid-youtube-player{grid-template-columns:1fr;overflow:auto}.fluid-youtube-frame{height:auto;aspect-ratio:16/9}.fluid-youtube-side{overflow:visible}.fluid-mini-player:not(.fluid-youtube-player){display:flex;padding:12px;overflow:auto}.fluid-mini-player:not(.fluid-youtube-player)>.fluid-mini-summary,.fluid-mini-player:not(.fluid-youtube-player)>.fluid-player-controls,.fluid-mini-player:not(.fluid-youtube-player)>.fluid-player-progress,.fluid-mini-player:not(.fluid-youtube-player)>.fluid-player-hint,.fluid-mini-player:not(.fluid-youtube-player)>.fluid-volume,.fluid-mini-player:not(.fluid-youtube-player)>.fluid-mini-links{margin:0;justify-self:auto}}
.fluid-root,.fluid-mini-player,.fluid-title-popover{--fm-night:var(--ui-bg-primary);--fm-graphite:var(--ui-bg-secondary);--fm-ink:var(--ui-text-primary);--fm-coral:var(--ui-accent);--fm-violet:var(--ui-accent);--fm-line:var(--ui-stroke-secondary)}
.fluid-app{display:grid;grid-template-rows:auto minmax(0,1fr);background:transparent;color:var(--fm-ink)}
.fluid-topbar{height:42px;display:flex;align-items:center;gap:18px;padding:0 clamp(12px,2cqw,24px);border-bottom:1px solid var(--fm-line);background:var(--fm-graphite)}
.fluid-wordmark{display:flex;align-items:center;gap:9px;border:0;background:transparent;color:var(--fm-ink);font:700 14px/1 inherit;letter-spacing:-.02em;cursor:pointer}.fluid-wordmark svg{color:var(--fm-coral)}
.fluid-primary-nav{display:flex;gap:3px;min-width:0}.fluid-primary-nav .fluid-nav-button{min-height:30px;padding:6px 12px;border-radius:4px;font-size:12px}.fluid-primary-nav .fluid-nav-button[data-active=true]{box-shadow:inset 0 -2px var(--fm-coral);background:transparent;color:var(--fm-ink)}
.fluid-content{padding:14px clamp(12px,2cqw,26px) 28px}.fluid-content-inner{max-width:1360px}.fluid-page-head{margin:16px 0 12px}.fluid-page-title{font-size:clamp(18px,1.8cqw,23px)}
.fluid-now-band{display:grid;grid-template-columns:112px minmax(240px,1fr) minmax(220px,.65fr);gap:clamp(16px,2cqw,28px);align-items:center;min-height:154px;padding:14px 0 18px;border-bottom:1px solid var(--fm-line)}
.fluid-orbit{position:relative;width:112px;min-width:112px;aspect-ratio:1;border-radius:50%;padding:9px;background:var(--fm-graphite);border:1px solid var(--fm-line);box-shadow:5px 8px 22px color-mix(in srgb,var(--ui-text-primary) 10%,transparent)}.fluid-orbit::after{content:'';position:absolute;inset:46%;border-radius:50%;background:var(--fm-night);border:1px solid var(--fm-line)}.fluid-orbit-art{width:100%;height:100%;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:var(--fm-night)}.fluid-orbit-art img{width:100%;height:100%;object-fit:cover}.fluid-orbit-art svg{width:54px;height:54px;color:var(--fm-violet)}.fluid-orbit[data-playing=true]{animation:fluid-spin 22s linear infinite}@keyframes fluid-spin{to{transform:rotate(360deg)}}
.fluid-source-chip{display:inline-flex;width:max-content;padding:3px 7px;border:1px solid var(--fm-line);border-radius:3px;color:var(--ui-text-secondary);font-size:9px;letter-spacing:.08em;text-transform:uppercase}.fluid-source-chip[data-source=radio]{color:var(--fm-coral)}.fluid-source-chip[data-source=spotify],.fluid-source-chip[data-source=youtube]{color:var(--fm-violet)}
.fluid-now-title{font-size:clamp(21px,2.4cqw,31px);line-height:1.08;letter-spacing:-.03em;margin:6px 0 4px}.fluid-now-subtitle{margin:0 0 10px;color:var(--ui-text-secondary);font-size:12px}.fluid-now-main .fluid-player-controls{justify-content:flex-start}.fluid-live-line{color:var(--fm-coral);font-size:11px;letter-spacing:.1em;text-transform:uppercase}.fluid-device-line{color:var(--ui-text-secondary);font-size:11px}
.fluid-up-next{align-self:stretch;padding:8px 12px;border-left:1px solid var(--fm-line);min-width:0}.fluid-next-row{width:100%;display:flex;align-items:center;gap:8px;padding:6px 0;border:0;border-bottom:1px solid var(--fm-line);background:transparent;color:inherit;text-align:left;cursor:pointer;min-width:0}.fluid-next-row>span{min-width:0}.fluid-next-row strong,.fluid-next-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fluid-next-row small{color:var(--ui-text-secondary);font-size:10px;margin-top:3px}
.fluid-secondary-tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid var(--fm-line);margin-bottom:14px}
.fluid-compact-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0}.fluid-panel-pad{padding:14px}.fluid-section-head{margin-bottom:10px}.fluid-searchbar{margin:10px 0}.fluid-history-time{font-size:9px;color:var(--ui-text-tertiary);white-space:nowrap}.fluid-youtube-results{margin-top:12px}.fluid-secondary-tabs button{flex:none;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--ui-text-secondary);padding:9px 12px;cursor:pointer}.fluid-secondary-tabs button[aria-selected=true]{color:var(--fm-ink);border-bottom-color:var(--fm-violet)}
.fluid-titlebar{position:relative;display:flex;align-items:center;gap:2px;width:210px;max-width:210px;height:22px;overflow:visible}.fluid-titlebar-summary{display:flex;align-items:center;gap:4px;flex:1 1 auto;min-width:0;max-width:176px;height:20px;padding:2px 5px!important;overflow:hidden}.fluid-titlebar>button:not(.fluid-titlebar-summary){flex:none}.fluid-titlebar-source{display:none}.fluid-titlebar-title{display:block;min-width:0;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:1}.fluid-title-popover{position:absolute;z-index:1000;right:0;top:calc(100% + 8px);width:min(390px,calc(100vw - 24px));max-height:min(680px,calc(100vh - 72px));overflow:auto;padding:18px;border:1px solid var(--fm-line);border-radius:8px;background:var(--ui-bg-elevated,var(--ui-bg-secondary));color:var(--fm-ink);box-shadow:8px 16px 46px color-mix(in srgb,var(--ui-text-primary) 16%,transparent)}.fluid-popover-now{display:grid;grid-template-columns:76px minmax(0,1fr);gap:14px;align-items:center}.fluid-orbit-small{width:76px;min-width:76px;padding:7px}.fluid-popover-title{display:block;font-size:17px;line-height:1.2;margin:7px 0 2px}.fluid-title-popover .fluid-player-controls{justify-content:flex-start;margin:16px 0}.fluid-title-popover .fluid-volume{margin:12px 0}.fluid-popover-upnext{margin-top:14px;border-top:1px solid var(--fm-line)}.fluid-popover-upnext h3{font-size:12px}.fluid-source-shortcuts,.fluid-mini-links{display:flex;gap:7px;flex-wrap:wrap;margin-top:16px}.fluid-youtube-title{display:block;margin:8px 0 16px}.fluid-youtube-compact{padding:0}.fluid-settings-grid{align-items:start}
.fluid-mini-player{background:transparent;color:var(--fm-ink)}.fluid-mini-player:not(.fluid-youtube-player){display:grid;grid-template-rows:minmax(0,1fr) 40px;height:100%;padding:6px 8px;overflow:hidden}.fluid-mini-body{min-height:0;overflow:hidden}.fluid-mini-body>.fluid-mini-summary{margin:0}.fluid-mini-body>.fluid-player-progress{margin:7px 0 0}.fluid-mini-body>.fluid-player-hint{margin:6px 0 0}.fluid-mini-body>.fluid-notice{margin:6px 0 0;padding:7px 8px;font-size:10px}.fluid-mini-controls{display:grid;grid-template-columns:auto minmax(90px,1fr) auto;align-items:center;gap:9px;min-width:0;border-top:1px solid var(--fm-line);padding-top:5px}.fluid-mini-controls .fluid-player-controls{justify-self:start;gap:5px}.fluid-mini-controls>.fluid-volume,.fluid-mini-controls>.fluid-mini-volume{width:auto;min-width:55px;margin:0}.fluid-mini-controls .fluid-volume-compact .fluid-range,.fluid-mini-controls .fluid-mini-volume .fluid-range{width:90px}.fluid-mini-controls>.fluid-mini-links{justify-self:end;justify-content:flex-end;flex-wrap:nowrap;gap:4px;margin:0}.fluid-mini-controls>.fluid-mini-links button{padding-inline:7px}.fluid-mini-art{border-radius:50%}.fluid-mini-links{justify-content:center}.fluid-youtube-player{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) 40px;gap:6px;height:100%;padding:6px 8px;overflow:hidden}.fluid-youtube-frame-wrap{min-width:0;min-height:0;height:100%;overflow:hidden;display:grid;place-items:stretch}.fluid-youtube-frame{display:block;width:100%;height:100%;min-height:0;border:1px solid var(--fm-line);border-radius:5px;background:var(--ui-bg-secondary)}.fluid-youtube-frame-loading{display:grid;place-content:center;text-align:center;color:var(--ui-text-secondary);font-size:12px}.fluid-youtube-side{min-width:0;min-height:0;overflow:hidden;padding:3px 2px}.fluid-youtube-summary{margin:0}.fluid-youtube-summary .fluid-mini-title,.fluid-youtube-summary .fluid-mini-subtitle{text-align:left}.fluid-youtube-summary .fluid-mini-title{font-size:14px;line-height:1.18;margin-top:5px}.fluid-youtube-summary .fluid-mini-subtitle{font-size:10px;line-height:1.35;margin:5px 0 0}.fluid-youtube-side .fluid-notice{margin:8px 0 0;padding:7px 8px;font-size:10px}.fluid-youtube-controls{grid-column:1/-1;display:grid;grid-template-columns:1fr minmax(110px,.7fr) 1fr;align-items:center;gap:10px;min-width:0;border-top:1px solid var(--fm-line);padding-top:5px}.fluid-youtube-controls .fluid-player-controls{justify-self:start;gap:6px}.fluid-mini-volume{display:flex;align-items:center;gap:7px;min-width:0}.fluid-youtube-controls .fluid-mini-links{justify-self:end;justify-content:flex-end;flex-wrap:nowrap;gap:5px;margin:0}
@container mini (max-width:360px){.fluid-mini-controls{grid-template-columns:auto minmax(70px,1fr) auto}.fluid-mini-controls .fluid-mini-links button{padding-inline:7px}}
@container mini (max-width:280px){.fluid-mini-controls{grid-template-columns:auto minmax(50px,1fr) auto}.fluid-mini-controls .fluid-volume-value{display:none}.fluid-mini-controls>.fluid-mini-links button{padding-inline:6px}}
@container fluid (max-width:980px){.fluid-now-band{grid-template-columns:96px minmax(0,1fr)}.fluid-up-next{grid-column:1/-1;border-left:0;border-top:1px solid var(--fm-line);padding:8px 0}.fluid-orbit{width:96px;min-width:96px}}
@container fluid (max-width:720px){.fluid-topbar{gap:10px;padding:0 8px}.fluid-wordmark span{display:none}.fluid-primary-nav{flex:1;justify-content:space-between}.fluid-primary-nav .fluid-nav-button{padding:5px 7px}.fluid-now-band{grid-template-columns:72px minmax(0,1fr);gap:12px;min-height:0}.fluid-orbit{width:72px;min-width:72px;padding:6px}.fluid-now-title{font-size:22px}.fluid-content{padding:12px 10px 24px}.fluid-page-head{margin-top:12px}.fluid-track-row{grid-template-columns:20px 36px minmax(0,1fr);}.fluid-track-row>.fluid-row-actions{grid-column:3;justify-content:flex-start;flex-wrap:wrap}.fluid-track-row>.fluid-source-tag,.fluid-track-row>.fluid-track-duration{display:none}}
@container fluid (max-width:460px){.fluid-topbar{height:auto;min-height:42px}.fluid-primary-nav .fluid-nav-button{font-size:11px}.fluid-now-band{grid-template-columns:72px minmax(0,1fr);padding-top:10px}.fluid-orbit{width:72px;min-width:72px}.fluid-up-next{grid-column:1/-1}.fluid-now-main .fluid-volume{width:100%}.fluid-page-title{font-size:20px}.fluid-log-row{grid-template-columns:1fr}.fluid-log-row pre{grid-column:1}.fluid-titlebar-source{display:none}}
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
    trash: 'M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14', logs: 'M5 5h14M5 10h14M5 15h9M5 20h12', settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 13.5l2 1.5-2 3.5-2.4-1a8 8 0 0 1-2.1 1.2L14.2 21h-4.4l-.3-2.3a8 8 0 0 1-2.1-1.2l-2.4 1L3 15l2-1.5a8 8 0 0 1 0-3L3 9l2-3.5 2.4 1a8 8 0 0 1 2.1-1.2L9.8 3h4.4l.3 2.3a8 8 0 0 1 2.1 1.2l2.4-1L21 9l-2 1.5a8 8 0 0 1 0 3z'
  }
  return jsx('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: kind === 'play' || kind === 'next' || kind === 'previous' ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, children: jsx('path', { d: paths[kind] || paths.music }) })
}

function Action({ label, kind, onClick, disabled = false, compact = false, primary = false }) {
  return jsx(Button, { type: 'button', variant: primary ? 'default' : 'ghost', size: compact ? 'icon-xs' : 'sm', disabled, onClick, 'aria-label': label, title: label, children: compact ? jsx(Icon, { kind }) : jsxs('span', { children: [jsx(Icon, { kind }), ' ', label] }) })
}

/* CONTROLLER_START */
function createController(ctx) {
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
  let unmutedVolume = clampVolume(ctx.storage.get('unmutedVolume', .5)) || .5
  let volumeTimer = null
  let volumeVersion = 0
  let spotifyStartedUri = ''
  let localRefreshVersion = 0
  const status = atom('idle')
  const message = atom('')
  const logs = atom([])
  const spotify = atom({ connected: false, title: '', subtitle: '', playing: false })
  const spotifyAuth = atom({ state: 'loading', authenticated: false, needsClientId: false, detail: '' })
  const spotifyDevices = atom([])
  const titlebarOpen = atom(false)
  const youtube = atom({ status: 'closed', title: 'YouTube', playing: false, nextAvailable: false, error: '' })
  const progress = atom({ positionMs: 0, durationMs: 0 })
  const playlists = atom(storedPlaylists.playlists)
  const localTracks = atom([])
  const sessionTracks = atom([])
  const localRoots = atom([])
  const history = atom([])
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
      return response && Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response
    } catch (error) {
      const failure = new Error(userFacingError(error, 'FluidMusic could not reach its backend. Retry after Hermes finishes reloading.'))
      failure.statusCode = Number(error?.statusCode) || 0
      addLog('error', 'api.failure', { requestId, method, route, status: failure.statusCode, durationMs: Date.now() - started, error: failure.message, ...diagnosticBody(options?.body) })
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
  const refreshHistory = async () => {
    const data = await request('/history?limit=500&offset=0')
    const entries = (Array.isArray(data?.items) ? data.items : []).map(entry => {
      const item = normalizeQueueItem(entry?.item)
      return item ? { id: entry.id, playedAt: safeText(entry.played_at), item } : null
    }).filter(Boolean)
    history.set(entries)
    return entries
  }
  const clearHistory = async () => {
    await request('/history', { method: 'DELETE' })
    history.set([])
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
      requestHermesQueueAdvance('projected-end', anchor.uri)
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
    const element = new Audio()
    audio = element
    audioSource = 'radio'
    element.preload = 'none'
    element.volume = volume.get()
    progress.set({ positionMs: 0, durationMs: 0 })
    status.set('loading')
    const isCurrent = () => !disposed && generation === radioGeneration && element === audio
    const finishFailure = () => {
      if (!isCurrent()) return

      status.set('error')
      message.set('This HTTPS radio stream could not connect. Choose another station or retry.')
    }
    radioTimeout = setTimeout(finishFailure, 15000)
    element.addEventListener('playing', () => {
      if (!isCurrent()) return
      clearTimeout(radioTimeout)
      radioTimeout = null
      status.set('playing')
      message.set('')
      if (!historyRecorded) { historyRecorded = true; recordHistory(item) }
    })
    element.addEventListener('pause', () => { if (isCurrent() && !element.ended && status.get() === 'playing') status.set('paused') })
    element.addEventListener('error', finishFailure)
    element.addEventListener('ended', finishFailure)
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

      status.set('playing')
      message.set('')
      if (!historyRecorded) { historyRecorded = true; recordHistory(item) }
    })
    element.addEventListener('loadedmetadata', () => {
      if (isCurrent()) progress.set({ positionMs: Math.max(0, Number(element.currentTime) || 0) * 1000, durationMs: Math.max(0, Number(element.duration) || 0) * 1000 })
    })
    element.addEventListener('timeupdate', () => {
      if (isCurrent()) progress.set({ positionMs: Math.max(0, Number(element.currentTime) || 0) * 1000, durationMs: Math.max(0, Number(element.duration) || 0) * 1000 })
    })
    element.addEventListener('pause', () => { if (isCurrent() && !element.ended) status.set('paused') })
    element.addEventListener('ended', () => { if (isCurrent()) void next() })
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
      return snapshot
    } catch (error) {
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
      return snapshot
    } catch (error) {
      const snapshot = { state: 'failed', authenticated: false, needsClientId: false, detail: error?.message || 'Spotify authentication status is unavailable.' }
      spotifyAuth.set(snapshot)
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
    const [rootsData, tracksData] = await Promise.all([
      request('/local/roots'),
      request('/local/tracks?include_missing=true&limit=5000&offset=0')
    ])
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
        if (item) opened.push(item)
        else URL.revokeObjectURL(objectUrl)
      })
    } catch (error) { opened.forEach(revokeLocal); throw new Error(userFacingError(error, 'Those files could not be opened.')) }
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
      youtube.set({ status: 'ready', url: item.url, title: item.title, subtitle: item.subtitle, artwork: item.artwork, durationMs: item.durationMs, playing: false, ended: false, error: '', item })
      progress.set({ positionMs: 0, durationMs: item.durationMs })
      status.set('paused')
      message.set('YouTube transport is in the FluidMusic player pane.')
      recordHistory(item)
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
        message.set('YouTube transport is in the FluidMusic player pane.')
        if (token === transition) status.set('paused')
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

  function add(item, play = false) {
    const normalized = normalizeQueueItem(item)
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
      await stopActive(current())
      if (token !== transition) return false
      queue.set(playable.map(item => ({ ...item })))
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
    const before = queue.get().length
    queue.set([...queue.get(), ...playable.map(item => ({ ...item }))])
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
      try {
        const data = await request('/youtube/resolve', { method: 'POST', body: { url: item.url } })
        const resolved = normalizeQueueItem(data?.item)
        if (!resolved) continue
        queue.set(queue.get().map(value => value.id === item.id ? resolved : value))
        if (current()?.id === resolved.id) youtube.set({ ...youtube.get(), title: resolved.title, subtitle: resolved.subtitle, artwork: resolved.artwork, item: resolved })
        changed = true
      } catch { /* Old queue labels remain usable when metadata is temporarily unavailable. */ }
    }
    if (changed) persist()
  }

  const spotifyTrack = track => normalizeQueueItem({
    source: 'spotify', id: track?.id, title: track?.name, subtitle: (track?.artists || []).map(artist => artist.name).join(', '), uri: track?.uri,
    contextUri: track?.album?.uri, artwork: track?.album?.images?.[0]?.url, album: track?.album?.name, durationMs: track?.duration_ms, kind: 'track', explicit: track?.explicit
  })

  function reportYouTubeState(state) {
    // Embed bridge adapter: surface relay reports bind to the exact selected
    // occurrence and the current transition generation; stale or foreign
    // reports are ignored, and completion advances the queue exactly once.
    if (!state || typeof state !== 'object' || disposed) return false
    const item = current()
    if (!item || item.source !== 'youtube') return false
    const expectedVideoId = safeText(item.id).replace(/^youtube:/, '')
    if (state.videoId && state.videoId !== expectedVideoId) return false
    if (state.kind === 'ready') {
      youtube.set({ ...youtube.get(), status: 'ready', error: '' })
      return true
    }
    if (state.kind !== 'state') return false
    const guard = youtubeQueueGuard
    if (guard && guard.token !== transition) return false
    youtube.set({ ...youtube.get(), playing: Boolean(state.playing), ended: Boolean(state.ended) })
    progress.set({ positionMs: Math.max(0, Number(state.positionMs) || 0), durationMs: Math.max(0, Number(state.durationMs) || 0) })
    status.set(state.playing ? 'playing' : 'paused')
    if (state.ended) requestYouTubeQueueAdvance()
    return true
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
    return { tracks, albums, playlists: spotifyPlaylists, artists }
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
    const tracks = data.items.map((entry, at) => {
      const track = spotifyTrack(entry?.track || entry?.item || entry)
      if (!track) return null
      return { ...track, contextUri: `spotify:playlist:${id}`, contextPosition: start + at }
    }).filter(Boolean)
    const total = Number.isFinite(data.total) ? Math.max(0, data.total) : start + data.items.length
    const nextOffset = start + data.items.length
    return { playlist, tracks, total, next: Boolean(data.next) || nextOffset < total, nextOffset, skipped: data.items.length - tracks.length }
  }

  function playSpotifyPlaylistTrack(queueItem, track) {
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
  void refreshQueuedYouTubeMetadata()
  ctx.onDispose(() => {
    disposed = true
    transition += 1
    clearInterval(spotifyTimer)
    clearInterval(spotifyProgressTimer)
    clearAuthPoll()
    clearTimeout(volumeTimer)
    stopInternalAudio()
    new Set([...queue.get(), ...localRegistry.values()]).forEach(revokeLocal)

  })
  return {
    workspaceView, setWorkspaceView, selectedPlaylist, selectPlaylist, undoState, undoPlaylistEdit, toggleMute, titlebarOpen,
    playlistItems, enqueuePlaylist, saveQueueAsPlaylist, addManyToPlaylist, removePlaylistItems, deduplicatePlaylist, exportPlaylists, importPlaylists,
    queue, index, favorites, volume, status, message, logs, spotify, spotifyAuth, spotifyDevices, progress, playlists, localTracks, localRoots, history, shuffle, repeat, spotifyAutoplay, youtube,
    current, add, remove, move, clearQueue, resetSavedRadio, next, previous, playAt, toggle, seekTo, setVolume, setShuffle, setRepeat, setSpotifyAutoplay,
    toggleFavorite, refreshSpotify, refreshSpotifyAuth, refreshSpotifyDevices, startSpotifyAuth, transferSpotifyDevice, addYouTubeUrl, addYouTubeItem, searchYouTube, resolveYouTubeEmbedUrl, reportYouTubeState,
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
        item.unavailable ? 'Missing file · rescan its folder' : item.subtitle || sourceLabel(item),
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
        onClick: onPlay || (() => controller.add(item, true)),
      }),
      h(Action, {
        compact: true,
        kind: 'plus',
        label: `Add ${item.title} to queue`,
        disabled: item.unavailable,
        onClick: () => {
          if (controller.add(item)) controller.message.set(`Added “${item.title}” to the queue.`)
        },
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
      setTracks((previous) => (more ? [...previous, ...page.tracks] : page.tracks))
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
          `${tracks.length} loaded${total ? ` / ${total} entries` : ''}${skipped ? ` · ${skipped} unsupported entries skipped` : ''}. Play starts at that position in Spotify.`,
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
          controller,
          item: track,
          at: track.contextPosition,
          key: `${track.uri}-${track.contextPosition}`,
          onPlay: () => void controller.playSpotifyPlaylistTrack(item, track),
        }),
      ),
    ),
    busy && h('p', { className: 'fluid-muted', role: 'status' }, 'Loading songs…'),
    !busy &&
      !error &&
      !tracks.length &&
      h(
        Empty,
        { title: 'No supported songs found' },
        'Spotify may restrict this playlist or contain unavailable entries.',
      ),
    next &&
      h(WorkspaceButton, { disabled: busy, onClick: () => void load(true) }, 'Load more songs'),
  )
}
function QueueEntry({ controller, item, at, current, status, length }) {
  const collection = /^spotify:playlist:/.test(item.uri || '')
  const [expanded, setExpanded] = useState(collection && at === current)
  return h(
    'div',
    { className: 'fluid-queue-entry' },
    h(
      'div',
      { className: 'fluid-queue-row', 'data-current': at === current },
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
function QueueList({ controller }) {
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
    devices = useValue(controller.spotifyDevices)
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
    [searched, setSearched] = useState('')
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  const search = async (event) => {
    event?.preventDefault()
    if (busy || query.trim().length < 2 || !auth.authenticated) return
    const token = ++request.current,
      term = query.trim()
    setBusy(true)
    setError('')
    try {
      const data = await controller.searchSpotifyCatalog(term)
      if (token === request.current) {
        setResults(data)
        setSearched(term)
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
                  h(TrackRow, { key: `${item.id}-${at}`, controller, item, at }),
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
                  results[kind].map((item) =>
                    kind === 'artists'
                      ? h(
                          'article',
                          { className: 'fluid-media-tile', key: item.id },
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
                      : h(MediaTile, { controller, item, key: item.id }),
                  ),
                ),
              ),
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
      if (playlist) setDetail((previous) => (more ? [...previous, ...data.tracks] : data.tracks))
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
                detail.map((item, at) => h(TrackRow, { key: `${item.id}-${at}`, controller, item, at })),
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
              onPlay: () => {
                const queued = controller.queue.get().findIndex((row) => row.id === item.id)
                if (queued >= 0) void controller.playAt(queued)
                else controller.add(item, true)
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
            filtered.slice(0, limit).map((item, at) => h(TrackRow, { controller, item, at, key: item.id })),
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
    h('div', { className: 'fluid-track-list' }, items.map((item, at) => h(TrackRow, { controller, item, at, key: `${item.id}-${at}`, hideSave: true, onPlay: () => void controller.playPlaylist(playlist.id, at), extraActions: null }))),
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
    [clear, setClear] = useState(false)
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

        h(
          WorkspaceButton,
          { danger: true, disabled: !queue.length, onClick: () => setClear(true) },
          'Clear queue',
        ),
      ),
    }),
    h(QueueList, { controller }),

    clear &&
      h(
        Confirm,
        { title: 'Clear queue', onClose: () => setClear(false), action: () => controller.clearQueue() },
        'Stop playback and clear this session’s queue? Your saved playlists and files are not changed.',
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

function MiniControlBar({ controller, playing, onToggle, onVolumeChange, disabled = false }) {
  const volume = useValue(controller.volume)
  const changeVolume = event => {
    const next = clampVolume(event.target.value)
    controller.setVolume(next)
    onVolumeChange?.(next)
  }
  return h('footer', { className: 'fluid-mini-controls', 'aria-label': 'Playback controls' },
    h('div', { className: 'fluid-player-controls' },
      h(Action, { compact: true, kind: 'previous', label: 'Previous', onClick: () => void controller.previous() }),
      h(WorkspaceButton, { primary: true, onClick: onToggle, disabled, 'aria-label': playing ? 'Pause' : 'Play' }, h(Icon, { kind: playing ? 'pause' : 'play' })),
      h(Action, { compact: true, kind: 'next', label: 'Next', onClick: () => void controller.next() }),
    ),
    h('label', { className: 'fluid-mini-volume' }, h(Icon, { kind: volume === 0 ? 'mute' : 'volume' }), h('input', { className: 'fluid-range', type: 'range', min: 0, max: 1, step: .01, value: volume, onChange: changeVolume, 'aria-label': 'Volume' })),
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
      setPlaying(parsed.playing)
      controller.reportYouTubeState(parsed)
    }
    window.addEventListener('message', receive)
    const handshake = setInterval(() => {
      const frame = frameRef.current
      const origin = embedFrameOrigin(frame?.src)
      if (frame?.contentWindow && origin) frame.contentWindow.postMessage(youTubeListeningMessage(), origin)
    }, 500)
    return () => { live = false; window.removeEventListener('message', receive); clearInterval(handshake) }
  }, [videoId, frameRef])
  const toggle = () => { send(playing ? 'pauseVideo' : 'playVideo') }
  return h(MiniControlBar, { controller, playing: playing && ready, disabled: !ready, onToggle: toggle, onVolumeChange: next => send('setVolume', [Math.round(next * 100)]) })
}

function MiniPlayer({ controller }) {
  const queue = useValue(controller.queue)
  const at = useValue(controller.index)
  const spotify = useValue(controller.spotify)
  const status = useValue(controller.status)
  const progress = useValue(controller.progress)
  const item = queue[at]
  const capabilities = mediaCapabilities(item)
  const display = item?.source === 'spotify' && spotify.title
    ? { ...item, title: spotify.title, subtitle: spotify.subtitle, artwork: spotify.artwork }
    : item
  const embedUrl = youtubeEmbedUrl(item)
  const youtubeFrameRef = useRef(null)
  if (embedUrl) {
    return h(
      'section',
      { className: 'fluid-mini-player fluid-youtube-player', 'aria-label': 'FluidMusic YouTube player' },
      h('div', { className: 'fluid-youtube-frame-wrap' },
        h(EmbeddedYouTubeFrame, { controller, item, title: display?.title || 'YouTube video', frameRef: youtubeFrameRef }),
      ),
      h(YouTubeTransport, { controller, frameRef: youtubeFrameRef, item }),
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
    results.length > 0 && h('div', { className: 'fluid-track-list fluid-youtube-results' }, results.map((item, at) => h(TrackRow, { controller, item, at, key: `${item.id}-${at}`, hideSave: true, onPlay: () => controller.addYouTubeItem(item, true) }))),
  )
}

function HistoryPage({ controller }) {
  const entries = useValue(controller.history)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void controller.refreshHistory().catch(() => {}) }, [controller])
  const clear = async () => {
    setBusy(true)
    try { await controller.clearHistory() } finally { setBusy(false) }
  }
  return h('section', {},
    h('div', { className: 'fluid-compact-toolbar' }, h('p', { className: 'fluid-muted' }, `${entries.length} recent play${entries.length === 1 ? '' : 's'}`), h(WorkspaceButton, { disabled: busy || !entries.length, onClick: clear }, busy ? 'Clearing…' : 'Clear history')),
    entries.length ? h('div', { className: 'fluid-track-list' }, entries.map((entry, at) => h(TrackRow, {
      controller,
      item: entry.item,
      at,
      key: entry.id,
      hideSave: true,
      onPlay: () => controller.add(entry.item, true),
      extraActions: h('time', { className: 'fluid-history-time', dateTime: entry.playedAt }, entry.playedAt ? new Date(entry.playedAt).toLocaleString() : ''),
    }))) : h(Empty, { title: 'Nothing played yet' }, 'Spotify, radio, local music, and YouTube plays will appear here.'),
  )
}

function NowPlayingBand({ controller }) {
  const queue = useValue(controller.queue)
  const at = useValue(controller.index)
  const status = useValue(controller.status)
  const spotify = useValue(controller.spotify)
  const progress = useValue(controller.progress)
  const item = queue[at]
  const capabilities = mediaCapabilities(item)
  const display = item?.source === 'spotify' && spotify.title ? { ...item, title: spotify.title, subtitle: spotify.subtitle, artwork: spotify.artwork } : item
  const upcoming = queue.slice(at + 1, at + 4)
  return h('section', { className: 'fluid-now-band', 'aria-label': 'Now playing' },
    h('div', { className: 'fluid-orbit', 'data-playing': status === 'playing' }, h(Artwork, { item: display, className: 'fluid-orbit-art' })),
    h('div', { className: 'fluid-now-main' },
      h('span', { className: 'fluid-source-chip', 'data-source': item?.source || 'idle' }, item ? sourceLabel(item) : 'FluidMusic'),
      h('h1', { className: 'fluid-now-title' }, display?.title || 'Choose what plays next'),
      h('p', { className: 'fluid-now-subtitle' }, display?.subtitle || 'Spotify, live radio, local music, and embedded YouTube playback.'),
      capabilities.play && h(Transport, { controller }),
      capabilities.seek && progress.durationMs > 0 ? h(SeekBar, { controller }) : h('p', { className: 'fluid-live-line' }, item?.source === 'radio' ? 'LIVE · station broadcast' : status),
      capabilities.volume && h(VolumeControl, { controller }),
      item?.source === 'spotify' && h('p', { className: 'fluid-device-line' }, spotify.device ? `Playing on ${spotify.device}` : 'Choose an available Spotify Connect device in Settings.'),
    ),
    h('aside', { className: 'fluid-up-next', 'aria-label': 'Up next preview' },
      h('div', { className: 'fluid-section-head' }, h('h2', { className: 'fluid-section-title' }, 'Up Next'), h('span', {}, `${Math.max(0, queue.length - at - 1)}`)),
      upcoming.length ? upcoming.map((next, offset) => h('button', { type: 'button', className: 'fluid-next-row', key: `${next.id}-${offset}`, onClick: () => void controller.playAt(at + offset + 1) }, h(Artwork, { item: next, className: 'fluid-mini-cover' }), h('span', {}, h('strong', {}, next.title), h('small', {}, sourceLabel(next))))) : h('p', { className: 'fluid-muted' }, 'Nothing queued after this.'),
      h('div', { className: 'fluid-actions' }, h(WorkspaceButton, { onClick: () => controller.setWorkspaceView('queue') }, 'Open Queue')),
    ),
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

function SettingsPage({ controller }) {
  const [tab, setTab] = useState('providers')
  const autoplay = useValue(controller.spotifyAutoplay)
  return h('div', {}, h(PageHead, { title: 'Settings', subtitle: 'Connections, playback behavior, and diagnostics.' }), h(SecondaryTabs, { label: 'Settings sections', value: tab, onChange: setTab, items: [['providers', 'Providers'], ['playback', 'Playback'], ['diagnostics', 'Diagnostics']] }),
    tab === 'providers' ? h('div', { className: 'fluid-settings-grid' }, h(SpotifyConnection, { controller }), h(YouTubeControls, { controller })) :
    tab === 'playback' ? h('section', { className: 'fluid-panel fluid-panel-pad' }, h('h2', { className: 'fluid-section-title' }, 'Playback'), h(VolumeControl, { controller }), h('label', { className: 'fluid-switch-row' }, h('input', { type: 'checkbox', checked: autoplay, onChange: event => controller.setSpotifyAutoplay(event.target.checked) }), h('span', {}, h('strong', {}, 'Let Spotify continue after a track'), h('small', {}, 'Otherwise FluidMusic advances its temporary Up Next queue.')))) : h(LogsPage, { controller }))
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
  return h('div', { className: 'fluid-root' }, h('main', { className: 'fluid-app' }, h(TopNavigation, { controller, view }), h('section', { className: 'fluid-content' }, h('div', { className: 'fluid-content-inner' }, h(Notice, { controller }), h(NowPlayingBand, { controller }), h(Page, { controller })))))
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
  return h('div', { ref: popoverRef, className: 'fluid-title-popover', role: 'dialog', 'aria-label': 'FluidMusic quick controls' },
    h('div', { className: 'fluid-popover-now' }, h('div', { className: 'fluid-orbit fluid-orbit-small', 'data-playing': state === 'playing' }, h(Artwork, { item: display, className: 'fluid-orbit-art' })), h('div', { className: 'fluid-row-copy' }, h('span', { className: 'fluid-source-chip', 'data-source': item?.source || 'idle' }, item ? sourceLabel(item) : 'FluidMusic'), h('strong', { className: 'fluid-popover-title' }, display?.title || 'Nothing selected'), h('span', { className: 'fluid-row-detail' }, display?.subtitle || 'Open Media to choose something.'))),
    item && h(Transport, { controller }),
    capabilities.seek && progress.durationMs > 0 ? h(SeekBar, { controller }) : item?.source === 'radio' && h('p', { className: 'fluid-live-line' }, 'LIVE'),
    capabilities.volume && h(VolumeControl, { controller }),
    item?.source === 'spotify' && h('p', { className: 'fluid-device-line' }, spotify.device || 'No confirmed Connect device'),
    upcoming.length > 0 && h('section', { className: 'fluid-popover-upnext' }, h('h3', {}, 'Up Next'), upcoming.map(next => h('div', { className: 'fluid-next-row', key: next.id }, h('span', {}, h('strong', {}, next.title), h('small', {}, sourceLabel(next)))))),
    h(Notice, { controller }),
    h('div', { className: 'fluid-source-shortcuts' }, h(WorkspaceButton, { onClick: () => { controller.setWorkspaceView('browse'); host.navigate(ROUTE) } }, 'YouTube in Media'), h(WorkspaceButton, { onClick: () => { controller.setWorkspaceView('queue'); host.navigate(ROUTE) } }, 'Open Queue'), h(WorkspaceButton, { onClick: () => host.navigate(ROUTE) }, 'Open Media')),
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
    h(Button, { ref: triggerRef, type: 'button', variant: 'ghost', size: 'micro', className: 'fluid-titlebar-summary', 'aria-expanded': open, 'aria-haspopup': 'dialog', onClick: () => controller.titlebarOpen.set(!open) }, h('span', { className: 'fluid-status-dot', 'data-state': state }), h('span', { className: 'fluid-titlebar-source' }, item ? sourceLabel(item) : 'Media'), h('span', { className: 'fluid-titlebar-title' }, title)),
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
          h('p', { className: 'fluid-error' }, `FluidMusic cannot start on this Hermes build: missing plugin SDK exports (${SDK_MISSING.join(', ')}). Update Hermes, then reopen Media.`)))
      if (ROUTES_AREA != null) {
        ctx.register({ id: 'media-route', area: ROUTES_AREA, data: { path: ROUTE }, render: renderFallback })
      } else {
        ctx.register({ id: 'media-sdk-fallback', area: 'panes', title: 'FluidMusic', data: { placement: 'right', width: '320px', height: '160px' }, render: renderFallback })
      }
      return
    }
    const controller = createController(ctx)
    ctx.register({ id: 'media-route', area: ROUTES_AREA, data: { path: ROUTE }, render: () => h(MediaPage, { controller }) })
    ctx.register({ id: 'media-titlebar', area: TITLEBAR_AREAS.right, order: 18, render: () => h(TitlebarPlayer, { controller }) })
    ctx.register({ id: 'mini-player', area: 'panes', title: 'FluidMusic player', data: { placement: 'right', width: '300px', height: '420px' }, render: () => h(MiniPlayer, { controller }) })
  },
}