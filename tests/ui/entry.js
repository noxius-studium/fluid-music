import React from 'react'
import { createRoot } from 'react-dom/client'
import plugin from '../../desktop/plugin.js'

// All catalog entries and provider responses below are explicitly test fixtures.
// Playback tests use a generated WAV through Chromium's REAL Audio/AudioContext.
const stored = JSON.parse(localStorage.getItem('fluid-test-storage') || '{}')
const contributions = [],
  disposers = [],
  calls = []
const faults = { playlistDelayMs: 0, failSecondPage: false }
const ctx = {
  storage: {
    get: (key, fallback) => stored[key] ?? fallback,
    set: (key, value) => {
      stored[key] = value
      localStorage.setItem('fluid-test-storage', JSON.stringify(stored))
    },
  },
  onDispose: (fn) => disposers.push(fn),
  register: (entry) => contributions.push(entry),
  os: { pickOpenPath: async () => null },
  rest: async (path, options) => {
    calls.push({ path, options })
    if (path === '/config') return { ok: true, data: {} }
    if (path === '/spotify/auth/status') return { ok: true, data: { authenticated: true } }
    if (path === '/devices')
      return {
        ok: true,
        data: {
          devices: [{ id: 'test-device', name: 'Test speaker', is_active: true }],
        },
      }
    if (path === '/player') return { ok: true, data: { is_playing: false } }
    if (path === '/local/roots') return { ok: true, data: { roots: [] } }
    if (path.startsWith('/local/tracks')) return { ok: true, data: { items: [], total: 0 } }
    if (path.startsWith('/playlists?'))
      return {
        ok: true,
        data: {
          items: [
            {
              id: 'testlist',
              name: 'Fixture Spotify playlist',
              uri: 'spotify:playlist:testlist',
              tracks: { total: 51 },
              owner: { display_name: 'Test user' },
            },
          ],
          total: 1,
          next: null,
        },
      }
    if (path.startsWith('/playlists/testlist/tracks')) {
      const nextPage = path.includes('offset=50')
      if (faults.playlistDelayMs)
        await new Promise((resolve) => setTimeout(resolve, faults.playlistDelayMs))
      if (nextPage && faults.failSecondPage)
        return { ok: false, error: 'Fixture provider unavailable' }
      return {
        ok: true,
        data: {
          items: Array.from({ length: nextPage ? 1 : 50 }, (_, at) => ({
            track: {
              id: `track${at + (nextPage ? 50 : 0)}`,
              uri: `spotify:track:track${at + (nextPage ? 50 : 0)}`,
              name: `Fixture track ${at + (nextPage ? 50 : 0)}`,
              artists: [{ name: 'Test artist' }],
            },
          })),
          total: 51,
          next: nextPage ? null : 'page2',
        },
      }
    }
    if (path.startsWith('/search'))
      return {
        ok: true,
        data: {
          tracks: {
            items: [
              {
                id: 'searchtrack',
                uri: 'spotify:track:searchtrack',
                name: 'Fixture search result',
                artists: [{ name: 'Test artist' }],
                duration_ms: 180000,
              },
            ],
          },
        },
      }
    if (path.startsWith('/radio/search')) return { ok: true, data: { stations: [] } }
    return { ok: true, data: {} }
  },
}
plugin.register(ctx)
const route = contributions.find((entry) => entry.area === 'routes')
const status = contributions.find((entry) => entry.area === 'statusBar.right')
const pane = contributions.find((entry) => entry.area === 'panes')
const controller = route.render().props.controller
const workspace = createRoot(document.getElementById('workspace'))
const statusRoot = createRoot(document.getElementById('status'))
const paneRoot = createRoot(document.getElementById('pane'))
workspace.render(route.render())
statusRoot.render(status.render())
paneRoot.render(pane.render())
window.fixture = {
  faults,
  controller,
  calls,
  contributions,
  stored,
  leaveMedia: () =>
    workspace.render(
      React.createElement('div', { className: 'test-work' }, 'Working outside Media'),
    ),
  returnMedia: () => workspace.render(route.render()),
  dispose: () => {
    workspace.unmount()
    statusRoot.unmount()
    paneRoot.unmount()
    disposers.forEach((fn) => fn())
  },
  seed: () => {
    const first = controller.createPlaylist(
      'After hours',
      'A test collection for late-night focus.',
    )
    controller.addManyToPlaylist(first.id, [
      {
        source: 'spotify',
        title: 'Night drive',
        subtitle: 'Fixture artist',
        uri: 'spotify:track:nightdrive',
        durationMs: 216000,
      },
      {
        source: 'radio',
        title: 'Chillsynth',
        subtitle: 'Soft focus · warm synths',
        streamUrl: 'https://stream.nightride.fm/chillsynth.mp3',
      },
      {
        source: 'local',
        title: 'A missing local track',
        localTrackId: 'fixture-missing',
        unavailable: true,
      },
      {
        source: 'spotify',
        title:
          'Long title to verify ellipsis does not cover controls or push the layout out of the pane',
        subtitle: 'Fixture artist',
        uri: 'spotify:track:longtitle',
        durationMs: 194000,
      },
    ])
    controller.createPlaylist('Deep work', 'No distractions.')
    controller.createPlaylist('Slow mornings', 'Start gently.')
    controller.selectPlaylist(first.id)
    controller.setWorkspaceView('playlists')
  },
  playTone: async () => {
    const seconds = 45,
      sampleRate = 16000,
      count = seconds * sampleRate
    const bytes = new ArrayBuffer(44 + count * 2),
      view = new DataView(bytes)
    const text = (at, value) =>
      [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)))
    text(0, 'RIFF')
    view.setUint32(4, 36 + count * 2, true)
    text(8, 'WAVE')
    text(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, 'data')
    view.setUint32(40, count * 2, true)
    for (let i = 0; i < count; i++)
      view.setInt16(44 + i * 2, Math.sin((i / sampleRate) * Math.PI * 880) * 10000, true)
    controller.add({
      source: 'local',
      title: 'Generated test tone',
      objectUrl: URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })),
    })
    await controller.playAt(controller.queue.get().length - 1)
  },
}
