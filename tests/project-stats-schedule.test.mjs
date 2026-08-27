import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const workflow = await readFile('.github/workflows/collect-project-stats.yml', 'utf8')
const vercel = JSON.parse(await readFile('vercel.json', 'utf8'))

test('collects project statistics hourly through the protected production endpoint', () => {
  assert.match(workflow, /cron: '5 \* \* \* \*'/)
  assert.match(workflow, /https:\/\/www\.looptroop\.ovh\/api\/cron\/project-stats/)
  assert.match(workflow, /CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/)
  assert.match(workflow, /Authorization: Bearer \$CRON_SECRET/)
  assert.match(workflow, /curl --fail-with-body --silent --show-error/)
})

test('does not configure an hourly cron that Vercel Hobby would reject', () => {
  assert.equal(vercel.crons, undefined)
})
