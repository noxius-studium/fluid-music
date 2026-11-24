import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const root = fileURLToPath(new URL('../../', import.meta.url))
const evidence = `${root}.hermes-tests/ui`
const review = `${root}.impeccable/review`
await Promise.all([mkdir(evidence, { recursive: true }), mkdir(review, { recursive: true })])
const bundled = await build({ entryPoints: [`${root}tests/ui/entry.js`], bundle: true, format: 'iife', write: false, alias: { '@hermes/plugin-sdk': `${root}tests/ui/sdk-fixture.js` } })
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FluidMusic isolated UI</title><style>
:root{--ui-bg-primary:#0b1220;--ui-bg-secondary:#151c29;--ui-bg-elevated:#151c29;--ui-text-primary:#f3f0e8;--ui-text-secondary:#aab2c2;--ui-text-tertiary:#7f899d;--ui-text-quaternary:#667085;--ui-stroke-secondary:#2b3548;--ui-accent:#9b8cff;--font-mono:monospace;font:13px/1.5 system-ui;color:var(--ui-text-primary);background:var(--ui-bg-primary)}*{box-sizing:border-box}html,body{margin:0;height:100%}body{display:grid;grid-template-rows:40px minmax(0,1fr);overflow:hidden}#host-title{display:flex;align-items:center;justify-content:flex-end;padding:0 12px;border-bottom:1px solid var(--ui-stroke-secondary);background:#0e1522}#surface{display:flex;min-height:0}#workspace{flex:1;min-width:0;height:100%}#pane{width:320px;height:420px;display:block;align-self:end}.test-button{font:12px system-ui;color:var(--ui-text-primary);background:var(--ui-bg-secondary);border:1px solid var(--ui-stroke-secondary);padding:7px 10px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;gap:5px}.test-button[data-variant=default]{background:#ff786c;color:#10131b;border-color:#ff786c}.test-button[data-variant=ghost]{background:transparent;border-color:transparent}.test-button[data-size=icon-xs]{width:28px;height:28px;padding:5px}.test-button:disabled{opacity:.45}.fluid-sleep-chip{background:var(--ui-bg-secondary);border:1px solid var(--ui-stroke-secondary);border-radius:5px;padding:4px 8px}.test-work{padding:60px}
</style></head><body><div id="host-title"><div id="titlebar"></div></div><div id="surface"><div id="workspace"></div><aside id="pane"></aside></div><script src="/bundle.js"></script></body></html>`
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html'); res.end(req.url === '/bundle.js' ? bundled.outputFiles[0].text : html) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => Boolean(window.fixture))
  await page.evaluate(() => window.fixture.seed())
  await page.locator('.fluid-now-band').waitFor()
  const mini = page.locator('#pane .fluid-mini-player')
  await mini.waitFor()
  assert.equal(await mini.locator('.fluid-mini-body').isHidden(), true, 'mini player starts controls-only')
  const controls = mini.locator('.fluid-mini-controls')
  const geometry = await controls.evaluate(el => {
    const player = el.closest('.fluid-mini-player').getBoundingClientRect()
    const bounds = el.getBoundingClientRect()
    const playerStyle = getComputedStyle(el.closest('.fluid-mini-player'))
    return {
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      childBottom: Math.max(...[...el.children].map(child => child.getBoundingClientRect().bottom)),
      bottom: bounds.bottom,
      contentBottom: player.bottom - Number.parseFloat(playerStyle.paddingBottom || '0'),
    }
  })
  assert.ok(geometry.scrollHeight <= geometry.clientHeight, `mini controls clip ${geometry.scrollHeight - geometry.clientHeight}px`)
  assert.ok(geometry.childBottom <= geometry.bottom + 1, 'every mini control row stays inside the footer')
  assert.ok(Math.abs(geometry.bottom - geometry.contentBottom) <= 1, `mini controls end at ${geometry.bottom}, content box ends at ${geometry.contentBottom}`)
  const hitTargets = await controls.locator('.fluid-player-controls > button').evaluateAll(buttons => buttons.map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })))
  assert.ok(hitTargets.every(rect => rect.width >= 32 && rect.height >= 32), JSON.stringify(hitTargets))
  await page.evaluate(() => window.fixture.selectYouTube())
  const download = controls.getByRole('button', { name: 'Download Fixture YouTube song locally' })
  await download.waitFor({ state: 'visible' })
  const linkGeometry = await controls.locator('.fluid-mini-links').evaluate(el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }))
  assert.ok(linkGeometry.scrollWidth <= linkGeometry.clientWidth, `YouTube download row overflows by ${linkGeometry.scrollWidth - linkGeometry.clientWidth}px`)
  await controls.getByRole('button', { name: 'Show player details' }).click()
  assert.equal(await mini.locator('.fluid-mini-details').isVisible(), true)
  await controls.getByRole('button', { name: 'Hide player details' }).click()
  assert.equal(await mini.locator('.fluid-mini-details').isHidden(), true)
  await page.screenshot({ path: `${review}/mini-player-controls-only.png`, fullPage: true })
  await page.locator('#pane').evaluate(el => { el.style.display = 'none' })
  assert.equal(await page.locator('[aria-label="Persistent player"]').count(), 0)
  assert.equal(await page.locator('#status').count(), 0)
  assert.deepEqual(await page.locator('.fluid-primary-nav .fluid-nav-button').allTextContents(), ['Browse', 'Library', 'Queue', 'Settings'])

  await page.locator('#titlebar .fluid-titlebar-summary').click()
  await page.getByRole('dialog', { name: 'FluidMusic quick controls' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'FluidMusic quick controls' }).evaluate(el => el.contains(document.activeElement)), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog', { name: 'FluidMusic quick controls' }).count(), 0)
  assert.equal(await page.locator('#titlebar .fluid-titlebar-summary').evaluate(el => el === document.activeElement), true)
  await page.locator('#titlebar .fluid-titlebar-summary').click()
  await page.getByRole('dialog', { name: 'FluidMusic quick controls' }).waitFor()
  await page.screenshot({ path: `${review}/titlebar-popover.png`, fullPage: true })
  await page.getByRole('dialog').getByRole('button', { name: 'YouTube in Media', exact: true }).click()
  assert.equal(await page.evaluate(() => window.lastNavigation), '/media', 'popover shortcut navigates the host to Media')
  assert.equal(await page.locator('.fluid-primary-nav').getByRole('button', { name: 'Browse', exact: true }).getAttribute('aria-current'), 'page')
  const invariant = await page.evaluate(() => { const c = window.fixture.controller; return { item: c.current()?.id, index: c.index.get(), status: c.status.get(), youtube: c.youtube.get() } })
  await page.evaluate(() => window.fixture.changeChatFocus('different-chat'))
  assert.deepEqual(await page.evaluate(() => { const c = window.fixture.controller; return { item: c.current()?.id, index: c.index.get(), status: c.status.get(), youtube: c.youtube.get() } }), invariant)
  await page.locator('#workspace').click({ position: { x: 5, y: 5 } })
  assert.equal(await page.getByRole('dialog', { name: 'FluidMusic quick controls' }).count(), 0)
  assert.equal(await page.locator('#titlebar .fluid-titlebar-summary').evaluate(el => el === document.activeElement), true)

  for (const width of [1440, 980, 720, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const name of ['Browse', 'Library', 'Queue', 'Settings']) {
      await page.locator('.fluid-primary-nav').getByRole('button', { name, exact: true }).click()
      const overflow = await page.locator('.fluid-content').evaluate(el => el.scrollWidth - el.clientWidth)
      assert.ok(overflow <= 2, `${name}@${width} overflow ${overflow}`)
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.locator('.fluid-primary-nav').getByRole('button', { name: 'Browse', exact: true }).click()
  await page.screenshot({ path: `${review}/desktop.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${review}/mobile.png`, fullPage: true })

  await page.setViewportSize({ width: 1440, height: 960 })
  await page.locator('.fluid-primary-nav').getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('tab', { name: 'Collections', exact: true }).click()
  await page.getByRole('heading', { name: 'Local collections' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /After hours/ }).count(), 1, 'legacy mix stays readable')
  assert.equal(await page.getByRole('button', { name: 'Edit details' }).count(), 0)

  const report = await new AxeBuilder({ page }).include('.fluid-root').withTags(['wcag2a', 'wcag2aa']).analyze()
  await writeFile(`${evidence}/accessibility.json`, JSON.stringify(report.violations, null, 2))
  assert.deepEqual(report.violations.map(v => v.id), [])
  assert.deepEqual(errors, [])
  console.log('Verified Night Radio workspace, titlebar popover, owned YouTube handle, session invariants, responsive widths, legacy collections, screenshots, and WCAG checks.')
} finally {
  await browser.close()
  server.close()
}