<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  HISTORY_BUCKETS,
  HISTORY_RANGES,
  chooseHistoryBucket,
  fetchProjectStatsHistory,
  formatHistoryBucketLabel,
  formatHistoryCount,
  isHistoryBucketAllowed,
  updateHistorySourceSelection,
} from '../../../public/project-stats-history.js'

interface HistorySource {
  key: string
  label: string
  includedInTotal: boolean
}

interface HistoryBucket {
  start: string
  end: string
  partial: boolean
  complete: boolean
  downloadsAdded: Record<string, number | null>
  cumulative: Record<string, number | null>
}

interface HistoryPayload {
  schemaVersion: 1
  generatedAt: string
  trackingStartedAt: string | null
  range: string
  bucket: string
  stale: boolean
  sources: HistorySource[]
  buckets: HistoryBucket[]
}

type Metric = 'downloadsAdded' | 'cumulative'
type ChartStyle = 'bar' | 'line'

const range = ref('30d')
const bucket = ref('day')
const metric = ref<Metric>('downloadsAdded')
const chartStyle = ref<ChartStyle>('bar')
const selectedSources = ref<string[]>(['total'])
const history = ref<HistoryPayload | null>(null)
const loading = ref(true)
const error = ref(false)
const canvas = ref<HTMLCanvasElement | null>(null)
let chart: { destroy: () => void } | null = null
let requestSequence = 0
let renderSequence = 0
let themeObserver: MutationObserver | null = null

const palette = ['#645cff', '#e25d43', '#15957f', '#b66b00', '#9a4fc4', '#3879c9', '#64748b', '#c24178']
const trackingStartedAt = computed(() => history.value?.trackingStartedAt)
const hasPartialBucket = computed(() => history.value?.buckets.some((item) => item.partial) ?? false)
const hasIncompleteChanges = computed(() => metric.value === 'downloadsAdded'
  && (history.value?.buckets.some((item) => !item.complete && !item.partial) ?? false))
const generatedAt = computed(() => formatDateTime(history.value?.generatedAt))
const trackingStarted = computed(() => formatDateTime(history.value?.trackingStartedAt))
const selectedSourceMetadata = computed(() => history.value?.sources.filter(({ key }) => selectedSources.value.includes(key)) ?? [])
const hasValues = computed(() => history.value?.buckets.some((item) => (
  selectedSources.value.some((key) => item[metric.value][key] !== null)
)) ?? false)

function formatDateTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date)
}

function bucketDisabled(candidate: string) {
  return !isHistoryBucketAllowed(range.value, candidate, trackingStartedAt.value)
}

function changeRange() {
  bucket.value = chooseHistoryBucket(range.value, bucket.value, trackingStartedAt.value)
}

function toggleSource(key: string, checked: boolean) {
  selectedSources.value = updateHistorySourceSelection(selectedSources.value, key, checked)
}

async function loadHistory() {
  const sequence = ++requestSequence
  renderSequence += 1
  chart?.destroy()
  chart = null
  loading.value = true
  error.value = false
  try {
    const result = await fetchProjectStatsHistory({ range: range.value, bucket: bucket.value })
    if (sequence !== requestSequence) return
    history.value = result as HistoryPayload
    selectedSources.value = selectedSources.value.filter((key) => result.sources.some((source) => source.key === key))
    if (selectedSources.value.length === 0) selectedSources.value = ['total']
  } catch {
    if (sequence !== requestSequence) return
    history.value = null
    error.value = true
  } finally {
    if (sequence === requestSequence) loading.value = false
  }
}

async function renderChart() {
  const sequence = ++renderSequence
  chart?.destroy()
  chart = null
  if (!canvas.value || !history.value || !hasValues.value) return

  const { default: Chart } = await import('chart.js/auto')
  if (sequence !== renderSequence || !canvas.value || !history.value || !hasValues.value) return
  const dark = document.documentElement.classList.contains('dark')
  const textColor = dark ? '#c7c9d1' : '#4f5768'
  const gridColor = dark ? 'rgba(255, 255, 255, 0.11)' : 'rgba(15, 23, 42, 0.11)'
  const labels = history.value.buckets.map((item) => {
    const label = formatHistoryBucketLabel(item.start, item.end, bucket.value)
    return item.partial ? `${label} (partial)` : label
  })
  const sourceColor = new Map(history.value.sources.map((source, index) => [source.key, palette[index]]))

  chart = new Chart(canvas.value, {
    type: chartStyle.value,
    data: {
      labels,
      datasets: selectedSourceMetadata.value.map((source) => ({
        label: source.label,
        data: history.value!.buckets.map((item) => item[metric.value][source.key]),
        backgroundColor: sourceColor.get(source.key),
        borderColor: sourceColor.get(source.key),
        borderWidth: chartStyle.value === 'line' ? 2 : 0,
        borderRadius: chartStyle.value === 'bar' ? 3 : 0,
        pointRadius: chartStyle.value === 'line' ? 2 : 0,
        pointHoverRadius: 5,
        spanGaps: false,
        tension: 0.2,
      })),
    },
    options: {
      animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : undefined,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.parsed.y
              return `${context.dataset.label}: ${value === null ? 'No data' : formatHistoryCount(value)}`
            },
            afterTitle(items) {
              const item = history.value?.buckets[items[0]?.dataIndex]
              if (!item) return ''
              if (item.partial) return 'Current bucket is still in progress'
              if (!item.complete) return 'Some hourly snapshots are missing'
              return ''
            },
          },
        },
      },
      scales: {
        x: {
          stacked: false,
          ticks: { color: textColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 9 },
          grid: { display: false },
        },
        y: {
          beginAtZero: metric.value === 'downloadsAdded',
          stacked: false,
          ticks: {
            color: textColor,
            callback: (value) => formatHistoryCount(Number(value), undefined, true),
          },
          grid: { color: gridColor },
        },
      },
    },
  })
}

onMounted(() => {
  void loadHistory()
  themeObserver = new MutationObserver(() => void renderChart())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

watch([range, bucket], () => void loadHistory())
watch([history, selectedSources, metric, chartStyle], () => nextTick(() => void renderChart()), { deep: true })

onBeforeUnmount(() => {
  requestSequence += 1
  renderSequence += 1
  chart?.destroy()
  themeObserver?.disconnect()
})
</script>

<template>
  <section class="download-history" aria-label="Download history chart">
    <p v-if="trackingStarted" class="download-history__tracking">Tracked since {{ trackingStarted }}</p>

    <div class="download-history__controls" role="group" aria-label="Download history controls">
      <label>
        <span>Range</span>
        <select v-model="range" @change="changeRange">
          <option v-for="option in HISTORY_RANGES" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label>
        <span>Group by</span>
        <select v-model="bucket">
          <option
            v-for="option in HISTORY_BUCKETS"
            :key="option.value"
            :value="option.value"
            :disabled="bucketDisabled(option.value)"
          >
            {{ option.label }}
          </option>
        </select>
      </label>
      <label>
        <span>Metric</span>
        <select v-model="metric">
          <option value="downloadsAdded">Downloads added</option>
          <option value="cumulative">Cumulative total</option>
        </select>
      </label>
      <label>
        <span>Style</span>
        <select v-model="chartStyle">
          <option value="bar">Bars</option>
          <option value="line">Lines</option>
        </select>
      </label>
    </div>

    <p class="download-history__limit-note">
      Grouping options that would exceed 400 points are unavailable. Choose a longer interval to widen the range.
    </p>

    <fieldset v-if="history" class="download-history__sources">
      <legend>Sources</legend>
      <label v-for="(source, index) in history.sources" :key="source.key">
        <input
          type="checkbox"
          :checked="selectedSources.includes(source.key)"
          :disabled="selectedSources.length === 1 && selectedSources.includes(source.key)"
          @change="toggleSource(source.key, ($event.target as HTMLInputElement).checked)"
        >
        <span class="download-history__swatch" :style="{ backgroundColor: palette[index] }" aria-hidden="true" />
        <span>{{ source.label }}</span>
        <small v-if="!source.includedInTotal">not in total</small>
      </label>
    </fieldset>

    <div v-if="loading" class="download-history__notice" role="status">
      Loading download history…
    </div>
    <div v-else-if="error" class="download-history__notice download-history__notice--error" role="status">
      <strong>Download history is temporarily unavailable.</strong>
      <span>The lifetime download totals above still use their own data source.</span>
      <button type="button" @click="loadHistory">Try again</button>
    </div>
    <template v-else-if="history">
      <p v-if="history.stale" class="download-history__notice download-history__notice--warning" role="status">
        The latest stored snapshot is older than expected. Recent activity may be missing.
      </p>
      <p v-if="hasIncompleteChanges" class="download-history__notice download-history__notice--warning" role="status">
        Some periods do not have enough snapshots to calculate download changes.
      </p>
      <p v-if="hasPartialBucket" class="download-history__notice download-history__notice--warning" role="status">
        The current UTC bucket is still in progress and is marked as partial.
      </p>
      <div v-if="history.buckets.length === 0" class="download-history__notice" role="status">
        <strong>History starts with the first hourly snapshot.</strong>
        <span>Check back after the collector has recorded data.</span>
      </div>
      <div v-else-if="!hasValues" class="download-history__notice" role="status">
        No {{ metric === 'downloadsAdded' ? 'download changes' : 'cumulative totals' }} are available for these filters.
      </div>
      <div v-else class="download-history__chart">
        <canvas
          ref="canvas"
          role="img"
          :aria-label="`${metric === 'downloadsAdded' ? 'Downloads added' : 'Cumulative downloads'} by ${bucket} for the selected sources. Exact values are available in the data table.`"
        />
      </div>

      <p v-if="generatedAt" class="download-history__updated">Generated {{ generatedAt }}.</p>

      <details v-if="history.buckets.length" class="download-history__data">
        <summary>View data table</summary>
        <div class="download-history__table-scroll">
          <table>
            <caption>Exact {{ metric === 'downloadsAdded' ? 'downloads added' : 'cumulative download' }} values</caption>
            <thead>
              <tr>
                <th scope="col">UTC period</th>
                <th v-for="source in selectedSourceMetadata" :key="source.key" scope="col">{{ source.label }}</th>
                <th scope="col">Coverage</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in history.buckets" :key="item.start">
                <th scope="row">{{ formatHistoryBucketLabel(item.start, item.end, bucket) }}</th>
                <td v-for="source in selectedSourceMetadata" :key="source.key">
                  {{ item[metric][source.key] === null ? 'No data' : formatHistoryCount(item[metric][source.key]!) }}
                </td>
                <td>{{ item.partial ? 'Partial, in progress' : item.complete ? 'Complete' : 'Incomplete' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </template>
  </section>
</template>

<style scoped>
.download-history {
  margin: 2.5rem 0;
  padding: 1.25rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
}

.download-history p {
  margin: 0;
}

.download-history__tracking,
.download-history__updated,
.download-history__limit-note {
  color: var(--vp-c-text-3) !important;
  font-size: 0.8rem;
}

.download-history__tracking {
  text-align: right;
}

.download-history__controls {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 1.25rem;
}

.download-history__controls label,
.download-history__controls label > span {
  display: block;
}

.download-history__controls label > span,
.download-history__sources legend {
  margin-bottom: 0.3rem;
  color: var(--vp-c-text-2);
  font-size: 0.76rem;
  font-weight: 700;
}

.download-history__controls select {
  width: 100%;
  min-height: 2.5rem;
  padding: 0.45rem 1.8rem 0.45rem 0.6rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
}

.download-history__limit-note {
  margin-top: 0.5rem !important;
}

.download-history__sources {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.85rem;
  margin: 1rem 0 0;
  padding: 0.8rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
}

.download-history__sources label {
  display: inline-flex;
  gap: 0.35rem;
  align-items: center;
  min-height: 1.7rem;
  font-size: 0.84rem;
}

.download-history__sources small {
  color: var(--vp-c-text-3);
  font-size: 0.7rem;
}

.download-history__swatch {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
}

.download-history__notice {
  display: grid;
  gap: 0.3rem;
  margin-top: 1rem !important;
  padding: 0.85rem 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
}

.download-history__notice--warning {
  border-color: var(--vp-c-warning-2);
  color: var(--vp-c-text-1);
  background: var(--vp-c-warning-soft);
}

.download-history__notice--error {
  border-color: var(--vp-c-danger-2);
  background: var(--vp-c-danger-soft);
}

.download-history__notice button {
  justify-self: start;
  margin-top: 0.35rem;
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 7px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  cursor: pointer;
}

.download-history__chart {
  position: relative;
  height: min(26rem, 64vw);
  min-height: 18rem;
  margin-top: 1.25rem;
}

.download-history__updated {
  margin-top: 0.5rem !important;
  text-align: right;
}

.download-history__data {
  margin-top: 1rem;
}

.download-history__data summary {
  cursor: pointer;
  font-weight: 650;
}

.download-history__table-scroll {
  overflow-x: auto;
  margin-top: 0.75rem;
}

.download-history__data table {
  display: table;
  width: 100%;
  min-width: 38rem;
  margin: 0;
}

.download-history__data caption {
  padding: 0.5rem;
  color: var(--vp-c-text-2);
  text-align: left;
}

.download-history__data th,
.download-history__data td {
  font-variant-numeric: tabular-nums;
  vertical-align: top;
}

@media (max-width: 720px) {
  .download-history {
    padding: 1rem;
  }

  .download-history__tracking {
    text-align: left;
  }

  .download-history__controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 420px) {
  .download-history__controls {
    grid-template-columns: 1fr;
  }
}
</style>
