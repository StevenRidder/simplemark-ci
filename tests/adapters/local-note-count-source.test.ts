import { describe, expect, it } from 'vitest'

import { LocalNoteCountSource } from '../../src/adapters/filesystem/local-note-count-source.js'

const storage = (entries: Record<string, string>) => ({ getItem: (key: string) => entries[key] ?? null })

describe('LocalNoteCountSource (APP-47)', () => {
  it('counts open and resolved threads under the mapped key, zero when there is nothing stored', async () => {
    const source = new LocalNoteCountSource(
      storage({
        'simplemark.threads.fixture:b.md': JSON.stringify([{ id: '1', state: 'open' }, { id: '2', state: 'resolved' }, { id: '3', state: 'open' }]),
      }),
      (row) => (row === 'note-1' ? 'fixture:a.md' : row === 'note-2' ? 'fixture:b.md' : undefined),
    )
    await expect(source.count(['note-1', 'note-2'])).resolves.toEqual({
      counts: [
        { handle: 'note-1', open: 0, resolved: 0 },
        { handle: 'note-2', open: 2, resolved: 1 },
      ],
      unreadable: [],
    })
  })

  it('reports an unmappable row and an unparseable value instead of counting zero', async () => {
    const source = new LocalNoteCountSource(
      storage({ 'simplemark.threads.fixture:bad.md': '{not json', 'simplemark.threads.fixture:obj.md': '{"a":1}' }),
      (row) => (row === 'ghost' ? undefined : `fixture:${row}`),
    )
    await expect(source.count(['ghost', 'bad.md', 'obj.md'])).resolves.toEqual({
      counts: [],
      unreadable: ['ghost', 'bad.md', 'obj.md'],
    })
  })
})
