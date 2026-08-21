import type { SnapshotEntry, SnapshotStore } from '../../application/index.js'

export type TauriSnapshotInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>

/**
 * Versions beside the document, through the native shell (ADR-0014).
 *
 * Each snapshot is the document's exact bytes in
 * `.simplemark/versions/<note-key>/<id>.md` with an `index.json` beside them;
 * the Rust side resolves "beside" with the same rule threads use and falls
 * back to application data. This class only speaks the commands.
 */
export class TauriSnapshotStore implements SnapshotStore {
  constructor(
    private readonly invoke: TauriSnapshotInvoke,
    private readonly documentHandle: () => string | undefined = () => undefined,
  ) {}

  async list(noteKey: string): Promise<readonly SnapshotEntry[]> {
    const raw = await this.invoke('list_note_snapshots', {
      noteKey,
      documentHandle: this.documentHandle() ?? null,
    })
    if (!Array.isArray(raw)) throw new Error('The snapshot index for this document could not be read')
    return raw as SnapshotEntry[]
  }

  async write(
    noteKey: string,
    markdown: string,
    options: { readonly trigger: SnapshotEntry['trigger']; readonly label?: string },
  ): Promise<SnapshotEntry> {
    const raw = await this.invoke('write_note_snapshot', {
      noteKey,
      documentHandle: this.documentHandle() ?? null,
      markdown,
      trigger: options.trigger,
      label: options.label ?? null,
    })
    if (typeof raw !== 'object' || raw === null) throw new Error('The snapshot was not recorded')
    return raw as SnapshotEntry
  }

  async read(noteKey: string, id: string): Promise<string> {
    const raw = await this.invoke('read_note_snapshot', {
      noteKey,
      documentHandle: this.documentHandle() ?? null,
      id,
    })
    if (typeof raw !== 'string') throw new Error('The snapshot could not be read')
    return raw
  }

  async remove(noteKey: string, id: string): Promise<void> {
    await this.invoke('delete_note_snapshot', {
      noteKey,
      documentHandle: this.documentHandle() ?? null,
      id,
    })
  }
}
