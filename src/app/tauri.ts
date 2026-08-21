import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { Image } from '@tauri-apps/api/image'

import { MdastBlockBoundaries } from '../adapters/editor/mdast-block-boundaries.js'
import { CompositeRenderer } from '../adapters/renderers/composite-renderer.js'
import { MermaidRenderer } from '../adapters/renderers/mermaid-renderer.js'
import { SvgRenderer } from '../adapters/renderers/svg-renderer.js'
import { TextCardRenderer } from '../adapters/renderers/text-card-renderer.js'
import { GraphvizRenderer } from '../adapters/renderers/graphviz-renderer.js'
import { KatexRenderer } from '../adapters/renderers/katex-renderer.js'
import { BrowserAssetReferencePort } from '../adapters/filesystem/browser-asset-reference-port.js'
import { BrowserClipboardPort } from '../adapters/clipboard/browser-clipboard-port.js'
import { OpenAiCompatibleDiagramFixPort } from '../adapters/ai/openai-compatible-diagram-fix.js'
import { OpenAiResponsesAgentPort } from '../adapters/ai/openai-responses-agent.js'
import type { AgentResponsesTransport } from '../adapters/ai/openai-responses-agent.js'
import { isAgentConfigured, loadAgentConnection } from './agent-settings.js'
import { applyAgentEditsToCatalog, applyNoteCountsToCatalog, createAgentEditTally, type NoteCounts } from './agent-edit-overlay.js'
import { createNoteCountSweep } from './note-count-sweep.js'
import { TauriNoteCountSource } from '../adapters/filesystem/tauri-note-count-source.js'
import type { AgentEditTally } from './agent-edit-overlay.js'
import type { ChatCompletionTransport, ModelListTransport } from '../adapters/ai/openai-compatible-diagram-fix.js'
import { loadAiSettings } from './ai-settings.js'
import { FixtureFilePort } from '../adapters/filesystem/fixture-file-port.js'
import { OpenCancelled, TauriFilePort } from '../adapters/filesystem/tauri-file-port.js'
import { TauriWorkspaceCatalogPort } from '../adapters/filesystem/tauri-workspace-catalog-port.js'
import { TauriDocumentLinkPort } from '../adapters/filesystem/tauri-document-link-port.js'
import { TauriChartDataReader } from '../adapters/filesystem/tauri-chart-data-reader.js'
import { TauriImageStore } from '../adapters/filesystem/tauri-image-store.js'
import { TauriNoteIdentity } from '../adapters/filesystem/tauri-note-identity.js'
import { TauriThreadStore } from '../adapters/filesystem/tauri-thread-store.js'
import { TauriSnapshotStore } from '../adapters/filesystem/tauri-snapshot-store.js'
import { VegaLiteRenderer } from '../adapters/renderers/vega-lite-renderer.js'
import type { FilePort, WorkspaceCatalog } from '../application/index.js'
import { suggestedMarkdownFileName } from '../domain/index.js'
import { installNativeMenu } from './ui/native-menu.js'
import type { NativeMenuHandle } from './ui/native-menu.js'
import type { MacosTextServiceId } from './ui/native-menu.js'
import { createSettingsPanel } from './ui/settings-panel.js'
import type { SettingsPanel } from './ui/settings-panel.js'
import { isCommit, isRepository, readProvenance } from './build-provenance.js'
import type { BuildProvenance } from './build-provenance.js'
import { readComparison, updateStatus } from './update-status.js'
import type { UpdateStatus } from './update-status.js'
import { composeApp } from './bootstrap.js'
import type { AppComposition } from './bootstrap.js'
import type { WorkspaceOptions } from './ui/window-chrome.js'
import type { ChromeMode } from './ui/window-chrome.js'
import { SupersedingOperationQueue } from './superseding-operation-queue.js'
import { createPageZoomController } from './page-zoom.js'
import type { PageZoomController } from './page-zoom.js'
import { loadWindowGeometry, saveWindowGeometry } from './window-geometry.js'
import { loadActiveCollection, saveActiveCollection } from './workspace-selection.js'
import { SAMPLE_DOCUMENTS, WELCOME_SAMPLE, sampleDocument } from './sample-documents.js'
import { sampleWorkspaceOptions } from './sample-workspace.js'
import { WorkspacePins } from './workspace-pins.js'
import { NoteWalk } from './note-walk.js'
import { applySummariesToCatalog } from './note-summary-overlay.js'
import { applyPreviewsToCatalog } from './note-preview-overlay.js'
import { APP_ICON_CHOICES, normaliseAppIconId } from './app-icons.js'
import {
  TauriNoteSummaryPort,
  UnavailableNoteSummaryPort,
} from '../adapters/intelligence/index.js'
import type { NoteSummaryPort } from '../application/index.js'
import { WorkspaceHistoryStore } from './workspace-history.js'
import type { Visit } from './workspace-history.js'
import { DRAFT_NOTE_ID, noteRows } from './workspace-view.js'
import {
  retainedFolderHandles,
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

// Read once in start(), before anything else composes the chrome around it.
let hostChromeMode: 'macos' | 'ios' = 'macos'

export async function start(root: HTMLElement): Promise<AppComposition> {
  try {
    const platform = await invoke<string>('host_platform')
    hostChromeMode = platform === 'ios' ? 'ios' : 'macos'
  } catch {
    // A binary built before this command is a desktop binary.
    hostChromeMode = 'macos'
  }
  const nativeWindow = getCurrentWindow()
  const savedGeometry = loadWindowGeometry(window.localStorage)
  if (savedGeometry !== null) {
    await nativeWindow.setSize(new PhysicalSize(savedGeometry.width, savedGeometry.height))
    await nativeWindow.setPosition(new PhysicalPosition(savedGeometry.x, savedGeometry.y))
    if (savedGeometry.maximized) await nativeWindow.maximize()
  }
  const pageZoom = createPageZoomController(window.localStorage, {
    enable: () => invoke('enable_page_magnification'),
    setMagnification: (magnification) => invoke('set_page_magnification', { magnification }),
    syncTrafficLightPosition: (magnification) => invoke('sync_traffic_lights_to_page_zoom', { magnification }),
  })
  await installNativePageMagnificationTracking(pageZoom)
  // Created once per process, like pageZoom above, and threaded the same way:
  // mount() reruns on every note switch, but the panel (and anything the user
  // is mid-typing into it) must not be torn down and rebuilt along with it.
  const modelListTransport: ModelListTransport = (baseUrl, apiKey) =>
    invoke('ai_list_models', { baseUrl, apiKey })
  const settingsPanel = createSettingsPanel({ storage: window.localStorage, listModels: modelListTransport })
  document.body.append(settingsPanel.element)
  const controller = await startNative(root, pageZoom, settingsPanel)
  let geometryTimer: ReturnType<typeof setTimeout> | undefined
  const rememberGeometry = (): void => {
    // Wry re-applies its configured traffic-light inset whenever the window
    // redraws during a resize. Put the zoom-aware baseline back afterwards.
    void invoke('sync_traffic_lights_to_page_zoom', { magnification: pageZoom.current() })
      .catch(() => undefined)
    clearTimeout(geometryTimer)
    geometryTimer = setTimeout(() => {
      void Promise.all([
        nativeWindow.outerPosition(),
        nativeWindow.outerSize(),
        nativeWindow.isMaximized(),
      ]).then(([position, size, maximized]) => {
        saveWindowGeometry(window.localStorage, {
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          maximized,
        })
      })
    }, 180)
  }
  await nativeWindow.onMoved(rememberGeometry)
  await nativeWindow.onResized(rememberGeometry)
  // The geometry restore above (setSize/setPosition/maximize) resizes the
  // window before these listeners existed to catch it, so whichever finished
  // last — Wry's own reset or pageZoom's constructor-time sync — silently
  // decided where the traffic lights landed. Listeners are live now; correct
  // once more so a restored window is deterministic instead of a coin flip.
  rememberGeometry()
  await installNativeContextMenuBridge(controller)
  await installNativeNoteNavigationBridge(controller)
  await installOpenRequestBridge(controller)
  await installSharedTextDraftBridge(controller)
  await installMarkdownDropBridge(controller)
  return controller.current()
}

/**
 * AppKit recognizes the physical trackpad pinch. WebKit renders that native
 * browser-style magnification; this listener only remembers its final scale.
 */
async function installNativePageMagnificationTracking(pageZoom: PageZoomController): Promise<void> {
  await listen<number>('native-page-zoom-delta', (event) => {
    pageZoom.preview(pageZoom.current() * (1 + event.payload))
  })
  await listen('native-page-zoom-end', () => {
    pageZoom.remember(pageZoom.current())
  })
}

async function installNativeContextMenuBridge(controller: NativeController): Promise<void> {
  await listen<string>('native-context-menu-command', (event) => {
    controller.current().runNativeContextCommand(
      event.payload as Parameters<AppComposition['runNativeContextCommand']>[0],
    )
  })
}

const NATIVE_NOTE_NAVIGATION_COMMANDS = [
  'historyBack',
  'historyForward',
  'previousNote',
  'nextNote',
] as const

function isNativeNoteNavigationCommand(
  command: string,
): command is (typeof NATIVE_NOTE_NAVIGATION_COMMANDS)[number] {
  return (NATIVE_NOTE_NAVIGATION_COMMANDS as readonly string[]).includes(command)
}

/**
 * AppKit owns Command-Option-arrow before a WKWebView's responder chain.
 * Resolve the active composition here, rather than capturing a composition at
 * startup, so the chord follows the note after every native remount.
 */
async function installNativeNoteNavigationBridge(controller: NativeController): Promise<void> {
  await listen<string>('native-note-navigation', (event) => {
    if (!isNativeNoteNavigationCommand(event.payload)) return
    const app = controller.current()
    if (!app.commandState(event.payload).enabled) return
    app.run(event.payload)
  })
}

interface NativeController {
  current(): AppComposition
  openPath(path: string): Promise<void>
  openSharedTextDraft(draft: SharedTextDraft): void
}

interface SharedTextDraft {
  readonly id: string
  readonly text: string
}

interface WorkspacePreview {
  readonly handle: string
  readonly preview?: string
}

/** Owns the one active document while every open route shares one transition. */
async function startNative(
  root: HTMLElement,
  pageZoom: PageZoomController,
  settingsPanel: SettingsPanel,
): Promise<NativeController> {
  let current: AppComposition
  let stopWatching: UnlistenFn | undefined
  let activeHandle: string | undefined
  let activeSampleId = WELCOME_SAMPLE.id
  let workspaceHandle: string | undefined
  let activeCollectionId = loadActiveCollection(window.localStorage)
  let requestedSelection: { readonly path: string; readonly collectionId: string } | undefined
  let pendingSharedDraftId: string | undefined
  /**
   * Whether the open document is a new note with no file behind it yet.
   *
   * Shell state rather than a different workspace shape: a new note is one more
   * row in whatever list you were already looking at, so every catalog the
   * shell builds while this is true simply carries an extra row.
   */
  let draft = false
  const collections = new WorkspaceCollections()
  const catalogPort = new TauriWorkspaceCatalogPort(invoke)
  const pins = new WorkspacePins(window.localStorage)
  const folderStore = new WorkspaceFolderStore(window.localStorage)
  const hiddenStore = new WorkspaceHiddenStore(window.localStorage)
  const recentStore = new WorkspaceRecentStore(window.localStorage)
  const historyStore = new WorkspaceHistoryStore(window.localStorage)
  const history = historyStore.load()
  // Shell-scoped on purpose: every note open destroys and remounts the chrome,
  // so a walk held in there would restart on the step that needs it to continue.
  const noteWalk = new NoteWalk()
  const watchedFolders = new Set<string>()
  const samplePorts = new Map(
    SAMPLE_DOCUMENTS.map((sample) => [
      sample.id,
      new FixtureFilePort(sample.name, sample.markdown),
    ]),
  )

  // Shell-scoped like the walk: remounting the chrome per note must not drop
  // the subscription or re-ask the native side whether a model exists.
  const summaryTransport = new TauriNoteSummaryPort(invoke, listen)
  const noteSummaries: NoteSummaryPort = (await summaryTransport.available())
    ? summaryTransport
    : new UnavailableNoteSummaryPort()
  /**
   * Summaries that have arrived this session, by note handle.
   *
   * Patching the row is not enough on its own. The catalog's `preview` is the
   * extracted lead sentence, and every reconcile — and every remount, which
   * happens on each note open — rebuilds the rows from the catalog and so puts
   * the extracted line straight back. Holding the summary here lets each
   * render start from it instead.
   */
  const arrivedSummaries = new Map<string, string>()
  const arrivedPreviews = new Map<string, string>()
  /**
   * Agent edits per note, held out here for the same reason the summaries are:
   * `mount` runs once per opened note and each run discards everything it owns.
   */
  const agentEdits = createAgentEditTally()
  /**
   * Note counts per document (APP-44), held out here like the agent tally so
   * a remount does not forget what the previous note reported.
   */
  const noteCounts = new Map<string, NoteCounts>()
  /**
   * Counts for the rows nobody opened this session (APP-47): one native call
   * per catalog, results patched into rows as they arrive and remembered in
   * the same map the open document reports into.
   */
  const noteCountSweep = createNoteCountSweep({
    source: new TauriNoteCountSource(invoke),
    cache: noteCounts,
    apply: (handle, open, resolved) => current?.applyNoteCounts(handle, open, resolved),
    report: (message) => current?.setStatus('error', message),
  })

  /** The catalog as the note list should show it: AI summaries beat previews. */
  const withSummaries = (catalog: WorkspaceCatalog): WorkspaceCatalog =>
    applyNoteCountsToCatalog(
      applyAgentEditsToCatalog(
        applySummariesToCatalog(
          applyPreviewsToCatalog(catalog, arrivedPreviews),
          arrivedSummaries,
        ),
        agentEdits.all(),
      ),
      noteCounts,
    )

  await listen<WorkspacePreview>('workspace-note-preview', ({ payload }) => {
    if (payload.preview === undefined) return
    arrivedPreviews.set(payload.handle, payload.preview)
    if (!arrivedSummaries.has(payload.handle)) current?.applyNotePreview(payload.handle, payload.preview)
  })

  // Arrives on a background thread over a second after it was asked for, so
  // the row is patched in place rather than repainting and re-running the sort.
  noteSummaries.onSummary((summary) => {
    arrivedSummaries.set(summary.handle, summary.summary)
    current.applyNoteSummary(summary.handle, summary.summary)
  })
  /**
   * How many notes one request may ask for.
   *
   * A bound rather than a viewport: the catalog is already sorted newest-first,
   * so its order is the relevance order and the head of the list is very nearly
   * what is on screen. That gets the benefit an IntersectionObserver would,
   * without the webview reporting scroll position across the bridge.
   *
   * It is also a cost fix, not only a politeness one. The native side must read
   * and hash a note before it can look it up — the cache is keyed by content —
   * so an uncapped request re-reads and re-hashes the whole collection on every
   * catalog refresh, which happens each time you switch notes.
   *
   * Notes past the bound keep their extracted preview until you select one, at
   * which point it becomes the active note and goes to the front.
   */
  const SUMMARY_REQUEST_LIMIT = 30

  /** Active note first, then the most recent of the collection. */
  const requestSummaries = (activeHandle: string, catalog: WorkspaceCatalog): void => {
    const handles = [
      ...(activeHandle === '' ? [] : [activeHandle]),
      ...catalog.notes.map((note) => note.handle).filter((handle) => handle !== activeHandle),
    ].slice(0, SUMMARY_REQUEST_LIMIT)
    if (handles.length > 0) void noteSummaries.request(handles)
  }

  const showOpenFailure = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    current.setStatus('error', `Could not open file — ${message}`)
  }

  const operations = new SupersedingOperationQueue(showOpenFailure)
  const enqueue = (operation: () => Promise<void>): Promise<void> => operations.enqueue(operation)

  const watch = async (port: TauriFilePort, handle: string): Promise<void> => {
    stopWatching?.()
    await port.watch(handle)
    const stopChanged = await listen<string>('note-changed-externally', (event) => {
      if (event.payload !== handle) return
      current.setStatus(
        'error',
        `Changed on disk by another program — ${event.payload.split('/').pop() ?? 'this note'}`,
      )
    })
    const stopThreads = await listen<string>('note-threads-changed-externally', (event) => {
      if (event.payload !== handle) return
      void current.notes.reload()
    })
    stopWatching = () => {
      stopChanged()
      stopThreads()
    }
  }

  const watchFolder = async (handle: string): Promise<void> => {
    if (watchedFolders.has(handle)) return
    await invoke('watch_workspace_folder', { handle })
    watchedFolders.add(handle)
  }

  /**
   * Handles that could not be listed this launch.
   *
   * Kept because failing to list is not the same as being given up on, and
   * only the person removing a folder should remove it. See
   * `retainedFolderHandles`.
   */
  const unreachableFolders: string[] = []

  const persistFolders = (): void => {
    folderStore.save(retainedFolderHandles(
      collections.folders().map((folder) => folder.handle),
      unreachableFolders,
    ))
  }

  const persistRecentNotes = (): void => {
    recentStore.save(collections.recentNotes('').notes.map((note) => note.handle))
  }

  const persistHiddenNotes = (): void => {
    hiddenStore.save(collections.hiddenHandles())
  }

  /**
   * The one set of row and collection actions every catalog view is built from.
   *
   * Assembled in a function rather than copied per mount because the copies are
   * how the middle pane drifted apart in the first place: whichever transition
   * forgot one grew its own note list.
   */
  const workspaceActions = (collectionId: string): CatalogActions => ({
    select: selectNote,
    create: createNote,
    addFolder: addFolder,
    selectCollection,
    togglePinned,
    copyText,
    copyMarkdown,
    duplicateNote,
    exportNote,
    saveNoteAs,
    closeNote,
    trashNote,
    revealInFinder,
    historyBack,
    historyForward,
    canHistoryBack: () => history.canBack(),
    canHistoryForward: () => history.canForward(),
    noteWalk,
    folders: collections.folders(),
    activeCollectionId: collectionId,
    recentNotesCount: collections.recentCount(),
  })

  /** The middle pane for a collection, including the draft row when there is one. */
  const workspaceView = (
    selectedHandle: string,
    collectionId = activeCollectionId,
  ): WorkspaceOptions => {
    const catalog = collections.collection(collectionId, workspaceHandle ?? selectedHandle)
    // Every catalog the shell shows passes through here, so this is the one
    // place summaries need asking for. Fire-and-forget: results arrive on an
    // event and never hold up the render.
    requestSummaries(selectedHandle, catalog)
    void noteCountSweep.sweep(catalog)
    return catalogWorkspace(
      withSummaries(catalog),
      selectedHandle,
      pins,
      workspaceActions(collectionId),
      draft,
    )
  }

  const reconcileWorkspace = (
    selectedHandle = activeHandle,
    collectionId = activeCollectionId,
  ): void => {
    // A draft has no handle and still has to keep its row: it is the note on
    // screen. Without it a folder refresh mid-draft would repaint the list
    // without the note you are looking at.
    if (selectedHandle === undefined && !draft) return
    current.reconcileWorkspace(workspaceView(selectedHandle ?? DRAFT_NOTE_ID, collectionId))
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
    requestSummaries(opened.handle, inspected)
    activeCollectionId = collectionId
    saveActiveCollection(window.localStorage, collectionId)
    const catalog = collections.collection(collectionId, inspected.handle)
    void noteCountSweep.sweep(catalog)
    // Startup can reach this path before there is a composition at all. A
    // later open replaces the mounted editor; the very first restored note is
    // the initial mount and therefore has nothing to tear down.
    if (current !== undefined) await current.destroy()
    activeHandle = opened.handle
    // Whatever was being drafted has either become this file or been left
    // behind; either way the row standing in for it is gone.
    draft = false
    workspaceHandle = collectionId === 'recent' ? inspected.handle : catalog.handle
    current = await mount(root, port, {
      filePath: opened.handle,
      pageZoom,
      settingsPanel,
      agentEdits,
      noteCounts,
      menuTarget: () => current,
      onOpenFile: openFromPicker,
      onOpenFolder: addFolder,
      onRenameDocument: renameActiveDocument,
      workspace: catalogWorkspace(
        withSummaries(catalog),
        opened.handle,
        pins,
        workspaceActions(activeCollectionId),
      ),
    })
    await watch(port, opened.handle)
  }

  /**
   * True when the new note on screen is still exactly as it was created.
   *
   * A new note starts as an empty heading. Leaving one you never typed in must
   * not raise a destination panel — being unable to click another note without
   * answering a save dialog is what made a new note feel like a trap.
   *
   * The session is flushed first, because this decides whether a document is
   * thrown away. The editor hands changes over on a debounce, so a draft typed
   * into and left within that window still reads as the empty heading it was
   * created as — and answering "untouched" there discards what was just typed
   * without so much as a destination panel.
   */
  const discardsUntouchedDraft = (): boolean => {
    if (!draft) return false
    current.flushPendingChanges()
    return current.session.snapshot().markdown.replace(/^#+/u, '').trim() === ''
  }

  /**
   * Flushes the open document before a transition replaces it.
   *
   * `false` means the transition must not continue. The draft flag is left
   * alone: only the code that actually swaps the document clears it, so an
   * abandoned transition cannot strip the draft's row from a list that is still
   * showing the draft.
   */
  const flush = async (): Promise<boolean> => discardsUntouchedDraft() || current.save()

  /**
   * Opens a note, optionally recording the arrival in the visit stack.
   *
   * `record` is the whole distinction between going somewhere and going back.
   * Every ordinary open — a row click, a Previous/Next Note walk, a collection
   * switch — is a place you chose to go, so it lands on the stack. Replaying an
   * entry the Back button already moved the cursor to must not, or the stack
   * would rewrite itself under its own navigation and Forward would never
   * survive a single step backwards.
   */
  const openInCollection = (path: string, collectionId: string, record = true): void => {
    // The draft row is the note already on screen and no file answers to its
    // id, so selecting it is a no-op rather than a read of a path that is not
    // one. Every other row action guards the same way.
    if (path === DRAFT_NOTE_ID) return
    if (
      requestedSelection === undefined
      && path === activeHandle
      && collectionId === activeCollectionId
    ) return
    requestedSelection = { path, collectionId }
    if (record) {
      history.visit({ handle: path, collectionId })
      historyStore.save(history)
    }
    // A row click has immediate visible acknowledgement even though the
    // durable transition must save before reading another file.
    reconcileWorkspace(path, collectionId)
    current.setStatus('saved', `Opening ${path.split('/').pop() ?? 'note'}…`)
    void operations.enqueueLatest('note-selection', async (isCurrent) => {
      try {
        if (!(await flush())) return
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

  /**
   * Replays the entry the cursor lands on after a step.
   *
   * The cursor moves first and the open follows, so the stack is the single
   * source of truth about where you are; nothing here recomputes a position
   * from the note that happens to be showing.
   */
  const replay = (visit: Visit | undefined): void => {
    if (visit === undefined) return
    historyStore.save(history)
    openInCollection(visit.handle, visit.collectionId, false)
  }

  const historyBack = (): void => replay(history.back())
  const historyForward = (): void => replay(history.forward())

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
      collections.addFolder(catalog)
      persistFolders()
      if (!(await flush())) return
      const startWatchingFolder = (): void => {
        void watchFolder(catalog.handle).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          current.setStatus('error', `Folder opened, but changes cannot be watched — ${message}`)
        })
      }
      // Selecting a folder succeeds independently from opening its first
      // document. iCloud can take time to materialise that document; holding
      // the collection switch until then leaves the person stranded in Samples
      // even though the native picker already accepted their folder.
      activeCollectionId = catalog.handle
      saveActiveCollection(window.localStorage, catalog.handle)
      workspaceHandle = catalog.handle
      reconcileWorkspace('', catalog.handle)
      if (catalog.notes.length === 0) {
        // An empty folder is still a real destination. On a phone this moves
        // to its note list; on a wider window the current document stays
        // visible while the selected, empty folder is shown beside it.
        startWatchingFolder()
        return
      }
      const next = catalog.notes.find((note) => note.handle === activeHandle) ?? catalog.notes[0]!
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(next.handle)
      await install(port, opened, catalog.handle)
      startWatchingFolder()
    })
  }

  /**
   * Where a just-saved new note belongs.
   *
   * Saving into the folder you were browsing should leave you in that folder.
   * The folder is re-listed rather than assumed: only the filesystem knows
   * whether the destination panel actually put the file there.
   */
  const collectionForSavedNote = async (handle: string): Promise<string> => {
    if (activeCollectionId === 'recent') return 'recent'
    const folder = collections.folder(activeCollectionId)
    if (folder === undefined) return 'recent'
    collections.addFolder(await catalogPort.listFolder(folder.handle))
    const contains = collections.folder(activeCollectionId)?.notes
      .some((note) => note.handle === handle) === true
    return contains ? activeCollectionId : 'recent'
  }

  const saveDraft = async (markdown: string): Promise<boolean> => {
    const port = new TauriFilePort(invoke)
    const opened = await port.saveNew(
      suggestedMarkdownFileName(markdown),
      new TextEncoder().encode(markdown),
    )
    if (opened === null) return false
    await install(port, opened, await collectionForSavedNote(opened.handle))
    if (pendingSharedDraftId !== undefined) {
      const id = pendingSharedDraftId
      pendingSharedDraftId = undefined
      void invoke('acknowledge_shared_text_draft', { id }).catch(() => {
        // The saved Markdown file is authoritative. Retaining a stale handoff
        // record is preferable to claiming it was consumed when iOS rejected
        // the App Group operation.
        pendingSharedDraftId = id
      })
    }
    current.setStatus('saved', `Saved ${opened.name.replace(/\.(md|markdown)$/iu, '')}`)
    return true
  }

  const renameActiveDocument = async (name: string): Promise<boolean> => {
    const previousHandle = activeHandle
    if (previousHandle === undefined) return false
    const port = new TauriFilePort(invoke)
    const opened = await port.rename(previousHandle, name)
    collections.forgetRecent(previousHandle)
    persistRecentNotes()
    for (const folder of collections.folders()) {
      if (folder.notes.some((note) => note.handle === previousHandle)) {
        collections.addFolder(await catalogPort.listFolder(folder.handle))
      }
    }
    await install(port, opened, activeCollectionId)
    current.setStatus('saved', `Renamed to ${opened.name.replace(/\.(md|markdown)$/iu, '')}`)
    return true
  }

  /**
   * Opens a new, unsaved note without disturbing the list you are looking at.
   *
   * The collection is deliberately left alone. A new note is a row added to the
   * catalog on screen, not a reason to be moved to a different collection — and
   * the list stays populated the whole time, which is the point: this used to
   * compose the welcome screen's one-row workspace, so the middle pane emptied
   * itself until the note was saved.
   */
  const createNote = (source = '# \n', status = 'Not saved'): void => {
    void enqueue(async () => {
      if (!(await flush())) return
      stopWatching?.()
      stopWatching = undefined
      await invoke('stop_watching_note')
      activeHandle = undefined
      draft = true
      await current.destroy()
      current = await mount(root, new FixtureFilePort('Untitled.md', source), {
        filePath: 'Not saved',
        pageZoom,
        settingsPanel,
        agentEdits,
        noteCounts,
        menuTarget: () => current,
        onOpenFile: openFromPicker,
        onOpenFolder: addFolder,
        onSaveDraft: saveDraft,
        workspace: workspaceView(DRAFT_NOTE_ID),
      })
      current.setStatus('dirty', status)
      // A new note exists so you can start typing. Landing with focus still on
      // whatever you clicked to get here — the New Note button, a menu item —
      // means the first keystroke (or paste) goes nowhere until you click into
      // the page yourself.
      current.editor.focusEnd()
    })
  }

  /**
   * Every row action below is handed a row id, and one row on screen may be the
   * unsaved note. Pinning it, copying it, or revealing it would all reach for a
   * file that does not exist yet, so each one recognises the draft and declines.
   */
  const togglePinned = (handle: string): boolean =>
    handle === DRAFT_NOTE_ID ? false : pins.toggle(handle)

  const copyText = async (text: string): Promise<void> => {
    await writeText(text)
    current.setStatus('saved', 'Copied')
  }

  const copyMarkdown = async (handle: string): Promise<void> => {
    if (handle === DRAFT_NOTE_ID) {
      // No file backs the draft, so the session is the only copy — and it is a
      // debounce behind the editor. Copying a note has to yield the note.
      current.flushPendingChanges()
      await copyText(current.session.snapshot().markdown)
      return
    }
    const port = new TauriFilePort(invoke)
    const opened = await port.openAt(handle)
    await copyText(new TextDecoder().decode(opened.bytes))
  }

  const duplicateNote = (handle: string): Promise<void> => enqueue(async () => {
    if (handle === DRAFT_NOTE_ID) return
    if (!(await flush())) return
    const duplicate = await invoke<{ readonly handle: string }>('duplicate_note', { handle })
    if (activeCollectionId !== 'recent') {
      collections.addFolder(await catalogPort.listFolder(activeCollectionId))
    }
    const port = new TauriFilePort(invoke)
    const opened = await port.openAt(duplicate.handle)
    await install(port, opened, activeCollectionId)
  })

  const exportNote = (handle: string): Promise<void> => enqueue(async () => {
    if (handle === DRAFT_NOTE_ID) return
    if (handle === activeHandle && !(await flush())) return
    const exported = await invoke<boolean>('export_note', { handle })
    if (exported) current.setStatus('saved', 'Exported')
  })

  const saveNoteAs = (handle: string): Promise<void> => enqueue(async () => {
    if (handle === DRAFT_NOTE_ID) {
      current.setStatus('error', 'Save this note before using Save As')
      return
    }
    if (handle === activeHandle && !(await flush())) return
    const saved = await invoke<{ readonly handle: string } | null>('save_note_as', { handle })
    if (saved === null) return
    let destinationCollectionId = activeCollectionId
    if (activeCollectionId !== 'recent') {
      const refreshed = await catalogPort.listFolder(activeCollectionId)
      collections.addFolder(refreshed)
      if (!refreshed.notes.some((note) => note.handle === saved.handle)) {
        destinationCollectionId = 'recent'
      }
    }
    const port = new TauriFilePort(invoke)
    const opened = await port.openAt(saved.handle)
    await install(port, opened, destinationCollectionId)
  })

  const revealInFinder = async (handle: string): Promise<void> => {
    if (handle === DRAFT_NOTE_ID) {
      current.setStatus('error', 'Save this note before revealing it in Finder')
      return
    }
    await invoke('reveal_in_finder', { handle })
  }

  /**
   * Throws the unsaved note away and lands on the collection behind it.
   *
   * Closing or trashing the draft row is the only honest meaning available:
   * there is no file to close or trash, so what goes is the draft itself.
   */
  const discardDraft = async (): Promise<void> => {
    draft = false
    const catalog = collections.collection(activeCollectionId, workspaceHandle ?? '')
    const next = catalog.notes[0]
    if (next !== undefined) {
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(next.handle)
      await install(port, opened, activeCollectionId)
      current.setStatus('saved', 'Discarded the new note')
      return
    }
    activeHandle = undefined
    await mountSample()
    current.setStatus('saved', 'Discarded the new note')
  }

  let closeNote: (handle: string) => Promise<void>
  closeNote = (handle: string): Promise<void> => enqueue(async () => {
    if (handle === DRAFT_NOTE_ID) return discardDraft()
    const before = collections.collection(activeCollectionId, workspaceHandle ?? handle)
    const closedIndex = before.notes.findIndex((note) => note.handle === handle)
    const wasActive = handle === activeHandle
    if (wasActive && !(await flush())) return

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
    void noteCountSweep.sweep(after)
    await current.destroy()
    current = await mount(root, new FixtureFilePort('No note selected.md', ''), {
      filePath: 'No note selected',
      pageZoom,
      settingsPanel,
      agentEdits,
      noteCounts,
      menuTarget: () => current,
      onOpenFile: openFromPicker,
      onOpenFolder: addFolder,
      workspace: catalogWorkspace(withSummaries(after), '', pins, workspaceActions(activeCollectionId)),
    })
    current.setStatus('saved', message)
  })

  const trashNote = (handle: string): Promise<void> => enqueue(async () => {
    if (handle === DRAFT_NOTE_ID) return discardDraft()
    if (handle === activeHandle && !(await flush())) return
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
    draft = false
    workspaceHandle = undefined
    activeCollectionId = 'recent'
    saveActiveCollection(window.localStorage, activeCollectionId)
    await mountSample()
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

      if (!(await flush())) return
      await install(port, opened, 'recent')
    })
  }

  /** Mounts one bundled sample without pretending it is a file on disk. */
  const mountSample = async (id = WELCOME_SAMPLE.id): Promise<void> => {
    const sample = sampleDocument(id) ?? WELCOME_SAMPLE
    const port = samplePorts.get(sample.id)
    if (port === undefined) throw new Error(`Missing bundled sample ${sample.id}`)

    stopWatching?.()
    stopWatching = undefined
    if (current !== undefined) await current.destroy()
    activeHandle = undefined
    draft = false
    workspaceHandle = undefined
    activeSampleId = sample.id
    current = await mount(root, port, {
      filePath: 'Samples · changes reset when SimpleMark restarts · open a file to use your own Markdown',
      pageZoom,
      settingsPanel,
      agentEdits,
      noteCounts,
      menuTarget: () => current,
      onOpenFile: openFromPicker,
      onOpenFolder: addFolder,
      workspace: sampleWorkspaceOptions(sample.id, {
        onSelectNote: selectSample,
        onCreateNote: createNote,
        onAddFolder: addFolder,
        onSelectCollection: selectCollection,
        folders: collections.folders().map((folder) => ({
          id: folder.handle,
          name: folder.name,
          count: folder.notes.length,
        })),
      }),
    })
  }

  const selectSample = (id: string): void => {
    if (id === activeSampleId) return
    void enqueue(async () => {
      if (!(await flush())) return
      await mountSample(id)
    })
  }

  for (const handle of folderStore.load()) {
    try {
      const catalog = await catalogPort.listFolder(handle)
      collections.addFolder(catalog)
      await watchFolder(catalog.handle)
    } catch {
      // This folder is not listable *right now*, which says nothing about
      // whether the person still wants it. A folder in iCloud answers with an
      // error while the daemon is still materialising it, an external disk is
      // not mounted yet, a network volume is asleep. Dropping the handle here
      // would be silent and permanent — the sidebar simply never mentions the
      // folder again — so it is held and retried on the next launch instead.
      unreachableFolders.push(handle)
    }
  }
  // The folders this platform supplies, adopted whenever it offers any.
  //
  // On iOS that is the operating system's single document directory, and there
  // is no picker that could choose another. On macOS they are this app's folders
  // in iCloud Drive — the container the phone writes into, and the folder of the
  // same name a person keeps at the top of iCloud Drive. None of them is a guess
  // about where notes live, which is why having folders of your own does not
  // suppress them: a Mac that shows every folder except the app's own iCloud
  // folders is exactly the Mac that cannot see a note written on the phone.
  //
  // A folder already present is left alone, so somebody who added one by hand
  // keeps their single copy of it, in the order they put it in.
  {
    try {
      const supplied = await invoke<readonly WorkspaceCatalog[]>('default_workspaces')
      for (const catalog of supplied) {
        if (collections.folder(catalog.handle) !== undefined) continue
        collections.addFolder(catalog)
        await watchFolder(catalog.handle)
        // Only a sole collection decides where launch lands. Otherwise the
        // person's own restored view is left exactly as they left it.
        if (collections.folders().length === 1) {
          activeCollectionId = catalog.handle
          saveActiveCollection(window.localStorage, activeCollectionId)
        }
      }
    } catch {
      // An unreachable default is the same as not having one: the shell stays
      // in its welcome state rather than claiming a folder it cannot read.
    }
  }
  persistFolders()
  if (activeCollectionId !== 'recent' && collections.folder(activeCollectionId) === undefined) {
    activeCollectionId = 'recent'
    saveActiveCollection(window.localStorage, activeCollectionId)
  }

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

  // A persisted stack outlives the files in it, so it is filtered against what
  // the workspace can actually reach before anything can navigate to it. The
  // recent map is the right authority here: it is the set of notes an explicit
  // open has already put in reach, which is the same set history is built from.
  {
    const reachable = new Set(collections.recentNotes('').notes.map((note) => note.handle))
    history.retain((visit) => reachable.has(visit.handle))
    historyStore.save(history)
  }

  const mostRecent = collections.recentNotes('').notes[0]
  const restoredCatalog = activeCollectionId === 'recent'
    ? collections.recentNotes('')
    : collections.folder(activeCollectionId)
  const restoredNote = restoredCatalog?.notes.find((note) => note.handle === mostRecent?.handle)
    ?? restoredCatalog?.notes[0]
    ?? mostRecent
  if (restoredNote !== undefined) {
    try {
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(restoredNote.handle)
      await install(port, opened, activeCollectionId)
      // Launch lands you somewhere, so the stack has to agree that is where
      // you are. `visit` ignores this when it already is the current entry —
      // the common case, since the restored note is usually the last one you
      // had open — so a restart does not pad the stack with a duplicate.
      history.visit({ handle: restoredNote.handle, collectionId: activeCollectionId })
      historyStore.save(history)
      reconcileWorkspace(restoredNote.handle, activeCollectionId)
    } catch {
      collections.forgetRecent(restoredNote.handle)
      persistRecentNotes()
      // There is no existing composition to leave in place here: startup now
      // mounts the restored note directly instead of first constructing and
      // immediately destroying the sample editor. If the remembered file has
      // gone away, make the welcome document the one and only initial mount.
      await mountSample()
    }
  } else {
    // First launch has no recent file. The welcome document is the initial
    // mount only in that case, never a disposable staging editor for a file we
    // already know we are about to restore.
    await mountSample()
  }

  await listen<string>('workspace-folder-changed', (event) => {
    void enqueue(async () => {
      if (collections.folder(event.payload) === undefined) return
      const refreshed = await catalogPort.listFolder(event.payload)
      const refresh = collections.refreshFolder(refreshed)
      if (!refresh.membershipChanged) {
        // The same notes with different bytes: one was edited rather than
        // added or removed. Membership is what decides whether the *workspace*
        // changed, and it did not — but every row carries a preview, a
        // modified time and its place in a list sorted by that time, and all
        // three are now wrong. Returning here is why an edited note looked
        // frozen in every folder until something else forced a repaint.
        //
        // Only the repaint belongs here. There is no folder to persist, no
        // note that went missing, and the open note must not be reopened —
        // this fires on our own saves too, and reopening on each one would
        // fight the editor for the document being typed into.
        reconcileWorkspace()
        return
      }
      persistFolders()

      const activeWasRemoved = activeHandle !== undefined
        && refresh.previous?.notes.some((note) => note.handle === activeHandle) === true
        && !refresh.current.notes.some((note) => note.handle === activeHandle)
      if (activeWasRemoved) {
        current.setStatus('error', 'The open note was removed from disk — your editor was left untouched')
        return
      }

      // A draft has no handle either, and it must survive a folder changing
      // underneath it: the note being written is not on disk, so nothing that
      // happened on disk can be a reason to throw it away. Repaint the list
      // around it and leave the editor alone.
      if (draft) {
        reconcileWorkspace()
        return
      }

      if (activeHandle === undefined) {
        await mountSample(activeSampleId)
        return
      }

      if (!(await flush())) return
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
      if (!(await flush())) return
      const port = new TauriFilePort(invoke)
      const opened = await port.openAt(path)
      await install(port, opened, 'recent')
    }),
    openSharedTextDraft: (draft) => {
      pendingSharedDraftId = draft.id
      createNote(draft.text, 'Shared text — choose Save to place it')
    },
  }
}

async function mount(
  root: HTMLElement,
  file: FilePort,
  options: {
    filePath: string
    onOpenFile: () => void
    onOpenFolder: () => void
    onSaveDraft?: (markdown: string) => Promise<boolean>
    onRenameDocument?: (name: string) => Promise<boolean>
    workspace: WorkspaceOptions
    pageZoom: PageZoomController
    /**
     * The native menubar can outlive a note remount. Resolve its command
     * target at activation time so an accelerator never dispatches into the
     * composition that was showing when the menu was first installed.
     */
    menuTarget?: () => AppComposition | undefined
    /** The one Settings panel for this process — created in `start()`, survives every remount. */
    settingsPanel: SettingsPanel
    /**
     * Agent edits per note. Created in `startNative` for the same reason the
     * Settings panel is: `mount` reruns on every note switch and discards
     * everything it owns, and this marker has to outlive that.
     */
    agentEdits: AgentEditTally
    /** Note counts per document, surviving remounts like the tally (APP-44). */
    noteCounts: Map<string, NoteCounts>
  },
): Promise<AppComposition> {
  let app: AppComposition
  const appIcon = normaliseAppIconId(await invoke<string>('get_app_icon'))
  const chatCompletionTransport: ChatCompletionTransport = (baseUrl, apiKey, model, messages) =>
    invoke('ai_chat_completion', { baseUrl, apiKey, model, messages })
  /**
   * The agent's transport, through its own native command (AGENT-11).
   *
   * `/v1/responses`, not chat completions: that endpoint refuses function tools
   * together with a reasoning level for this model, and the agent needs both.
   * The packaged app's CSP blocks a frontend `fetch` outright, so this hop is
   * not optional either.
   */
  const agentResponsesTransport: AgentResponsesTransport = (baseUrl, apiKey, _model, body) =>
    invoke('ai_responses', { baseUrl, apiKey, body })
  const agentPort = new OpenAiResponsesAgentPort(
    agentResponsesTransport,
    () => loadAgentConnection(window.localStorage),
  )

  // Final review Finding 1: the native menubar's Format → Diagram ids only
  // ever repainted from inside a menu action's own `activate` — a bare
  // selection change (a click, an arrow key) never touched it, so those 8
  // ids sat permanently disabled, or stale-enabled from whatever the last
  // menu click happened to leave behind. `nativeMenu` is assigned once
  // `installNativeMenu` resolves, below; `onSelectionChange` closes over the
  // variable rather than a snapshot, since the menu does not exist yet at
  // this point in `mount`. Debounced because a selection changes on every
  // keystroke too (the caret moves) — this keeps a fast run of typing to one
  // native round trip, not one per character.
  //
  // Fix-wave review: `mount` runs once per opened note, each preceded by
  // `await current.destroy()` — so a timer armed just before a note switch
  // can fire after this composition's editor is torn down. `repaint()` reads
  // `commandState` → `editor.diagram.kind()` → the Milkdown ctx, which
  // throws once that ctx is destroyed. Two belts: `compositionTornDown` is
  // this composition's own liveness flag, set the moment its `destroy()`
  // runs (wrapped below), where belt 1 also cancels whatever timer is
  // currently pending — between the two, the ordinary case never reaches the
  // callback at all. Belt 2 is the flag itself, checked inside the callback:
  // it is what catches a timer `scheduleMenuRepaint` arms *after* `destroy()`
  // has already run — a late, out-of-order selection-change event, say —
  // which belt 1's one-time `clearTimeout` cannot have seen coming.
  let nativeMenu: NativeMenuHandle | undefined
  let menuRepaintTimer: ReturnType<typeof setTimeout> | undefined
  let compositionTornDown = false
  const scheduleMenuRepaint = (): void => {
    if (menuRepaintTimer !== undefined) clearTimeout(menuRepaintTimer)
    menuRepaintTimer = setTimeout(() => {
      menuRepaintTimer = undefined
      if (compositionTornDown) return
      nativeMenu?.repaint()
    }, 50)
  }

  app = await composeApp({
    ports: {
      file,
      // The picker is an ordinary file input inside the webview. Copying an
      // asset into the note's own directory is a native capability APP-2 does
      // not claim; the port says so rather than pretending.
      assets: new BrowserAssetReferencePort(pickDocumentAsset, window),
      links: new TauriDocumentLinkPort(invoke),
      images: new TauriImageStore((command, args) => invoke(command, args)),
      threads: new TauriThreadStore(
        (command, args) => invoke(command, args),
        () => options.filePath,
      ),
      snapshots: new TauriSnapshotStore(
        (command, args) => invoke(command, args),
        () => options.filePath,
      ),
      identity: new TauriNoteIdentity((command, args) => invoke(command, args)),
      clipboard: new BrowserClipboardPort(),
      diagramFix: new OpenAiCompatibleDiagramFixPort(chatCompletionTransport, () => loadAiSettings(window.localStorage)),
      // Lets a save re-emit untouched blocks from the file's own bytes instead
      // of re-serializing the whole document (FIDELITY-1).
      blockBoundaries: new MdastBlockBoundaries(),
      diagrams: new CompositeRenderer([
        new MermaidRenderer(),
        new SvgRenderer(),
        new GraphvizRenderer(),
        new KatexRenderer(),
        // A chart may name a data file, resolved against this note by the same
        // rules a Markdown link obeys. `mount` runs per opened note, so the
        // handle this closes over is the note the chart sits in.
        new VegaLiteRenderer(new TauriChartDataReader(invoke, () => options.filePath)),
        new TextCardRenderer(),
      ]),
    },
    filePath: options.filePath,
    pageZoom: options.pageZoom,
    workspace: options.workspace,
    chromeMode: hostChromeMode,
    appIcon,
    appIconChoices: APP_ICON_CHOICES,
    onAppIconChange: (icon) => invoke('set_app_icon', { icon }),
    // The native menubar is the complete command surface. The small floating
    // palette is the fast, Apple Notes-style reach shown in the approved
    // interactive wireframe; it is not a second menu row.
    stylesBarDefault: true,
    onOpenFile: options.onOpenFile,
    onOpenFolder: options.onOpenFolder,
    ...(options.onSaveDraft === undefined ? {} : { onSaveDraft: options.onSaveDraft }),
    ...(options.onRenameDocument === undefined ? {} : { onRenameDocument: options.onRenameDocument }),
    // A huge virtual table goes through Tauri's native pasteboard bridge.
    // WKWebView's navigator.clipboard can synchronously stall while it
    // marshals a large payload, defeating the renderer's safety guarantee.
    copyDeferredTable: async (source) => {
      try {
        await writeText(source)
        return true
      } catch {
        return false
      }
    },
    // §1 ruling 4: image clipboard writes go through the shell's native
    // pasteboard, following the same reasoning as `copyDeferredTable` above —
    // WKWebView's `ClipboardItem` support is not to be trusted for anything
    // beyond plain text (the Graphviz class of packaged-only failure).
    copyImage: async (png) => {
      try {
        const image = await Image.fromBytes(png)
        await writeImage(image)
        return true
      } catch {
        return false
      }
    },
    // `Save image`'s native save dialog, through the same `save_image`
    // command `save_note_as` (Rust side) already mirrors for the note itself.
    // Bytes cross base64-encoded — the D7 fidelity boundary convention this
    // codebase already uses for `save_new_note`'s payload.
    saveImage: async (bytes, format, suggestedName) => {
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      const encoded = btoa(binary)
      return await invoke<boolean>('save_image', {
        suggestedName: `${suggestedName}.${format}`,
        extension: format,
        bytes: encoded,
      })
    },
    // WKWebView never answers the webview's own `window.print()`, so the panel
    // has to be raised from the native side. What lands on paper is still the
    // shared print stylesheet — this only opens the door.
    onPrint: () => void invoke('print_note'),
    onNativeContextMenu: (shape) => {
      void invoke('set_native_context_menu_shape', { shape })
    },
    onSelectionChange: scheduleMenuRepaint,
    // Read per run, not captured: credentials are entered while the app runs.
    agentProvider: () =>
      isAgentConfigured(loadAgentConnection(window.localStorage)) ? agentPort : undefined,
    onOpenSettings: () => options.settingsPanel.open(),
    // The wedge banner's Restart. A full relaunch, because the wedge lives in
    // the WebContent process and reload does not reliably leave it.
    onRelaunch: () => void invoke('relaunch_app'),
    agentEdits: options.agentEdits,
    onNoteCountsChanged: (handle, open, resolved) => {
      options.noteCounts.set(handle, { open, resolved })
    },
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

  // Belt 1 of the fix-wave review fix, above: cancel the pending repaint
  // timer in the same place this composition is torn down, mirroring
  // `composeApp`'s own `saveTimer`/`destroy()` convention (bootstrap.ts) —
  // done here rather than inside `composeApp` itself since the timer is a
  // native-shell-only concern `composeApp` (shared with the browser build)
  // has no reason to know about.
  const composedDestroy = app.destroy.bind(app)
  app.destroy = async () => {
    compositionTornDown = true
    if (menuRepaintTimer !== undefined) {
      clearTimeout(menuRepaintTimer)
      menuRepaintTimer = undefined
    }
    await composedDestroy()
  }

  root.replaceChildren(app.element)
  window.simplemark = app
  installWindowDragging(app.element)

  // Native-first: the menubar is the complete command surface, generated from
  // the same registry the toolbar uses. AppKit may retain an earlier native
  // menu while a note transition replaces the webview composition, so its
  // callbacks must resolve the live composition rather than close over `app`.
  // The local fallback is necessary during this first mount, before the native
  // controller has assigned its `current` reference.
  const menuApp = (): AppComposition => options.menuTarget?.() ?? app

  // Rebuilt with each composition so View checkmarks match the shell that is
  // actually on screen. Even if AppKit keeps an earlier menu instance, the
  // dynamic callbacks above still route its accelerators to the current note.
  // Provenance is read once at menu build. A bundle's commit cannot change
  // while it runs, and a failure to read it must not cost you the menubar.
  let provenance: BuildProvenance | undefined
  try {
    provenance = readProvenance(await invoke('build_provenance'))
  } catch {
    provenance = undefined
  }

  // A menubar is a desktop capability, and iOS has none — Tauri's menu APIs
  // reject there. Unguarded, that made a missing menubar fatal to the whole
  // composition: the document was already on screen by the time this ran, so
  // the app looked fine while `mount` never returned and `current` was never
  // assigned. Every later interaction then died on an undefined composition,
  // which is why tapping a note on iOS did nothing at all and reported nothing.
  // Losing the menubar must cost exactly the menubar, the same way losing
  // provenance does just above.
  try {
    nativeMenu = await installNativeMenu({
      run: (command) => menuApp().run(command),
      state: (command) => menuApp().commandState(command),
      openSettings: () => options.settingsPanel.open(),
      runTextService: (service: MacosTextServiceId) => {
        void invoke('perform_macos_text_service', { service }).catch((error) => {
          app.setStatus('error', `macOS text service unavailable — ${String(error)}`)
        })
      },
      ...(provenance === undefined ? {} : { provenance }),
    })
  } catch {
    // No menubar on this platform. Every command it carries is also reachable
    // from the toolbar and the context menu, so the document stays fully usable.
  }

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

/** Everything a catalog view can do, in one place so no mount can miss one. */
interface CatalogActions {
  readonly select: (id: string) => void
  readonly create: () => void
  readonly addFolder: () => void
  readonly selectCollection: (id: string) => void
  readonly togglePinned: (id: string) => boolean
  readonly copyText: (text: string) => Promise<void>
  readonly copyMarkdown: (id: string) => Promise<void>
  readonly duplicateNote: (id: string) => Promise<void>
  readonly exportNote: (id: string) => Promise<void>
  readonly saveNoteAs: (id: string) => Promise<void>
  readonly closeNote: (id: string) => Promise<void>
  readonly trashNote: (id: string) => Promise<void>
  readonly revealInFinder: (id: string) => Promise<void>
  readonly historyBack: () => void
  readonly historyForward: () => void
  readonly canHistoryBack: () => boolean
  readonly canHistoryForward: () => boolean
  readonly noteWalk: NoteWalk
  readonly folders: readonly WorkspaceCatalog[]
  readonly activeCollectionId: string
  readonly recentNotesCount: number
}

function catalogWorkspace(
  catalog: WorkspaceCatalog,
  activeNoteId: string,
  pins: WorkspacePins,
  actions: CatalogActions,
  /** Adds the row standing in for a new note that has no file yet. */
  draft = false,
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
    onSaveNoteAs: actions.saveNoteAs,
    onCloseNote: actions.closeNote,
    onTrashNote: actions.trashNote,
    onRevealInFinder: actions.revealInFinder,
    onHistoryBack: actions.historyBack,
    onHistoryForward: actions.historyForward,
    canHistoryBack: actions.canHistoryBack,
    canHistoryForward: actions.canHistoryForward,
    noteWalk: actions.noteWalk,
    notes: noteRows(catalog.notes, (handle) => pins.has(handle), { draft }),
  }
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
 * Bridges native document delivery without a launch race.
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
      controller.current().setStatus('error', `Could not receive the requested Markdown file — ${message}`)
    })
  }

  await listen<void>('open-note-requested', schedule)
  schedule()
}

/**
 * A Share extension has text rather than a Markdown file URL. It therefore
 * enters as the same unsaved draft a person creates in the app, and is removed
 * from the App Group only after the regular Save flow succeeds.
 */
async function installSharedTextDraftBridge(controller: NativeController): Promise<void> {
  try {
    const draft = await invoke<SharedTextDraft | null>('peek_shared_text_draft')
    if (draft !== null) controller.openSharedTextDraft(draft)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    controller.current().setStatus('error', `Could not receive shared text — ${message}`)
  }
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
  }).catch((error: unknown) => {
    // A shell that fails to start must say so. A rejected promise with no
    // handler leaves the window blank, and blank is indistinguishable from
    // hung — that is exactly how the 2026-08-17 notes-key failure presented.
    const message = error instanceof Error ? error.message : String(error)
    root.textContent = `SimpleMark could not start — ${message}`
  })
}
