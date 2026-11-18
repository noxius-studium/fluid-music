function youtubeEmbedUrl(item) {
  const videoId = item?.source === 'youtube' ? safeText(item.id).replace(/^youtube:/, '') : ''
  return /^[A-Za-z0-9_-]{11}$/.test(videoId)
    ? `https://www.youtube-nocookie.com/embed/${videoId}?controls=1&enablejsapi=1&playsinline=1&rel=0&origin=https%3A%2F%2Fwww.youtube.com`
    : ''
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

function MiniControlBar({ controller, playing, onToggle, onVolumeChange }) {
  const volume = useValue(controller.volume)
  const changeVolume = event => {
    const next = clampVolume(event.target.value)
    controller.setVolume(next)
    onVolumeChange?.(next)
  }
  return h('footer', { className: 'fluid-mini-controls', 'aria-label': 'Playback controls' },
    h('div', { className: 'fluid-player-controls' },
      h(Action, { compact: true, kind: 'previous', label: 'Previous', onClick: () => void controller.previous() }),
      h(WorkspaceButton, { primary: true, onClick: onToggle, 'aria-label': playing ? 'Pause' : 'Play' }, h(Icon, { kind: playing ? 'pause' : 'play' })),
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
  const send = (func, args = []) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: args.length ? args : '', id: 'fluid-music', channel: 'fluid-music' }), '*')
  }
  useEffect(() => {
    setPlaying(false)
    const receive = event => {
      if (event.source !== frameRef.current?.contentWindow) return
      let data = event.data
      try { if (typeof data === 'string') data = JSON.parse(data) } catch { return }
      const state = Number(data?.info?.playerState)
      if (state === 1) setPlaying(true)
      if ([0, 2, 5].includes(state)) setPlaying(false)
    }
    window.addEventListener('message', receive)
    const listening = setInterval(() => frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'fluid-music', channel: 'fluid-music' }), '*'), 500)
    return () => { window.removeEventListener('message', receive); clearInterval(listening) }
  }, [item?.id, frameRef])
  const toggle = () => {
    send(playing ? 'pauseVideo' : 'playVideo')
    setTimeout(() => send(playing ? 'pauseVideo' : 'playVideo'), 250)
  }
  return h(MiniControlBar, { controller, playing, onToggle: toggle, onVolumeChange: next => send('setVolume', [Math.round(next * 100)]) })
}

function MiniPlayer({ controller }) {
  const queue = useValue(controller.queue)
  const at = useValue(controller.index)
  const spotify = useValue(controller.spotify)
  const status = useValue(controller.status)
  const progress = useValue(controller.progress)
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
        h(EmbeddedYouTubeFrame, { controller, item, title: display?.title || 'YouTube video', frameRef: youtubeFrameRef }),
      ),
      h(YouTubeTransport, { controller, frameRef: youtubeFrameRef, item }),
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