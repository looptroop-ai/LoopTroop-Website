import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { FLOOR_PHRASES, floorPages, rewriteFloor, rewritePin } from '../scripts/follow-looptroop.mjs'
import {
  assertDocumentedPrerequisiteFloors,
  auditApiRouteCoverage,
  auditSseEventCoverage,
  compareSemverTriples,
  extractFloorVersion,
  findDocumentedPrerequisiteVersions,
  findFutureReleaseLanguage,
  findReleaseLeakage,
  parseDocumentedApiRoutes,
  parseDocumentedSseEvents,
} from '../scripts/verify-site.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const readRepoFile = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8')

/** The body of the `run: |` block in the step with this `id`, as bash receives it. */
function runBlock(yamlText, id) {
  const lines = yamlText.split('\n')
  const step = lines.findIndex((line) => line.trim() === `id: ${id}`)
  const run = lines.findIndex((line, index) => index > step && line.trim() === 'run: |')
  assert.ok(step >= 0 && run > step, `no run block for step ${id}`)
  const indent = lines[run + 1].length - lines[run + 1].trimStart().length
  const body = []
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && line.length - line.trimStart().length < indent) break
    body.push(line.slice(indent))
  }
  return body.join('\n')
}

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
 * The pages are generated from one application commit and verified against the
 * checkout of one. If those could differ, the pages would be checked against a
 * CLI other than the one they came from, and nothing downstream would notice.
 * So the commit is written once, in CLI_SOURCE_REF, and the checkout reads it
 * from there. That also keeps it out of every workflow file, which
 * follow-looptroop.yml could not move: GITHUB_TOKEN may not push a workflow edit.
 */
test('checks out the commit CLI_SOURCE_REF names, and names it nowhere else', async () => {
  const { CLI_SOURCE_REF } = await import('../scripts/sync-cli-reference.mjs')
  assert.match(CLI_SOURCE_REF, /^[0-9a-f]{40}$/)

  const action = await readRepoFile('.github/actions/looptroop-source/action.yml')
  const scratch = mkdtempSync(path.join(tmpdir(), 'looptroop-source-'))
  try {
    const output = path.join(scratch, 'github-output')
    const result = spawnSync('bash', ['-c', runBlock(action, 'pin')], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(output, 'utf8'), `ref=${CLI_SOURCE_REF}\n`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  assert.ok(action.includes('ref: ${{ steps.pin.outputs.ref }}'), 'the action checks out the commit it read')

  const workflows = await readdir(path.join(repoRoot, '.github', 'workflows'))
  for (const name of workflows) {
    const workflow = await readRepoFile(path.join('.github', 'workflows', name))
    assert.ok(!workflow.includes(CLI_SOURCE_REF), `${name} names the source commit itself`)
    assert.ok(!workflow.includes('repository: looptroop-ai/LoopTroop'), `${name} checks out LoopTroop without the action`)
  }
  for (const name of ['ci.yml', 'follow-looptroop.yml']) {
    const workflow = await readRepoFile(path.join('.github', 'workflows', name))
    assert.ok(workflow.includes('uses: ./.github/actions/looptroop-source'), `${name} verifies against the pinned source`)
  }
})

test('moves the floor in every phrase that states it, and in nothing else', () => {
  const page = [
    '| curl | Node 24.18.0+, git, `gh` |',
    '| npm | you provide **24.18.0+** |',
    'application channels need Node `24.18.0` or',
    'the runtime floor is **Node 24.18.0 or',
    'newer**. Homebrew installs `node@24` for you.',
    'Node 24.13.1 fixed it, npm 24.18.0 is no Node, and 24.18.0 alone is no floor.',
  ].join('\n')

  assert.equal(rewriteFloor(page, '24.18.0', '24.19.1'), [
    '| curl | Node 24.19.1+, git, `gh` |',
    '| npm | you provide **24.19.1+** |',
    'application channels need Node `24.19.1` or',
    'the runtime floor is **Node 24.19.1 or',
    'newer**. Homebrew installs `node@24` for you.',
    'Node 24.13.1 fixed it, npm 24.18.0 is no Node, and 24.18.0 alone is no floor.',
  ].join('\n'))
  assert.match(rewriteFloor(page, '24.18.0', '26.1.0'), /Homebrew installs `node@26` for you/)
  assert.equal(rewriteFloor(page, '24.18.0', '24.18.0'), page)
})

test('moves CLI_SOURCE_REF to a full commit, and nothing else', async () => {
  const source = await readRepoFile('scripts/sync-cli-reference.mjs')
  const commit = 'a'.repeat(40)
  const moved = rewritePin(source, commit)
  const before = source.split('\n')
  const changed = moved.split('\n').filter((line, index) => line !== before[index])

  assert.deepEqual(changed, [`export const CLI_SOURCE_REF = '${commit}'`])
  assert.throws(() => rewritePin(source, 'main'), /Not a full commit/)
  assert.throws(() => rewritePin('export const CLI_SOURCE_REF = main', commit), /no CLI_SOURCE_REF line/)
})

/**
 * follow-looptroop.mjs moves the floor by finding it in known phrases, so a
 * page that states it some other way would keep the old number after the
 * application's floor moved, and verify:site would not notice a number above
 * the floor. Every mention of the documented floor has to be one it can move.
 */
test('states the Node floor only in phrases the daily follow can move', async () => {
  const documented = new Set(findDocumentedPrerequisiteVersions(await readRepoFile('docs/getting-started.md'), 'Node'))
  assert.ok(documented.size > 0, 'Getting Started states no Node floor')

  const pages = await floorPages(repoRoot)
  assert.ok(pages.includes('web.html') && pages.includes(path.join('docs', 'getting-started.md')))
  for (const floor of documented) {
    let stated = 0
    let movable = 0
    for (const page of pages) {
      const text = await readRepoFile(page)
      stated += text.split(floor).length - 1
      for (const [before, after] of FLOOR_PHRASES) movable += text.split(`${before}${floor}${after}`).length - 1
    }
    assert.equal(movable, stated, `a page states Node ${floor} in a phrase follow-looptroop.mjs cannot move`)
  }
})

/**
 * The publishing job holds a write token, so nothing installed runs there: the
 * follow script and everything it imports are Node built-ins and this
 * repository's own files, and the job pushes only the rewrite the read-only job
 * built, tested and verified.
 */
test('publishes the daily follow with nothing installed in reach of the write token', async () => {
  const pending = ['scripts/follow-looptroop.mjs']
  const seen = new Set()
  while (pending.length > 0) {
    const file = pending.pop()
    if (seen.has(file)) continue
    seen.add(file)
    // `from 'x'`, `import 'x'` and `import('x')`, over line breaks.
    for (const [, specifier] of (await readRepoFile(file)).matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)'([^']+)'/g)) {
      if (specifier.startsWith('node:')) continue
      assert.ok(specifier.startsWith('./'), `${file} imports ${specifier}, which the publishing job has not installed`)
      pending.push(path.posix.join(path.posix.dirname(file), specifier))
    }
  }
  assert.ok(seen.has('scripts/sync-cli-reference.mjs') && seen.has('scripts/verify-site.mjs'))

  const workflow = await readRepoFile('.github/workflows/follow-looptroop.yml')
  const follow = workflow.slice(workflow.indexOf('\n  follow:'), workflow.indexOf('\n  publish:'))
  const publish = workflow.slice(workflow.indexOf('\n  publish:'))
  assert.match(workflow, /^permissions:\n {2}contents: read$/m)
  assert.ok(!follow.includes('contents: write'), 'the job that runs installed code cannot write')
  assert.match(publish, /permissions:\n {6}contents: write/)
  assert.doesNotMatch(publish, /npm |verify:site|looptroop-source/, 'the publishing job runs nothing installed')
  assert.ok(publish.includes('node scripts/follow-looptroop.mjs "${COMMIT}"'))
  assert.ok(publish.includes('!= "${VERIFIED}"'), 'the publishing job pushes only the verified rewrite')
  assert.doesNotMatch(publish, /--force|push [^\n]*\+/)

  const ci = await readRepoFile('.github/workflows/ci.yml')
  const nodeVersions = [...`${ci}\n${workflow}`.matchAll(/node-version: (\S+)/g)].map((match) => match[1])
  assert.equal(new Set(nodeVersions).size, 1, 'the daily follow verifies on the Node CI verifies on')
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
