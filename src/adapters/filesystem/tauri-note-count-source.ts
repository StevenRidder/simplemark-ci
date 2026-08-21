import type { NoteCountReport, NoteCountSource } from '../../application/index.js'
import type { TauriInvoke } from './tauri-file-port.js'

/**
 * One native call for a whole catalog (APP-47): the command reads each
 * document's front-matter id and its threads file off the UI thread and
 * answers with counts plus the handles it could not read.
 */
export class TauriNoteCountSource implements NoteCountSource {
  constructor(private readonly invoke: TauriInvoke) {}

  async count(handles: readonly string[]): Promise<NoteCountReport> {
    if (handles.length === 0) return { counts: [], unreadable: [] }
    return this.invoke<NoteCountReport>('count_note_threads', { handles: [...handles] })
  }
}
