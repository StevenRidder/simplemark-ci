import type { ThreadStore } from '../../application/index.js'
import type { Thread } from '../../domain/index.js'

export type TauriNotesInvoke = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>

/** The degraded key for a document that would not take an id. */
export function noteKeyForPath(path: string): string {
  let hash = 0n
  for (const char of path) hash = (hash * 131n + BigInt(char.codePointAt(0) ?? 0)) % (1n << 64n)
  return `path-${hash.toString(16).padStart(16, '0')}`
}

/**
 * One JSON file per document, holding all of its threads.
 *
 * A file that will not parse raises rather than being replaced. Losing a note
 * because we failed to read it would be worse than the read failing — and a
 * store that repairs itself by truncating is a store that eats data.
 */
export class TauriThreadStore implements ThreadStore {
  constructor(private readonly invoke: TauriNotesInvoke) {}

  async list(noteKey: string): Promise<Thread[]> {
    const raw = await this.invoke('read_note_threads', { noteKey })
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (text === '') return []
    try {
      const parsed: unknown = JSON.parse(text)
      return Array.isArray(parsed) ? (parsed as Thread[]) : []
    } catch {
      throw new Error('The notes for this document could not be read')
    }
  }

  async save(thread: Thread): Promise<void> {
    const existing = await this.list(thread.noteKey)
    const next = [...existing.filter((candidate) => candidate.id !== thread.id), thread]
    await this.write(thread.noteKey, next)
  }

  async remove(noteKey: string, threadId: string): Promise<void> {
    const existing = await this.list(noteKey)
    await this.write(
      noteKey,
      existing.filter((candidate) => candidate.id !== threadId),
    )
  }

  private async write(noteKey: string, threads: readonly Thread[]): Promise<void> {
    await this.invoke('write_note_threads', {
      noteKey,
      contents: JSON.stringify(threads, null, 2),
    })
  }
}
