import type { NoteCountSource } from '../application/index.js'
import type { NoteCounts } from './agent-edit-overlay.js'

/**
 * Fills in note counts for catalog rows nobody has opened this session (APP-47).
 *
 * APP-44 painted a count only for documents this session had already opened:
 * the open document counts its own threads and reports them. Everything else
 * in the folder showed nothing, which read as "unannotated" and was simply
 * unknown. This sweep asks the host for the rest, once per catalog, in one
 * call for every row the cache does not know.
 *
 * The cache is the host's: the open document's own paints write the same map,
 * and those writes win — a count read from disk a moment ago loses to the
 * threads on screen now. Unreadable documents are reported once per session
 * and not retried: a placeholder that never downloads should say so once, not
 * on every repaint of the list.
 */
export interface NoteCountSweepDeps {
  readonly source: NoteCountSource
  /** Per-handle cache shared with the open document's own reports. */
  readonly cache: Map<string, NoteCounts>
  /** Patches one visible row. A row that is not on screen is a no-op. */
  readonly apply: (handle: string, open: number, resolved: number) => void
  /** Surfaces a sweep that could not count. Loud by policy, never swallowed. */
  readonly report: (message: string) => void
  /** Handles per host call. */
  readonly chunk?: number
  /** How the status line names a document; the last path segment when absent. */
  readonly label?: (handle: string) => string
}

/** The least a sweep needs: the handles of the rows on screen. */
export interface NoteCountRows {
  readonly notes: ReadonlyArray<{ readonly handle: string }>
}

export interface NoteCountSweep {
  /** Counts every catalog row the cache does not know yet. Resolves when done. */
  sweep(catalog: NoteCountRows): Promise<void>
}

const DEFAULT_CHUNK = 100

export function createNoteCountSweep(deps: NoteCountSweepDeps): NoteCountSweep {
  const inFlight = new Set<string>()
  const reported = new Set<string>()
  const chunkSize = deps.chunk ?? DEFAULT_CHUNK
  const label = deps.label ?? ((handle: string) => handle.split('/').pop() ?? handle)
  return {
    async sweep(catalog) {
      const wanted = catalog.notes
        .map((note) => note.handle)
        .filter((handle) => !deps.cache.has(handle) && !inFlight.has(handle) && !reported.has(handle))
      if (wanted.length === 0) return
      for (const handle of wanted) inFlight.add(handle)
      try {
        for (let start = 0; start < wanted.length; start += chunkSize) {
          const report = await deps.source.count(wanted.slice(start, start + chunkSize))
          for (const entry of report.counts) {
            // The open document may have reported itself while this call was
            // out; what is on screen beats what was on disk.
            if (deps.cache.has(entry.handle)) continue
            deps.cache.set(entry.handle, { open: entry.open, resolved: entry.resolved })
            if (entry.open > 0 || entry.resolved > 0) deps.apply(entry.handle, entry.open, entry.resolved)
          }
          const fresh = report.unreadable.filter((handle) => !reported.has(handle))
          for (const handle of fresh) reported.add(handle)
          if (fresh.length > 0) deps.report(unreadableMessage(fresh.map(label)))
        }
      } catch (error) {
        deps.report(`Could not count notes — ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        for (const handle of wanted) inFlight.delete(handle)
      }
    },
  }
}

function unreadableMessage(names: readonly string[]): string {
  const first = names[0]!
  return names.length === 1
    ? `Could not read the notes for ${first}`
    : `Could not read the notes for ${names.length} documents, including ${first}`
}
