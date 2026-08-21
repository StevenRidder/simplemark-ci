import type { WorkspaceCatalog } from '../application/index.js'

/**
 * Lays "an agent edited this note, and how many times" over a catalog (APP-32).
 *
 * The note list is the only place this can become visible. An app-level
 * conversation can be pointed at a note nobody is looking at (ADR-0012,
 * `MCP-SERVER.md` §10.2), so the document surface — status line, margin chips —
 * cannot report it: the reader is not on that document.
 *
 * Laid over the catalog rather than patched into the row, and that distinction
 * is a bug this repo has already paid for: the shell tears down and remounts
 * the whole composition on every note open, and rebuilds the rows from the
 * catalog on every reconcile. State that lives only in the DOM survives until
 * the next open, which is seconds away. See `note-summary-overlay.ts`, which
 * exists for the same reason.
 *
 * Pure and separate from the entrypoints so it can be tested: the composition
 * root touches the DOM, and vitest runs in `node` deliberately.
 */
/** Open and resolved notes per document, for the catalog (APP-44). */
export interface NoteCounts {
  readonly open: number
  readonly resolved: number
}

/**
 * Lays note counts over a catalog the same way agent edits are laid over it:
 * absent when there is nothing to say, so an unannotated list is unchanged.
 */
export function applyNoteCountsToCatalog(
  catalog: WorkspaceCatalog,
  counts: ReadonlyMap<string, NoteCounts>,
): WorkspaceCatalog {
  if (counts.size === 0) return catalog
  return {
    ...catalog,
    notes: catalog.notes.map((note) => {
      const found = counts.get(note.handle)
      if (found === undefined || (found.open <= 0 && found.resolved <= 0)) return note
      return {
        ...note,
        ...(found.open > 0 ? { openNotes: found.open } : {}),
        ...(found.resolved > 0 ? { resolvedNotes: found.resolved } : {}),
      }
    }),
  }
}

export function applyAgentEditsToCatalog(
  catalog: WorkspaceCatalog,
  edits: ReadonlyMap<string, number>,
): WorkspaceCatalog {
  if (edits.size === 0) return catalog
  return {
    ...catalog,
    notes: catalog.notes.map((note) => {
      const changes = edits.get(note.handle)
      // Zero is not a marker. A note the agent opened and left alone reads as
      // untouched, because it is.
      return changes === undefined || changes <= 0 ? note : { ...note, agentChanges: changes }
    }),
  }
}

/**
 * Counts one accepted agent transaction against a note.
 *
 * Returns a new map rather than mutating, so a render that captured the
 * previous one cannot change under it mid-paint.
 */
export function countAgentEdit(
  edits: ReadonlyMap<string, number>,
  handle: string,
): ReadonlyMap<string, number> {
  if (handle === '') return edits
  const next = new Map(edits)
  next.set(handle, (next.get(handle) ?? 0) + 1)
  return next
}

/**
 * The running tally, owned by the entrypoint rather than the composition.
 *
 * This has to outlive a mount. Opening a note tears down and rebuilds the whole
 * composition, so a tally held inside it is discarded the moment the reader
 * looks at anything — and the one thing this marker exists to report is an edit
 * to a note they are *not* looking at. Holding it beside the catalog, the way
 * `note-summary-overlay.ts` holds arrived summaries, is what makes it survive.
 */
export interface AgentEditTally {
  /** Counts one edit and answers with that note's new total. */
  record(handle: string): number
  all(): ReadonlyMap<string, number>
}

export function createAgentEditTally(): AgentEditTally {
  let edits: ReadonlyMap<string, number> = new Map()
  return {
    record: (handle) => {
      edits = countAgentEdit(edits, handle)
      return edits.get(handle) ?? 0
    },
    all: () => edits,
  }
}

/** What the row says. Singular is worth the branch; "1 changes" reads as a bug. */
export function agentEditLabel(changes: number): string {
  return changes === 1 ? 'Agent made 1 change' : `Agent made ${changes} changes`
}
