function LogsPage({ controller }) {
  const entries = useValue(controller.logs),
    [query, setQuery] = useState('')
  const rows = entries.filter((entry) =>
    `${entry.event} ${entry.level} ${JSON.stringify(entry.detail)}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  return h(
    'div',
    {},
    h(PageHead, {
      kicker: 'Diagnostics',
      title: `Logs · ${entries.length}`,
      subtitle: 'Provider requests, failures, and confirmed playback transitions. No credentials.',
      actions: h(
        WorkspaceButton,
        { disabled: !entries.length, onClick: () => controller.clearLogs() },
        'Clear logs',
      ),
    }),
    h('input', {
      className: 'fluid-input',
      type: 'search',
      value: query,
      onChange: (event) => setQuery(event.target.value),
      'aria-label': 'Filter diagnostics',
      placeholder: 'Filter events…',
    }),
    h(
      'div',
      { className: 'fluid-log-list' },
      rows.map((entry) =>
        h(
          'article',
          { className: 'fluid-log-row', 'data-level': entry.level, key: entry.id },
          h('time', { dateTime: entry.at }, new Date(entry.at).toLocaleTimeString()),
          h('span', { className: 'fluid-log-level' }, entry.level),
          h('strong', {}, entry.event),
          h('pre', {}, JSON.stringify(entry.detail, null, 2)),
        ),
      ),
    ),
    !rows.length && h(Empty, { title: 'No matching events' }, 'Use the player to record provider activity.'),
  )
}
function SettingsPage({ controller }) {
  const autoplay = useValue(controller.spotifyAutoplay),
    shuffle = useValue(controller.shuffle),
    repeat = useValue(controller.repeat),
    queue = useValue(controller.queue),
    at = useValue(controller.index)
  const item = queue[at],
    polling = controller.polling()
  const run = (work) => void work().catch((error) => controller.message.set(userFacingError(error)))
  return h(
    'div',
    {},
    h(PageHead, {
      kicker: 'Make it yours',
      title: 'Playback & connections.',
      subtitle: 'Choose where music plays and what happens next.',
    }),
    h(
      'div',
      { className: 'fluid-settings-grid' },
      h(SpotifyConnection, { controller }),
      h(
        'section',
        { className: 'fluid-panel fluid-panel-pad' },
        h('h2', { className: 'fluid-section-title' }, 'Volume & visuals'),
        h(
          'p',
          { className: 'fluid-muted' },
          'Volume is always available in the status bar, even outside Media.',
        ),
        h(VolumeControl, { controller }),
        h(VisualizerSettings, { controller }),
        h('hr', {}),
        h('h2', { className: 'fluid-section-title' }, 'Spotify continuation'),
        h(
          'label',
          { className: 'fluid-switch-row' },
          h('input', {
            type: 'checkbox',
            checked: autoplay,
            onChange: (event) => controller.setSpotifyAutoplay(event.target.checked),
          }),
          h(
            'span',
            {},
            h('strong', {}, 'Let Spotify continue after a track'),
            h(
              'small',
              {},
              autoplay
                ? 'Spotify controls the next song in its context.'
                : 'FluidMusic advances to the next item in your queue.',
            ),
          ),
        ),
        item?.source === 'spotify' &&
          h(
            'div',
            { className: 'fluid-actions' },
            h(
              WorkspaceButton,
              { onClick: () => run(() => controller.setShuffle(!shuffle)), 'aria-pressed': shuffle },
              shuffle ? 'Shuffle on' : 'Shuffle off',
            ),
            h(
              WorkspaceButton,
              {
                onClick: () =>
                  run(() =>
                    controller.setRepeat(
                      repeat === 'off' ? 'context' : repeat === 'context' ? 'track' : 'off',
                    ),
                  ),
              },
              `Repeat: ${repeat}`,
            ),
          ),
        h(
          'p',
          { className: 'fluid-muted' },
          `State checks: ${polling.open}s in Media, ${polling.closed}s elsewhere. Progress advances between checks.`,
        ),
      ),
      h(
        'section',
        { className: 'fluid-panel fluid-panel-pad' },
        h('h2', { className: 'fluid-section-title' }, 'Three sources. Clear boundaries.'),
        h(
          'dl',
          { className: 'fluid-boundaries' },
          h('dt', {}, 'Spotify'),
          h(
            'dd',
            {},
            'Remote control of an official Connect device. No audio samples are available here; the visualizer never simulates them.',
          ),
          h('dt', {}, 'Radio'),
          h(
            'dd',
            {},
            'Browser audio, with station ads intact. Audio visualization is available when the stream permits analysis.',
          ),
          h('dt', {}, 'Local music'),
          h(
            'dd',
            {},
            'Audio stays on disk. Saved playlists store stable catalog IDs, never audio bytes or private paths.',
          ),
        ),
      ),
    ),
  )
}
const NAV_PRIMARY = [
  ['home', 'home', 'Overview'],
  ['search', 'search', 'Search'],
  ['library', 'spotify', 'Spotify'],
  ['radio', 'radio', 'Radio'],
  ['local', 'local', 'Local music'],
]
const NAV_LIBRARY = [
  ['playlists', 'playlist', 'Playlists'],
  ['queue', 'queue', 'Queue'],
  ['settings', 'settings', 'Settings'],
  ['logs', 'logs', 'Logs'],
]
function Sidebar({ controller, view, navigate }) {
  const queue = useValue(controller.queue),
    playlists = useValue(controller.playlists),
    auth = useValue(controller.spotifyAuth)
  const group = (label, rows) =>
    h(
      'div',
      { className: 'fluid-nav-group' },
      h('p', { className: 'fluid-nav-label' }, label),
      rows.map(([id, icon, text]) =>
        h(
          'button',
          {
            type: 'button',
            className: 'fluid-nav-button',
            'data-active': view === id,
            'aria-current': view === id ? 'page' : undefined,
            key: id,
            onClick: () => navigate(id),
          },
          h('span', { className: 'fluid-nav-icon' }, h(Icon, { kind: icon })),
          h('span', {}, text),
          ['queue', 'playlists'].includes(id) &&
            h('span', { className: 'fluid-nav-count' }, id === 'queue' ? queue.length : playlists.length),
        ),
      ),
    )
  return h(
    'nav',
    { className: 'fluid-sidebar', 'aria-label': 'FluidMusic' },
    h(
      'div',
      { className: 'fluid-brand' },
      h(Icon, { kind: 'music' }),
      h('span', {}, h('strong', {}, 'FluidMusic'), h('small', {}, 'A soundtrack for your work')),
    ),
    group('Listen', NAV_PRIMARY),
    group('Collection', NAV_LIBRARY),
    h(
      'div',
      { className: 'fluid-sidebar-foot' },
      h(
        'span',
        { className: 'fluid-provider-state' },
        h('i', { className: 'fluid-state-dot', 'data-on': auth.authenticated }),
        auth.authenticated ? 'Spotify connected' : 'Spotify disconnected',
      ),
    ),
  )
}
function MediaPage({ controller }) {
  const view = useValue(controller.workspaceView)
  useEffect(() => {
    controller.setPollingOpen(true)
    void controller.refreshSpotifyAuth()
    void controller.refreshSpotifyDevices()
    return () => controller.setPollingOpen(false)
  }, [controller])
  const pages = {
    home: HomePage,
    search: SearchPage,
    library: SpotifyLibraryPage,
    radio: RadioPage,
    local: LocalPage,
    playlists: PlaylistsPage,
    queue: QueuePage,
    settings: SettingsPage,
    logs: LogsPage,
  }
  return h(
    'div',
    { className: 'fluid-root' },
    h(
      'main',
      { className: 'fluid-app' },
      h(
        'div',
        { className: 'fluid-shell' },
        h(Sidebar, { controller, view, navigate: controller.setWorkspaceView }),
        h(
          'section',
          { className: 'fluid-content', key: view },
          h(
            'div',
            { className: 'fluid-content-inner' },
            h(Notice, { controller }),
            h(pages[view] || HomePage, { controller, navigate: controller.setWorkspaceView }),
          ),
        ),
      ),
      h(PlayerDock, { controller }),
    ),
  )
}
function StatusBar({ controller }) {
  const queue = useValue(controller.queue),
    at = useValue(controller.index),
    status = useValue(controller.status),
    spotify = useValue(controller.spotify),
    message = useValue(controller.message),
    visual = useValue(controller.statusVisualizer)
  const item = queue[at],
    active = status === 'playing' || status === 'loading'
  const title =
    item?.source === 'spotify' && spotify.title && status === 'playing'
      ? spotify.title
      : item?.title || 'FluidMusic'
  return h(
    'div',
    { className: 'fluid-statusbar', 'aria-label': 'FluidMusic controls' },
    h(
      Button,
      {
        variant: 'ghost',
        size: 'micro',
        onClick: () => host.navigate(ROUTE),
        title: message || `${title} · ${status}`,
        'aria-label': 'Open FluidMusic',
      },
      h('span', { className: 'fluid-status-dot', 'data-state': status }),
      h('span', { className: 'fluid-statusbar-title' }, title),
    ),
    item &&
      h(Action, {
        compact: true,
        label: active ? 'Pause' : 'Play',
        kind: active ? 'pause' : 'play',
        onClick: () => void controller.toggle(),
      }),
    item && h(Action, { compact: true, label: 'Next', kind: 'next', onClick: () => void controller.next() }),
    h(VolumeControl, { controller, compact: true }),
    h(Action, {
      compact: true,
      kind: 'wave',
      label: visual ? 'Hide status visualizer' : 'Show status visualizer',
      onClick: () => controller.setStatusVisualizer(!visual),
    }),
    visual && h(AudioVisualizer, { controller, compact: true }),
    visual && h(VisualizerStyle, { controller, compact: true }),
  )
}
export default {
  id: ID,
  name: 'FluidMusic',
  description: 'Your listening workspace: Spotify Connect, radio, and local music.',
  defaultEnabled: true,
  register(ctx) {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.append(style)
    ctx.onDispose(() => style.remove())
    const controller = createController(ctx)
    ctx.register({
      id: 'media-route',
      area: ROUTES_AREA,
      data: { path: ROUTE },
      render: () => h(MediaPage, { controller }),
    })
    ctx.register({
      id: 'media-nav',
      area: SIDEBAR_NAV_AREA,
      data: { path: ROUTE, label: 'Media', codicon: 'music' },
    })
    ctx.register({
      id: 'media-status',
      area: STATUSBAR_AREAS.right,
      order: 18,
      render: () => h(StatusBar, { controller }),
    })
    ctx.register({
      id: 'mini-player',
      area: 'panes',
      title: 'FluidMusic player',
      data: { placement: 'right', width: '300px', height: '420px' },
      render: () => h(MiniPlayer, { controller }),
    })
  },
}
