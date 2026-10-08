function HomePage({ controller, navigate }) {
  const queue = useValue(controller.queue),
    at = useValue(controller.index),
    playlists = useValue(controller.playlists),
    status = useValue(controller.status),
    spotify = useValue(controller.spotify)
  const item = queue[at],
    display =
      item?.source === 'spotify' && spotify.title && status === 'playing'
        ? { ...item, title: spotify.title, subtitle: spotify.subtitle, artwork: spotify.artwork }
        : item
  return h(
    'div',
    {},
    h(PageHead, {
      kicker: 'Your listening space',
      title: 'Make room for music.',
      subtitle: 'Build a mix. Find a station. Keep your flow.',
    }),
    h(
      'section',
      { className: 'fluid-now-card' },
      h(Artwork, { item: display, className: 'fluid-now-cover' }),
      h(
        'div',
        { className: 'fluid-now-copy' },
        h(
          'p',
          { className: 'fluid-kicker' },
          item ? `${sourceLabel(item)} · ${status}` : 'Pick your soundtrack',
        ),
        h('h2', { className: 'fluid-now-title' }, display?.title || 'A little less silence.'),
        h(
          'p',
          { className: 'fluid-now-subtitle' },
          display?.subtitle || 'Your library, live radio, and Spotify in one workspace.',
        ),
        item
          ? h(
              'div',
              { className: 'fluid-actions' },
              h(Transport, { controller }),
              h(WorkspaceButton, { onClick: () => navigate('queue') }, `View queue · ${queue.length}`),
            )
          : h(
              'div',
              { className: 'fluid-actions' },
              h(WorkspaceButton, { primary: true, onClick: () => navigate('radio') }, 'Discover radio'),
              h(WorkspaceButton, { onClick: () => navigate('local') }, 'Add your music'),
            ),
      ),
    ),
    h(
      'div',
      { className: 'fluid-source-links' },
      [
        ['search', 'spotify', 'Spotify', 'Search songs, albums & playlists'],
        ['radio', 'radio', 'Live radio', 'A station for every kind of focus'],
        ['local', 'local', 'On your device', 'Your folders. Your collection.'],
      ].map(([view, kind, title, text]) =>
        h(
          'button',
          { type: 'button', key: view, onClick: () => navigate(view) },
          h(Icon, { kind }),
          h('span', {}, h('strong', {}, title), h('small', {}, text)),
          h(Icon, { kind: 'forward' }),
        ),
      ),
    ),
    h(
      'section',
      { className: 'fluid-result-section' },
      h(
        'div',
        { className: 'fluid-section-head' },
        h('h2', { className: 'fluid-section-title' }, 'Made by you'),
        h(WorkspaceButton, { onClick: () => navigate('playlists') }, 'Manage playlists'),
      ),
      playlists.length
        ? h(
            'div',
            { className: 'fluid-collection-grid' },
            playlists.slice(0, 6).map((entry) =>
              h(
                'button',
                {
                  type: 'button',
                  className: 'fluid-collection-card',
                  key: entry.id,
                  onClick: () => {
                    controller.selectPlaylist(entry.id)
                    navigate('playlists')
                  },
                },
                h('span', { className: 'fluid-collection-icon' }, h(Icon, { kind: 'playlist' })),
                h('strong', {}, entry.name),
                h('span', {}, `${entry.items.length} items · ${entry.description || 'Your mix'}`),
              ),
            ),
          )
        : h(
            Empty,
            { title: 'Start a collection' },
            h(WorkspaceButton, { onClick: () => navigate('playlists') }, 'Create your first playlist'),
          ),
    ),
    h(
      'section',
      { className: 'fluid-result-section' },
      h(
        'div',
        { className: 'fluid-section-head' },
        h('h2', { className: 'fluid-section-title' }, 'On the air'),
        h(WorkspaceButton, { onClick: () => navigate('radio') }, 'Explore radio'),
      ),
      h(
        'div',
        { className: 'fluid-track-list' },
        RADIO_PRESETS.map((station, index) =>
          h(TrackRow, { key: station.id, controller, item: station, at: index }),
        ),
      ),
    ),
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
    h(PageHead, {
      kicker: 'Discover',
      title: 'Find your next favourite.',
      subtitle: 'Search the Spotify catalog. Save individual tracks or whole contexts.',
    }),
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
        'Your Spotify playlists stay on Spotify. Save tracks to FluidMusic to build a mixed collection.',
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
    h(PageHead, {
      kicker: 'Tune in',
      title: 'Something is always playing.',
      subtitle: 'Live stations for deep work, slow mornings, and everything between.',
      actions: h(
        WorkspaceButton,
        {
          onClick: () => {
            setError('')
            setCustom(true)
          },
        },
        'Add a stream',
      ),
    }),
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
          h('h2', { className: 'fluid-section-title' }, 'Open files with visualization'),
          h(
            'p',
            { className: 'fluid-section-copy' },
            'Direct browser playback gives the visualizer real audio samples, without changing your indexed library.',
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
        'aria-label': 'Open audio files for visualization',
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
