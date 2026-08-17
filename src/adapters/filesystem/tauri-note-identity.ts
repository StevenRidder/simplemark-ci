import type { NoteIdentity } from '../../application/index.js'

type TauriNotesInvoke = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>

/**
 * Two calls, and the separation is the guarantee.
 *
 * `readId` reaches a command that only reads, so no code path exists by which
 * opening a document could modify it. `ensureId` is reached only when the
 * author creates their first note.
 */
export class TauriNoteIdentity implements NoteIdentity {
  constructor(private readonly invoke: TauriNotesInvoke) {}

  async readId(documentHandle: string): Promise<string | undefined> {
    let id: unknown
    try {
      id = await this.invoke('read_note_id', { documentHandle })
    } catch {
      // Not every handle is a readable file: the welcome sample, an unsaved
      // draft, an iCloud placeholder. A document we cannot read has no id we
      // can see, and saying so must never cost the person the document itself.
      return undefined
    }
    return typeof id === 'string' && id !== '' ? id : undefined
  }

  async ensureId(documentHandle: string): Promise<{ id: string; markdown?: string } | { unwritable: true }> {
    const result = (await this.invoke('ensure_note_id', { documentHandle })) as {
      id?: string
      unwritable?: boolean
      markdown?: string
    }
    if (typeof result.id !== 'string') return { unwritable: true }
    return typeof result.markdown === 'string'
      ? { id: result.id, markdown: result.markdown }
      : { id: result.id }
  }
}
