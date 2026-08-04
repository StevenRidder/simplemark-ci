import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'

import { CompositeRenderer } from '../adapters/renderers/composite-renderer.js'
import { MermaidRenderer } from '../adapters/renderers/mermaid-renderer.js'
import { SvgRenderer } from '../adapters/renderers/svg-renderer.js'
import { TextCardRenderer } from '../adapters/renderers/text-card-renderer.js'
import { GraphvizRenderer } from '../adapters/renderers/graphviz-renderer.js'
import { KatexRenderer } from '../adapters/renderers/katex-renderer.js'
import { BrowserAssetReferencePort } from '../adapters/filesystem/browser-asset-reference-port.js'
import { FixtureFilePort } from '../adapters/filesystem/fixture-file-port.js'
import { OpenCancelled, TauriFilePort } from '../adapters/filesystem/tauri-file-port.js'
import { TauriWorkspaceCatalogPort } from '../adapters/filesystem/tauri-workspace-catalog-port.js'
import { TauriDocumentLinkPort } from '../adapters/filesystem/tauri-document-link-port.js'
import type { FilePort, WorkspaceCatalog } from '../application/index.js'
import { installNativeMenu } from './ui/native-menu.js'
import { isCommit, isRepository, readProvenance } from './build-provenance.js'
import type { BuildProvenance } from './build-provenance.js'
import { readComparison, updateStatus } from './update-status.js'
import type { UpdateStatus } from './update-status.js'
import { composeApp } from './bootstrap.js'
import type { AppComposition } from './bootstrap.js'
import type { WorkspaceOptions } from './ui/window-chrome.js'
import { SupersedingOperationQueue } from './superseding-operation-queue.js'
import { WELCOME_MARKDOWN, WELCOME_NAME } from './welcome-note.js'
import { WorkspacePins } from './workspace-pins.js'
import {
  WorkspaceCollections,
  WorkspaceFolderStore,
  WorkspaceHiddenStore,
  WorkspaceRecentStore,
} from './workspace-collections.js'

import './styles/tokens.css'
import './styles/app.css'
import './styles/print.css'

/**
 * The macOS entrypoint (ADR-0001 §Web and native shells).
 *
 * Platform wiring only, and deliberately the same shape as `browser.ts`: pick
 * a file, rebuild the composition around it, tear the old one down. Every
 * document rule — parsing, source preservation, transactions, rendering,
 * toolbar commands — is the identical module the browser shell loads. If a
 * behaviour existed only here, that would be the bug this ADR exists to
 * prevent.
 *
 * What the native shell adds is exactly two capabilities the web platform
 * cannot give: writing the original file in place with a real atomic rename,
 * and being told when something else changes that file.
 */

export async function start(root: HTMLElement): Promise<AppComposition> {
  const controller = await startNative(root)
  await installOpenRequestBridge(controller)
  await installMarkdownDropBridge(controller)
  return controller.current()
}

interface NativeController {
  current(): AppComposition
  openPath(path: string): Promise<void>
}

/** Owns the one active document while every open route shares one transition. */
async function startNative(root: HTMLElement): Promise<NativeController> {
  let current: AppComposition
  let stopWatching: UnlistenFn | undefined
  let activeHandle: string | undefined
  let workspaceHandle: string | undefined
  let activeCollectionId = 'recent'
  let requestedSelection: { readonly path: string; readonly collectionId: string } | undefined
  const collections = new WorkspaceCollections()
  const catalogPort = new TauriWorkspaceCatalogPort(invoke)
  const pins = new WorkspacePins(window.localStorage)
  const folderStore = new WorkspaceFolderStore(window.localStorage)
  const hiddenStore = new WorkspaceHiddenStore(window.localStorage)
  const recentStore = new WorkspaceRecentStore(window.localStorage)
  const watchedFolders = new Set<string>()

  const showOpenFailure = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    current.setStatus('error', `Could not open file — ${message}`)
  }

  const operations = new SupersedingOperationQueue(showOpenFailure)
  const enqueue = (operation: () => Promise<void>): Promise<void> => operations.enqueue(operation)

  const watch = async (port: TauriFilePort, handle: string): Promise<void> => {
    stopWatching?.()
    await port.watch(handle)
    stopWatching = await listen<string>('note-changed-externally', (event) => {
      if (event.payload !== handle) return
      current.setStatus(
        'error',
        `Changed on disk by another program — ${event.payload.split('/').pop() ?? 'this note'}`,
      )
    })
  }

  const watchFolder = async (handle: string): Promise<void> => {
    if (watchedFolders.has(handle)) return
    await invoke('watch_workspace_folder', { handle })
    watchedFolders.add(handle)
  }

  const persistFolders = (): void => {
    folderStore.save(collections.folders().map((folder) => folder.handle))
  }

  const persistRecentNotes = (): void => {
    recentStore.save(collections.recentNotes('').notes.map((note) => note.handle))
  }

  const persistHiddenNotes = (): void => {
    hiddenStore.save(collections.hiddenHandles())
  }

  const reconcileWorkspace = (
    selectedHandle = activeHandle,
    collectionId = activeCollectionId,
  ): void => {
    if (selectedHandle === undefined) return
    const catalog = collections.collection(collectionId, workspaceHandle ?? selectedHandle)
    current.reconcileWorkspace(catalogWorkspace(catalog, selectedHandle, pins, {
      select: selectNote,
      create: createNote,
      addFolder: addFolder,
      selectCollection,
      togglePinned,
      copyText,
      copyMarkdown,
      duplicateNote,
      exportNote,
      closeNote,
      trashNote,
      revealInFinder,
      folders: collections.folders(),
      activeCollectionId: collectionId,
      recentNotesCount: collections.recentCount(),
    }))
  }

  const install = async (
    port: TauriFilePort,
    opened: { readonly handle: string; readonly name: string },
    collectionId: string,
  ): Promise<void> => {
    const inspected = await catalogPort.inspect(opened.handle)
    const entry = inspected.notes[0]
    if (entry === undefined) throw new Error(`Native inspection returned no note for ${opened.handle}`)
    // Every explicit open becomes history, including a click while browsing a
    // folder. Only that selected file is remembered; adopting a folder never
    // dumps all of its siblings into Recent Notes.
    collections.rememberRecent(entry)
    persistRecentNotes()
    activeCollectionId = collectionId
    const catalog = collections.collection(collectionId, inspected.handle)
    await current.destroy()
    activeHandle = opened.handle
    workspaceHandle = collectionId === 'recent' ? inspected.handle : catalog.handle
    current = await mount(root, port, {
      filePath: opened.handle,
      onOpenFile: openFromPicker,
      workspace: catalogWorkspace(catalog, opened.handle, pins, {
        select: selectNote,
        create: createNote,
        addFolder: addFolder,
        selectCollection,
        togglePinned,
        copyText,
        copyMarkdown,
        duplicateNote,
        exportNote,
        closeNote,
        trashNote,
        revealInFinder,
        folders: collections.folders(),
        activeCollectionId,
        recentNotesCount: collections.recentCount(),
      }),
    })
    await watch(port, opened.handle)
  }

  const openInCollection = (path: string, collectionId: string): void => {
    if (
      requestedSelection === undefined
      && path === activeHandle
      && collectionId === activeCollectionId
    ) return
    requestedSelection = { path, collectionId }
    // A row click has immediate visible acknowledgement even though the
    // durable transition must save before reading another file.
    reconcileWorkspace(path, collectionId)
    current.setStatus('saved', `Opening ${path.split('/').pop() ?? 'note'}…`)
    void operations.enqueueLatest('note-selection', async (isCurrent) => {
      try {
        await current.save()
        if (!isCurrent()) return
        const port = new TauriFilePort(invoke)
        const opened = await port.openAt(path)
        if (!isCurrent()) return
        await install(port, opened, collectionId)
      } finally {
        if (isCurrent()) requestedSelection = undefined
      }
    })
  }

  const selectNote = (path: string): void => openInCollection(path, activeCollectionId)

  const selectCollection = (collectionId: string): void => {
    if (collectionId === activeCollectionId) return
    const catalog = collectionId === 'recent'
      ? collections.recentNotes(workspaceHandle ?? '')
      : collections.folder(collectionId)
    const next = catalog?.notes.find((note) => note.handle === activeHandle) ?? catalog?.notes[0]
    if (next === undefined) return
    openInCollection(next.handle, collectionId)
  }

  const addFolder = (): void => {
    void enqueue(async () => {
      const catalog = await catalogPort.chooseFolder()
      if (catalog === null) return
      if (catalog.notes.length === 0) {
        current.setStatus('error', `${catalog.name} contains no Markdown notes`)
        return
      }
      collections.addFolder(catalog)
      persistFolders()
      await watchFolder(catalog.handle)
      await current.save()
      const next = catalog.notes.find((note) => note.handle === activeHandle) ?? catalog.notes[0]!
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(next.handle)
      await install(port, opened, catalog.handle)
    })
  }

  const createNote = (): void => {
    if (workspaceHandle === undefined) return
    void enqueue(async () => {
      await current.save()
      const created = await catalogPort.create(workspaceHandle!)
      if (activeCollectionId !== 'recent') {
        collections.addFolder(await catalogPort.listAround(created.handle))
      }
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(created.handle)
      await install(port, opened, activeCollectionId)
    })
  }

  const togglePinned = (handle: string): boolean => pins.toggle(handle)

  const copyText = async (text: string): Promise<void> => {
    await writeText(text)
    current.setStatus('saved', 'Copied')
  }

  const copyMarkdown = async (handle: string): Promise<void> => {
    const port = new TauriFilePort(invoke)
    const opened = await port.openAt(handle)
    await copyText(new TextDecoder().decode(opened.bytes))
  }

  const duplicateNote = (handle: string): Promise<void> => enqueue(async () => {
    await current.save()
    const duplicate = await invoke<{ readonly handle: string }>('duplicate_note', { handle })
    if (activeCollectionId !== 'recent') {
      collections.addFolder(await catalogPort.listFolder(activeCollectionId))
    }
    const port = new TauriFilePort(invoke)
    const opened = await port.openAt(duplicate.handle)
    await install(port, opened, activeCollectionId)
  })

  const exportNote = (handle: string): Promise<void> => enqueue(async () => {
    if (handle === activeHandle) await current.save()
    const exported = await invoke<boolean>('export_note', { handle })
    if (exported) current.setStatus('saved', 'Exported')
  })

  const revealInFinder = async (handle: string): Promise<void> => {
    await invoke('reveal_in_finder', { handle })
  }

  let closeNote: (handle: string) => Promise<void>
  closeNote = (handle: string): Promise<void> => enqueue(async () => {
    const before = collections.collection(activeCollectionId, workspaceHandle ?? handle)
    const closedIndex = before.notes.findIndex((note) => note.handle === handle)
    const wasActive = handle === activeHandle
    if (wasActive) await current.save()

    if (activeCollectionId !== 'recent') {
      collections.hideFromFolders(handle)
      persistHiddenNotes()
    } else {
      collections.forgetRecent(handle)
      persistRecentNotes()
    }

    const message = activeCollectionId === 'recent'
      ? 'Closed note — file remains on disk'
      : 'Closed note and hid it from this folder — file remains on disk'

    // Closing a background row is catalog-only and must preserve the mounted
    // editor. Closing the active row is a document transition: the right pane
    // must not keep showing a note the person just closed.
    if (!wasActive) {
      reconcileWorkspace()
      current.setStatus('saved', message)
      return
    }

    const after = collections.collection(activeCollectionId, workspaceHandle ?? handle)
    const nextIndex = Math.min(Math.max(closedIndex, 0), after.notes.length - 1)
    const next = after.notes[nextIndex] ?? after.notes[0]
    if (next !== undefined) {
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(next.handle)
      await install(port, opened, activeCollectionId)
      current.setStatus('saved', message)
      return
    }

    stopWatching?.()
    stopWatching = undefined
    await invoke('stop_watching_note')
    activeHandle = undefined
    if (activeCollectionId === 'recent') workspaceHandle = undefined
    await current.destroy()
    current = await mount(root, new FixtureFilePort('No note selected.md', ''), {
      filePath: 'No note selected',
      onOpenFile: openFromPicker,
      workspace: catalogWorkspace(after, '', pins, {
        select: selectNote,
        create: createNote,
        addFolder: addFolder,
        selectCollection,
        togglePinned,
        copyText,
        copyMarkdown,
        duplicateNote,
        exportNote,
        closeNote,
        trashNote,
        revealInFinder,
        folders: collections.folders(),
        activeCollectionId,
        recentNotesCount: collections.recentCount(),
      }),
    })
    current.setStatus('saved', message)
  })

  const trashNote = (handle: string): Promise<void> => enqueue(async () => {
    if (handle === activeHandle) await current.save()
    current.setStatus('saved', 'Moving to Trash…')
    await invoke('trash_note', { handle })
    collections.forgetRecent(handle)
    persistRecentNotes()
    for (const folder of collections.folders()) {
      if (folder.notes.some((note) => note.handle === handle)) {
        collections.addFolder(await catalogPort.listFolder(folder.handle))
      }
    }

    if (handle !== activeHandle && activeHandle !== undefined) {
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(activeHandle)
      await install(port, opened, activeCollectionId)
      return
    }

    const catalog = collections.collection(activeCollectionId, workspaceHandle ?? '')
    const next = catalog.notes.find((note) => note.handle !== handle)
    if (next !== undefined) {
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(next.handle)
      await install(port, opened, activeCollectionId)
      return
    }

    stopWatching?.()
    activeHandle = undefined
    workspaceHandle = undefined
    activeCollectionId = 'recent'
    await current.destroy()
    current = await mount(root, new FixtureFilePort(WELCOME_NAME, WELCOME_MARKDOWN), {
      filePath: 'Demo workspace · open a file to work with your own Markdown',
      onOpenFile: openFromPicker,
      workspace: nativeWorkspace(WELCOME_NAME, {
        addFolder,
        selectCollection,
        folders: collections.folders(),
      }),
    })
  })

  const openFromPicker = (): void => {
    void enqueue(async () => {
      const port = new TauriFilePort(invoke)
      let opened
      try {
        // Prompt before saving or tearing down: cancelling leaves the current
        // document and its editing context exactly where they were.
        opened = await port.open()
      } catch (error) {
        if (error instanceof OpenCancelled) return
        throw error
      }

      await current.save()
      await install(port, opened, 'recent')
    })
  }

  for (const handle of folderStore.load()) {
    try {
      const catalog = await catalogPort.listFolder(handle)
      collections.addFolder(catalog)
      await watchFolder(catalog.handle)
    } catch {
      // A moved or disconnected folder is omitted rather than resurrected
      // from stale metadata. The next successful save repairs persistence.
    }
  }
  persistFolders()

  for (const handle of hiddenStore.load()) collections.hideFromFolders(handle)
  persistHiddenNotes()

  // Persist only opaque handles, then re-inspect them on launch so stale
  // metadata never masquerades as filesystem truth. Loading oldest first
  // preserves the store's most-recent-first order in the collection map.
  for (const handle of [...recentStore.load()].reverse()) {
    try {
      const inspected = await catalogPort.inspect(handle)
      const entry = inspected.notes[0]
      if (entry !== undefined) collections.rememberRecent(entry)
    } catch {
      // Missing or moved files fall out of history instead of breaking launch.
    }
  }
  persistRecentNotes()

  current = await mount(root, new FixtureFilePort(WELCOME_NAME, WELCOME_MARKDOWN), {
    filePath: 'Demo workspace · open a file to work with your own Markdown',
    onOpenFile: openFromPicker,
    workspace: nativeWorkspace(WELCOME_NAME, {
      addFolder,
      selectCollection,
      folders: collections.folders(),
    }),
  })

  const mostRecent = collections.recentNotes('').notes[0]
  if (mostRecent !== undefined) {
    try {
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(mostRecent.handle)
      await install(port, opened, 'recent')
    } catch {
      collections.forgetRecent(mostRecent.handle)
      persistRecentNotes()
    }
  }

  await listen<string>('workspace-folder-changed', (event) => {
    void enqueue(async () => {
      if (collections.folder(event.payload) === undefined) return
      const refreshed = await catalogPort.listFolder(event.payload)
      const refresh = collections.refreshFolder(refreshed)
      if (!refresh.membershipChanged) return
      persistFolders()

      const activeWasRemoved = activeHandle !== undefined
        && refresh.previous?.notes.some((note) => note.handle === activeHandle) === true
        && !refresh.current.notes.some((note) => note.handle === activeHandle)
      if (activeWasRemoved) {
        current.setStatus('error', 'The open note was removed from disk — your editor was left untouched')
        return
      }

      if (activeHandle === undefined) {
        await current.destroy()
        current = await mount(root, new FixtureFilePort(WELCOME_NAME, WELCOME_MARKDOWN), {
          filePath: 'Demo workspace · open a file to work with your own Markdown',
          onOpenFile: openFromPicker,
          workspace: nativeWorkspace(WELCOME_NAME, {
            addFolder,
            selectCollection,
            folders: collections.folders(),
          }),
        })
        return
      }

      await current.save()
      const activeCatalog = collections.collection(activeCollectionId, activeHandle)
      const next = activeCatalog.notes.find((note) => note.handle === activeHandle)
        ?? activeCatalog.notes[0]
      if (next === undefined) return
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(next.handle)
      await install(port, opened, activeCollectionId)
    })
  })

  return {
    current: () => current,
    openPath: (path) => enqueue(async () => {
      // Finder has already chosen the destination, so flush first. This also
      // makes reopening the same file read the bytes we just committed.
      await current.save()
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(path)
      await install(port, opened, 'recent')
    }),
  }
}

async function mount(
  root: HTMLElement,
  file: FilePort,
  options: { filePath: string; onOpenFile: () => void; workspace: WorkspaceOptions },
): Promise<AppComposition> {
  let app: AppComposition

  app = await composeApp({
    ports: {
      file,
      // The picker is an ordinary file input inside the webview. Copying an
      // asset into the note's own directory is a native capability APP-2 does
      // not claim; the port says so rather than pretending.
      assets: new BrowserAssetReferencePort(pickDocumentAsset, window),
      links: new TauriDocumentLinkPort(invoke),
      diagrams: new CompositeRenderer([
        new MermaidRenderer(),
        new SvgRenderer(),
        new GraphvizRenderer(),
        new KatexRenderer(),
        new TextCardRenderer(),
      ]),
    },
    filePath: options.filePath,
    workspace: options.workspace,
    chromeMode: 'macos',
    // The native menubar is the complete command surface. The small floating
    // palette is the fast, Apple Notes-style reach shown in the approved
    // interactive wireframe; it is not a second menu row.
    stylesBarDefault: true,
    onOpenFile: options.onOpenFile,
    // WKWebView never answers the webview's own `window.print()`, so the panel
    // has to be raised from the native side. What lands on paper is still the
    // shared print stylesheet — this only opens the door.
    onPrint: () => void invoke('print_note'),
    // Phase 1 hands over the documented install rather than performing it
    // (docs/UPDATE-NOTIFICATION.md §6). One-click needs a signing key, a
    // published feed, and notarization; none of them exist, and an app that
    // silently shelled out to a two-minute build with no window on screen
    // would be a worse answer than a command you can read.
    onUpdate: () => {
      void navigator.clipboard
        .writeText('bash scripts/install-main.sh')
        .then(() => app.setStatus('saved', 'Update command copied — run it in the repository'))
        .catch(() => app.setStatus('error', 'Run: bash scripts/install-main.sh'))
    },
  })

  root.replaceChildren(app.element)
  window.simplemark = app
  installWindowDragging(app.element)

  // Native-first: the menubar is the complete command surface, generated from
  // the same registry the toolbar uses. Rebuilt with each composition so the
  // View checkmarks match the shell that is actually on screen.
  // Provenance is read once at menu build. A bundle's commit cannot change
  // while it runs, and a failure to read it must not cost you the menubar.
  let provenance: BuildProvenance | undefined
  try {
    provenance = readProvenance(await invoke('build_provenance'))
  } catch {
    provenance = undefined
  }

  await installNativeMenu({
    run: (command) => app.run(command),
    state: (command) => app.commandState(command),
    ...(provenance === undefined ? {} : { provenance }),
  })

  // Once, at launch, and never on a timer (docs/UPDATE-NOTIFICATION.md §8):
  // one call per launch is far inside the unauthenticated rate limit, and a
  // strip that can appear mid-sentence is a strip that interrupts reading.
  void checkForUpdate(provenance).then((status) => app.setUpdateStatus(status))

  return app
}

/**
 * Asks GitHub how far this build trails `main`.
 *
 * The app never computes ancestry — `build-provenance.ts` is explicit that a
 * bundle carries one SHA and no history. This asks the remote that does have
 * the history and reports what it was told, and any failure to get an answer
 * becomes `unknown` rather than silence.
 */
async function checkForUpdate(provenance: BuildProvenance | undefined): Promise<UpdateStatus> {
  if (provenance === undefined || !isCommit(provenance.sha)) {
    return updateStatus(provenance, null)
  }
  // No source file names a repository (build-provenance.ts), so a build that
  // could not read its own remote has nothing to ask and says so.
  if (!isRepository(provenance.repository)) {
    return updateStatus(provenance, null, 'This build did not record where it came from')
  }
  const url = `https://api.github.com/repos/${provenance.repository}/compare/${provenance.sha}...main`
  try {
    const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
    if (!response.ok) {
      // 404 is what a private repository returns to an anonymous caller, and
      // saying so beats a generic failure — it is the difference between "no
      // network" and "this check needs credentials" (§9).
      const reason =
        response.status === 404
          ? 'Update checks need access to the repository'
          : `Update check failed (${response.status})`
      return updateStatus(provenance, null, reason)
    }
    const body = (await response.json()) as Record<string, unknown>
    return updateStatus(
      provenance,
      readComparison({
        status: body['status'],
        latestSha: (body['commits'] as { sha?: unknown }[] | undefined)?.at(-1)?.sha,
        behindBy: body['behind_by'],
      }),
    )
  } catch {
    return updateStatus(provenance, null, 'Could not reach GitHub')
  }
}

/** The welcome state is honest until a real local note supplies a folder. */
function nativeWorkspace(
  fileName: string,
  actions?: {
    readonly addFolder: () => void
    readonly selectCollection: (id: string) => void
    readonly folders: readonly WorkspaceCatalog[]
  },
): WorkspaceOptions {
  return {
    name: 'SimpleMark',
    collectionLabel: 'Recent Notes',
    activeCollectionId: 'recent',
    activeNoteId: fileName,
    recentNotesCount: 0,
    ...(actions === undefined ? {} : {
      onAddFolder: actions.addFolder,
      onSelectCollection: actions.selectCollection,
      folders: actions.folders.map((folder) => ({
        id: folder.handle,
        name: folder.name,
        count: folder.notes.length,
      })),
    }),
    notes: [
      {
        id: fileName,
        title: fileName.replace(/\.(md|markdown)$/i, ''),
        preview: 'Current local Markdown file',
        updatedLabel: 'Open',
        pinned: false,
      },
    ],
  }
}

function catalogWorkspace(
  catalog: WorkspaceCatalog,
  activeNoteId: string,
  pins: WorkspacePins,
  actions: {
    readonly select: (id: string) => void
    readonly create: () => void
    readonly addFolder: () => void
    readonly selectCollection: (id: string) => void
    readonly togglePinned: (id: string) => boolean
    readonly copyText: (text: string) => Promise<void>
    readonly copyMarkdown: (id: string) => Promise<void>
    readonly duplicateNote: (id: string) => Promise<void>
    readonly exportNote: (id: string) => Promise<void>
    readonly closeNote: (id: string) => Promise<void>
    readonly trashNote: (id: string) => Promise<void>
    readonly revealInFinder: (id: string) => Promise<void>
    readonly folders: readonly WorkspaceCatalog[]
    readonly activeCollectionId: string
    readonly recentNotesCount: number
  },
): WorkspaceOptions {
  return {
    name: 'SimpleMark',
    collectionLabel: catalog.name,
    recentNotesCount: actions.recentNotesCount,
    folders: actions.folders.map((folder) => ({
      id: folder.handle,
      name: folder.name,
      count: folder.notes.length,
    })),
    activeCollectionId: actions.activeCollectionId,
    activeNoteId,
    onSelectNote: actions.select,
    onCreateNote: actions.create,
    onAddFolder: actions.addFolder,
    onSelectCollection: actions.selectCollection,
    onTogglePinned: actions.togglePinned,
    onCopyText: actions.copyText,
    onCopyMarkdown: actions.copyMarkdown,
    onDuplicateNote: actions.duplicateNote,
    onExportNote: actions.exportNote,
    onCloseNote: actions.closeNote,
    onTrashNote: actions.trashNote,
    onRevealInFinder: actions.revealInFinder,
    notes: catalog.notes.map((note) => ({
      id: note.handle,
      identifier: note.name,
      portableLink: `./${note.name}`,
      title: note.name.replace(/\.(md|markdown)$/i, ''),
      preview: 'Local Markdown file',
      updatedLabel: relativeDate(note.modifiedMs),
      pinned: pins.has(note.handle),
    })),
  }
}

function relativeDate(modifiedMs: number): string {
  if (modifiedMs === 0) return 'Unknown'
  const elapsed = Math.max(0, Date.now() - modifiedMs)
  if (elapsed < 60_000) return 'Now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`
  if (elapsed < 172_800_000) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(modifiedMs)
}

/**
 * Lets the title bar move and zoom the window, like every other macOS app.
 *
 * Driven explicitly rather than declaratively. Electron's
 * `-webkit-app-region: drag` does nothing here — WKWebView never implemented
 * it — and Tauri's `data-tauri-drag-region` attribute did not take either, so
 * the shell asks the window to drag itself and the behaviour stops depending
 * on which mechanism a given webview happens to support.
 *
 * Wired from the native entrypoint, never inside `window-chrome.ts`: that
 * module is shared with the browser shell and must not import a Tauri API
 * (ADR-0001 — platform decisions live at the composition root).
 */
function installWindowDragging(element: HTMLElement): void {
  const dragRegions = element.querySelectorAll<HTMLElement>(
    '.titlebar, .workspace-library-head, .notes-header',
  )

  /** Presses on a control or an input are not drags. */
  const isChrome = (target: EventTarget | null): boolean =>
    target instanceof Element &&
    target.closest('button, input, textarea, select, a, [contenteditable]') !== null

  for (const region of dragRegions) {
    // Keep Tauri's declarative path as a native fallback while the explicit
    // API below guarantees dragging in WKWebView builds where the attribute
    // alone has proved unreliable.
    region.setAttribute('data-tauri-drag-region', '')
    region.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || isChrome(event.target)) return
      // Left to itself the webview would start a text selection instead.
      event.preventDefault()
      // Tauri 2 gates this command separately from `core:default`; the native
      // capability grants `core:window:allow-start-dragging`. Keep the error
      // visible during development instead of silently shipping a dead title
      // bar if that capability is ever removed.
      void getCurrentWindow().startDragging().catch((error: unknown) => {
        console.error('Could not start native window drag', error)
      })
    })

    // Double-clicking any empty pane header zooms, which is the macOS
    // convention people reach for without thinking about it.
    region.addEventListener('dblclick', (event) => {
      if (isChrome(event.target)) return
      void getCurrentWindow().toggleMaximize().catch((error: unknown) => {
        console.error('Could not toggle native window size', error)
      })
    })
  }
}

/**
 * Bridges macOS delivery without a launch race.
 *
 * Rust retains paths until this function takes them. The event only schedules
 * another drain, so a file delivered before the webview listener exists is
 * handled exactly like one delivered to an already-running app.
 */
async function installOpenRequestBridge(controller: NativeController): Promise<void> {
  let drains = Promise.resolve()

  const drain = async (): Promise<void> => {
    while (true) {
      const path = await invoke<string | null>('take_open_note_request')
      if (path === null) return
      await controller.openPath(path)
    }
  }

  const schedule = (): void => {
    drains = drains.then(drain).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      controller.current().setStatus('error', `Could not receive file from macOS — ${message}`)
    })
  }

  await listen<void>('open-note-requested', schedule)
  schedule()
}

/** Dropped Markdown files behave like Finder opens: adopt, never copy. */
async function installMarkdownDropBridge(controller: NativeController): Promise<void> {
  const windowHandle = getCurrentWindow()
  await windowHandle.onDragDropEvent((event) => {
    const noteList = document.querySelector<HTMLElement>('.workspace-notes')
    if (event.payload.type === 'enter' || event.payload.type === 'over') {
      noteList?.classList.add('accepting-note-drop')
      return
    }
    noteList?.classList.remove('accepting-note-drop')
    if (event.payload.type !== 'drop') return

    const paths = event.payload.paths.filter((path) => /\.(md|markdown)$/i.test(path))
    if (paths.length === 0) {
      controller.current().setStatus('error', 'Drop a Markdown file to add it to Recent Notes')
      return
    }
    for (const path of paths) void controller.openPath(path)
  })
}

/** Same ordinary file input the browser shell uses; the webview supports it. */
function pickDocumentAsset(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.className = 'browser-file-picker'
    input.tabIndex = -1
    document.body.append(input)

    const finish = (result: File | DOMException): void => {
      input.remove()
      if (result instanceof File) resolve(result)
      else reject(result)
    }
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.item(0)
        finish(file ?? new DOMException('The user aborted a request.', 'AbortError'))
      },
      { once: true },
    )
    input.addEventListener(
      'cancel',
      () => finish(new DOMException('The user aborted a request.', 'AbortError')),
      { once: true },
    )
    input.click()
  })
}

declare global {
  interface Window {
    simplemark?: AppComposition
  }
}

document.documentElement.dataset['shell'] = 'native'

const root = document.querySelector<HTMLElement>('#root')
if (root !== null) {
  void start(root).then((app) => {
    window.simplemark = app
  })
}
