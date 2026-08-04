import type { WorkspaceCatalog, WorkspaceCatalogEntry } from '../application/index.js'

const FOLDER_STORAGE_KEY = 'simplemark.workspace-folders.v1'
const RECENT_STORAGE_KEY = 'simplemark.recent-notes.v1'
const HIDDEN_STORAGE_KEY = 'simplemark.hidden-notes.v1'

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

/** Persists recent note handles only; note bytes and metadata stay on disk. */
export class WorkspaceRecentStore {
  constructor(private readonly storage: WorkspaceStorage) {}

  load(): readonly string[] {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(RECENT_STORAGE_KEY) ?? '[]')
      if (!Array.isArray(value)) return []
      return [...new Set(value.filter((handle): handle is string =>
        typeof handle === 'string' && handle.trim() !== '',
      ))]
    } catch {
      return []
    }
  }

  save(handles: readonly string[]): void {
    this.storage.setItem(RECENT_STORAGE_KEY, JSON.stringify([...new Set(handles)]))
  }
}

/** Persists notes explicitly hidden from adopted folder views. */
export class WorkspaceHiddenStore {
  constructor(private readonly storage: WorkspaceStorage) {}

  load(): readonly string[] {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(HIDDEN_STORAGE_KEY) ?? '[]')
      if (!Array.isArray(value)) return []
      return [...new Set(value.filter((handle): handle is string =>
        typeof handle === 'string' && handle.trim() !== '',
      ))]
    } catch {
      return []
    }
  }

  save(handles: readonly string[]): void {
    this.storage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify([...new Set(handles)]))
  }
}

/**
 * Shell-only collection membership. Files remain authoritative; this model
 * remembers only what the person explicitly opened or adopted as a folder.
 */
export class WorkspaceCollections {
  readonly #recent = new Map<string, WorkspaceCatalogEntry>()
  readonly #folders = new Map<string, WorkspaceCatalog>()
  readonly #hidden = new Set<string>()

  rememberRecent(note: WorkspaceCatalogEntry): void {
    this.#recent.delete(note.handle)
    this.#recent.set(note.handle, note)
  }

  forgetRecent(handle: string): void {
    this.#recent.delete(handle)
  }

  addFolder(catalog: WorkspaceCatalog): void {
    this.#folders.delete(catalog.handle)
    this.#folders.set(catalog.handle, catalog)
  }

  hideFromFolders(handle: string): void {
    this.#hidden.add(handle)
  }

  hiddenHandles(): readonly string[] {
    return [...this.#hidden]
  }

  #visible(catalog: WorkspaceCatalog): WorkspaceCatalog {
    return {
      ...catalog,
      notes: catalog.notes.filter((note) => !this.#hidden.has(note.handle)),
    }
  }

  folder(id: string): WorkspaceCatalog | undefined {
    const catalog = this.#folders.get(id)
    return catalog === undefined ? undefined : this.#visible(catalog)
  }

  folders(): readonly WorkspaceCatalog[] {
    return [...this.#folders.values()].map((catalog) => this.#visible(catalog))
  }

  recentCount(): number {
    return this.#recent.size
  }

  recentNotes(fallbackHandle: string): WorkspaceCatalog {
    return {
      handle: fallbackHandle,
      name: 'Recent Notes',
      notes: [...this.#recent.values()].reverse(),
    }
  }

  collection(id: string, fallbackHandle: string): WorkspaceCatalog {
    if (id === 'recent') return this.recentNotes(fallbackHandle)
    return this.folder(id) ?? this.recentNotes(fallbackHandle)
  }
}
