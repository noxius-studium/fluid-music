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
    ? h('iframe', { ref: frameRef, src, title, className: 'fluid-youtube-frame', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', referrerPolicy: 'strict-origin-when-cross-origin', scrolling: 'no' })
    : h('div', { className: 'fluid-youtube-frame fluid-youtube-frame-loading', role: 'status' }, 'Preparing YouTube player…')
}

function MiniControlBar({ controller, playing, onToggle, disabled = false }) {
  const detailsVisible = useValue(controller.miniDetailsVisible)
  const queue = useValue(controller.queue)
  const at = useValue(controller.index)
  const item = queue[at]
  const [downloading, setDownloading] = useState(false)
  const download = async () => {
    if (downloading || item?.source !== 'youtube') return
    setDownloading(true)
    try {
      await controller.downloadYouTubeAudio(item)
    } finally {
      setDownloading(false)
    }
  }
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
      h(WorkspaceButton, {
        onClick: () => controller.toggleMiniDetails(),
        'aria-pressed': detailsVisible,
        'aria-label': detailsVisible ? 'Hide player details' : 'Show player details',
      }, detailsVisible ? 'Hide player' : 'Show player'),
      item?.source === 'youtube' && h(WorkspaceButton, {
        disabled: downloading,
        onClick: () => void download(),
        'aria-label': downloading ? `Downloading ${item.title}` : `Download ${item.title} locally`,
      }, downloading ? 'Saving…' : 'Download'),
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
  const detailsVisible = useValue(controller.miniDetailsVisible)
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
      // Details leave view by default, but remain mounted so YouTube playback
      // and the command bridge continue without a second engine.
      h('div', { className: 'fluid-mini-details', hidden: !detailsVisible },
        h('div', { className: 'fluid-youtube-stage' },
          h('div', { className: 'fluid-youtube-frame-wrap' },
            watching
              ? h(OwnedWatchSurface, { controller, item, capability: controller.youtubeWatchCapability(), controlRef: watchControlRef })
              : h(EmbeddedYouTubeFrame, { key: `${item.id}-${youtubeState.reloadToken || 0}`, controller, item, title: display?.title || 'YouTube video', frameRef: youtubeFrameRef }),
          ),
        ),
        h('p', { className: 'fluid-mini-expand-note', role: 'status' }, 'This pane is too short for the full video. Expand the FluidMusic player to about 360px or more; playback controls stay available below.'),
        youtubeState.status === 'switching' && h('p', { className: 'fluid-muted', role: 'status' }, 'Switching player…'),
        youtubeState.status === 'error' && youtubeState.error && h('p', { className: 'fluid-error', role: 'alert' }, youtubeState.error),
        youtubeState.status === 'error' && h('div', { className: 'fluid-actions' },
          youtubeState.retryable && h(WorkspaceButton, { onClick: () => void controller.retryYouTube() }, 'Retry'),
          youtubeState.fallbackEligible && h(WorkspaceButton, { onClick: () => void controller.downloadYouTubeAudio(item) }, 'Download audio'),
          youtubeState.fallbackEligible && h(WorkspaceButton, { onClick: () => controller.attemptYouTubeWatchFallback() }, 'Try watch fallback'),
          h(WorkspaceButton, { onClick: () => void controller.next() }, 'Skip')),
      ),
      watching
        ? h(MiniControlBar, { controller, playing: Boolean(youtubeState.playing), onToggle: () => void controller.toggle() })
        : h(YouTubeTransport, { controller, frameRef: youtubeFrameRef, item }),
    )
  }
  return h(
    'section',
    { className: 'fluid-mini-player', 'aria-label': 'Dockable FluidMusic player' },
    h('div', { className: 'fluid-mini-body', hidden: !detailsVisible },
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
}