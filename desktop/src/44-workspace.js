function YouTubeControls({ controller, compact = false }) {
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
  const total = useValue(controller.historyTotal)
  const [confirmClear, setConfirmClear] = useState(false)
  useEffect(() => { void controller.refreshHistory().catch(() => {}) }, [controller])
  return h('section', {},
    h('div', { className: 'fluid-compact-toolbar' },
      h('p', { className: 'fluid-muted' }, `${entries.length}${total > entries.length ? ` of ${total}` : ''} recent play${entries.length === 1 ? '' : 's'}`),
      h(WorkspaceButton, { disabled: !entries.length, onClick: () => setConfirmClear(true) }, 'Clear history')),
    entries.length ? h('div', { className: 'fluid-track-list' }, entries.map((entry, at) => h(TrackRow, {
      controller,
      item: entry.item,
      at,
      key: entry.id,
      hideSave: true,
      onPlay: () => controller.add(entry.item, true),
      extraActions: h('time', { className: 'fluid-history-time', dateTime: entry.playedAt }, entry.playedAt ? new Date(entry.playedAt).toLocaleString() : ''),
    }))) : h(Empty, { title: 'Nothing played yet' }, 'Spotify, radio, local music, and YouTube plays will appear here.'),
    confirmClear && h(Confirm, {
      title: 'Clear history',
      action: () => controller.clearHistory(),
      onClose: () => setConfirmClear(false),
    }, `This removes ${entries.length} recorded play${entries.length === 1 ? '' : 's'} from this profile's listening history. Queues, collections, and provider history are not affected.`),
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
    const controller = createController(ctx, { watchCapability: youTubeWatchCapability(SDK) })
    ctx.register({ id: 'media-route', area: ROUTES_AREA, data: { path: ROUTE }, render: () => h(MediaPage, { controller }) })
    ctx.register({ id: 'media-titlebar', area: TITLEBAR_AREAS.right, order: 18, render: () => h(TitlebarPlayer, { controller }) })
    ctx.register({ id: 'mini-player', area: 'panes', title: 'FluidMusic player', data: { placement: 'right', width: '300px', height: '420px' }, render: () => h(MiniPlayer, { controller }) })
  },
}