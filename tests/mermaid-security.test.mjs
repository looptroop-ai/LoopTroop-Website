import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('MermaidBlock configured with strict securityLevel', async () => {
  const filePath = new URL('../docs/.vitepress/theme/MermaidBlock.vue', import.meta.url)
  const content = await readFile(filePath, 'utf8')

  assert.match(content, /securityLevel:\s*'strict'/)
  assert.doesNotMatch(content, /securityLevel:\s*'loose'/)
})
