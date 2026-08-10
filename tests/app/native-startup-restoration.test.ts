import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

const TAURI = readFileSync('src/app/tauri.ts', 'utf8')

test('native startup mounts either the restored note or the welcome sample', () => {
  const start = TAURI.indexOf("  const mostRecent = collections.recentNotes('').notes[0]")
  const end = TAURI.indexOf("  await listen<string>('workspace-folder-changed'", start)
  expect(start, 'native restoration block should exist').toBeGreaterThan(-1)
  expect(end, 'native restoration block should end before folder watching').toBeGreaterThan(start)

  const restoration = TAURI.slice(start, end)
  expect(restoration).toMatch(/if \(restoredNote !== undefined\) \{[\s\S]*?await install\(port, opened, activeCollectionId\)/)
  expect(restoration).toMatch(/\} else \{[\s\S]*?await mountSample\(\)/)
  expect(restoration).not.toMatch(/await mountSample\(\)\s*\n\s*const mostRecent/)

  const installStart = TAURI.indexOf('  const install = async')
  const installEnd = TAURI.indexOf('  const mountSample = async', installStart)
  const install = TAURI.slice(installStart, installEnd)
  expect(install).toContain('if (current !== undefined) await current.destroy()')
})
