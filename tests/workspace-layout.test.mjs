import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// FM-13 design-contract fixtures: compact Hermes-themed composition, host-only
// colors, persistent bottom bar, bounded Orbit, responsive reflow. Static
// bundle/CSS proofs — live theme rendering on the owner's Desktop is an
// explicit review gate (FM-25), not claimed here.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const css = source.match(/const CSS = `([\s\S]*?)`/)?.[1]
assert.ok(css, 'CSS template is present')
const fn = (name, next) => {
  const start = source.indexOf(`function ${name}(`)
  const end = source.indexOf(`function ${next}(`)
  assert.ok(start >= 0 && end > start, `${name} boundary`)
  return source.slice(start, end)
}

test('navigation is exactly four compact destinations with no permanent sidebar row', () => {
  assert.match(source, /const PRIMARY_NAV = \[\['browse', 'Browse'\], \['library', 'Library'\], \['queue', 'Queue'\], \['settings', 'Settings'\]\]/)
  assert.doesNotMatch(source, /const NAV_(?:PRIMARY|LIBRARY) = .*?[⌂⌕◉◌▶♪◇≡⚙]/)
  assert.doesNotMatch(source, /SIDEBAR_NAV_AREA/)
  assert.match(source, /id: 'media-route', area: ROUTES_AREA/)
  assert.match(source, /TITLEBAR_AREAS\.right/)
})

test('content scrolls above ONE persistent bottom bar; the overview never duplicates controls', () => {
  const media = fn('MediaPage', 'PlayerPopover')
  const order = [media.indexOf('TopNavigation'), media.indexOf('fluid-content'), media.indexOf('BottomTransport')]
  assert.ok(order.every(at => at >= 0), 'header, scrolling content and persistent bar all render')
  assert.ok(order[0] < order[1] && order[1] < order[2], 'bar is the last grid region, outside the scroll body')
  assert.match(media, /view === 'browse' && h\(NowPlayingBand/, 'overview focal only on Browse')
  const band = fn('NowPlayingBand', 'BottomTransport')
  assert.doesNotMatch(band, /h\(Transport/)
  assert.doesNotMatch(band, /h\(SeekBar/)
  assert.doesNotMatch(band, /h\(VolumeControl/)
  assert.match(band, /fluid-orbit/, 'Orbit overview focal retained')
  assert.match(band, /playAt\(at \+ offset \+ 1\)/, 'Up Next preview interaction retained')
  const bar = fn('BottomTransport', 'SecondaryTabs')
  assert.match(bar, /mediaCapabilities\(item\)/, 'same capability table as every surface')
  assert.match(bar, /h\(Transport, \{ controller \}\)/)
  assert.match(bar, /h\(SeekBar, \{ controller \}\)/)
  assert.match(bar, /h\(VolumeControl, \{ controller \}\)/)
  assert.match(bar, /LIVE · station broadcast/, 'radio shows LIVE, never a fake seek')
  assert.match(bar, /title: display\?\.title/, 'long titles keep an accessible full name')
})

test('colors stay live to the Hermes theme; no private palette or fixed hex returns', () => {
  assert.match(css, /--fm-night:color-mix\(in srgb,var\(--ui-bg-primary\) 92%, transparent\)/)
  assert.match(css, /--fm-panel:var\(--ui-bg-secondary\)/, 'panels stay theme-owned but opaque enough to prevent pane bleed-through')
  assert.match(css, /--fm-soft:color-mix\(in srgb,var\(--ui-accent\) 9%,transparent\)/)
  assert.match(css, /--fm-coral:var\(--ui-accent\)/)
  assert.match(css, /--fm-violet:var\(--ui-accent\)/)
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no fixed hex fallbacks')
  assert.match(css, /\.fluid-app\{[^}]*background:transparent/, 'transparent plugin root, no private wash')
  assert.match(css, /outline:2px solid var\(--ui-accent\);outline-offset:3px/, 'keyboard focus never removed')
})

test('geometry follows the contract: compact header, small titles, bounded Orbit, usable bar', () => {
  assert.match(css, /\.fluid-app\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/)
  assert.match(css, /\.fluid-topbar\{height:42px/)
  assert.match(css, /\.fluid-content\{[^}]*overflow:auto/)
  assert.match(css, /\.fluid-now-title\{font-size:clamp\(19px,2cqw,25px\)/)
  assert.match(css, /\.fluid-page-title\{font-size:clamp\(19px,2cqw,25px\)/)
  assert.match(css, /\.fluid-orbit\{position:relative;width:160px;min-width:160px/)
  assert.match(css, /\.fluid-orbit\{width:96px;min-width:96px\}/, 'narrow overview Orbit bounded')
  assert.match(css, /\.fluid-bottom-bar\{[^}]*min-height:68px/)
  assert.match(css, /@container fluid \(max-width:720px\)\{\.fluid-bottom-bar\{[^}]*min-height:96px/)
  assert.match(css, /@container fluid \(max-width:460px\)\{\.fluid-bottom-bar\{[^}]*min-height:112px/)
  assert.match(css, /\.fluid-bottom-right \.fluid-volume\{width:100%\}/, 'narrow bar volume fills its row')
  assert.match(css, /\.fluid-row-title\{[^}]*text-overflow:ellipsis/, 'long titles truncate safely')
  assert.doesNotMatch(css, /font-size:clamp\(25px,3\.4cqw,46px\)/, 'website-sized hero title retired')
})
