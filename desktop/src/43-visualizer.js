const VISUAL_STYLES = [
  ['bars', 'Spectrum'],
  ['wave', 'Waveform'],
  ['mirror', 'Mirror'],
]
function VisualizerStyle({ controller, compact = false }) {
  const style = useValue(controller.visualizerStyle)
  return h(
    'select',
    {
      className: compact ? 'fluid-viz-select fluid-viz-select-compact' : 'fluid-select',
      'aria-label': compact ? 'Status visualizer style' : 'Visualizer style',
      value: style,
      onChange: (event) => controller.setVisualizerStyle(event.target.value),
    },
    VISUAL_STYLES.map(([value, label]) => h('option', { value, key: value }, label)),
  )
}
function VisualizerSettings({ controller }) {
  const status = useValue(controller.statusVisualizer),
    mini = useValue(controller.miniVisualizer)
  return h(
    'div',
    { className: 'fluid-viz-settings' },
    h(
      'label',
      { className: 'fluid-switch-row' },
      h('input', {
        type: 'checkbox',
        checked: status,
        onChange: (event) => controller.setStatusVisualizer(event.target.checked),
      }),
      'Status-bar visualizer',
    ),
    h(
      'label',
      { className: 'fluid-switch-row' },
      h('input', {
        type: 'checkbox',
        checked: mini,
        onChange: (event) => controller.setMiniVisualizer(event.target.checked),
      }),
      'Mini-player visualizer',
    ),
    h(VisualizerStyle, { controller }),
    h(
      'p',
      { className: 'fluid-muted' },
      'Hidden, inactive, and reduced-motion visuals do no sample reads or animation work. When both are inactive, the analyser is disconnected. Move the FluidMusic player pane using Hermes’ layout controls.',
    ),
  )
}
function AudioVisualizer({ controller, compact = false }) {
  const ref = useRef(null),
    style = useValue(controller.visualizerStyle),
    status = useValue(controller.status),
    meter = useValue(controller.radioMeter),
    queue = useValue(controller.queue),
    at = useValue(controller.index)
  const source = queue[at]?.source
  const supported = ['ready', 'analyser'].includes(meter) && source !== 'spotify'
  useEffect(() => {
    const canvas = ref.current,
      drawing = canvas?.getContext('2d')
    if (!drawing) return undefined
    drawing.clearRect(0, 0, canvas.width, canvas.height)
    if (!supported || status !== 'playing') return undefined
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0,
      release = null,
      intersecting = false,
      lastTime = 0,
      stopped = false
    let width = 0,
      height = 0,
      color = ''
    let bands = [], bandRate = 0, bandBins = 0
    const resize = () => {
      const box = canvas.getBoundingClientRect(),
        ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(0, Math.floor(box.width * ratio))
      height = Math.max(0, Math.floor(box.height * ratio))
      canvas.width = width
      canvas.height = height
      color = getComputedStyle(canvas).getPropertyValue('--ui-accent').trim()
      reconcile()
    }
    const draw = (time) => {
      if (!release || stopped) return
      frame = requestAnimationFrame(draw)
      if (time - lastTime < 1000 / 30) return
      lastTime = time
      const samples = controller.visualSamples(style)
      drawing.clearRect(0, 0, width, height)
      if (!samples) return
      drawing.fillStyle = color
      drawing.strokeStyle = color
      drawing.lineWidth = 1.5 * Math.min(window.devicePixelRatio || 1, 2)
      if (style === 'wave') {
        drawing.beginPath()
        for (let point = 0; point < samples.length; point++) {
          const x = (point / (samples.length - 1)) * width,
            y = (samples[point] / 255) * height
          point ? drawing.lineTo(x, y) : drawing.moveTo(x, y)
        }
        drawing.stroke()
      } else {
        const count = compact ? 20 : 48,
          step = width / count
        const sampleRate = controller.visualSampleRate()
        if (sampleRate !== bandRate || samples.length !== bandBins) {
          bands = spectrumBands(samples.length, sampleRate, count)
          bandRate = sampleRate
          bandBins = samples.length
        }
        for (let bar = 0; bar < bands.length; bar++) {
          const { low, high } = bands[bar]
          // A faint baseline marks every band, including silence; it is not fabricated signal.
          drawing.globalAlpha = .18
          drawing.fillRect(bar * step, style === 'mirror' ? height / 2 : height - 1, Math.max(1, step - 2), 1)
          drawing.globalAlpha = 1
          let sum = 0
          for (let i = low; i < high; i++) sum += samples[i] || 0
          const level = (sum / (high - low) / 255) * height
          drawing.fillRect(
            bar * step,
            style === 'mirror' ? (height - level) / 2 : height - level,
            Math.max(1, step - 2),
            level,
          )
        }
      }
    }
    function reconcile() {
      if (stopped) return
      const active = intersecting && width > 0 && height > 0 && !document.hidden && !motion.matches
      if (active && !release) {
        release = controller.acquireVisualizer()
        frame = requestAnimationFrame(draw)
      }
      if (!active && release) {
        cancelAnimationFrame(frame)
        release()
        release = null
        drawing.clearRect(0, 0, width, height)
      }
    }
    const intersection = new IntersectionObserver((entries) => {
      intersecting = entries[0]?.isIntersecting || false
      reconcile()
    })
    const observer = new ResizeObserver(resize)
    intersection.observe(canvas)
    observer.observe(canvas)
    document.addEventListener('visibilitychange', reconcile)
    motion.addEventListener('change', reconcile)
    resize()
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      release?.()
      intersection.disconnect()
      observer.disconnect()
      document.removeEventListener('visibilitychange', reconcile)
      motion.removeEventListener('change', reconcile)
    }
  }, [controller, supported, status, style, compact])
  const hint =
    source === 'spotify'
      ? 'Spotify Connect: audio plays on your device; samples are unavailable.'
      : meter === 'unavailable'
        ? source === 'local'
          ? 'For visualization, reopen this file using Local music → Open audio files. Indexed playback stays available.'
          : 'This stream does not expose audio samples.'
        : status !== 'playing'
          ? 'Visualization resumes during playback.'
          : 'Audio-reactive visualization. Reduced-motion preferences suspend animation.'
  return h(
    'div',
    { className: compact ? 'fluid-visualizer fluid-visualizer-compact' : 'fluid-visualizer', title: hint },
    h('canvas', { ref, role: 'img', 'aria-label': `${style} audio visualizer` }),
    (!supported || status !== 'playing') &&
      h('span', { className: 'fluid-viz-hint' }, compact ? (source === 'spotify' ? 'REMOTE' : '—') : hint),
  )
}
function MiniPlayer({ controller }) {
  const queue = useValue(controller.queue),
    at = useValue(controller.index),
    spotify = useValue(controller.spotify),
    status = useValue(controller.status),
    progress = useValue(controller.progress),
    show = useValue(controller.miniVisualizer)
  const item = queue[at]
  const display =
    item?.source === 'spotify' && spotify.title && status === 'playing'
      ? { ...item, title: spotify.title, subtitle: spotify.subtitle, artwork: spotify.artwork }
      : item
  return h(
    'section',
    { className: 'fluid-mini-player', 'aria-label': 'Dockable FluidMusic player' },
    h(
      'div',
      { className: 'fluid-section-head' },
      h('span', { className: 'fluid-kicker' }, item ? `${sourceLabel(item)} · ${status}` : 'FluidMusic'),
      h(Action, {
        compact: true,
        kind: 'external',
        label: 'Open Media workspace',
        onClick: () => host.navigate(ROUTE),
      }),
    ),
    h(
      'div',
      { className: 'fluid-mini-summary' },
      h(Artwork, { item: display, className: 'fluid-mini-art' }),
      h(
        'div',
        { className: 'fluid-row-copy' },
        h(
          'h2',
          { className: 'fluid-mini-title', title: display?.title },
          display?.title || 'Your soundtrack, anywhere.',
        ),
        h(
          'p',
          { className: 'fluid-mini-subtitle' },
          display?.subtitle || (item ? sourceLabel(item) : 'Choose music in the Media workspace.'),
        ),
      ),
    ),
    h(Transport, { controller }),
    item?.source !== 'radio' && progress.durationMs > 0
      ? h(SeekBar, { controller })
      : h(
          'p',
          { className: 'fluid-player-hint' },
          item?.source === 'radio'
            ? 'LIVE · no fixed duration'
            : `${formatClock(progress.positionMs)} / ${formatClock(progress.durationMs)}`,
        ),
    h(VolumeControl, { controller }),
    h(
      'div',
      { className: 'fluid-mini-visual-controls' },
      h(
        WorkspaceButton,
        { onClick: () => controller.setMiniVisualizer(!show) },
        show ? 'Hide visualizer' : 'Show visualizer',
      ),
      show && h(VisualizerStyle, { controller }),
    ),
    show && h(AudioVisualizer, { controller }),
    h(Notice, { controller }),
  )
}
