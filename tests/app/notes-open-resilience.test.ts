import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Opening a note must never be lost to notes.
 *
 * On 2026-08-17 the desktop app went blank on every open: `composeApp` awaited
 * the thread store with the raw document path as its key whenever the file had
 * no front-matter id, the native store rejected that key, and nothing caught
 * the rejection — `start()` had no `.catch`, so the window stayed white and
 * looked hung. The browser shell's `LocalThreadStore` accepts any key, which
 * is why no test noticed. These are source guards, per tests/app/native-new-note.test.ts.
 */

const BOOTSTRAP = readFileSync('src/app/bootstrap.ts', 'utf8')
const TAURI = readFileSync('src/app/tauri.ts', 'utf8')

function bootstrapConst(name: string): string {
  const start = BOOTSTRAP.indexOf(`  const ${name} = `)
  expect(start, `${name} should exist in src/app/bootstrap.ts`).toBeGreaterThan(-1)
  const end = BOOTSTRAP.indexOf('\n  }\n', start)
  expect(end).toBeGreaterThan(start)
  return BOOTSTRAP.slice(start, end)
}

describe('the note key for the open document', () => {
  const noteKeyForOpenDocument = bootstrapConst('noteKeyForOpenDocument')

  it('degrades to the same path-derived key the composer uses, never the raw handle', () => {
    expect(noteKeyForOpenDocument).toContain('noteKeyForPath(handle)')
    expect(noteKeyForOpenDocument).not.toMatch(/\?\?\s*handle\b/)
  })
})

describe('loading threads while composing', () => {
  it('cannot reject the composition: a store or identity failure costs exactly the notes', () => {
    const load = BOOTSTRAP.indexOf('let noteThreads: readonly Thread[]')
    expect(load).toBeGreaterThan(-1)
    const window = BOOTSTRAP.slice(load, load + 900)
    expect(window).toMatch(/try \{[\s\S]*await persist\.list\(await noteKeyForOpenDocument\(\)\)[\s\S]*\} catch/)
  })
})

describe('the native entrypoint', () => {
  it('reports a startup failure in the window instead of leaving it blank', () => {
    const start = TAURI.indexOf('void start(root)')
    expect(start).toBeGreaterThan(-1)
    expect(TAURI.slice(start, start + 400)).toMatch(/\.catch\(/)
  })
})
