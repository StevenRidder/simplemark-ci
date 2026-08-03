import type { WorkspaceCatalog, WorkspaceCatalogEntry } from '../application/index.js'

/**
 * Shell-only collection membership. Files remain authoritative; this model
 * remembers only what the person explicitly opened or adopted as a folder.
 */
export class WorkspaceCollections {
  readonly #opened = new Map<string, WorkspaceCatalogEntry>()
  readonly #folders = new Map<string, WorkspaceCatalog>()

  rememberOpened(note: WorkspaceCatalogEntry): void {
    this.#opened.delete(note.handle)
    this.#opened.set(note.handle, note)
  }

  addFolder(catalog: WorkspaceCatalog): void {
    this.#folders.delete(catalog.handle)
    this.#folders.set(catalog.handle, catalog)
  }

  folder(id: string): WorkspaceCatalog | undefined {
    return this.#folders.get(id)
  }

  folders(): readonly WorkspaceCatalog[] {
    return [...this.#folders.values()]
  }

  openedCount(): number {
    return this.#opened.size
  }

  openNotes(fallbackHandle: string): WorkspaceCatalog {
    return {
      handle: fallbackHandle,
      name: 'Open Notes',
      notes: [...this.#opened.values()].reverse(),
    }
  }

  collection(id: string, fallbackHandle: string): WorkspaceCatalog {
    if (id === 'open') return this.openNotes(fallbackHandle)
    return this.#folders.get(id) ?? this.openNotes(fallbackHandle)
  }
}
