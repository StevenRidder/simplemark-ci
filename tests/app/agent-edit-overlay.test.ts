import { describe, expect, test } from 'vitest'

import {
  agentEditLabel,
  applyAgentEditsToCatalog,
  countAgentEdit,
} from '../../src/app/agent-edit-overlay.js'
import type { WorkspaceCatalog } from '../../src/application/index.js'

const catalog: WorkspaceCatalog = {
  handle: '/notes',
  name: 'notes',
  notes: [
    { handle: '/notes/a.md', name: 'a.md', modifiedMs: 1, createdMs: 1 },
    { handle: '/notes/b.md', name: 'b.md', modifiedMs: 2, createdMs: 2 },
  ],
}

describe('applyAgentEditsToCatalog', () => {
  test('marks only the notes an agent actually wrote to', () => {
    const next = applyAgentEditsToCatalog(catalog, new Map([['/notes/b.md', 3]]))

    expect(next.notes[0]).not.toHaveProperty('agentChanges')
    expect(next.notes[1]?.agentChanges).toBe(3)
  })

  test('a zero count is not a marker', () => {
    // A note the agent opened and left alone reads as untouched, because it is.
    const next = applyAgentEditsToCatalog(catalog, new Map([['/notes/a.md', 0]]))
    expect(next.notes[0]).not.toHaveProperty('agentChanges')
  })

  test('an empty tally returns the same catalog untouched', () => {
    expect(applyAgentEditsToCatalog(catalog, new Map())).toBe(catalog)
  })

  test('a handle the catalog does not list is ignored rather than invented', () => {
    const next = applyAgentEditsToCatalog(catalog, new Map([['/elsewhere.md', 9]]))
    expect(next.notes).toHaveLength(2)
    expect(next.notes.some((note) => note.agentChanges !== undefined)).toBe(false)
  })
})

describe('countAgentEdit', () => {
  test('counts per note and leaves the previous map alone', () => {
    const first = countAgentEdit(new Map(), '/notes/a.md')
    const second = countAgentEdit(first, '/notes/a.md')
    const other = countAgentEdit(second, '/notes/b.md')

    expect(first.get('/notes/a.md')).toBe(1)
    // The earlier map is unchanged, so a render that captured it cannot shift
    // under its own paint.
    expect(second.get('/notes/a.md')).toBe(2)
    expect(other.get('/notes/a.md')).toBe(2)
    expect(other.get('/notes/b.md')).toBe(1)
  })

  test('an unsaved note with no handle is not counted against ""', () => {
    expect(countAgentEdit(new Map(), '').size).toBe(0)
  })
})

describe('agentEditLabel', () => {
  test('reads correctly for one change', () => {
    expect(agentEditLabel(1)).toBe('Agent made 1 change')
    expect(agentEditLabel(4)).toBe('Agent made 4 changes')
  })
})
