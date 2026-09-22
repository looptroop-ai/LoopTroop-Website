import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertDocumentedPrerequisiteFloors,
  auditApiRouteCoverage,
  auditSseEventCoverage,
  compareSemverTriples,
  extractFloorVersion,
  findFutureReleaseLanguage,
  findReleaseLeakage,
  parseDocumentedApiRoutes,
  parseDocumentedSseEvents,
} from '../scripts/verify-site.mjs'

test('extracts and compares version floors at patch level', () => {
  assert.equal(extractFloorVersion('>=24.21.0'), '24.21.0')
  assert.equal(compareSemverTriples('24.21.1', '24.21.0') > 0, true)
  assert.equal(compareSemverTriples('24.21.0', '24.21.0'), 0)
  assert.equal(compareSemverTriples('24.18.0', '24.21.0') < 0, true)
})

test('accepts Getting Started prerequisite versions at or above the CLI floor', () => {
  const gettingStarted = `
| Channel | What it needs first |
| --- | --- |
| curl | Node 24.21.0+, npm 12.0.2+, git, gh |
| npm | Node 24.21.1+, npm 12.0.2+, git, gh |
`

  assert.doesNotThrow(() => assertDocumentedPrerequisiteFloors(gettingStarted, {
    engines: { node: '>=24.21.0', npm: '>=12.0.2' },
  }))
})

test('reports documented prerequisite versions below the CLI floor', () => {
  const gettingStarted = 'Node 24.18.0+, npm 12.0.1+'

  assert.throws(
    () => assertDocumentedPrerequisiteFloors(gettingStarted, {
      engines: { node: '>=24.21.0', npm: '>=12.0.2' },
    }),
    /below the CLI floor/,
  )
})

test('accepts a page that documents no npm floor when the CLI declares none', () => {
  const gettingStarted = '| curl | Node 24.11.0+, git, gh |'

  assert.doesNotThrow(() => assertDocumentedPrerequisiteFloors(gettingStarted, {
    engines: { node: '>=24.11.0' },
  }))
})

test('reports an npm floor the CLI no longer declares', () => {
  const gettingStarted = '| curl | Node 24.11.0+, npm 12.0.2+, git, gh |'

  assert.throws(
    () => assertDocumentedPrerequisiteFloors(gettingStarted, {
      engines: { node: '>=24.11.0' },
    }),
    /declares no npm floor/,
  )
})

test('names the homepage when its prerequisites drift from the CLI', () => {
  const homepage = '<span>Pre-requisites:</span> OpenCode, Node 24.21.0+, npm 12.0.2+, Git'

  assert.throws(
    () => assertDocumentedPrerequisiteFloors(homepage, { engines: { node: '>=24.15.0' } }, 'The homepage'),
    /^Error: The homepage documents npm 12\.0\.2\+ while the CLI declares no npm floor\.$/,
  )
})

/**
 * The CLI source is named twice: once for the sparse checkout CI verifies
 * against, once for the script that regenerates docs/cli.md. Moving one without
 * the other validates the pages against a different CLI than the one they were
 * generated from, and nothing downstream notices.
 */
test('pins the workflow checkout and the CLI reference sync to the same source commit', async () => {
  const { CLI_SOURCE_REF } = await import('../scripts/sync-cli-reference.mjs')
  const { readFile } = await import('node:fs/promises')
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

  assert.match(CLI_SOURCE_REF, /^[0-9a-f]{40}$/)
  assert.ok(workflow.includes(`ref: ${CLI_SOURCE_REF}`), 'ci.yml checks out a different LoopTroop commit than CLI_SOURCE_REF')
})

test('parses documented route rows and allows intentional tombstones', () => {
  const markdown = `
| Method | Route | Notes |
| --- | --- | --- |
| \`GET\` | \`/api/live\` | Current route |
| \`POST\` | \`/api/old\` | Deprecated tombstone row kept for migration notes |
`

  const audit = auditApiRouteCoverage(
    ['GET /api/live'],
    parseDocumentedApiRoutes(markdown),
  )

  assert.deepEqual(audit, { missing: [], unexpected: [] })
})

test('reports missing live routes and non-tombstone extras', () => {
  const markdown = `
| Method | Route | Notes |
| --- | --- | --- |
| \`GET\` | \`/api/live\` | Current route |
| \`POST\` | \`/api/extra\` | Accidental extra row |
`

  const audit = auditApiRouteCoverage(
    ['GET /api/live', 'POST /api/needed'],
    parseDocumentedApiRoutes(markdown),
  )

  assert.deepEqual(audit, {
    missing: ['POST /api/needed'],
    unexpected: ['POST /api/extra'],
  })
})

test('parses SSE event docs and allows explicitly reserved names', () => {
  const markdown = `
## SSE Events

| Event type | When emitted | Key payload fields |
| --- | --- | --- |
| \`state_change\` | State changes | \`ticketId\` |
| \`log\` | Log writes | \`ticketId\` |
| \`replay_gap\` | Replay cannot continue | \`ticketId\` |

> The \`SSEEventType\` union in \`server/sse/eventTypes.ts\` also declares \`progress\` and \`app_error\`, but no broadcaster call site emits them today.
`

  const parsed = parseDocumentedSseEvents(markdown)
  assert.deepEqual(parsed, {
    documented: ['state_change', 'log', 'replay_gap'],
    reserved: ['progress', 'app_error'],
  })

  const audit = auditSseEventCoverage({
    liveEvents: ['state_change', 'log', 'replay_gap', 'progress', 'app_error'],
    documentedEvents: parsed.documented,
    reservedEvents: parsed.reserved,
  })

  assert.deepEqual(audit, { missing: [], unexpected: [] })
})

test('flags undocumented live SSE events that are not explicitly reserved', () => {
  const audit = auditSseEventCoverage({
    liveEvents: ['state_change', 'ai_metrics'],
    documentedEvents: ['state_change'],
    reservedEvents: [],
  })

  assert.deepEqual(audit, { missing: ['ai_metrics'], unexpected: [] })
})

test('finds internal PR labels and release markers', () => {
  const findings = findReleaseLeakage(`
PR21 (unreleased) adds something here.
<!-- release-marker keep-out -->
`)

  assert.deepEqual(findings, ['<!-- release-marker keep-out -->', 'PR21 (unreleased)'])
})

test('finds forward-looking release wording without flagging upcoming questions', () => {
  assert.deepEqual(
    findFutureReleaseLanguage('Next release behavior. Upcoming release notes. Adjust the upcoming questions.'),
    ['Next release', 'Upcoming release'],
  )
})
