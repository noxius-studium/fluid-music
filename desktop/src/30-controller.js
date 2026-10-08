
/* CONTROLLER_START */
function createController(ctx) {
  const rawStoredQueue = ctx.storage.get('queue', [])
  const storedSelection = normalizeQueueSelection(rawStoredQueue, ctx.storage.get('queueIndex', -1))
  const storedPlaylists = normalizePlaylistState(ctx.storage.get('playlistState', { version: 2, playlists: [] }))
  const queue = atom(storedSelection.items)
  const index = atom(storedSelection.index)
  const favorites = atom(normalizeQueue(ctx.storage.get('favorites', [])))
  const volume = atom(clampVolume(ctx.storage.get('volume', .5)))
  const workspaceView = atom(isWorkspaceView(ctx.storage.get('workspaceView', 'home')))
  const selectedPlaylist = atom(safeText(ctx.storage.get('selectedPlaylist', '')))
  const undoState = atom(null)
  let unmutedVolume = clampVolume(ctx.storage.get('unmutedVolume', .5)) || .5
  let volumeTimer = null
  let volumeVersion = 0
  let spotifyStartedUri = ''
  let localRefreshVersion = 0
  const status = atom('idle')
  const message = atom('')
  const logs = atom([])
  const spotify = atom({ connected: false, title: '', subtitle: '', playing: false })
  const spotifyAuth = atom({ state: 'loading', authenticated: false, needsClientId: false, detail: '' })
  const spotifyDevices = atom([])
  const radioMeter = atom('idle')
  const statusVisualizer = atom(ctx.storage.get('statusVisualizer', true) !== false)
  const miniVisualizer = atom(ctx.storage.get('miniVisualizer', true) !== false)
  const visualizerStyle = atom(['bars', 'wave', 'mirror'].includes(ctx.storage.get('visualizerStyle', 'bars')) ? ctx.storage.get('visualizerStyle', 'bars') : 'bars')
  const visualConsumers = new Set()
  let visualBuffer = null
  let visualReads = 0
  const progress = atom({ positionMs: 0, durationMs: 0 })
  const playlists = atom(storedPlaylists.playlists)
  const localTracks = atom([])
  const sessionTracks = atom([])
  const localRoots = atom([])
  const shuffle = atom(false)
  const repeat = atom('off')
  const spotifyAutoplay = atom(Boolean(ctx.storage.get('spotifyAutoplay', false)))
  let audio = null
  let audioSource = null
  let context = null
  let mediaSource = null
  let analyser = null
  let gain = null
  let disposed = false
  let radioGeneration = 0
  let radioTimeout = null
  let spotifyTimer = null
  let spotifyProgressTimer = null
  let authTimer = null
  let authAttempts = 0
  let pollIntervalOpen = 8
  let pollIntervalClosed = 20
  let pollOpen = false
  let spotifyDeviceId = safeText(ctx.storage.get('spotifyDeviceId', ''))
  let spotifyDeviceRefreshVersion = 0
  let spotifyStateFingerprint = ''
  let requestSequence = 0
  let spotifyProgressAnchor = null
  let spotifyQueueGuard = null
  let transition = 0
  let transitionChain = Promise.resolve()
  const localRegistry = new Map()

  const addLog = (level, event, detail = {}) => {
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      level,
      event,
      detail
    }
    logs.set([entry, ...logs.get()].slice(0, 250))
    return entry
  }
  const clearLogs = () => logs.set([])
  const diagnosticBody = body => {
    if (!body || typeof body !== 'object') return {}
    const device = safeText(body.device_id)
    return {
      context: safeText(body.context_uri),
      track: safeText(body.uri || body.uris?.[0] || (typeof body.offset === 'string' ? body.offset : body.offset?.uri)),
      device: device ? `…${device.slice(-6)}` : ''
    }
  }

  const current = () => {
    const items = queue.get()
    const at = index.get()
    return at >= 0 && at < items.length ? items[at] : null
  }
  const persist = () => {
    const persistentQueue = []
    let persistentIndex = -1
    queue.get().forEach((value, at) => {
      const item = serializePlaylistItem(value)
      if (!item || (item.source === 'local' && !item.localTrackId)) return
      if (at === index.get()) persistentIndex = persistentQueue.length
      persistentQueue.push(item)
    })
    ctx.storage.set('queue', persistentQueue)
    ctx.storage.set('queueIndex', persistentIndex)
    ctx.storage.set('favorites', favorites.get().filter(item => item.source !== 'local'))
    ctx.storage.set('volume', volume.get())
    ctx.storage.set('spotifyAutoplay', spotifyAutoplay.get())
  }
  const persistPlaylists = () => ctx.storage.set('playlistState', { version: 3, playlists: playlists.get() })
  persist()
  persistPlaylists()
  const revokeLocal = item => {
    if (item?.source !== 'local' || !item.objectUrl) return
    try { URL.revokeObjectURL(item.objectUrl) } catch { /* Session object URL cleanup is best-effort. */ }
  }
  const api = (path, options) => ctx.rest(path, options)
  const request = async (path, options) => {
    const method = safeText(options?.method, 'GET').toUpperCase()
    const route = safeText(path).split('?')[0]
    const requestId = `r${++requestSequence}`
    const started = Date.now()
    const quiet = method === 'GET' && ['/player', '/devices', '/spotify/auth/status', '/config'].includes(route)
      || method === 'PUT' && ['/volume', '/seek'].includes(route)
    try {
      const response = await api(path, options)
      if (response && response.ok === false) {
        const detail = typeof response.error === 'string' ? response.error : safeText(response.error?.message)
        const failure = new Error(userFacingError(detail))
        failure.statusCode = Number(response.status_code) || 0
        throw failure
      }
      if (!quiet) addLog('info', 'api.success', { requestId, method, route, status: Number(response?.status_code || response?.data?.status_code) || 200, durationMs: Date.now() - started, ...diagnosticBody(options?.body) })
      return response && Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response
    } catch (error) {
      const failure = new Error(userFacingError(error, 'FluidMusic could not reach its backend. Retry after Hermes finishes reloading.'))
      failure.statusCode = Number(error?.statusCode) || 0
      addLog('error', 'api.failure', { requestId, method, route, status: failure.statusCode, durationMs: Date.now() - started, error: failure.message, ...diagnosticBody(options?.body) })
      throw failure
    }
  }
  const spotifyRequest = request
  const spotifyCommandBody = (body = {}) => {
    const active = spotifyDevices.get().find(device => device.active && !device.restricted)
    // An explicit user choice is authoritative even while Spotify's device list is stale.
    // If Spotify rejects it as unavailable, surface that error; never retarget another device.
    const deviceId = spotifyDeviceId || active?.id || ''
    return deviceId ? { ...body, device_id: deviceId } : body
  }
  const clearSpotifyDeviceSelection = () => {
    spotifyDeviceId = ''
    ctx.storage.set('spotifyDeviceId', '')
  }
  const isSpotifyAuthFailure = error => Number(error?.statusCode) === 401 || /(?:authentication|auth).*(?:expired|required)|(?:expired|reconnect).*(?:authentication|auth)|reconnect required/i.test(error?.message || '')

  function armSpotifyQueueGuard(item, token = transition) {
    spotifyProgressAnchor = null
    progress.set({ positionMs: 0, durationMs: Math.max(0, Number(item?.durationMs) || 0) })
    spotifyQueueGuard = /^spotify:track:/.test(item?.uri || '')
      ? { token, expectedUri: item.uri, seenExpected: false, advancing: false }
      : null
  }

  function requestHermesQueueAdvance(reason, observedUri = '') {
    const guard = spotifyQueueGuard
    if (spotifyAutoplay.get() || !guard || guard.token !== transition || !guard.seenExpected || guard.advancing) return
    guard.advancing = true
    addLog('state', 'spotify.hermes-queue-advance', { reason, expectedTrack: guard.expectedUri, observedTrack: observedUri || 'none' })
    void next().catch(error => {
      guard.advancing = false
      message.set(error?.message || 'FluidMusic could not advance to the next queue item.')
    })
  }

  function updateSpotifyProgress() {
    const anchor = spotifyProgressAnchor
    if (!anchor || current()?.source !== 'spotify') return
    const elapsed = anchor.playing ? Math.max(0, Date.now() - anchor.receivedAt) : 0
    const positionMs = Math.min(anchor.durationMs || Number.MAX_SAFE_INTEGER, anchor.positionMs + elapsed)
    progress.set({ positionMs, durationMs: anchor.durationMs })
    const guard = spotifyQueueGuard
    if (anchor.playing && anchor.durationMs > 0 && positionMs >= anchor.durationMs && guard?.expectedUri === anchor.uri) {
      requestHermesQueueAdvance('projected-end', anchor.uri)
    }
  }

  function setSpotifyAutoplay(value) {
    const enabled = Boolean(value)
    spotifyAutoplay.set(enabled)
    ctx.storage.set('spotifyAutoplay', enabled)
    if (enabled) {
      spotifyQueueGuard = null
    } else {
      const item = current()
      armSpotifyQueueGuard(item)
      if (spotifyQueueGuard && spotify.get().uri === spotifyQueueGuard.expectedUri) spotifyQueueGuard.seenExpected = true
    }
  }

  function stopInternalAudio() {
    radioGeneration += 1
    if (radioTimeout) clearTimeout(radioTimeout)
    radioTimeout = null
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audio.remove()
      audio = null
      audioSource = null
    }
    if (gain) gain.disconnect()
    if (analyser) analyser.disconnect()
    if (mediaSource) mediaSource.disconnect()
    gain = null
    analyser = null
    visualBuffer = null
    mediaSource = null
    if (context?.state === 'running') void context.suspend()
    radioMeter.set('idle')
  }

  async function startRadio(item, analyse, token) {
    stopInternalAudio()
    if (!item || item.source !== 'radio' || disposed || token !== transition) return
    const generation = radioGeneration
    const element = new Audio()
    audio = element
    audioSource = 'radio'
    element.preload = 'none'
    element.volume = analyse ? 1 : volume.get()
    if (analyse) element.crossOrigin = 'anonymous'
    radioMeter.set(analyse ? 'ready' : 'unavailable')
    progress.set({ positionMs: 0, durationMs: 0 })
    status.set('loading')
    const isCurrent = () => !disposed && generation === radioGeneration && element === audio
    const finishFailure = () => {
      if (!isCurrent()) return
      if (analyse) {
        void startRadio(item, false, token)
        return
      }
      status.set('error')
      message.set('This HTTPS radio stream could not connect. Choose another station or retry.')
    }
    radioTimeout = setTimeout(finishFailure, 15000)
    element.addEventListener('playing', () => {
      if (!isCurrent()) return
      clearTimeout(radioTimeout)
      radioTimeout = null
      status.set('playing')
      message.set(analyse ? '' : 'Audio is playing. Analyser unavailable; this display is static.')
    })
    element.addEventListener('pause', () => { if (isCurrent() && !element.ended && status.get() === 'playing') status.set('paused') })
    element.addEventListener('error', finishFailure)
    element.addEventListener('ended', finishFailure)
    element.src = item.streamUrl
    try {
      if (analyse) {
        context ??= new AudioContext()
        gain = context.createGain()
        gain.gain.value = volume.get()
        mediaSource = context.createMediaElementSource(element)
        mediaSource.connect(gain)
        gain.connect(context.destination)
        syncAnalyser()
        await context.resume()
      }
      await element.play()
    } catch {
      finishFailure()
    }
  }

  async function startLocal(item, token, analyse = Boolean(item?.objectUrl)) {
    stopInternalAudio()
    if (!item || item.source !== 'local' || disposed || token !== transition) return
    const sources = [item.objectUrl, ...(Array.isArray(item.playbackUrls) ? item.playbackUrls : localPlaybackUrls(item.filePath))].filter(Boolean)
    if (item.unavailable || !sources.length) {
      status.set('error')
      message.set('This local track is unavailable. Rescan its music folder to restore it.')
      return
    }
    const generation = radioGeneration
    const element = new Audio()
    audio = element
    audioSource = 'local'
    element.preload = 'metadata'
    if (analyse) element.crossOrigin = 'anonymous'
    element.volume = volume.get()
    radioMeter.set(analyse ? 'ready' : 'unavailable')
    progress.set({ positionMs: 0, durationMs: Math.max(0, Number(item.durationMs) || 0) })
    status.set('loading')
    let sourceIndex = 0
    let played = false
    const isCurrent = () => !disposed && generation === radioGeneration && element === audio && current()?.id === item.id
    const playSource = async () => {
      if (!isCurrent()) return
      element.src = sources[sourceIndex]
      try {
        await element.play()
      } catch {
        if (isCurrent() && sourceIndex + 1 < sources.length) {
          sourceIndex += 1
          await playSource()
        } else if (isCurrent() && analyse) {
          await startLocal(item, token, false)
        } else if (isCurrent()) {
          status.set('error')
          message.set('Hermes could not start this local audio file. Rescan it or check Chromium format support.')
        }
      }
    }
    element.addEventListener('playing', () => {
      if (!isCurrent()) return
      played = true
      if (analyse && !mediaSource) {
        try {
          context ??= new AudioContext()
          gain = context.createGain()
          gain.gain.value = volume.get()
          mediaSource = context.createMediaElementSource(element)
          element.volume = 1
          mediaSource.connect(gain)
          gain.connect(context.destination)
          syncAnalyser()
          void context.resume().catch(() => { if (isCurrent()) void startLocal(item, token, false) })
        } catch { void startLocal(item, token, false); return }
      }
      status.set('playing')
      message.set('')
    })
    element.addEventListener('loadedmetadata', () => {
      if (isCurrent()) progress.set({ positionMs: Math.max(0, Number(element.currentTime) || 0) * 1000, durationMs: Math.max(0, Number(element.duration) || 0) * 1000 })
    })
    element.addEventListener('timeupdate', () => {
      if (isCurrent()) progress.set({ positionMs: Math.max(0, Number(element.currentTime) || 0) * 1000, durationMs: Math.max(0, Number(element.duration) || 0) * 1000 })
    })
    element.addEventListener('pause', () => { if (isCurrent() && !element.ended) status.set('paused') })
    element.addEventListener('ended', () => { if (isCurrent()) void next() })
    element.addEventListener('error', () => {
      if (!isCurrent()) return
      if (!played && sourceIndex + 1 < sources.length) {
        sourceIndex += 1
        void playSource()
        return
      }
      if (analyse && !played) { void startLocal(item, token, false); return }
      status.set('error')
      message.set('This local track is unavailable. Rescan its music folder and retry.')
    })
    await playSource()
  }

  async function refreshSpotify(token = transition) {
    try {
      const data = await spotifyRequest('/player')
      const state = data?.player || data || {}
      const item = state.item || state.currently_playing || {}
      const snapshot = {
        connected: Boolean(state.device || item.name || state.is_playing),
        title: safeText(item.name),
        subtitle: safeText((item.artists || []).map(entry => entry.name).join(', '), safeText(state.device?.name)),
        playing: Boolean(state.is_playing),
        artwork: safeText(item.album?.images?.[0]?.url),
        album: safeText(item.album?.name),
        context: safeText(state.context?.type),
        uri: safeText(item.uri),
        progressMs: Math.max(0, Number(state.progress_ms) || 0),
        durationMs: Math.max(0, Number(item.duration_ms) || 0),
        device: safeText(state.device?.name),
        deviceType: safeText(state.device?.type),
        volumePercent: Math.max(0, Math.min(100, Number(state.device?.volume_percent) || 0)),
        shuffle: Boolean(state.shuffle_state),
        repeat: safeText(state.repeat_state, 'off')
      }
      spotify.set(snapshot)
      shuffle.set(snapshot.shuffle)
      repeat.set(['off', 'context', 'track'].includes(snapshot.repeat) ? snapshot.repeat : 'off')
      const fingerprint = `${snapshot.playing}:${snapshot.uri}:${snapshot.device}`
      if (fingerprint !== spotifyStateFingerprint) {
        spotifyStateFingerprint = fingerprint
        addLog('state', 'spotify.playback', { playing: snapshot.playing, track: snapshot.uri, device: snapshot.device || 'none', context: snapshot.context || 'none', positionMs: snapshot.progressMs, durationMs: snapshot.durationMs, remainingMs: Math.max(0, snapshot.durationMs - snapshot.progressMs) })
      }
      if (token === transition && current()?.source === 'spotify') {
        spotifyProgressAnchor = { uri: snapshot.uri, positionMs: snapshot.progressMs, durationMs: snapshot.durationMs, playing: snapshot.playing, receivedAt: Date.now() }
        progress.set({ positionMs: snapshot.progressMs, durationMs: snapshot.durationMs })
        const guard = spotifyQueueGuard
        if (guard && guard.token === transition) {
          if (snapshot.uri === guard.expectedUri) {
            guard.seenExpected = true
          } else if (guard.seenExpected && snapshot.uri) {
            requestHermesQueueAdvance('provider-track-changed', snapshot.uri)
          }
          if (guard.seenExpected && !snapshot.playing && snapshot.durationMs > 0 && snapshot.progressMs >= snapshot.durationMs - 1000) {
            requestHermesQueueAdvance('provider-reported-end', snapshot.uri)
          }
        }
        status.set(snapshot.playing ? 'playing' : 'paused')
        if (snapshot.device) message.set('')
      }
      return snapshot
    } catch (error) {
      if (token === transition && current()?.source === 'spotify') {
        status.set('error')
        message.set(error?.message || 'Spotify Connect state could not be confirmed.')
      }
      return null
    }
  }

  async function refreshSpotifyAuth() {
    try {
      const snapshot = normalizeSpotifyAuth(await spotifyRequest('/spotify/auth/status'))
      spotifyAuth.set(snapshot)
      return snapshot
    } catch (error) {
      const snapshot = { state: 'failed', authenticated: false, needsClientId: false, detail: error?.message || 'Spotify authentication status is unavailable.' }
      spotifyAuth.set(snapshot)
      return snapshot
    }
  }

  async function refreshSpotifyDevices({ throwOnError = false } = {}) {
    const refreshVersion = ++spotifyDeviceRefreshVersion
    const hadSelectedDevice = Boolean(spotifyDeviceId)
    try {
      const devices = normalizeSpotifyDevices(await spotifyRequest('/devices'))
      // Discovery may be started by initialization, polling, a manual refresh,
      // or transfer. A late completion must never overwrite newer intent/state.
      if (refreshVersion !== spotifyDeviceRefreshVersion) return devices
      spotifyDevices.set(devices)
      const selectionVanished = hadSelectedDevice && !devices.some(device => device.id === spotifyDeviceId)
      if (selectionVanished) clearSpotifyDeviceSelection()
      if (!spotifyDeviceId && !hadSelectedDevice) {
        const active = devices.find(device => device.active && !device.restricted)
        if (active) {
          spotifyDeviceId = active.id
          ctx.storage.set('spotifyDeviceId', spotifyDeviceId)
        }
      }
      if (!current() && status.get() !== 'error') message.set('')
      return devices
    } catch (error) {
      if (refreshVersion !== spotifyDeviceRefreshVersion) {
        if (throwOnError) throw error
        return []
      }
      spotifyDevices.set([])
      clearSpotifyDeviceSelection()
      if (isSpotifyAuthFailure(error)) {
        spotifyAuth.set({ state: 'failed', authenticated: false, needsClientId: false, detail: error?.message || 'Spotify authentication has expired. Reconnect to continue.' })
      }
      message.set(error?.message || 'Spotify devices could not be refreshed.')
      if (throwOnError) throw error
      return []
    }
  }

  function clearAuthPoll() { if (authTimer) clearTimeout(authTimer); authTimer = null }
  async function pollSpotifyAuth() {
    const snapshot = await refreshSpotifyAuth()
    if (snapshot.authenticated || snapshot.state === 'failed') { clearAuthPoll(); return snapshot }
    authAttempts += 1
    if (authAttempts >= 80) {
      const timeout = { ...snapshot, state: 'timeout', detail: 'Spotify sign-in timed out. Reconnect to try again.' }
      spotifyAuth.set(timeout); clearAuthPoll(); return timeout
    }
    authTimer = setTimeout(() => void pollSpotifyAuth(), 1500)
    return snapshot
  }
  async function startSpotifyAuth(clientId = '') {
    clearAuthPoll(); authAttempts = 0
    spotifyAuth.set({ ...spotifyAuth.get(), state: 'connecting', detail: 'Waiting for browser approval…' })
    const value = safeText(clientId)
    await spotifyRequest('/spotify/auth/start', { method: 'POST', body: value ? { client_id: value } : {} })
    return pollSpotifyAuth()
  }
  async function transferSpotifyDevice(deviceId) {
    const id = safeText(deviceId)
    if (!id) throw new Error('Choose a Spotify device first.')
    await spotifyRequest('/transfer', { method: 'PUT', body: { device_id: id, play: false } })
    spotifyDeviceId = id
    ctx.storage.set('spotifyDeviceId', id)
    await refreshSpotify()
    return refreshSpotifyDevices()
  }

  function hydrateLocalReferences(items) {
    return items.map(item => {
      if (item?.source !== 'local' || item.objectUrl?.startsWith('blob:')) return item
      return localRegistry.get(item.localTrackId) || localRegistry.get(item.id) || { ...item, unavailable: true, filePath: '', playbackUrls: [] }
    })
  }

  async function refreshLocalLibrary() {
    const version = ++localRefreshVersion
    const [rootsData, tracksData] = await Promise.all([
      request('/local/roots'),
      request('/local/tracks?include_missing=true&limit=5000&offset=0')
    ])
    if (disposed || version !== localRefreshVersion) return { roots: localRoots.get(), tracks: localTracks.get() }
    const roots = Array.isArray(rootsData?.roots) ? rootsData.roots : []
    const tracks = (Array.isArray(tracksData?.items) ? tracksData.items : []).map(localTrackItem).filter(Boolean)
    localRoots.set(roots)
    localTracks.set(tracks)
    const sessionTracks = [...localRegistry.values()].filter(item => item.objectUrl?.startsWith('blob:'))
    localRegistry.clear()
    sessionTracks.forEach(item => localRegistry.set(item.id, item))
    tracks.forEach(item => {
      if (item.localTrackId) localRegistry.set(item.localTrackId, item)
      localRegistry.set(item.id, item)
    })
    queue.set(hydrateLocalReferences(queue.get()))
    persist()
    return { roots, tracks }
  }

  function openLocalFiles(files) {
    const selected = Array.from(files || [])
    const supported = selected.filter(file => isSupportedLocalAudio(file) && file.size > 0)
    if (sessionTracks.get().length + supported.length > 500) throw new Error('Open up to 500 session files. Restart or use indexed folders for larger libraries.')
    const opened = []
    try {
      supported.forEach(file => {
        const objectUrl = URL.createObjectURL(file)
        const item = normalizeQueueItem({ source: 'local', id: `session:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`, title: file.name.replace(/\.[^.]+$/, ''), subtitle: 'Opened file · this session only', objectUrl, mimeType: file.type })
        if (item) opened.push(item)
        else URL.revokeObjectURL(objectUrl)
      })
    } catch (error) { opened.forEach(revokeLocal); throw new Error(userFacingError(error, 'Those files could not be opened.')) }
    const before = queue.get().length
    opened.forEach(item => localRegistry.set(item.id, item))
    sessionTracks.set([...sessionTracks.get(), ...opened])
    queue.set([...queue.get(), ...opened])
    if (index.get() < 0 && opened.length) { index.set(before); status.set('paused') }
    persist()
    message.set(opened.length ? `Opened ${opened.length} audio file(s). Select Play to listen with visualization. Session files are not saved to playlists and must be reopened after restart.${selected.length > opened.length ? ` Skipped ${selected.length - opened.length} unsupported/empty file(s).` : ''}` : 'Choose non-empty supported audio files.')
    return opened.length
  }

  async function addLocalRoot(path) {
    const folder = safeText(path)
    if (!folder) throw new Error('Choose a music folder first.')
    await request('/local/roots', { method: 'POST', body: { path: folder }, timeoutMs: 120000 })
    return refreshLocalLibrary()
  }

  async function chooseLocalRoot() {
    const path = await ctx.os?.pickOpenPath?.({ directories: true, multiple: false, title: 'Choose a music folder' })
    if (!path) return null
    return addLocalRoot(path)
  }

  async function rescanLocalLibrary(rootId = '') {
    await request('/local/rescan', { method: 'POST', body: rootId ? { root_id: rootId } : {}, timeoutMs: 120000 })
    return refreshLocalLibrary()
  }

  async function removeLocalRoot(rootId) {
    const id = safeText(rootId)
    if (!id) return false
    await request(`/local/roots/${encodeURIComponent(id)}`, { method: 'DELETE' })
    await refreshLocalLibrary()
    return true
  }

  async function stopActive(item) {
    if (item?.source === 'radio' || item?.source === 'local') stopInternalAudio()
    if (item?.source === 'spotify') {
      await spotifyRequest('/pause', { method: 'POST', body: spotifyCommandBody() })
    }
  }

  function runTransition(work) {
    const token = ++transition
    transitionChain = transitionChain.catch(() => {}).then(() => disposed ? false : work(token)).catch(error => {
      if (!disposed && token === transition) { status.set('error'); message.set(userFacingError(error)) }
      return false
    })
    return transitionChain
  }

  async function startSelected(nextIndex, token, contextPosition = null) {
    const item = queue.get()[nextIndex]
    if (!item || token !== transition || disposed) return
    index.set(nextIndex)
    persist()
    message.set('')
    if (item.source !== 'spotify') {
      spotifyProgressAnchor = null
      spotifyQueueGuard = null
    }
    if (item.source === 'radio') {
      await startRadio(item, true, token)
      return
    }
    if (item.source === 'local') {
      await startLocal(item, token)
      return
    }
    if (item.source === 'spotify') {
      armSpotifyQueueGuard(item, token)
      status.set('loading')
      try {
        const payload = Number.isInteger(contextPosition) ? { context_uri: item.uri, offset: contextPosition } : spotifyPlayPayload(item)
        await spotifyRequest('/play', { method: 'POST', body: spotifyCommandBody(payload) })
        spotifyStartedUri = item.uri
        if (token === transition) await refreshSpotify(token)
      } catch (error) {
        if (token === transition) {
          status.set('error')
          message.set(error?.message || 'Spotify Connect could not start this item. Open Spotify on a Connect device and try again.')
        }
      }
      return
    }
  }

  function playAt(nextIndex) {
    if (nextIndex < 0 || nextIndex >= queue.get().length) {
      status.set('idle')
      message.set('Add Spotify, radio, or local music to start a mixed queue.')
      return Promise.resolve()
    }
    return runTransition(async token => {
      if (token !== transition) return
      const previous = current()
      await stopActive(previous)
      if (token !== transition) return
      await startSelected(nextIndex, token)
    })
  }

  function toggle() {
    return runTransition(async token => {
      if (token !== transition) return
      const item = current()
      if (!item) { status.set('idle'); return }

      if (item.source === 'radio') {
        if (status.get() === 'playing' || status.get() === 'loading') {
          stopInternalAudio()
          if (token === transition) status.set('paused')
        } else {
          await startRadio(item, true, token)
        }
        return
      }
      if (item.source === 'local') {
        if ((status.get() === 'playing' || status.get() === 'loading') && audioSource === 'local' && audio) {
          audio.pause()
          if (token === transition) status.set('paused')
        } else if (audioSource === 'local' && audio) {
          try { await audio.play() } catch { if (token === transition) status.set('error') }
        } else {
          await startLocal(item, token)
        }
        return
      }
      const pause = status.get() === 'playing'
      status.set('loading')
      try {
        if (!pause) armSpotifyQueueGuard(item, token)
        const resume = spotifyStartedUri === item.uri
        await spotifyRequest(pause ? '/pause' : '/play', { method: 'POST', body: spotifyCommandBody(pause || resume ? {} : spotifyPlayPayload(item)) })
        if (!pause) spotifyStartedUri = item.uri
        if (token === transition) await refreshSpotify(token)
      } catch (error) {
        if (token === transition) {
          status.set('error')
          message.set(error?.message || 'Spotify Connect did not accept the transport request.')
        }
      }
    })
  }

  function next() {
    const item = current()
    if (item?.source === 'spotify' && (spotifyAutoplay.get() || /^spotify:(album|playlist):/.test(item.uri))) {
      return runTransition(async token => {
        if (token !== transition) return false
        await spotifyRequest('/next', { method: 'POST', body: spotifyCommandBody() })
        if (token === transition) await refreshSpotify(token)
      })
    }
    const nextIndex = nextQueueIndex(queue.get().length, index.get())
    return nextIndex < 0 ? playAt(-1) : playAt(nextIndex)
  }

  function previous() {
    const item = current()
    if (item?.source === 'spotify') {
      return runTransition(async token => {
        status.set('loading')
        try {
          await spotifyRequest('/previous', { method: 'POST', body: spotifyCommandBody() })
          if (token === transition) await refreshSpotify(token)
        } catch (error) {
          if (token === transition) { status.set('error'); message.set(error?.message || 'Spotify could not move to the previous track.') }
        }
      })
    }
    const previousIndex = previousQueueIndex(queue.get().length, index.get())
    return previousIndex < 0 ? playAt(-1) : playAt(previousIndex)
  }

  async function seekTo(positionMs) {
    const item = current()
    const durationMs = progress.get().durationMs
    const target = Math.max(0, Math.min(durationMs || 86_400_000, Number(positionMs) || 0))
    if (item?.source === 'local' && audioSource === 'local' && audio) {
      audio.currentTime = target / 1000
      progress.set({ positionMs: target, durationMs })
      return
    }
    if (item?.source === 'spotify') {
      await spotifyRequest('/seek', { method: 'PUT', body: spotifyCommandBody({ position_ms: Math.round(target) }) })
      progress.set({ positionMs: target, durationMs })
      await refreshSpotify()
    }
  }

  async function setShuffle(value) {
    if (current()?.source !== 'spotify') return
    const state = Boolean(value)
    await spotifyRequest('/shuffle', { method: 'PUT', body: spotifyCommandBody({ state }) })
    shuffle.set(state)
  }

  async function setRepeat(value) {
    if (current()?.source !== 'spotify') return
    const state = ['off', 'context', 'track'].includes(value) ? value : 'off'
    await spotifyRequest('/repeat', { method: 'PUT', body: spotifyCommandBody({ state }) })
    repeat.set(state)
  }

  function add(item, play = false) {
    const normalized = normalizeQueueItem(item)
    if (!normalized) {
      message.set('That item is not a supported public Spotify, HTTPS radio, or indexed local audio entry.')
      return false
    }
    if (normalized.source === 'local' && normalized.unavailable) {
      message.set('That local track is unavailable. Rescan its music folder first.')
      return false
    }
    if (normalized.source === 'local') {
      localRegistry.set(normalized.id, normalized)
      if (normalized.localTrackId) localRegistry.set(normalized.localTrackId, normalized)
    }
    const next = [...queue.get(), normalized]
    queue.set(next)
    if (index.get() === -1) {
      index.set(next.length - 1)
      status.set('paused')
    }
    persist()
    if (play) void playAt(next.length - 1)
    return true
  }

  function remove(at) {
    const items = queue.get()
    if (!Number.isInteger(at) || at < 0 || at >= items.length) return Promise.resolve(false)
    if (at !== index.get()) {
      queue.set(items.filter((_, position) => position !== at))
      if (at < index.get()) index.set(index.get() - 1)
      persist()
      return Promise.resolve(true)
    }
    const wasPlaying = ['playing', 'loading'].includes(status.get())
    return runTransition(async token => {
      const items = queue.get()
      if (at < 0 || at >= items.length || token !== transition) return
      const currentIndex = index.get()
      const removingCurrent = at === currentIndex
      const previous = removingCurrent ? current() : null
      if (removingCurrent) await stopActive(previous)
      if (token !== transition) return
      const nextItems = items.filter((_, itemIndex) => itemIndex !== at)
      queue.set(nextItems)
      if (!nextItems.length) {
        index.set(-1)
        status.set('idle')
        persist()
        return
      }
      if (!removingCurrent) {
        if (at < currentIndex) index.set(currentIndex - 1)
        persist()
        return
      }
      const successor = Math.min(at, nextItems.length - 1)
      index.set(successor)
      persist()
      progress.set({ positionMs: 0, durationMs: 0 })
      spotifyQueueGuard = null
      spotifyProgressAnchor = null
      if (wasPlaying) await startSelected(successor, token)
      else status.set('paused')
    })
  }

  function move(at, direction) {
    const items = [...queue.get()]
    const target = at + direction
    if (!Number.isInteger(at) || !Number.isInteger(direction) || at < 0 || at >= items.length || target < 0 || target >= items.length) return
    ;[items[at], items[target]] = [items[target], items[at]]
    const currentIndex = index.get()
    queue.set(items)
    if (currentIndex === at) index.set(target)
    else if (currentIndex === target) index.set(at)
    persist()
  }

  function toggleMute() {
    setVolume(volume.get() > 0 ? 0 : unmutedVolume)
  }

  function setVolume(value) {
    const next = clampVolume(value)
    volume.set(next)
    if (next > 0) { unmutedVolume = next; ctx.storage.set('unmutedVolume', next) }
    const version = ++volumeVersion
    if (volumeTimer) clearTimeout(volumeTimer)
    if (audio && !gain) audio.volume = next
    if (gain) {
      const now = context?.currentTime || 0
      gain.gain.cancelAndHoldAtTime?.(now)
      gain.gain.setTargetAtTime(next, now, .015)
    }
    if (current()?.source === 'spotify') {
      const body = spotifyCommandBody({ volume_percent: Math.round(next * 100) })
      volumeTimer = setTimeout(() => {
        if (disposed || version !== volumeVersion || current()?.source !== 'spotify') return
        void spotifyRequest('/volume', { method: 'PUT', body }).catch(error => { if (version === volumeVersion) message.set(error?.message || 'Spotify volume could not be changed.') })
      }, 180)
    }
    persist()
  }

  function toggleFavorite(item) {
    const normalized = normalizeQueueItem(item)
    if (!normalized || normalized.source === 'local') return
    const existing = favorites.get()
    const has = existing.some(entry => entry.id === normalized.id)
    favorites.set(has ? existing.filter(entry => entry.id !== normalized.id) : [...existing, normalized])
    persist()
  }

  function clearQueue() {
    return runTransition(async token => {
      if (token !== transition) return false
      await stopActive(current())
      if (token !== transition) return false
      queue.set([])
      index.set(-1)
      spotifyQueueGuard = null
      spotifyProgressAnchor = null
      spotifyStartedUri = ''
      progress.set({ positionMs: 0, durationMs: 0 })
      status.set('idle')
      message.set('')
      persist()
      return true
    })
  }

  function resetSavedRadio() {
    favorites.set(favorites.get().filter(item => item.source !== 'radio'))
    persist()
  }

  function createPlaylist(name, description = '') {
    undoState.set(null)
    const now = new Date().toISOString()
    const playlist = { id: `playlist:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: safeText(name, 'Untitled playlist'), description: safeText(description), createdAt: now, updatedAt: now, items: [] }
    playlists.set([...playlists.get(), playlist])
    persistPlaylists()
    return playlist
  }

  function updatePlaylist(id, changes = {}) {
    undoState.set(null)
    let updated = null
    playlists.set(playlists.get().map(entry => {
      if (entry.id !== id) return entry
      updated = { ...entry, name: safeText(changes.name, entry.name), description: typeof changes.description === 'string' ? changes.description.trim() : entry.description, updatedAt: new Date().toISOString() }
      return updated
    }))
    persistPlaylists()
    return updated
  }

  function deletePlaylist(id) {
    const before = playlists.get()
    if (!before.some(entry => entry.id === id)) return false
    rememberPlaylistEdit('Delete playlist')
    playlists.set(before.filter(entry => entry.id !== id))
    persistPlaylists()
    return playlists.get().length !== before.length
  }

  function duplicatePlaylist(id) {
    const original = playlists.get().find(entry => entry.id === id)
    if (!original) return null
    const copy = createPlaylist(`${original.name} copy`, original.description)
    const items = original.items.map(item => ({ ...item }))
    playlists.set(playlists.get().map(entry => entry.id === copy.id ? { ...entry, items } : entry))
    persistPlaylists()
    return playlists.get().find(entry => entry.id === copy.id)
  }

  function addToPlaylist(id, value) {
    undoState.set(null)
    const normalized = normalizeQueueItem(value)
    if (!normalized) return false
    if (normalized.source === 'local' && !normalized.localTrackId) { message.set('Session files cannot be saved to playlists. Index their folder to create persistent references.'); return false }
    if (normalized.source === 'local' && !normalized.unavailable) {
      localRegistry.set(normalized.id, normalized)
      if (normalized.localTrackId) localRegistry.set(normalized.localTrackId, normalized)
    }
    const stored = serializePlaylistItem(normalized)
    let found = false
    playlists.set(playlists.get().map(entry => {
      if (entry.id !== id) return entry
      found = true
      return { ...entry, items: [...entry.items, stored], updatedAt: new Date().toISOString() }
    }))
    if (found) persistPlaylists()
    return found
  }

  function removeFromPlaylist(id, at) {
    return removePlaylistItems(id, [at])
  }

  function moveInPlaylist(id, at, direction) {
    undoState.set(null)
    playlists.set(playlists.get().map(entry => {
      if (entry.id !== id) return entry
      const items = [...entry.items]
      const target = at + direction
      if (!Number.isInteger(at) || !Number.isInteger(direction) || at < 0 || at >= items.length || target < 0 || target >= items.length) return entry
      ;[items[at], items[target]] = [items[target], items[at]]
      return { ...entry, items, updatedAt: new Date().toISOString() }
    }))
    persistPlaylists()
  }

  function playlistItems(id) {
    const playlist = playlists.get().find(entry => entry.id === id)
    return hydrateLocalReferences(playlist?.items || [])
  }

  function playPlaylist(id, startAt = 0) {
    const items = playlistItems(id)
    if (!Number.isInteger(startAt) || startAt < 0 || startAt >= items.length) {
      message.set('This playlist is empty. Add tracks before playing it.')
      return Promise.resolve(false)
    }
    const selected = items[startAt]
    const playable = items.filter(item => item && !item.unavailable)
    if (!playable.length || selected?.unavailable) {
      message.set('The selected local track is missing. Rescan its folder or choose another track. Your queue has not changed.')
      return Promise.resolve(false)
    }
    const nextIndex = items.slice(0, startAt).filter(item => !item.unavailable).length
    return runTransition(async token => {
      if (token !== transition) return false
      await stopActive(current())
      if (token !== transition) return false
      queue.set(playable.map(item => ({ ...item })))
      index.set(nextIndex)
      persist()
      await startSelected(nextIndex, token)
      if (items.length !== playable.length) message.set(`${items.length - playable.length} missing local track(s) skipped. Saved playlist unchanged.`)
      return token === transition && status.get() !== 'error'
    })
  }

  function enqueuePlaylist(id) {
    const items = playlistItems(id)
    const playable = items.filter(item => !item.unavailable)
    if (!playable.length) { message.set('No playable tracks to add. Your queue has not changed.'); return 0 }
    const before = queue.get().length
    queue.set([...queue.get(), ...playable.map(item => ({ ...item }))])
    if (index.get() < 0) { index.set(before); status.set('paused') }
    persist()
    message.set(`Added ${playable.length} item(s) to the queue.${items.length > playable.length ? ` Skipped ${items.length - playable.length} missing track(s).` : ''}`)
    return playable.length
  }

  function saveQueueAsPlaylist(name) {
    const items = queue.get().filter(item => item.source !== 'local' || item.localTrackId).map(serializePlaylistItem).filter(Boolean)
    if (!items.length) { message.set('There are no persistent items to save.'); return null }
    const playlist = createPlaylist(name)
    playlists.set(playlists.get().map(entry => entry.id === playlist.id ? { ...entry, items } : entry))
    persistPlaylists()
    return playlists.get().find(entry => entry.id === playlist.id)
  }

  function addManyToPlaylist(id, values) {
    undoState.set(null)
    const items = (Array.isArray(values) ? values : []).map(normalizeQueueItem).filter(Boolean)
    let count = 0
    // Commit once, preserving duplicate occurrences and their order.
    playlists.set(playlists.get().map(entry => {
      if (entry.id !== id) return entry
      const stored = items.filter(item => item.source !== 'local' || item.localTrackId).map(item => {
        if (item.source === 'local' && !item.unavailable) {
          localRegistry.set(item.id, item)
          if (item.localTrackId) localRegistry.set(item.localTrackId, item)
        }
        return serializePlaylistItem(item)
      }).filter(Boolean)
      count = stored.length
      return { ...entry, items: [...entry.items, ...stored], updatedAt: new Date().toISOString() }
    }))
    if (count) persistPlaylists()
    return count
  }

  function rememberPlaylistEdit(label) {
    undoState.set({ label, playlists: playlists.get().map(entry => ({ ...entry, items: entry.items.map(item => ({ ...item })) })) })
  }

  function undoPlaylistEdit() {
    const saved = undoState.get()
    if (!saved) return false
    playlists.set(saved.playlists)
    undoState.set(null)
    persistPlaylists()
    return true
  }

  function removePlaylistItems(id, positions) {
    const selected = new Set(positions.filter(Number.isInteger))
    if (!selected.size) return 0
    rememberPlaylistEdit('Remove tracks')
    let removed = 0
    playlists.set(playlists.get().map(entry => {
      if (entry.id !== id) return entry
      const items = entry.items.filter((_, at) => !selected.has(at))
      removed = entry.items.length - items.length
      return { ...entry, items, updatedAt: new Date().toISOString() }
    }))
    persistPlaylists()
    return removed
  }

  function deduplicatePlaylist(id) {
    const playlist = playlists.get().find(entry => entry.id === id)
    if (!playlist) return 0
    const seen = new Set()
    const duplicates = []
    playlist.items.forEach((item, at) => {
      const key = `${item.source}:${item.uri || item.localTrackId || item.streamUrl || item.id}`
      if (seen.has(key)) duplicates.push(at)
      else seen.add(key)
    })
    return removePlaylistItems(id, duplicates)
  }

  function exportPlaylists(id = '') {
    return JSON.stringify({ format: 'fluid-music', ...normalizePlaylistState({ playlists: playlists.get().filter(entry => !id || entry.id === id) }) }, null, 2)
  }

  function importPlaylists(text) {
    if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Choose a FluidMusic JSON file smaller than 2 MB.')
    let data
    try { data = JSON.parse(text) } catch { throw new Error('That file is not valid JSON.') }
    if (data?.format !== 'fluid-music' || !Array.isArray(data.playlists) || data.playlists.length > 200) throw new Error('Choose a FluidMusic playlist export (up to 200 playlists).')
    if (data.playlists.some(entry => !entry || typeof entry.name !== 'string' || !Array.isArray(entry.items) || entry.items.length > 10000)) throw new Error('Invalid playlist structure or too many tracks.')
    const normalized = normalizePlaylistState(data)
    const supplied = data.playlists.reduce((count, entry) => count + entry.items.length, 0)
    const accepted = normalized.playlists.reduce((count, entry) => count + entry.items.length, 0)
    if (accepted !== supplied) throw new Error('The file contains unsupported or invalid tracks. Nothing was imported.')
    rememberPlaylistEdit('Import playlists')
    const imported = normalized.playlists.map(entry => ({ ...entry, id: `playlist:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` }))
    playlists.set([...playlists.get(), ...imported])
    persistPlaylists()
    return imported
  }

  function setWorkspaceView(view) {
    const next = isWorkspaceView(view)
    workspaceView.set(next)
    ctx.storage.set('workspaceView', next)
  }

  function selectPlaylist(id) {
    selectedPlaylist.set(id)
    ctx.storage.set('selectedPlaylist', id)
  }


  function syncAnalyser() {
    if (!mediaSource || !gain || disposed) return
    if (visualConsumers.size && !analyser) {
      analyser = context.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = .72
      // Analysis is a side tap. Never break or reroute source → gain → speakers.
      mediaSource.connect(analyser)
      radioMeter.set('analyser')
    } else if (!visualConsumers.size && analyser) {
      mediaSource.disconnect(analyser)
      analyser.disconnect()
      analyser = null
      visualBuffer = null
      radioMeter.set('ready')
    }
  }

  function acquireVisualizer() {
    const consumer = Symbol('visualizer')
    visualConsumers.add(consumer)
    syncAnalyser()
    return () => { visualConsumers.delete(consumer); syncAnalyser() }
  }

  function visualSamples(style = 'wave') {
    if (!visualConsumers.size || !analyser || status.get() !== 'playing' || disposed) return null
    const length = style === 'wave' ? analyser.fftSize : analyser.frequencyBinCount
    if (!visualBuffer || visualBuffer.length !== length) visualBuffer = new Uint8Array(length)
    if (style === 'wave') analyser.getByteTimeDomainData(visualBuffer)
    else analyser.getByteFrequencyData(visualBuffer)
    visualReads++
    return visualBuffer
  }
  function radioSamples() { return visualSamples('wave') }
  function setStatusVisualizer(value) { statusVisualizer.set(Boolean(value)); ctx.storage.set('statusVisualizer', Boolean(value)) }
  function setMiniVisualizer(value) { miniVisualizer.set(Boolean(value)); ctx.storage.set('miniVisualizer', Boolean(value)) }
  function setVisualizerStyle(value) { if (['bars', 'wave', 'mirror'].includes(value)) { visualizerStyle.set(value); ctx.storage.set('visualizerStyle', value) } }
  const visualDiagnostics = () => ({ consumers: visualConsumers.size, analyser: Boolean(analyser), reads: visualReads })

  const spotifyTrack = track => normalizeQueueItem({
    source: 'spotify', id: track?.id, title: track?.name, subtitle: (track?.artists || []).map(artist => artist.name).join(', '), uri: track?.uri,
    contextUri: track?.album?.uri, artwork: track?.album?.images?.[0]?.url, album: track?.album?.name, durationMs: track?.duration_ms, kind: 'track', explicit: track?.explicit
  })

  async function searchSpotify(query) {
    const data = await spotifyRequest(`/search?q=${encodeURIComponent(query)}&type=track&limit=10&offset=0`)
    const tracks = data?.tracks?.items || []
    return tracks.map(spotifyTrack).filter(Boolean)
  }

  async function searchSpotifyCatalog(query, offset = 0) {
    const data = await spotifyRequest(`/search?q=${encodeURIComponent(query)}&type=track,album,artist,playlist&limit=10&offset=${Math.max(0, Number(offset) || 0)}`)
    const tracks = (data?.tracks?.items || []).map(spotifyTrack).filter(Boolean)
    const albums = (data?.albums?.items || []).map(album => normalizeQueueItem({ source: 'spotify', id: album.id, title: album.name, subtitle: (album.artists || []).map(artist => artist.name).join(', '), uri: album.uri, artwork: album.images?.[0]?.url, kind: 'album' })).filter(Boolean)
    const spotifyPlaylists = (data?.playlists?.items || []).filter(Boolean).map(playlist => normalizeQueueItem({ source: 'spotify', id: playlist.id, title: playlist.name, subtitle: playlist.owner?.display_name || 'Spotify playlist', uri: playlist.uri, artwork: playlist.images?.[0]?.url, kind: 'playlist' })).filter(Boolean)
    const artists = (data?.artists?.items || []).map(artist => ({ id: safeText(artist.id), source: 'spotify', kind: 'artist', title: safeText(artist.name, 'Artist'), subtitle: `${Number(artist.followers?.total || 0).toLocaleString()} followers`, artwork: safeText(artist.images?.[0]?.url), uri: safeText(artist.uri), genres: Array.isArray(artist.genres) ? artist.genres.slice(0, 3) : [] }))
    return { tracks, albums, playlists: spotifyPlaylists, artists }
  }

  async function loadSpotifyPlaylists(offset = 0) {
    const data = await spotifyRequest(`/playlists?limit=50&offset=${Math.max(0, Number(offset) || 0)}`)
    return { items: (data?.items || []).filter(Boolean).map(playlist => ({ id: safeText(playlist.id), name: safeText(playlist.name, 'Untitled playlist'), description: safeText(playlist.description), owner: safeText(playlist.owner?.display_name, safeText(playlist.owner?.id)), artwork: safeText(playlist.images?.[0]?.url), uri: safeText(playlist.uri), visibility: playlist.public === true ? 'Public' : playlist.public === false ? 'Private' : 'Unlisted', collaborative: Boolean(playlist.collaborative), trackCount: Math.max(0, Number(playlist.items?.total ?? playlist.tracks?.total) || 0) })), total: Math.max(0, Number(data?.total) || 0), next: Boolean(data?.next) }
  }

  async function loadSpotifyPlaylist(playlist, offset = 0) {
    const uri = safeText(playlist?.uri)
    const id = /^spotify:playlist:[A-Za-z0-9]+$/.test(uri) ? uri.split(':')[2] : safeText(playlist?.id)
    if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error('Choose a valid Spotify playlist first.')
    const start = Math.max(0, Math.floor(Number(offset) || 0))
    const data = await spotifyRequest(`/playlists/${encodeURIComponent(id)}/tracks?limit=50&offset=${start}`)
    if (!Array.isArray(data?.items)) throw new Error('Spotify did not return playlist tracks. Retry or reconnect Spotify.')
    const tracks = data.items.map((entry, at) => {
      const track = spotifyTrack(entry?.track || entry?.item || entry)
      if (!track) return null
      return { ...track, contextUri: `spotify:playlist:${id}`, contextPosition: start + at }
    }).filter(Boolean)
    const total = Number.isFinite(data.total) ? Math.max(0, data.total) : start + data.items.length
    const nextOffset = start + data.items.length
    return { playlist, tracks, total, next: Boolean(data.next) || nextOffset < total, nextOffset, skipped: data.items.length - tracks.length }
  }

  function playSpotifyPlaylistTrack(queueItem, track) {
    if (!/^spotify:playlist:[A-Za-z0-9]+$/.test(queueItem?.uri || '') || track?.contextUri !== queueItem.uri || !Number.isInteger(track.contextPosition) || track.contextPosition < 0 || track.contextPosition > 10000) {
      message.set('Refresh this Spotify playlist before choosing the track.')
      return Promise.resolve(false)
    }
    return runTransition(async token => {
      if (token !== transition) return false
      let at = queue.get().indexOf(queueItem)
      if (at < 0) { message.set('That playlist is no longer in the queue.'); return false }
      const previous = current()
      if (previous?.source !== 'spotify') await stopActive(previous)
      if (token !== transition) return false
      at = queue.get().indexOf(queueItem)
      if (at < 0) return false
      await startSelected(at, token, track.contextPosition)
      return token === transition && status.get() !== 'error'
    })
  }

  async function resolvePlaylistSave(item, mode, options = {}) {
    const normalized = normalizeQueueItem(item)
    if (!normalized) throw new Error('Choose a supported track or playlist.')
    if (normalized.source === 'local' && !normalized.localTrackId) throw new Error('Index this file’s folder before saving it to a playlist.')
    const checkCancelled = () => { if (disposed || options.signal?.aborted) throw new Error('Save cancelled. Nothing was changed.') }
    checkCancelled()
    if (mode !== 'tracks' || !/^spotify:playlist:/.test(normalized.uri || '')) return { items: [serializePlaylistItem(normalized)], skipped: 0 }
    const items = []
    let offset = 0, skipped = 0, expectedTotal = null
    do {
      checkCancelled()
      const page = await loadSpotifyPlaylist(normalized, offset)
      checkCancelled()
      if (page.total > 10000 || (expectedTotal !== null && expectedTotal !== page.total)) throw new Error('This playlist is too large or changed while loading. Nothing was saved; retry with a stable playlist of up to 10,000 items.')
      expectedTotal = page.total
      skipped += page.skipped
      items.push(...page.tracks.map(track => serializePlaylistItem({ ...track, contextUri: '' })))
      options.onProgress?.({ loaded: page.nextOffset, total: page.total })
      if (!page.next) break
      if (page.nextOffset <= offset || page.nextOffset >= 10000) throw new Error('Spotify pagination could not complete. Nothing was saved; retry.')
      offset = page.nextOffset
    } while (true)
    if (!items.length) throw new Error('This Spotify playlist has no supported tracks to save.')
    return { items, skipped }
  }

  async function saveToPlaylist({ id = '', name = '', item, mode = 'tracks', signal, onProgress } = {}) {
    // Resolve all pages first. No empty destination or partial copy is published on failure/cancel.
    if (!id && !safeText(name)) throw new Error('Enter a playlist name.')
    if (id && !playlists.get().some(entry => entry.id === id)) throw new Error('Choose an existing destination playlist.')
    const resolved = await resolvePlaylistSave(item, mode, { signal, onProgress })
    if (disposed || signal?.aborted) throw new Error('Save cancelled. Nothing was changed.')
    const existing = playlists.get()
    if (id && !existing.some(entry => entry.id === id)) throw new Error('The destination was deleted. Nothing was saved.')
    const now = new Date().toISOString()
    const destinationId = id || `playlist:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    const next = id ? existing.map(entry => entry.id === id ? { ...entry, items: [...entry.items, ...resolved.items], updatedAt: now } : entry) : [...existing, { id: destinationId, name: safeText(name), description: '', createdAt: now, updatedAt: now, items: resolved.items }]
    const state = { version: 3, playlists: next }
    ctx.storage.set('playlistState', state)
    if (JSON.stringify(ctx.storage.get('playlistState', null)) !== JSON.stringify(state)) throw new Error('Playlist storage could not confirm the save. Check available storage and retry.')
    undoState.set(null)
    playlists.set(next)
    return { playlist: next.find(entry => entry.id === destinationId), added: resolved.items.length, skipped: resolved.skipped }
  }

  function restartSpotifyPolling() {
    if (spotifyTimer) clearInterval(spotifyTimer)
    spotifyTimer = setInterval(() => {
      void refreshSpotify()
      void refreshSpotifyDevices()
    }, 1000 * (pollOpen ? pollIntervalOpen : pollIntervalClosed))
  }

  function setPollingOpen(open) {
    pollOpen = Boolean(open)
    restartSpotifyPolling()
  }

  async function loadConfig() {
    try {
      const config = await request('/config')
      if (disposed) return
      const settings = config?.settings || config || {}
      pollIntervalOpen = Math.max(8, Number(settings.poll_interval_open) || pollIntervalOpen)
      pollIntervalClosed = Math.max(20, Number(settings.poll_interval_closed) || pollIntervalClosed)
      restartSpotifyPolling()
    } catch { /* Default polling intervals remain safe when config is unavailable. */ }
  }

  restartSpotifyPolling()
  spotifyProgressTimer = setInterval(updateSpotifyProgress, 500)
  void loadConfig()
  void refreshSpotify()
  void refreshSpotifyAuth()
  void refreshSpotifyDevices()
  void refreshLocalLibrary().catch(() => {})
  ctx.onDispose(() => {
    disposed = true
    transition += 1
    clearInterval(spotifyTimer)
    clearInterval(spotifyProgressTimer)
    clearAuthPoll()
    clearTimeout(volumeTimer)
    stopInternalAudio()
    new Set([...queue.get(), ...localRegistry.values()]).forEach(revokeLocal)
    if (context) void context.close()
  })
  return {
    visualSampleRate: () => context?.sampleRate || 0,
    statusVisualizer, miniVisualizer, visualizerStyle, setStatusVisualizer, setMiniVisualizer, setVisualizerStyle, acquireVisualizer, visualSamples, visualDiagnostics,
    workspaceView, setWorkspaceView, selectedPlaylist, selectPlaylist, undoState, undoPlaylistEdit, toggleMute,
    playlistItems, enqueuePlaylist, saveQueueAsPlaylist, addManyToPlaylist, removePlaylistItems, deduplicatePlaylist, exportPlaylists, importPlaylists,
    queue, index, favorites, volume, status, message, logs, spotify, spotifyAuth, spotifyDevices, radioMeter, progress, playlists, localTracks, localRoots, shuffle, repeat, spotifyAutoplay,
    current, add, remove, move, clearQueue, resetSavedRadio, next, previous, playAt, toggle, seekTo, setVolume, setShuffle, setRepeat, setSpotifyAutoplay,
    toggleFavorite, radioSamples, refreshSpotify, refreshSpotifyAuth, refreshSpotifyDevices, startSpotifyAuth, transferSpotifyDevice,
    sessionTracks, openLocalFiles, refreshLocalLibrary, addLocalRoot, chooseLocalRoot, rescanLocalLibrary, removeLocalRoot,
    searchSpotify, searchSpotifyCatalog, loadSpotifyPlaylists, loadSpotifyPlaylist, playSpotifyPlaylistTrack, saveToPlaylist,
    createPlaylist, updatePlaylist, deletePlaylist, duplicatePlaylist, addToPlaylist, removeFromPlaylist, moveInPlaylist, playPlaylist,
    capabilities: () => mediaCapabilities(current()), clearLogs, setPollingOpen, rest: api, polling: () => ({ open: pollIntervalOpen, closed: pollIntervalClosed })
  }
}
/* CONTROLLER_END */