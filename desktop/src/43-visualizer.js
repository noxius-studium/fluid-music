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
      if (parsed.kind === 'state') setPlaying(parsed.playing)
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
  const youtubeState = useValue(controller.youtube)
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
        h(EmbeddedYouTubeFrame, { key: `${item.id}-${youtubeState.reloadToken || 0}`, controller, item, title: display?.title || 'YouTube video', frameRef: youtubeFrameRef }),
      ),
      youtubeState.status === 'error' && youtubeState.error && h('p', { className: 'fluid-error', role: 'alert' }, youtubeState.error),
      h(YouTubeTransport, { controller, frameRef: youtubeFrameRef, item }),
      youtubeState.status === 'error' && h('div', { className: 'fluid-actions' },
        youtubeState.retryable && h(WorkspaceButton, { onClick: () => void controller.retryYouTube() }, 'Retry'),
        h(WorkspaceButton, { onClick: () => void controller.next() }, 'Skip')),
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
}