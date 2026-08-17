import { describe, expect, it } from 'vitest'

import { LocalThreadStore } from '../../src/adapters/filesystem/local-thread-store.js'
import { buildAnchor, type Thread } from '../../src/domain/index.js'

const thread = (id: string): Thread => ({
  id,
  noteKey: 'n1',
  author: 'local',
  createdAt: '2026-08-06T10:00:00Z',
  body: 'why?',
  anchor: buildAnchor('a QUOTE b', 2, 7, 0),
  state: 'open',
})

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('LocalThreadStore', () => {
  it('returns nothing for a document with no stored threads', async () => {
    expect(await new LocalThreadStore(memoryStorage()).list('n1')).toEqual([])
  })

  it('round-trips a thread through localStorage', async () => {
    const store = new LocalThreadStore(memoryStorage())
    await store.save(thread('t1'))
    expect(await store.list('n1')).toEqual([thread('t1')])
  })

  it('replaces a thread with the same id rather than appending', async () => {
    const store = new LocalThreadStore(memoryStorage())
    await store.save(thread('t1'))
    await store.save({ ...thread('t1'), body: 'edited' })
    const listed = await store.list('n1')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.body).toBe('edited')
  })

  it('never overwrites a value it could not parse', async () => {
    const storage = memoryStorage()
    storage.setItem('simplemark.threads.n1', '{ this is not json')
    const store = new LocalThreadStore(storage)
    await expect(store.list('n1')).rejects.toThrow(/could not be read/)
    expect(storage.getItem('simplemark.threads.n1')).toBe('{ this is not json')
  })

  it('removes one thread and leaves the rest', async () => {
    const store = new LocalThreadStore(memoryStorage())
    await store.save(thread('t1'))
    await store.save(thread('t2'))
    await store.remove('n1', 't1')
    expect(await store.list('n1')).toEqual([thread('t2')])
  })
})
