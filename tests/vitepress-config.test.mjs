import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, unlinkSync } from 'node:fs'
import config from '../docs/.vitepress/config.ts'

test('transformPageData correctly retrieves commit hash for valid relative path', () => {
  const pageData = {
    relativePath: 'index.md',
    frontmatter: {},
  }
  config.transformPageData(pageData)
  assert.ok(pageData.frontmatter.lastUpdatedCommitHash, 'Expected lastUpdatedCommitHash to be set')
  assert.equal(typeof pageData.frontmatter.lastUpdatedCommitHash, 'string')
  assert.match(pageData.frontmatter.lastUpdatedCommitHash, /^[0-9a-f]{40}$/i)
  assert.ok(pageData.frontmatter.lastUpdatedFileDiffHash, 'Expected lastUpdatedFileDiffHash to be set')
})

test('transformPageData prevents command injection in relativePath', () => {
  const canaryFile = '/tmp/looptroop_cmd_injection_test.txt'
  if (existsSync(canaryFile)) {
    unlinkSync(canaryFile)
  }

  const maliciousPaths = [
    `index.md; touch ${canaryFile}`,
    `$(touch ${canaryFile})`,
    `\`touch ${canaryFile}\``,
    `index.md" || touch ${canaryFile} #`,
  ]

  for (const relativePath of maliciousPaths) {
    const pageData = {
      relativePath,
      frontmatter: {},
    }
    config.transformPageData(pageData)
    assert.equal(
      existsSync(canaryFile),
      false,
      `Command injection occurred for relativePath: ${relativePath}`
    )
  }
})
