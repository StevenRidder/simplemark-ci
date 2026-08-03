import type { WorkspaceCatalog, WorkspaceCatalogEntry } from '../application/index.js'

const FOLDER_STORAGE_KEY = 'simplemark.workspace-folders.v1'

export interface WorkspaceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Persists only adopted folder handles; the filesystem remains authoritative. */
export class WorkspaceFolderStore {
  constructor(private readonly storage: WorkspaceStorage) {}

  load(): readonly string[] {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(FOLDER_STORAGE_KEY) ?? '[]')
      if (!Array.isArray(value)) return []
      return [...new Set(value.filter((handle): handle is string =>
        typeof handle === 'string' && handle.trim() !== '',
      ))]
    } catch {
      return []
    }
  }

  save(handles: readonly string[]): void {
    this.storage.setItem(FOLDER_STORAGE_KEY, JSON.stringify([...new Set(handles)]))
  }
}

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

  forgetOpened(handle: string): void {
    this.#opened.delete(handle)
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
