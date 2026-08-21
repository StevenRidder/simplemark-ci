import { describe, expect, test } from 'vitest'

import { AUTOMATIC_SNAPSHOT_LIMIT, LocalSnapshotStore, prune } from '../../src/adapters/filesystem/local-snapshot-store.js'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { size(): number } {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    size: () => map.size,
  }
}

describe('LocalSnapshotStore', () => {
  test('writes bytes back exactly and lists newest last', async () => {
    const store = new LocalSnapshotStore(memoryStorage())
    const first = await store.write('n', '# One\n', { trigger: 'agent' })
    const second = await store.write('n', '# Two\n', { trigger: 'manual', label: 'before Brent' })
    expect((await store.list('n')).map((entry) => entry.id)).toEqual([first.id, second.id])
    expect(await store.read('n', first.id)).toBe('# One\n')
    expect((await store.list('n'))[1]?.label).toBe('before Brent')
  })

  test('prunes automatic snapshots past the limit but never named ones', () => {
    const entries = Array.from({ length: AUTOMATIC_SNAPSHOT_LIMIT + 2 }, (_, i) => ({
      id: `a${i}`, createdMs: i, trigger: 'agent' as const, bytes: 1,
    }))
    const named = { id: 'named', createdMs: 0, trigger: 'manual' as const, bytes: 1, label: 'keep' }
    const kept = prune([named, ...entries])
    expect(kept.some((entry) => entry.id === 'named')).toBe(true)
    expect(kept.filter((entry) => entry.label === undefined)).toHaveLength(AUTOMATIC_SNAPSHOT_LIMIT)
    expect(kept.find((entry) => entry.id === 'a0')).toBeUndefined()
  })

  test('remove forgets both the bytes and the index entry', async () => {
    const storage = memoryStorage()
    const store = new LocalSnapshotStore(storage)
    const entry = await store.write('n', 'body', { trigger: 'agent' })
    await store.remove('n', entry.id)
    expect(await store.list('n')).toEqual([])
    await expect(store.read('n', entry.id)).rejects.toThrow('no longer exists')
  })
})
