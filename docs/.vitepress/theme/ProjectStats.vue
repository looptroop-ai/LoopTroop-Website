<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  formatProjectCount,
  loadProjectStats,
} from '../../../public/project-stats.js'

interface ProjectStatsPayload {
  schemaVersion: 1
  updatedAt: string
  repository: {
    stars: number
  }
  downloads: {
    total: number
    npmRegistry: number
    dockerHub: number
    github: {
      bundle: number
      standalone: number
      installerScripts: {
        posix: number
        powershell: number
        total: number
      }
    }
  }
}

interface ProjectStatsResult {
  stats: ProjectStatsPayload
  stale: boolean
}

const result = ref<ProjectStatsResult | null>(null)
const loading = ref(true)

const updatedAt = computed(() => {
  if (!result.value) return ''

  const date = new Date(result.value.stats.updatedAt)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
})

const sources = computed(() => {
  if (!result.value) return []

  const { downloads } = result.value.stats
  return [
    {
      label: 'npm registry',
      value: downloads.npmRegistry,
      description: 'Shared by npm, bun, pnpm, Yarn, and the default installer.',
      href: 'https://www.npmjs.com/package/looptroop',
      linkLabel: 'View on npm',
    },
    {
      label: 'Docker Hub',
      value: downloads.dockerHub,
      description: 'Pulls of the LoopTroop image through Docker Hub.',
      href: 'https://hub.docker.com/r/looptroopai/looptroop',
      linkLabel: 'View on Docker Hub',
    },
    {
      label: 'Release bundles',
      value: downloads.github.bundle,
      description: 'Shared bundle archives used by Homebrew, Scoop, and the AUR.',
      href: 'https://github.com/looptroop-ai/LoopTroop/releases',
      linkLabel: 'View GitHub releases',
    },
    {
      label: 'Standalone archives',
      value: downloads.github.standalone,
      description: 'Platform executables, including the archive used by WinGet.',
      href: 'https://github.com/looptroop-ai/LoopTroop/releases',
      linkLabel: 'View GitHub releases',
    },
  ]
})

onMounted(async () => {
  try {
    result.value = await loadProjectStats() as ProjectStatsResult | null
  } catch {
    result.value = null
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="project-stats" aria-label="Download statistics details">
    <div v-if="loading" class="project-stats__notice" role="status">
      Loading download statistics…
    </div>

    <template v-else-if="result">
      <div class="project-stats__summary">
        <p id="project-stats-summary" class="project-stats__eyebrow">Recorded distribution activity</p>
        <p class="project-stats__total">
          {{ formatProjectCount(result.stats.downloads.total) }}
          <span>downloads</span>
        </p>
        <p class="project-stats__summary-copy">
          A source-deduplicated total from the npm registry, Docker Hub, and GitHub
          release bundles and standalone archives.
        </p>
      </div>

      <p v-if="result.stale" class="project-stats__notice project-stats__notice--stale" role="status">
        Live sources are temporarily unavailable. Showing the most recent locally cached statistics.
      </p>

      <div class="project-stats__grid">
        <article v-for="source in sources" :key="source.label" class="project-stats__card">
          <p class="project-stats__card-label">{{ source.label }}</p>
          <p class="project-stats__count">{{ formatProjectCount(source.value) }}</p>
          <p>{{ source.description }}</p>
          <a :href="source.href" target="_blank" rel="noreferrer">
            {{ source.linkLabel }}
          </a>
        </article>
      </div>

      <div class="project-stats__supplemental">
        <div>
          <p class="project-stats__eyebrow">Installer-script fetches</p>
          <p class="project-stats__script-total">
            {{ formatProjectCount(result.stats.downloads.github.installerScripts.total) }} total
          </p>
        </div>
        <dl>
          <div>
            <dt>POSIX <code>install.sh</code></dt>
            <dd>{{ formatProjectCount(result.stats.downloads.github.installerScripts.posix) }}</dd>
          </div>
          <div>
            <dt>PowerShell <code>install.ps1</code></dt>
            <dd>{{ formatProjectCount(result.stats.downloads.github.installerScripts.powershell) }}</dd>
          </div>
        </dl>
        <p>
          These fetches are supplemental and excluded from the total because each
          script goes on to use npm or download a standalone archive already counted above.
        </p>
      </div>

      <p class="project-stats__updated">
        <span v-if="updatedAt">Updated {{ updatedAt }}.</span>
        Statistics refresh about once an hour.
      </p>
    </template>

    <div v-else class="project-stats__notice project-stats__notice--empty" role="status">
      <strong>Download statistics are temporarily unavailable.</strong>
      <span>Visit the official <a href="https://github.com/looptroop-ai/LoopTroop/releases">GitHub releases</a>, <a href="https://www.npmjs.com/package/looptroop">npm package</a>, or <a href="https://hub.docker.com/r/looptroopai/looptroop">Docker Hub repository</a> directly.</span>
    </div>

    <div class="project-stats__coverage">
      <h3 id="how-installation-methods-are-counted">How installation methods are counted</h3>
      <div class="project-stats__table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Installation method</th>
              <th scope="col">Counter used</th>
              <th scope="col">Included in total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>npm, bun, pnpm, Yarn, default installer</td>
              <td>Shared npm-registry downloads</td>
              <td>Yes, once</td>
            </tr>
            <tr>
              <td>Homebrew, Scoop, AUR</td>
              <td>Shared GitHub bundle downloads</td>
              <td>Yes, once</td>
            </tr>
            <tr>
              <td>Standalone and installer <code>--binary</code></td>
              <td>GitHub standalone-archive downloads</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>WinGet</td>
              <td>Shared Windows standalone archive</td>
              <td>Yes; not separately measurable</td>
            </tr>
            <tr>
              <td>Docker or Podman through Docker Hub</td>
              <td>Docker Hub pulls</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Installer-script files</td>
              <td>GitHub script-asset downloads</td>
              <td>No; shown as supplemental</td>
            </tr>
            <tr>
              <td>Chocolatey and GHCR</td>
              <td>Not publicly reported</td>
              <td>No</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <p class="project-stats__disclaimer">
      These are package downloads, image pulls, and release-asset downloads—not
      unique people or confirmed successful installations. Counts can include
      upgrades, automated CI, and repeated retrievals by the same user or system.
    </p>
  </section>
</template>

<style scoped>
.project-stats {
  margin: 1.5rem 0 2.5rem;
}

.project-stats p {
  margin: 0;
}

.project-stats__summary {
  padding: 1.4rem;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 34%, var(--vp-c-divider));
  border-radius: 14px;
  background:
    radial-gradient(circle at top right, var(--vp-c-brand-soft), transparent 52%),
    var(--vp-c-bg-soft);
}

.project-stats__eyebrow,
.project-stats__card-label {
  color: var(--vp-c-text-2);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.4;
  text-transform: uppercase;
}

.project-stats__total {
  margin-top: 0.2rem;
  color: var(--vp-c-text-1);
  font-size: clamp(2rem, 7vw, 3.25rem);
  font-weight: 750;
  letter-spacing: -0.045em;
  line-height: 1.08;
}

.project-stats__total span {
  color: var(--vp-c-text-2);
  font-size: 0.95rem;
  font-weight: 650;
  letter-spacing: 0;
}

.project-stats__summary-copy {
  max-width: 42rem;
  margin-top: 0.65rem !important;
  color: var(--vp-c-text-2);
  line-height: 1.65;
}

.project-stats__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  margin-top: 0.85rem;
}

.project-stats__card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 12.25rem;
  padding: 1.1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.project-stats__count {
  margin: 0.18rem 0 0.4rem !important;
  color: var(--vp-c-text-1);
  font-size: 1.75rem;
  font-weight: 730;
  letter-spacing: -0.025em;
  line-height: 1.2;
}

.project-stats__card > p:nth-child(3) {
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
  line-height: 1.55;
}

.project-stats__card a {
  align-self: flex-start;
  margin-top: auto;
  padding-top: 0.75rem;
  font-size: 0.88rem;
  font-weight: 650;
}

.project-stats__supplemental {
  display: grid;
  grid-template-columns: minmax(9rem, 0.75fr) minmax(14rem, 1fr) minmax(16rem, 1.5fr);
  gap: 1rem;
  align-items: center;
  margin-top: 0.85rem;
  padding: 1.1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-alt);
}

.project-stats__script-total {
  margin-top: 0.15rem !important;
  color: var(--vp-c-text-1);
  font-size: 1.18rem;
  font-weight: 700;
}

.project-stats__supplemental dl,
.project-stats__supplemental dl div {
  margin: 0;
}

.project-stats__supplemental dl {
  display: grid;
  gap: 0.45rem;
}

.project-stats__supplemental dl div {
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.project-stats__supplemental dt,
.project-stats__supplemental dd {
  font-size: 0.86rem;
}

.project-stats__supplemental dd {
  margin: 0;
  color: var(--vp-c-text-1);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.project-stats__supplemental > p {
  color: var(--vp-c-text-2);
  font-size: 0.86rem;
  line-height: 1.55;
}

.project-stats__notice {
  margin: 1rem 0 !important;
  padding: 0.9rem 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
}

.project-stats__notice--stale {
  border-color: var(--vp-c-warning-2);
  color: var(--vp-c-text-1);
  background: var(--vp-c-warning-soft);
}

.project-stats__notice--empty {
  display: grid;
  gap: 0.35rem;
}

.project-stats__updated {
  margin-top: 0.75rem !important;
  color: var(--vp-c-text-3);
  font-size: 0.82rem;
}

.project-stats__coverage {
  margin-top: 2rem;
}

.project-stats__coverage h3 {
  margin: 0 0 1rem;
  padding: 0;
  border: 0;
}

.project-stats__table-scroll {
  overflow-x: auto;
}

.project-stats__coverage table {
  display: table;
  width: 100%;
  min-width: 42rem;
  margin: 0;
}

.project-stats__coverage th,
.project-stats__coverage td {
  vertical-align: top;
}

.project-stats__disclaimer {
  margin-top: 1rem !important;
  padding-left: 0.9rem;
  border-left: 3px solid var(--vp-c-brand-2);
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
  line-height: 1.65;
}

@media (max-width: 640px) {
  .project-stats__summary,
  .project-stats__card,
  .project-stats__supplemental {
    padding: 1rem;
  }

  .project-stats__grid,
  .project-stats__supplemental {
    grid-template-columns: 1fr;
  }

  .project-stats__card {
    min-height: auto;
  }

  .project-stats__card a {
    margin-top: 0.25rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .project-stats * {
    scroll-behavior: auto !important;
  }
}
</style>
