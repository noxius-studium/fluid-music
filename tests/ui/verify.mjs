import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const root = fileURLToPath(new URL('../../', import.meta.url))
const evidence = `${root}.hermes-tests/ui`
await mkdir(evidence, { recursive: true })
const bundled = await build({
  entryPoints: [`${root}tests/ui/entry.js`],
  bundle: true,
  format: 'iife',
  write: false,
  alias: { '@hermes/plugin-sdk': `${root}tests/ui/sdk-fixture.js` },
})
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FluidMusic isolated UI verification — synthetic catalog</title><style>
:root{--ui-bg-primary:#101416;--ui-bg-secondary:#181e21;--ui-text-primary:#e7edee;--ui-text-secondary:#abb8bd;--ui-text-tertiary:#87969c;--ui-text-quaternary:#647077;--ui-stroke-secondary:#303b40;--ui-accent:#91c7b1;--font-mono:monospace;font:13px/1.5 system-ui;color:var(--ui-text-primary);background:var(--ui-bg-primary)}*{box-sizing:border-box;margin:0;padding:0}html,body{margin:0;height:100%}body{display:grid;grid-template-rows:minmax(0,1fr) 32px;overflow:hidden}#surface{display:flex;min-height:0}#workspace{flex:1;min-width:0;height:100%}#pane{width:300px;flex:none;border-left:1px solid var(--ui-stroke-secondary);display:none}#status{display:flex;justify-content:flex-end;padding:0 8px;border-top:1px solid var(--ui-stroke-secondary);overflow:auto}.test-button{font:12px/1.2 system-ui;color:var(--ui-text-primary);background:var(--ui-bg-secondary);border:1px solid var(--ui-stroke-secondary);padding:8px 12px;border-radius:5px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap}.test-button[data-variant=default]{background:var(--ui-accent);color:var(--ui-bg-primary);border-color:var(--ui-accent)}.test-button[data-variant=ghost]{background:transparent;border-color:transparent}.test-button[data-size=icon-xs]{width:28px;height:28px;padding:5px}.test-button[data-size=micro]{font-size:10px;padding:4px 6px}.test-button:disabled{opacity:.4;cursor:not-allowed}.test-work{padding:80px}
</style></head><body><div id="surface"><div id="workspace"></div><aside id="pane" aria-label="Test host pane"></aside></div><div id="status"></div><script src="/bundle.js"></script></body></html>`
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html')
  res.end(req.url === '/bundle.js' ? bundled.outputFiles[0].text : html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
})
const page = await context.newPage()
const errors = [],
  results = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
const check = async (name, fn) => {
  await fn()
  results.push(name)
  console.log(`PASS ${name}`)
}
const nav = (name) =>
  page.locator('nav[aria-label="FluidMusic"]').getByRole('button', { name, exact: true }).click()
try {
  await page.addInitScript(() => {
    const NativeAudio = window.Audio
    const elements = [],
      events = []
    window.audioProbe = { elements, events }
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args)
      const id = elements.push(audio) - 1
      for (const event of [
        'pause',
        'playing',
        'emptied',
        'seeking',
        'seeked',
        'waiting',
        'stalled',
        'loadstart',
      ])
        audio.addEventListener(event, () => events.push({ id, event, time: audio.currentTime }))
      return audio
    }
    window.Audio.prototype = NativeAudio.prototype
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => Boolean(window.fixture))
  await page.evaluate(() => window.fixture.seed())
  await page.getByRole('heading', { name: 'After hours', exact: true }).waitFor()
  await page.screenshot({ path: `${evidence}/playlists-desktop.png` })
  await check(
    'save dialog is centered and opaque under the host CSS reset and glass theme',
    async () => {
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--ui-bg-elevated', '#181e21')
        document.documentElement.style.setProperty('--ui-bg-secondary', 'rgba(24,30,33,.15)')
      })
      await page
        .getByRole('button', {
          name: 'Save Night drive to playlist',
          exact: true,
        })
        .count()
        .then(async (count) => {
          if (!count) {
            await page.evaluate(() => window.fixture.controller.setWorkspaceView('home'))
            await page
              .getByRole('button', {
                name: 'Save Chillsynth to playlist',
                exact: true,
              })
              .click()
          } else
            await page
              .getByRole('button', {
                name: 'Save Night drive to playlist',
                exact: true,
              })
              .click()
        })
      const box = await page.getByRole('dialog').boundingBox()
      const viewport = page.viewportSize()
      assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 3, JSON.stringify(box))
      assert.ok(Math.abs(box.y + box.height / 2 - viewport.height / 2) < 3, JSON.stringify(box))
      const background = await page
        .getByRole('dialog')
        .evaluate((el) => getComputedStyle(el).backgroundColor)
      assert.ok(!background.includes('0.15'), background)
      await page.screenshot({ path: `${evidence}/save-dialog-glass.png` })
      await page.keyboard.press('Escape')
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--ui-bg-secondary', '#181e21')
        window.fixture.controller.setWorkspaceView('playlists')
      })
    },
  )
  await check('playlist editor uses live local availability', async () => {
    assert.equal(
      await page
        .getByRole('button', {
          name: 'Play A missing local track',
          exact: true,
        })
        .isDisabled(),
      true,
    )
  })
  await check('create, edit and populate a playlist through real DOM actions', async () => {
    await page.getByRole('button', { name: 'New playlist', exact: true }).click()
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('UI regression mix')
    await page
      .getByRole('dialog')
      .getByLabel('Description', { exact: true })
      .fill('Created by the automated UI test')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create playlist', exact: true })
      .click()
    await page.getByRole('button', { name: 'Edit details' }).click()
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Renamed mix')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.getByRole('button', { name: 'Add tracks', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Radio', exact: true }).click()
    await page.getByRole('dialog').getByRole('checkbox').nth(0).check()
    await page.getByRole('dialog').getByRole('checkbox').nth(1).check()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Add selected · 2', exact: true })
      .click()
    await page.locator('.fluid-playlist-editor .fluid-track-row').nth(1).waitFor()
    assert.equal(await page.locator('.fluid-playlist-editor .fluid-track-row').count(), 2)
  })
  await check('filtered removal targets the original occurrence and Undo restores it', async () => {
    await page.getByLabel('Filter playlist tracks').fill('Nightride')
    await page.getByRole('checkbox', { name: 'Select Nightride', exact: true }).check()
    await page.getByRole('button', { name: 'Remove selected', exact: true }).click()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Select Nightride', exact: true }).waitFor()
    await page.getByLabel('Filter playlist tracks').fill('')
  })
  await check('playlist reorder, queue append, export and import preserve order', async () => {
    await page.getByRole('button', { name: 'Move Nightride earlier', exact: true }).click()
    assert.match(
      await page.locator('.fluid-playlist-editor .fluid-track-row').first().innerText(),
      /Nightride/,
    )
    await page.getByRole('button', { name: 'Add to queue', exact: true }).click()
    assert.equal(await page.evaluate(() => window.fixture.controller.queue.get().length), 2)
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export playlist', exact: true }).click()
    const download = await downloaded
    await download.saveAs(`${evidence}/roundtrip.json`)
    await page.getByLabel('Import FluidMusic playlists').setInputFiles(`${evidence}/roundtrip.json`)
    await page.waitForFunction(() => window.fixture.controller.playlists.get().length === 5)
  })
  await check('delete confirmation, cancellation and undo', async () => {
    await page.getByRole('button', { name: 'Delete playlist', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    assert.equal(await page.evaluate(() => window.fixture.controller.playlists.get().length), 5)
    await page.getByRole('button', { name: 'Delete playlist', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete playlist', exact: true })
      .click()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    assert.equal(await page.evaluate(() => window.fixture.controller.playlists.get().length), 5)
  })
  await check('Spotify library pagination reaches track 51', async () => {
    await nav('Spotify')
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await page.getByRole('button', { name: 'Load more', exact: true }).click()
    await page.getByText('Fixture track 50', { exact: true }).waitFor()
    assert.equal(await page.locator('.fluid-track-row').count(), 51)
  })
  await check(
    'queued Spotify playlists expand, paginate and send exact song offsets without replacing the context',
    async () => {
      await page.evaluate(() => {
        const c = window.fixture.controller
        c.add({
          source: 'spotify',
          uri: 'spotify:playlist:testlist',
          title: 'Fixture queue playlist',
        })
        c.setWorkspaceView('queue')
      })
      await page.getByRole('button', { name: 'Show songs', exact: true }).click()
      const songs = page.getByRole('region', {
        name: 'Songs in Fixture queue playlist',
      })
      await songs.getByRole('button', { name: 'Load more songs', exact: true }).click()
      await songs.getByRole('button', { name: 'Play Fixture track 50', exact: true }).click()
      await page.waitForFunction(() =>
        window.fixture.calls.some(
          (call) => call.path === '/play' && call.options.body.offset === 50,
        ),
      )
      assert.equal(
        await page.evaluate(() => window.fixture.controller.current().uri),
        'spotify:playlist:testlist',
      )
      await page.screenshot({ path: `${evidence}/queue-expanded.png` })
      await page.setViewportSize({ width: 390, height: 900 })
      const overflow = await page
        .locator('.fluid-content')
        .evaluate((el) => el.scrollWidth - el.clientWidth)
      assert.ok(overflow <= 2, `Expanded queue overflow: ${overflow}`)
      await page.screenshot({ path: `${evidence}/queue-expanded-390.png` })
      await page.setViewportSize({ width: 1440, height: 960 })
    },
  )
  await check(
    'save a Spotify collection as editable songs, append a single song, or keep an explicit context reference',
    async () => {
      const open = () =>
        page
          .getByRole('button', {
            name: 'Save Fixture queue playlist to playlist',
            exact: true,
          })
          .click()
      await open()
      let dialog = page.getByRole('dialog')
      assert.equal(await dialog.getByLabel('What to save').inputValue(), 'tracks')
      await dialog.getByRole('button', { name: 'Create a new playlist', exact: true }).click()
      await dialog.getByLabel('New playlist name', { exact: true }).fill('Queue songs')
      await page.screenshot({ path: `${evidence}/save-spotify-tracks.png` })
      await dialog.getByRole('button', { name: 'Create & save', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(
        await page.evaluate(
          () =>
            window.fixture.controller.playlists.get().find((p) => p.name === 'Queue songs').items
              .length,
        ),
        51,
      )
      await page
        .getByRole('button', {
          name: 'Save Fixture track 0 to playlist',
          exact: true,
        })
        .click()
      dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: /Queue songs/ }).click()
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(
        await page.evaluate(
          () =>
            window.fixture.controller.playlists.get().find((p) => p.name === 'Queue songs').items
              .length,
        ),
        52,
      )
      await open()
      dialog = page.getByRole('dialog')
      await dialog.getByLabel('What to save').selectOption('reference')
      await dialog.getByRole('button', { name: 'Create a new playlist', exact: true }).click()
      await dialog.getByLabel('New playlist name', { exact: true }).fill('Spotify reference')
      await dialog.getByRole('button', { name: 'Create & save', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.deepEqual(
        await page.evaluate(() =>
          window.fixture.controller.playlists
            .get()
            .find((p) => p.name === 'Spotify reference')
            .items.map((i) => i.uri),
        ),
        ['spotify:playlist:testlist'],
      )
    },
  )
  await check(
    'failed collection saves retain input for retry; cancellation prevents ghost playlists',
    async () => {
      await page.evaluate(() => {
        window.fixture.faults.failSecondPage = true
      })
      await page
        .getByRole('button', {
          name: 'Save Fixture queue playlist to playlist',
          exact: true,
        })
        .click()
      let dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Create a new playlist', exact: true }).click()
      await dialog.getByLabel('New playlist name', { exact: true }).fill('Retry copy')
      await dialog.getByRole('button', { name: 'Create & save', exact: true }).click()
      await dialog.getByRole('alert').waitFor()
      assert.equal(
        await page.evaluate(() =>
          window.fixture.controller.playlists.get().some((p) => p.name === 'Retry copy'),
        ),
        false,
      )
      await page.evaluate(() => {
        window.fixture.faults.failSecondPage = false
      })
      await dialog.getByRole('button', { name: 'Create & save', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(
        await page.evaluate(
          () =>
            window.fixture.controller.playlists.get().find((p) => p.name === 'Retry copy').items
              .length,
        ),
        51,
      )
      await page.evaluate(() => {
        window.fixture.faults.playlistDelayMs = 150
      })
      await page
        .getByRole('button', {
          name: 'Save Fixture queue playlist to playlist',
          exact: true,
        })
        .click()
      dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Create a new playlist', exact: true }).click()
      await dialog.getByLabel('New playlist name', { exact: true }).fill('Cancelled copy')
      await dialog.getByRole('button', { name: 'Create & save', exact: true }).click()
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.waitForTimeout(400)
      assert.equal(
        await page.evaluate(() =>
          window.fixture.controller.playlists.get().some((p) => p.name === 'Cancelled copy'),
        ),
        false,
      )
      await page.evaluate(() => {
        window.fixture.faults.playlistDelayMs = 0
      })
    },
  )
  await check('every navigation page renders without horizontal content overflow', async () => {
    for (const width of [1440, 980, 720, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const name of [
        'Overview',
        'Search',
        'Spotify',
        'Radio',
        'Local music',
        'Playlists',
        'Queue',
        'Settings',
        'Logs',
      ]) {
        // Counts are separate accessible text within nav buttons.
        await page
          .locator('.fluid-nav-button')
          .filter({ hasText: new RegExp(`^${name}(?:\\d+)?$`) })
          .click()
        await page.locator('.fluid-page-title').waitFor()
        const overflow = await page.locator('.fluid-content').evaluate((el) => ({
          scroll: el.scrollWidth,
          client: el.clientWidth,
        }))
        assert.ok(
          overflow.scroll <= overflow.client + 2,
          `${name}@${width}: ${JSON.stringify(overflow)}`,
        )
      }
      await page
        .locator('.fluid-nav-button')
        .filter({ hasText: /^Playlists/ })
        .click()
      await page.screenshot({ path: `${evidence}/playlists-${width}.png` })
    }
  })
  await check('status volume, mute and restore work outside Media', async () => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.evaluate(() => window.fixture.leaveMedia())
    const volume = page.getByRole('slider', { name: 'Status bar volume' })
    await volume.fill('37')
    await page.locator('#status').getByRole('button', { name: 'Mute', exact: true }).click()
    assert.equal(await volume.inputValue(), '0')
    await page.locator('#status').getByRole('button', { name: 'Unmute', exact: true }).click()
    assert.equal(await volume.inputValue(), '37')
  })
  await check(
    'real AudioContext visualization stops all sampling and disconnects when hidden',
    async () => {
      // Real file input grants a File to the actual generated plugin, not a fake Audio object.
      const sampleRate = 16000,
        count = sampleRate * 45
      const wav = Buffer.alloc(44 + count * 2)
      wav.write('RIFF', 0)
      wav.writeUInt32LE(36 + count * 2, 4)
      wav.write('WAVE', 8)
      wav.write('fmt ', 12)
      wav.writeUInt32LE(16, 16)
      wav.writeUInt16LE(1, 20)
      wav.writeUInt16LE(1, 22)
      wav.writeUInt32LE(sampleRate, 24)
      wav.writeUInt32LE(sampleRate * 2, 28)
      wav.writeUInt16LE(2, 32)
      wav.writeUInt16LE(16, 34)
      wav.write('data', 36)
      wav.writeUInt32LE(count * 2, 40)
      for (let i = 0; i < count; i++)
        wav.writeInt16LE(Math.round(Math.sin((i / sampleRate) * Math.PI * 880) * 10000), 44 + i * 2)
      await writeFile(`${evidence}/visual-check.wav`, wav)
      await page.evaluate(() => window.fixture.returnMedia())
      await nav('Local music')
      await page.getByLabel('Open audio files for visualization').setInputFiles({
        name: 'Visual check.wav',
        mimeType: 'audio/wav',
        buffer: wav,
      })
      await page.getByRole('button', { name: 'Play Visual check', exact: true }).click()
      assert.equal(
        await page
          .getByRole('button', {
            name: 'Session file: index its folder to save in playlists',
          })
          .isDisabled(),
        true,
      )
      assert.equal(
        await page.evaluate(() => window.fixture.stored.queue.some((item) => item.objectUrl)),
        false,
      )
      await page.evaluate(() => window.fixture.leaveMedia())
      await page.waitForFunction(() => window.fixture.controller.status.get() === 'playing')
      await page.waitForFunction(() => window.fixture.controller.visualDiagnostics().reads > 3)
      for (const style of ['wave', 'mirror', 'bars']) {
        await page.getByRole('combobox', { name: 'Status visualizer style' }).selectOption(style)
        await page.waitForFunction(
          (style) => window.fixture.controller.visualizerStyle.get() === style,
          style,
        )
      }
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#status canvas')
        if (!canvas || canvas.width < 8 || canvas.height < 2) return false
        const pixels = canvas
          .getContext('2d')
          .getImageData(canvas.width - 8, canvas.height - 2, 8, 2).data
        return pixels.some((value, index) => index % 4 === 3 && value > 0)
      })
      await page.getByRole('button', { name: 'Hide status visualizer', exact: true }).click()
      await page.waitForFunction(
        () => window.fixture.controller.visualDiagnostics().consumers === 0,
      )
      const before = await page.evaluate(() => window.fixture.controller.visualDiagnostics())
      await page.waitForTimeout(300)
      const after = await page.evaluate(() => window.fixture.controller.visualDiagnostics())
      assert.equal(after.reads, before.reads)
      assert.equal(after.analyser, false)
    },
  )
  await check(
    'dockable mini-player works outside Media and preserves engine across route changes',
    async () => {
      await page.evaluate(() => {
        document.getElementById('pane').style.display = 'block'
        window.fixture.returnMedia()
      })
      await page.waitForFunction(
        () => window.fixture.controller.visualDiagnostics().consumers === 1,
      )
      const before = await page.evaluate(() => window.fixture.controller.progress.get().positionMs)
      await page.evaluate(() => window.fixture.leaveMedia())
      await page.waitForFunction(
        (before) => window.fixture.controller.progress.get().positionMs > before,
        before,
      )
      await page.locator('#pane').getByRole('button', { name: 'Pause', exact: true }).click()
      await page.waitForFunction(() => window.fixture.controller.status.get() === 'paused')
      await page.waitForFunction(
        () => window.fixture.controller.visualDiagnostics().consumers === 0,
      )
      await page.locator('#pane').getByRole('button', { name: 'Play', exact: true }).click()
      await page.waitForFunction(() => window.fixture.controller.status.get() === 'playing')
      const resumedReads = await page.evaluate(
        () => window.fixture.controller.visualDiagnostics().reads,
      )
      await page.waitForFunction(
        (reads) => window.fixture.controller.visualDiagnostics().reads > reads,
        resumedReads,
      )
      await page.screenshot({ path: `${evidence}/mini-player.png` })
      await page
        .locator('#pane')
        .getByRole('button', { name: 'Hide visualizer', exact: true })
        .click()
      await page.waitForFunction(() => !window.fixture.controller.visualDiagnostics().analyser)
    },
  )
  await check(
    'style, route, resize and gain changes preserve the live audio element and timeline; seek remains usable',
    async () => {
      const baseline = await page.evaluate(() => ({
        count: window.audioProbe.elements.length,
        time: window.audioProbe.elements.at(-1).currentTime,
        events: window.audioProbe.events.length,
      }))
      await page.getByRole('button', { name: 'Show status visualizer', exact: true }).click()
      await page.waitForFunction(() => {
        const data = window.fixture.controller.visualSamples('wave')
        return data && [...data].some((value) => Math.abs(value - 128) > 2)
      })
      for (const style of ['wave', 'mirror', 'bars']) {
        await page.getByRole('combobox', { name: 'Status visualizer style' }).selectOption(style)
        await page.getByRole('slider', { name: 'Status bar volume' }).fill('20')
        await page.getByRole('slider', { name: 'Status bar volume' }).fill('65')
        await page.evaluate(() => window.fixture.returnMedia())
        await page.setViewportSize({ width: 980, height: 900 })
        await page.evaluate(() => window.fixture.leaveMedia())
        await page.setViewportSize({ width: 1440, height: 960 })
      }
      await page.waitForTimeout(200)
      const after = await page.evaluate(() => ({
        count: window.audioProbe.elements.length,
        time: window.audioProbe.elements.at(-1).currentTime,
        paused: window.audioProbe.elements.at(-1).paused,
        events: window.audioProbe.events,
      }))
      assert.equal(after.count, baseline.count)
      assert.ok(after.time > baseline.time)
      assert.equal(after.paused, false)
      assert.deepEqual(
        after.events
          .slice(baseline.events)
          .filter((e) =>
            ['pause', 'emptied', 'seeking', 'waiting', 'stalled', 'loadstart'].includes(e.event),
          ),
        [],
      )
      await page.evaluate(() => window.fixture.returnMedia())
      const seek = page
        .locator('#workspace')
        .getByRole('slider', { name: 'Seek through current track' })
      await seek.fill('15000')
      await seek.dispatchEvent('pointerup')
      await page.waitForFunction(() => window.audioProbe.elements.at(-1).currentTime >= 15)
      assert.equal(await page.evaluate(() => window.audioProbe.elements.length), baseline.count)
      await writeFile(
        `${evidence}/audio-continuity.json`,
        JSON.stringify({ baseline, after }, null, 2),
      )
      await page.evaluate(() => window.fixture.leaveMedia())
      await page.getByRole('button', { name: 'Hide status visualizer', exact: true }).click()
    },
  )
  await check('reduced motion suspends visuals without stopping music', async () => {
    await page.getByRole('button', { name: 'Show status visualizer', exact: true }).click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => window.fixture.controller.visualDiagnostics().consumers === 0)
    assert.equal(await page.evaluate(() => window.fixture.controller.status.get()), 'playing')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForFunction(() => window.fixture.controller.visualDiagnostics().consumers === 1)
  })
  await check('light theme, keyboard dialog and accessibility', async () => {
    await page.evaluate(() => {
      window.fixture.returnMedia()
      window.fixture.controller.setWorkspaceView('playlists')
      document.getElementById('pane').style.display = 'none'
      Object.entries({
        '--ui-bg-primary': '#f7f8f7',
        '--ui-bg-secondary': '#ffffff',
        '--ui-bg-elevated': '#ffffff',
        '--ui-text-primary': '#182823',
        '--ui-text-secondary': '#455850',
        '--ui-text-tertiary': '#5f7068',
        '--ui-stroke-secondary': '#d5ded9',
        '--ui-accent': '#28684d',
      }).forEach(([key, value]) => document.documentElement.style.setProperty(key, value))
    })
    await page.getByRole('button', { name: 'New playlist', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    assert.equal(
      await page
        .getByRole('dialog')
        .getByLabel('Name', { exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    )
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.screenshot({ path: `${evidence}/playlists-light.png` })
    const report = await new AxeBuilder({ page })
      .include('.fluid-root')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    await writeFile(`${evidence}/accessibility.json`, JSON.stringify(report.violations, null, 2))
    assert.deepEqual(
      report.violations.map((v) => ({ id: v.id, impact: v.impact })),
      [],
    )
  })
  await check('saved song copies and references survive a full renderer reload', async () => {
    await page.reload()
    await page.waitForFunction(() => window.fixture?.controller)
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.controller.playlists.get().find((p) => p.name === 'Queue songs').items
            .length,
      ),
      52,
    )
    assert.deepEqual(
      await page.evaluate(() =>
        window.fixture.controller.playlists
          .get()
          .find((p) => p.name === 'Spotify reference')
          .items.map((i) => i.uri),
      ),
      ['spotify:playlist:testlist'],
    )
    assert.equal(await page.evaluate(() => window.fixture.controller.sessionTracks.get().length), 0)
  })
  assert.deepEqual(errors, [])
  await page.evaluate(() => window.fixture.dispose())
  const disposed = await page.evaluate(() => window.fixture.controller.visualDiagnostics())
  assert.equal(disposed.analyser, false)
  await writeFile(
    `${evidence}/results.json`,
    JSON.stringify({ passed: results, consoleErrors: errors, disposed }, null, 2),
  )
  console.log(`Verified ${results.length} UI scenarios. Evidence: ${evidence}`)
} catch (error) {
  await page.screenshot({ path: `${evidence}/failure.png` })
  console.error('Browser errors:', errors)
  throw error
} finally {
  await browser.close()
  server.close()
}
