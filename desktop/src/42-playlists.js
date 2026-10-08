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
  const [source, setSource] = useState('queue'),
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
        ['queue', 'Current queue'],
        ['local', 'Local music'],
        ['radio', 'Radio'],
        ['spotify', 'Spotify'],
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
        h('p', { className: 'fluid-kicker' }, 'FluidMusic playlist'),
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
function PlaylistsPage({ controller }) {
  const playlists = useValue(controller.playlists),
    selectedId = useValue(controller.selectedPlaylist),
    undo = useValue(controller.undoState)
  const [filter, setFilter] = useState(''),
    [create, setCreate] = useState(false),
    [error, setError] = useState('')
  const file = useRef(null),
    selected = playlists.find((entry) => entry.id === selectedId) || playlists[0]
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
      title: 'Your playlists.',
      subtitle: 'Spotify, local tracks, and live radio. Arrange them your way.',
      actions: h(
        'div',
        { className: 'fluid-actions' },
        h(WorkspaceButton, { onClick: () => file.current?.click() }, 'Import'),
        h(
          WorkspaceButton,
          { disabled: !playlists.length, onClick: () => downloadPlaylist(controller) },
          'Export all',
        ),
        h(WorkspaceButton, { primary: true, onClick: () => setCreate(true) }, 'New playlist'),
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
        h('p', { className: 'fluid-muted' }, `${playlists.length} collections`),
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
                h('span', {}, `${entry.items.length} items`),
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
        ? h(PlaylistEditor, { key: selected.id, controller, playlist: selected })
        : h(
            Empty,
            { title: 'A home for your favourites.' },
            'Create a playlist, then add tracks from your queue, local library, radio, or Spotify.',
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
    [save, setSave] = useState(false),
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
        h(WorkspaceButton, { disabled: !queue.length, onClick: () => setSave(true) }, 'Save as playlist'),
        h(
          WorkspaceButton,
          { danger: true, disabled: !queue.length, onClick: () => setClear(true) },
          'Clear queue',
        ),
      ),
    }),
    h(QueueList, { controller }),
    save &&
      h(PlaylistForm, {
        onClose: () => setSave(false),
        onSave: (name) => {
          const playlist = controller.saveQueueAsPlaylist(name)
          if (playlist) controller.message.set(`Saved queue as “${playlist.name}”.`)
        },
      }),
    clear &&
      h(
        Confirm,
        { title: 'Clear queue', onClose: () => setClear(false), action: () => controller.clearQueue() },
        'Stop playback and clear this session’s queue? Your saved playlists and files are not changed.',
      ),
  )
}
