import type {
  OpenedDocument,
  WorkspaceCatalog,
  WorkspaceCatalogPort,
} from '../../application/index.js'
import type { TauriInvoke } from './tauri-file-port.js'

interface NativeWorkspaceCatalog {
  readonly handle: string
  readonly name: string
  readonly notes: WorkspaceCatalog['notes']
}

interface NativeNote {
  readonly handle: string
  readonly name: string
  readonly bytes: string
}

/** Thin native transport for the folder catalog; it contains no UI state. */
export class TauriWorkspaceCatalogPort implements WorkspaceCatalogPort {
  constructor(private readonly invoke: TauriInvoke) {}

  async inspect(documentHandle: string): Promise<WorkspaceCatalog> {
    return this.requestPreviews(await this.invoke<NativeWorkspaceCatalog>('inspect_workspace_note', {
      handle: documentHandle,
    }))
  }

  async chooseFolder(): Promise<WorkspaceCatalog | null> {
    const catalog = await this.invoke<NativeWorkspaceCatalog | null>('open_workspace_folder')
    return catalog === null ? null : this.requestPreviews(catalog)
  }

  async listAround(documentHandle: string): Promise<WorkspaceCatalog> {
    return this.requestPreviews(await this.invoke<NativeWorkspaceCatalog>('list_workspace', {
      handle: documentHandle,
    }))
  }

  async listFolder(workspaceHandle: string): Promise<WorkspaceCatalog> {
    return this.requestPreviews(await this.invoke<NativeWorkspaceCatalog>('list_workspace_folder', {
      handle: workspaceHandle,
    }))
  }

  async create(workspaceHandle: string): Promise<OpenedDocument> {
    const note = await this.invoke<NativeNote>('create_note', { workspaceHandle })
    return {
      handle: note.handle,
      name: note.name,
      bytes: decodeBase64(note.bytes),
    }
  }

  private requestPreviews(catalog: WorkspaceCatalog): WorkspaceCatalog {
    const handles = catalog.notes.map((note) => note.handle)
    if (handles.length > 0) void this.invoke('request_workspace_previews', { handles })
    return catalog
  }
}

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
