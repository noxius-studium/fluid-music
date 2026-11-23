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
