import type { NoteCountReport, NoteCountSource } from '../../application/index.js'

const STORAGE_PREFIX = 'simplemark.threads.'

/**
 * Counts the threads `LocalThreadStore` keeps in `localStorage` (APP-47).
 *
 * The browser shell keys its rows by something other than the thread key —
 * a demo row is `note-3`, its threads live under the port's `fixture:<name>`
 * handle — so the host supplies the mapping. A row it cannot map, or a value
 * that will not parse, is reported as unreadable rather than counted as zero.
 */
export class LocalNoteCountSource implements NoteCountSource {
  constructor(
    private readonly storage: Pick<Storage, 'getItem'>,
    private readonly keyFor: (handle: string) => string | undefined,
  ) {}

  async count(handles: readonly string[]): Promise<NoteCountReport> {
    const counts: { handle: string; open: number; resolved: number }[] = []
    const unreadable: string[] = []
    for (const handle of handles) {
      const key = this.keyFor(handle)
      if (key === undefined) {
        unreadable.push(handle)
        continue
      }
      const raw = this.storage.getItem(`${STORAGE_PREFIX}${key}`)
      if (raw === null || raw.trim() === '') {
        counts.push({ handle, open: 0, resolved: 0 })
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        unreadable.push(handle)
        continue
      }
      if (!Array.isArray(parsed)) {
        unreadable.push(handle)
        continue
      }
      const resolved = parsed.filter(
        (thread: unknown) => (thread as { state?: unknown }).state === 'resolved',
      ).length
      counts.push({ handle, open: parsed.length - resolved, resolved })
    }
    return { counts, unreadable }
  }
}
