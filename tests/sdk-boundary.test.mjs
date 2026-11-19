import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// SDK boundary contract for the shipped bundle. The host SDK is imported as a
// namespace and capability-checked before any optional export is referenced,
// so a missing named export cannot abort the whole plugin at ESM link time.
// These are headless contract checks against labelled SDK fixtures, not
// packaged-Desktop rendering evidence.
const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')

test('the bundle imports the host SDK as a namespace, not named ESM bindings', () => {
  assert.match(source, /import \* as HermesSDK from '@hermes\/plugin-sdk'/)
  assert.doesNotMatch(source, /import\s*\{[^}]*\}\s*from\s*'@hermes\/plugin-sdk'/)
})

const startMarker = '/* SDK_BOUNDARY_START */'
const endMarker = '/* SDK_BOUNDARY_END */'
const start = source.indexOf(startMarker)
const end = source.indexOf(endMarker)
assert.ok(start >= 0 && end > start, 'SDK boundary region is present in the shipped bundle')
const { resolveSdk, HOST_CONTRACT } = new Function(`${source.slice(start + startMarker.length, end)}\nreturn { resolveSdk, HOST_CONTRACT };`)()

const completeSdk = {
  atom: initial => ({ get: () => initial, set: () => {}, subscribe: () => () => {} }),
  useValue: store => store.get(),
  Button: () => null,
  host: { navigate: () => {} },
  ROUTES_AREA: 'routes',
  TITLEBAR_AREAS: { right: 'titleBar.right' },
}

test('a complete SDK namespace is compatible with no missing exports', () => {
  const result = resolveSdk(completeSdk)
  assert.equal(result.compatible, true)
  assert.deepEqual(result.missing, [])
  assert.equal(result.sdk, completeSdk)
})

test('Button is optional: its absence does not make the SDK incompatible', () => {
  const { Button: _optional, ...withoutButton } = completeSdk
  const result = resolveSdk(withoutButton)
  assert.equal(result.compatible, true)
  assert.deepEqual(result.missing, [])
  assert.equal(result.sdk.Button, undefined)
})

test('a missing core export is reported instead of aborting module evaluation', () => {
  const { atom: _core, ...withoutAtom } = completeSdk
  const result = resolveSdk(withoutAtom)
  assert.equal(result.compatible, false)
  assert.deepEqual(result.missing, ['atom'])
})

test('every missing core export is listed for the honest fallback surface', () => {
  const result = resolveSdk({ Button: () => null })
  assert.equal(result.compatible, false)
  assert.deepEqual(result.missing, ['atom', 'useValue', 'host', 'ROUTES_AREA', 'TITLEBAR_AREAS'])
})

test('a null or non-object namespace degrades to an incompatible result, never a throw', () => {
  for (const namespace of [null, undefined, 42, 'sdk']) {
    const result = resolveSdk(namespace)
    assert.equal(result.compatible, false)
    assert.equal(result.missing.length, 5)
  }
})

// ---- FM-23: declared contract, N+1 and absent-optional capability fixtures ----

test('HOST_CONTRACT declares the real required/optional doors and policy', () => {
  assert.equal(HOST_CONTRACT.contractVersion, 1)
  assert.equal(HOST_CONTRACT.sdk, '@hermes/plugin-sdk')
  assert.deepEqual(HOST_CONTRACT.required, ['atom', 'useValue', 'host', 'ROUTES_AREA', 'TITLEBAR_AREAS'])
  for (const door of ['Button', 'host.navigate', 'TITLEBAR_AREAS.right', 'OwnedMediaView', 'host.mediaSession', 'window.hermesDesktop.getEmbedHostOrigin', 'window.Spotify.Player']) {
    assert.ok(HOST_CONTRACT.optional[door], `optional door ${door} declares a fallback`)
  }
  assert.match(HOST_CONTRACT.policy, /not guaranteed/, 'no arbitrary-future-breaking-release promise')
  assert.match(HOST_CONTRACT.policy, /never silent data deletion/)
})

test('N+1: extra unknown exports are ignored and compatibility is preserved', () => {
  const nextSdk = { ...completeSdk, futureExport: () => {}, host: { ...completeSdk.host, extraDoor: true }, TITLEBAR_AREAS: { ...completeSdk.TITLEBAR_AREAS, left: 'titleBar.left' } }
  const result = resolveSdk(nextSdk)
  assert.equal(result.compatible, true)
  assert.deepEqual(result.missing, [])
  assert.equal(result.optional.button, true)
  assert.equal(result.optional.navigate, true)
  assert.equal(result.optional.titlebarRight, true)
})

test('absent optional doors preserve compatibility and project precise capabilities', () => {
  const { Button: _button, ...noButton } = completeSdk
  const noNavigate = { ...completeSdk, host: {} }
  const noTitlebarRight = { ...completeSdk, TITLEBAR_AREAS: {} }
  const bare = resolveSdk({ atom: completeSdk.atom, useValue: completeSdk.useValue, host: {}, ROUTES_AREA: 'routes', TITLEBAR_AREAS: {} })
  for (const result of [resolveSdk(noButton), resolveSdk(noNavigate), resolveSdk(noTitlebarRight), bare]) {
    assert.equal(result.compatible, true, 'core surfaces survive optional-door absence')
    assert.deepEqual(result.missing, [])
  }
  assert.equal(resolveSdk(noButton).optional.button, false)
  assert.equal(resolveSdk(noNavigate).optional.navigate, false)
  assert.equal(resolveSdk(noTitlebarRight).optional.titlebarRight, false)
  assert.deepEqual(bare.optional, { button: false, navigate: false, titlebarRight: false })
})

test('the titlebar summary never references the optional Button without a fallback', () => {
  assert.ok(source.includes("h(Button || 'button', { ref: triggerRef"), 'guarded summary button')
  assert.ok(!/h\(Button,\s*\{[^}]*ref: triggerRef/.test(source), 'the raw optional-Button trap is gone')
  assert.ok(source.includes('if (TITLEBAR_RIGHT != null)'), 'titlebar registration is capability-guarded')
  assert.ok(source.includes('HOST_NAVIGATE?.(ROUTE)'), 'navigation is feature-detected')
  assert.ok(source.includes('disabled: !HOST_NAVIGATE'), 'navigate-only shortcut degrades honestly')
})

test('the incompatible-host fallback is precise, data-safe and precedes any controller', () => {
  const registerStart = source.indexOf('register(ctx) {')
  const registerBody = source.slice(registerStart, source.indexOf('\n}', registerStart))
  const fallbackAt = registerBody.indexOf('if (!SDK_COMPATIBLE)')
  const controllerAt = registerBody.indexOf('createController(ctx')
  assert.ok(fallbackAt >= 0 && controllerAt > fallbackAt, 'the fallback path returns before any controller exists')
  const fallbackBlock = registerBody.slice(fallbackAt, controllerAt)
  assert.ok(fallbackBlock.includes('return'), 'incompatible registration returns early')
  assert.ok(!fallbackBlock.includes('storage'), 'the fallback never touches saved data')
  assert.ok(!fallbackBlock.includes('setInterval') && !fallbackBlock.includes('request('), 'no polling or requests in the fallback')
  assert.ok(source.includes('Required by host contract v${HOST_CONTRACT.contractVersion}'), 'the alert names the declared contract')
  assert.ok(source.includes('Your saved data is untouched'), 'the alert states data safety')
})

test('owned-view watch capability is feature-detected: present, absent and partial', () => {
  const pureStart = source.indexOf('/* PURE_FUNCTIONS_START */')
  const pureEnd = source.indexOf('/* PURE_FUNCTIONS_END */')
  const { youTubeWatchCapability } = new Function(`${source.slice(pureStart + '/* PURE_FUNCTIONS_START */'.length, pureEnd)}\nreturn { youTubeWatchCapability };`)()
  const session = { ensurePartition: async () => {}, openLogin: async () => {}, dispose: () => {} }
  const present = youTubeWatchCapability({ OwnedMediaView: () => null, host: { mediaSession: session } })
  assert.equal(present.available, true)
  assert.deepEqual(present.missing, [])
  const absent = youTubeWatchCapability({ host: {} })
  assert.equal(absent.available, false)
  assert.deepEqual(absent.missing, ['OwnedMediaView', 'host.mediaSession'])
  const partial = youTubeWatchCapability({ OwnedMediaView: () => null, host: { mediaSession: { ensurePartition: async () => {} } } })
  assert.equal(partial.available, false)
  assert.deepEqual(partial.missing, ['host.mediaSession'], 'partial capability reports the exact missing contract')
  assert.equal(youTubeWatchCapability(null).available, false)
})

test('the bundle keeps a single public SDK door and no private host coupling', () => {
  assert.ok(!/from\s+'hermes\//.test(source), 'no deep Hermes imports')
  assert.ok(!/plugins\/[a-z-]+\/(src|dashboard)/.test(source), 'no sibling-plugin source imports')
  assert.ok(!source.includes('app.asar'), 'no packaged-file patching')
  assert.ok(!/document\.querySelector\(['"]#hermes/.test(source), 'no host DOM selectors')
  assert.ok(source.includes('window.hermesDesktop?.getEmbedHostOrigin'), 'embed origin door stays optional-chained')
  assert.ok(source.includes('window.Spotify?.Player'), 'Web Playback SDK door stays feature-detected')
})
