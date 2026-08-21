import { describe, expect, it } from 'vitest'

import type { NoteCountReport, NoteCountSource } from '../../src/application/index.js'
import type { NoteCounts } from '../../src/app/agent-edit-overlay.js'
import { createNoteCountSweep } from '../../src/app/note-count-sweep.js'

interface Harness {
  calls: string[][]
  applied: [string, number, number][]
  reports: string[]
  cache: Map<string, NoteCounts>
}

function harness(
  answer: (handles: readonly string[]) => NoteCountReport | Promise<NoteCountReport>,
  chunk?: number,
  label?: (handle: string) => string,
) {
  const h: Harness = { calls: [], applied: [], reports: [], cache: new Map() }
  const source: NoteCountSource = {
    count: async (handles) => {
      h.calls.push([...handles])
      return answer(handles)
    },
  }
  const sweep = createNoteCountSweep({
    source,
    cache: h.cache,
    apply: (handle, open, resolved) => h.applied.push([handle, open, resolved]),
    report: (message) => h.reports.push(message),
    ...(chunk === undefined ? {} : { chunk }),
    ...(label === undefined ? {} : { label }),
  })
  return { ...h, sweep }
}

const rows = (...handles: string[]) => ({ notes: handles.map((handle) => ({ handle })) })

describe('note count sweep (APP-47)', () => {
  it('asks once for every row the cache does not know, caches all, paints only the non-zero', async () => {
    const h = harness((handles) => ({
      counts: handles.map((handle) => ({ handle, open: handle === '/b.md' ? 2 : 0, resolved: handle === '/c.md' ? 1 : 0 })),
      unreadable: [],
    }))
    h.cache.set('/a.md', { open: 5, resolved: 0 })
    await h.sweep.sweep(rows('/a.md', '/b.md', '/c.md', '/d.md'))
    expect(h.calls).toEqual([['/b.md', '/c.md', '/d.md']])
    expect(h.applied).toEqual([['/b.md', 2, 0], ['/c.md', 0, 1]])
    expect(h.cache.get('/d.md')).toEqual({ open: 0, resolved: 0 })
    // A second sweep over the same catalog has nothing left to ask.
    await h.sweep.sweep(rows('/a.md', '/b.md', '/c.md', '/d.md'))
    expect(h.calls).toHaveLength(1)
    expect(h.reports).toEqual([])
  })

  it('chunks a large catalog and never sends an empty request', async () => {
    const h = harness((handles) => ({ counts: handles.map((handle) => ({ handle, open: 0, resolved: 0 })), unreadable: [] }), 2)
    await h.sweep.sweep(rows('/1', '/2', '/3', '/4', '/5'))
    expect(h.calls).toEqual([['/1', '/2'], ['/3', '/4'], ['/5']])
    await h.sweep.sweep(rows())
    expect(h.calls).toHaveLength(3)
  })

  it('the open document\'s own report wins over a count that was in flight', async () => {
    let release: (() => void) | undefined
    const h = harness(async (handles) => {
      await new Promise<void>((resolve) => { release = resolve })
      return { counts: handles.map((handle) => ({ handle, open: 9, resolved: 9 })), unreadable: [] }
    })
    const pending = h.sweep.sweep(rows('/open.md', '/other.md'))
    // The open document paints while the call is out.
    h.cache.set('/open.md', { open: 1, resolved: 0 })
    release!()
    await pending
    expect(h.cache.get('/open.md')).toEqual({ open: 1, resolved: 0 })
    expect(h.cache.get('/other.md')).toEqual({ open: 9, resolved: 9 })
    expect(h.applied).toEqual([['/other.md', 9, 9]])
  })

  it('names unreadable documents once, never counts them as zero, and does not retry them', async () => {
    const h = harness(() => ({ counts: [], unreadable: ['/folder/placeholder.md', '/folder/broken.md'] }))
    await h.sweep.sweep(rows('/folder/placeholder.md', '/folder/broken.md'))
    expect(h.reports).toEqual(['Could not read the notes for 2 documents, including placeholder.md'])
    expect(h.cache.size).toBe(0)
    await h.sweep.sweep(rows('/folder/placeholder.md', '/folder/broken.md'))
    expect(h.calls).toHaveLength(1)
    expect(h.reports).toHaveLength(1)
  })

  it('names an unreadable document the way the host labels it', async () => {
    const h = harness(() => ({ counts: [], unreadable: ['note-2'] }), undefined, (id) => (id === 'note-2' ? 'second.md' : id))
    await h.sweep.sweep(rows('note-2'))
    expect(h.reports).toEqual(['Could not read the notes for second.md'])
  })

  it('a source that throws is reported, not swallowed, and the rows can be asked again', async () => {
    let fail = true
    const h = harness((handles) => {
      if (fail) throw new Error('bridge down')
      return { counts: handles.map((handle) => ({ handle, open: 1, resolved: 0 })), unreadable: [] }
    })
    await h.sweep.sweep(rows('/x.md'))
    expect(h.reports).toEqual(['Could not count notes — bridge down'])
    fail = false
    await h.sweep.sweep(rows('/x.md'))
    expect(h.applied).toEqual([['/x.md', 1, 0]])
  })
})
