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

function MusicFolderSetting({ controller }) {
  const saved = useValue(controller.musicDir)
  const [draft, setDraft] = useState(saved)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setDraft(saved) }, [saved])
  const browse = async () => {
    setBusy(true)
    try { const folder = await controller.chooseMusicDir(); if (folder) setDraft(folder) } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true)
    try { await controller.setMusicDir(draft) } finally { setBusy(false) }
  }
  return h('div', { className: 'fluid-setting-block' },
    h('h3', { className: 'fluid-section-title' }, 'Audio fallback folder'),
    h('p', { className: 'fluid-section-copy' }, 'When a YouTube video cannot play here, FluidMusic can save its audio as m4a in this folder and add it to your local library. Personal use; respect the provider terms.'),
    h('div', { className: 'fluid-inline-field' },
      h('input', { type: 'text', value: draft, placeholder: 'Choose a music folder', 'aria-label': 'Audio fallback music folder', onChange: event => setDraft(event.target.value) }),
      h(WorkspaceButton, { disabled: busy, onClick: () => void browse() }, 'Browse'),
      h(WorkspaceButton, { primary: true, disabled: busy || !draft.trim(), onClick: () => void save() }, 'Save'),
    ),
  )
}

function SettingsPage({ controller }) {
  const [tab, setTab] = useState('providers')
  const autoplay = useValue(controller.spotifyAutoplay)
  return h('div', {}, h(PageHead, { title: 'Settings', subtitle: 'Connections, playback behavior, and diagnostics.' }), h(SecondaryTabs, { label: 'Settings sections', value: tab, onChange: setTab, items: [['providers', 'Providers'], ['playback', 'Playback'], ['recovery', 'Recovery'], ['diagnostics', 'Diagnostics']] }),
    tab === 'providers' ? h('div', { className: 'fluid-settings-grid' }, h(SpotifyConnection, { controller }), h(YouTubeControls, { controller })) :
    tab === 'playback' ? h('section', { className: 'fluid-panel fluid-panel-pad' }, h('h2', { className: 'fluid-section-title' }, 'Playback'), h(VolumeControl, { controller }), h('label', { className: 'fluid-switch-row' }, h('input', { type: 'checkbox', checked: autoplay, onChange: event => controller.setSpotifyAutoplay(event.target.checked) }), h('span', {}, h('strong', {}, 'Let Spotify continue after a track'), h('small', {}, 'Otherwise FluidMusic advances its temporary Up Next queue.'))), h(MusicFolderSetting, { controller }), h(HistoryRetention, { controller })) :
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
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus()
        setTimeout(() => trigger.isConnected && trigger.focus(), 0)
      }
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