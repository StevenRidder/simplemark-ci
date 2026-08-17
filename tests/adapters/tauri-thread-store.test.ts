import { describe, expect, it, vi } from 'vitest'

import { TauriNoteIdentity } from '../../src/adapters/filesystem/tauri-note-identity.js'
import {
  noteKeyForPath,
  TauriThreadStore,
} from '../../src/adapters/filesystem/tauri-thread-store.js'
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

describe('TauriThreadStore', () => {
  it('returns nothing for a document with no thread file', async () => {
    const invoke = vi.fn().mockResolvedValue('')
    expect(await new TauriThreadStore(invoke).list('n1')).toEqual([])
  })

  it('round-trips a thread through the file contents', async () => {
    let stored = ''
    const invoke = vi.fn(async (command: string, args: Record<string, unknown>) => {
      if (command === 'write_note_threads') {
        stored = args['contents'] as string
        return undefined
      }
      return stored
    })
    const store = new TauriThreadStore(invoke)

    await store.save(thread('t1'))
    expect(await store.list('n1')).toEqual([thread('t1')])
  })

  it('replaces a thread with the same id rather than appending', async () => {
    let stored = ''
    const invoke = vi.fn(async (command: string, args: Record<string, unknown>) => {
      if (command === 'write_note_threads') {
        stored = args['contents'] as string
        return undefined
      }
      return stored
    })
    const store = new TauriThreadStore(invoke)

    await store.save(thread('t1'))
    await store.save({ ...thread('t1'), body: 'edited' })

    const listed = await store.list('n1')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.body).toBe('edited')
  })

  it('never destroys a file it could not parse', async () => {
    const invoke = vi.fn().mockResolvedValue('{ this is not json')
    const store = new TauriThreadStore(invoke)

    await expect(store.list('n1')).rejects.toThrow(/could not be read/)
    expect(invoke).not.toHaveBeenCalledWith('write_note_threads', expect.anything())
  })

  it('refuses JSON that is not an array without writing', async () => {
    const invoke = vi.fn().mockResolvedValue('{"threads":[]}')
    const store = new TauriThreadStore(invoke)

    await expect(store.list('n1')).rejects.toThrow(/could not be read/)
    expect(invoke).not.toHaveBeenCalledWith('write_note_threads', expect.anything())
  })

  it('removes one thread and leaves the rest', async () => {
    let stored = ''
    const invoke = vi.fn(async (command: string, args: Record<string, unknown>) => {
      if (command === 'write_note_threads') {
        stored = args['contents'] as string
        return undefined
      }
      return stored
    })
    const store = new TauriThreadStore(invoke)
    await store.save(thread('t1'))
    await store.save(thread('t2'))
    await store.remove('n1', 't1')
    expect(await store.list('n1')).toEqual([thread('t2')])
  })
})

describe('noteKeyForPath', () => {
  it('is a stable path-prefixed key', () => {
    const first = noteKeyForPath('/tmp/notes/one.md')
    const second = noteKeyForPath('/tmp/notes/one.md')
    expect(first).toMatch(/^path-[0-9a-f]{16}$/)
    expect(first).toBe(second)
    expect(noteKeyForPath('/tmp/notes/two.md')).not.toBe(first)
  })
})

describe('TauriNoteIdentity', () => {
  it('reads an id without writing', async () => {
    const invoke = vi.fn().mockResolvedValue('abc')
    expect(await new TauriNoteIdentity(invoke).readId('/tmp/note.md')).toBe('abc')
    expect(invoke).toHaveBeenCalledWith('read_note_id', { documentHandle: '/tmp/note.md' })
    expect(invoke).not.toHaveBeenCalledWith('ensure_note_id', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('write_note_threads', expect.anything())
  })

  it('treats a missing id as undefined', async () => {
    const invoke = vi.fn().mockResolvedValue(null)
    expect(await new TauriNoteIdentity(invoke).readId('/tmp/note.md')).toBeUndefined()
  })

  it('returns unwritable when ensure cannot stamp an id', async () => {
    const invoke = vi.fn().mockResolvedValue({ id: null, unwritable: true })
    expect(await new TauriNoteIdentity(invoke).ensureId('/tmp/note.md')).toEqual({
      unwritable: true,
    })
  })

  it('returns the stamped id when ensure writes', async () => {
    const invoke = vi.fn().mockResolvedValue({ id: 'abc', unwritable: false })
    expect(await new TauriNoteIdentity(invoke).ensureId('/tmp/note.md')).toEqual({ id: 'abc' })
  })
})
