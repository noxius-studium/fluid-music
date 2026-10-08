
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

function normalizeQueueItem(value) {
  if (!value || typeof value !== 'object') return null
  const source = value.source
  if (!['spotify', 'radio', 'local'].includes(source)) return null
  const title = safeText(value.title, source === 'radio' ? 'Untitled station' : source === 'local' ? 'Untitled local track' : 'Untitled track')
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
  return ['home', 'search', 'library', 'radio', 'local', 'playlists', 'queue', 'settings', 'logs'].includes(value) ? value : 'home'
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
      const items = Array.isArray(entry?.items) ? entry.items.map(item => serializePlaylistItem(item)).filter(Boolean) : []
      return { id: safeText(entry?.id, makeId('playlist', `${at}`)), name: safeText(entry?.name, 'Untitled playlist'), description: safeText(entry?.description), createdAt: safeText(entry?.createdAt), updatedAt: safeText(entry?.updatedAt), items }
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

// Log-frequency bands over the useful audible range, excluding DC and unused ultrasonic bins.
function spectrumBands(binCount, sampleRate, count) {
  if (!Number.isInteger(binCount) || binCount < 1 || !Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isInteger(count) || count < 1) return []
  const binHz = sampleRate / (2 * binCount)
  const maximumHz = Math.min(16000, sampleRate / 2)
  const minimumHz = Math.min(maximumHz, Math.max(40, binHz))
  const ratio = maximumHz / minimumHz
  return Array.from({ length: count }, (_, at) => {
    const low = Math.min(binCount - 1, Math.floor(minimumHz * Math.pow(ratio, at / count) / binHz))
    const high = Math.min(binCount, Math.max(low + 1, Math.ceil(minimumHz * Math.pow(ratio, (at + 1) / count) / binHz)))
    return { low, high }
  })
}

const RADIO_PRESETS = [
  { source: 'radio', id: 'fluid-chillsynth', title: 'Chillsynth', subtitle: 'Soft focus · warm synths', streamUrl: 'https://stream.nightride.fm/chillsynth.mp3', homepage: 'https://nightride.fm/?station=chillsynth' },
  { source: 'radio', id: 'fluid-nightride', title: 'Nightride', subtitle: 'Synthwave · after hours', streamUrl: 'https://stream.nightride.fm/nightride.mp3', homepage: 'https://nightride.fm/' },
  { source: 'radio', id: 'fluid-paradise', title: 'Radio Paradise', subtitle: 'Eclectic · human selected', streamUrl: 'https://stream.radioparadise.com/aac-128', homepage: 'https://radioparadise.com/' }
]
/* PURE_FUNCTIONS_END */