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
const { resolveSdk } = new Function(`${source.slice(start + startMarker.length, end)}\nreturn { resolveSdk };`)()

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
