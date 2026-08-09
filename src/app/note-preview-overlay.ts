import type { WorkspaceCatalog } from '../application/index.js'

/**
 * Layers previews that arrive after metadata-only catalog discovery.
 *
 * Kept pure so every remount uses the previews already delivered by native,
 * while the shell can still patch an existing row without re-sorting it.
 */
export function applyPreviewsToCatalog(
  catalog: WorkspaceCatalog,
  previews: ReadonlyMap<string, string>,
): WorkspaceCatalog {
  if (previews.size === 0) return catalog
  return {
    ...catalog,
    notes: catalog.notes.map((note) => {
      const preview = previews.get(note.handle)
      return preview === undefined ? note : { ...note, preview }
    }),
  }
}
