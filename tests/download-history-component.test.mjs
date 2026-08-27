import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../docs/.vitepress/theme/DownloadHistory.vue', import.meta.url), 'utf8')

test('loads Chart.js only when the history chart is rendered', () => {
  assert.match(source, /await import\('chart\.js\/auto'\)/)
  assert.doesNotMatch(source, /^import .*chart\.js/m)
})

test('exposes all interactive chart controls and grouped datasets', () => {
  assert.match(source, /v-model="range"/)
  assert.match(source, /v-model="bucket"/)
  assert.match(source, /v-model="metric"/)
  assert.match(source, /v-model="chartStyle"/)
  assert.match(source, /type="checkbox"/)
  assert.match(source, /stacked: false/)
})

test('keeps exact values and coverage available without reading the canvas', () => {
  assert.match(source, /role="img"/)
  assert.match(source, /Exact values are available in the data table/)
  assert.match(source, /<details[^>]+download-history__data/)
  assert.match(source, /<caption>/)
  assert.match(source, /<th scope="row">/)
  assert.match(source, /No data/)
  assert.match(source, /Partial, in progress/)
})

test('has independent loading, empty, stale, partial, and error messages', () => {
  assert.match(source, /Loading download history/)
  assert.match(source, /History starts with the first hourly snapshot/)
  assert.match(source, /latest stored snapshot is older than expected/)
  assert.match(source, /do not have enough snapshots to calculate download changes/)
  assert.match(source, /current UTC bucket is still in progress/)
  assert.match(source, /Download history is temporarily unavailable/)
})
