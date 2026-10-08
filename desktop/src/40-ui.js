function WorkspaceButton({ children, primary = false, danger = false, ...props }) {
  return h(
    Button,
    {
      type: 'button',
      variant: danger ? 'destructive' : primary ? 'default' : 'secondary',
      size: 'sm',
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
      h('p', { className: 'fluid-kicker' }, kicker),
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
  const sessionOnly = item.source === 'local' && !item.localTrackId
  return h(
    'span',
    {},
    h(Action, {
      compact: true,
      kind: 'playlist',
      disabled: sessionOnly,
      label: sessionOnly
        ? 'Session file: index its folder to save in playlists'
        : `Save ${item.title} to playlist`,
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
  const playlists = useValue(controller.playlists)
  const [destination, setDestination] = useState(playlists[0]?.id || 'new')
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState(null)
  const collection = /^spotify:playlist:/.test(item.uri || '')
  const [mode, setMode] = useState(collection ? 'tracks' : 'reference')
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
        mode,
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
          collection ? 'Spotify playlist' : sourceLabel(item),
        ),
      ),
    ),
    h(
      'form',
      { onSubmit: save },
      collection &&
        h(
          'label',
          { className: 'fluid-field' },
          'What to save',
          h(
            'select',
            {
              className: 'fluid-select',
              value: mode,
              disabled: busy,
              onChange: (event) => setMode(event.target.value),
            },
            h('option', { value: 'tracks' }, 'Copy the individual songs'),
            h('option', { value: 'reference' }, 'Keep as a single Spotify playlist reference'),
          ),
        ),
      collection &&
        h(
          'p',
          { className: 'fluid-muted' },
          mode === 'tracks'
            ? 'Copies all supported songs in their current order. You can then edit and mix them in FluidMusic. Spotify itself is not changed.'
            : 'Saves one context entry. Spotify continues to manage the songs inside it.',
        ),
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
    item = queue[at]
  return h(
    'div',
    { className: 'fluid-player-controls' },
    h(Action, {
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
        className: 'fluid-primary-action',
        disabled: !item,
        onClick: () => void controller.toggle(),
        'aria-label': ['playing', 'loading'].includes(status) ? 'Pause' : 'Play',
      },
      h(Icon, {
        kind: ['playing', 'loading'].includes(status) ? 'pause' : 'play',
      }),
    ),
    h(Action, {
      compact: true,
      kind: 'next',
      label: 'Next',
      disabled: !item,
      onClick: () => void controller.next(),
    }),
  )
}
function PlayerDock({ controller }) {
  const queue = useValue(controller.queue),
    at = useValue(controller.index),
    state = useValue(controller.status),
    spotify = useValue(controller.spotify),
    progress = useValue(controller.progress),
    autoplay = useValue(controller.spotifyAutoplay)
  const item = queue[at],
    confirmed =
      item?.source === 'spotify' &&
      spotify.title &&
      (spotify.uri === item.uri || item.kind !== 'track' || autoplay)
  const display = confirmed
    ? {
        ...item,
        title: spotify.title,
        subtitle: spotify.subtitle,
        artwork: spotify.artwork,
      }
    : item
  return h(
    'footer',
    { className: 'fluid-player', 'aria-label': 'Persistent player' },
    h(
      'div',
      { className: 'fluid-player-track' },
      h(Artwork, { item: display, className: 'fluid-player-cover' }),
      h(
        'div',
        { className: 'fluid-row-copy' },
        h('span', { className: 'fluid-player-title' }, display?.title || 'Ready when you are'),
        h(
          'span',
          { className: 'fluid-player-subtitle' },
          display?.subtitle || 'Choose a track, station, or playlist',
        ),
        h(
          'span',
          { className: 'fluid-player-source' },
          item ? `${sourceLabel(item)} · ${state}` : 'FluidMusic',
        ),
      ),
    ),
    h(
      'div',
      { className: 'fluid-player-center' },
      h(Transport, { controller }),
      item?.source !== 'radio' && progress.durationMs > 0
        ? h(SeekBar, { controller })
        : h(
            'p',
            { className: 'fluid-player-hint' },
            item?.source === 'radio'
              ? 'LIVE RADIO'
              : state === 'loading'
                ? 'Connecting…'
                : 'Your music, without leaving your work',
          ),
    ),
    h(
      'div',
      { className: 'fluid-player-side' },
      item?.source === 'spotify' &&
        spotify.device &&
        h('span', { className: 'fluid-player-device' }, spotify.device),
      h(VolumeControl, { controller }),
    ),
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
