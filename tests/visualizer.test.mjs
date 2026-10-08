import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const pure = source.split('/* PURE_FUNCTIONS_START */')[1].split('/* PURE_FUNCTIONS_END */')[0]
const model = new Function(`${pure}; return { bands: typeof spectrumBands === 'function' ? spectrumBands : null };`)()
const visual = source.slice(source.indexOf('function AudioVisualizer('))
function actualBands(length, sampleRate, count) {
  if (model.bands) return model.bands(length, sampleRate, count)
  // Run the exact old shipped frequency-mapping expressions to prove the regression.
  const expression = visual.slice(visual.indexOf('const low ='), visual.indexOf('let sum =')).trim()
  const get = new Function('bar', 'count', 'samples', `${expression}; return { low, high };`)
  return Array.from({ length: count }, (_, bar) => get(bar, count, new Uint8Array(length)))
}

test('music with energy through 8 kHz uses at least four fifths of the spectrum, not half', () => {
  const bins = 256, sampleRate = 48000, cutoff = Math.floor(8000 / (sampleRate / 2) * bins)
  const bands = actualBands(bins, sampleRate, 48)
  const active = bands.filter(band => band.low < cutoff).length
  assert.ok(active / bands.length >= .8, `Only ${active}/${bands.length} bars cover the useful music spectrum`)
})

test('spectrum bounds stay finite, in range and ordered at different sample rates', () => {
  assert.equal(typeof model.bands, 'function')
  for (const rate of [8000, 16000, 44100, 48000, 96000]) {
    const bands = model.bands(256, rate, 48)
    assert.equal(bands.length, 48)
    bands.forEach((band, at) => {
      assert.ok(Number.isInteger(band.low) && Number.isInteger(band.high))
      assert.ok(band.low >= 0 && band.low < band.high && band.high <= 256)
      if (at) assert.ok(band.low >= bands[at - 1].low)
    })
  }
  assert.deepEqual(model.bands(0, 48000, 48), [])
  assert.deepEqual(model.bands(256, 0, 48), [])
})
