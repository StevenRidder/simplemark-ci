import { describe, expect, it } from 'vitest'

import { BrowserFilePort } from '../../src/adapters/filesystem/browser-file-port.js'

/**
 * The File System Access API is not present in the test runtime, so the port
 * is exercised through the same seam the browser build uses: an injected
 * picker returning a FileSystemFileHandle-shaped object. The fake keeps real
 * bytes and honours the staging semantics of createWritable — nothing is
 * visible until close() — which is exactly the atomicity the port relies on.
 */
interface FakeWrite {
  closed: boolean
  chunks: Uint8Array[]
}

function fakeHandle(name: string, initial: Uint8Array) {
  let bytes = initial
  const writes: FakeWrite[] = []
  const handle = {
    name,
    async getFile(): Promise<File> {
      return new File([bytes as BlobPart], name, { type: 'text/markdown' })
    },
    async createWritable() {
      const write: FakeWrite = { closed: false, chunks: [] }
      writes.push(write)
      return {
        async write(chunk: Uint8Array) {
          write.chunks.push(chunk)
        },
        async close() {
          write.closed = true
          bytes = new Uint8Array(write.chunks.flatMap((c) => [...c]))
        },
      }
    },
  }
  return { handle, writes, current: () => bytes }
}

const BYTES = new TextEncoder().encode('# A real note\n\nwith bytes that must not change\n')

describe('BrowserFilePort', () => {
  it('opens the picked file with its exact bytes', async () => {
    const { handle } = fakeHandle('note.md', BYTES)
    const port = new BrowserFilePort(async () => handle as unknown as FileSystemFileHandle)

    const doc = await port.open()

    expect(doc.name).toBe('note.md')
    expect([...doc.bytes]).toEqual([...BYTES])
  })

  it('saves through createWritable and the write is complete before it is visible', async () => {
    const { handle, writes, current } = fakeHandle('note.md', BYTES)
    const port = new BrowserFilePort(async () => handle as unknown as FileSystemFileHandle)
    const doc = await port.open()

    const next = new TextEncoder().encode('# Edited\n')
    await port.save(doc.handle, next)

    expect(writes).toHaveLength(1)
    expect(writes[0]!.closed).toBe(true)
    expect([...current()]).toEqual([...next])
  })

  it('reopen after save returns the saved bytes', async () => {
    const { handle } = fakeHandle('note.md', BYTES)
    const port = new BrowserFilePort(async () => handle as unknown as FileSystemFileHandle)
    const doc = await port.open()

    const next = new TextEncoder().encode('# Edited\n\nsecond paragraph\n')
    await port.save(doc.handle, next)
    const reopened = await port.open()

    expect(new TextDecoder().decode(reopened.bytes)).toBe('# Edited\n\nsecond paragraph\n')
  })

  it('refuses to save a handle it did not issue', async () => {
    const { handle } = fakeHandle('note.md', BYTES)
    const port = new BrowserFilePort(async () => handle as unknown as FileSystemFileHandle)
    await port.open()

    await expect(port.save('fixture:architecture.md', BYTES)).rejects.toThrow(/unknown handle/)
  })

  it('save before any open fails loudly', async () => {
    const { handle } = fakeHandle('note.md', BYTES)
    const port = new BrowserFilePort(async () => handle as unknown as FileSystemFileHandle)

    await expect(port.save('fsa:0', BYTES)).rejects.toThrow(/unknown handle/)
  })
})
