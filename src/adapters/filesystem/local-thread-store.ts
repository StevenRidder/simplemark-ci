import type { ThreadStore } from '../../application/index.js'
import type { Thread } from '../../domain/index.js'

const STORAGE_PREFIX = 'simplemark.threads.'

/**
 * Durable thread storage for hosts that have no native notes port.
 *
 * The browser Playwright harness reloads the page. An in-memory store would
 * drop the note and the reload test would prove nothing. This store keeps
 * threads in `localStorage` under a key the document already owns. The Tauri
 * shell never constructs it: `tauri.ts` injects `TauriThreadStore` instead.
 */
export class LocalThreadStore implements ThreadStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}

  async list(noteKey: string): Promise<Thread[]> {
    return this.read(noteKey)
  }

  async save(thread: Thread): Promise<void> {
    const existing = this.read(thread.noteKey)
    this.write(thread.noteKey, [...existing.filter((candidate) => candidate.id !== thread.id), thread])
  }

  async remove(noteKey: string, threadId: string): Promise<void> {
    this.write(
      noteKey,
      this.read(noteKey).filter((thread) => thread.id !== threadId),
    )
  }

  private read(noteKey: string): Thread[] {
    let raw: string | null
    try {
      raw = this.storage.getItem(`${STORAGE_PREFIX}${noteKey}`)
    } catch {
      return []
    }
    if (raw === null || raw === '') return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('The notes for this document could not be read')
    }
    if (!Array.isArray(parsed)) {
      throw new Error('The notes for this document could not be read')
    }
    return parsed as Thread[]
  }

  private write(noteKey: string, threads: readonly Thread[]): void {
    this.storage.setItem(`${STORAGE_PREFIX}${noteKey}`, JSON.stringify(threads))
  }
}
