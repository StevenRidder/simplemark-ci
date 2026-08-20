import type {
  AssetReferencePort,
  ClipboardPort,
  DiagramFixPort,
  DiagramRenderer,
  DocumentLinkPort,
  FilePort,
  ImageStorePort,
  NoteIdentity,
  ThreadStore,
} from '../application/index.js'
import {
  appendReply,
  codeFenceContent,
  markdownTableToCsv,
  markdownTableToHtml,
  markdownToPlainText,
  matchAnchor,
  detachThread,
  resolveThread,
} from '../domain/index.js'
import type { Anchor, Thread } from '../domain/index.js'
import { DocumentSession } from '../application/index.js'
import { MilkdownEditor } from '../adapters/editor/milkdown-editor.js'
import type { DiagramController } from '../adapters/editor/milkdown-editor.js'
import { createStepDocumentPort } from '../adapters/editor/step-document-port.js'
import { createWindowChrome } from './ui/window-chrome.js'
import { createFindBar } from './ui/find-bar.js'
import { renderNoteRail, renderNoteStack } from './ui/note-rail.js'
import { createAgentPanel } from './ui/agent-panel.js'
import { createActivityTimeline } from './ui/activity-timeline.js'
import { createAgentStatusLine } from './ui/agent-status-line.js'
import { AgentConversation } from './agent-conversation.js'
import type { ComposerMode } from './agent-conversation.js'
import { createAgentController } from './agent-controller.js'
import { createAgentEditTally } from './agent-edit-overlay.js'
import { createWedgeDetector } from './wedge-detector.js'
import type { AgentEditTally } from './agent-edit-overlay.js'
import { NEED_SELECTION } from '../adapters/editor/note-capture.js'
import { LocalThreadStore } from '../adapters/filesystem/local-thread-store.js'
import { noteKeyForPath } from '../adapters/filesystem/tauri-thread-store.js'
import type { EditorCommand } from './ui/window-chrome.js'
import { COMMANDS } from '../application/index.js'
import type {
  AgentProviderPort,
  BlockBoundaryPort,
  DocumentCommandId,
  StepDocumentPort,
} from '../application/index.js'
import type { WindowChrome } from './ui/window-chrome.js'
import type { SaveState } from './ui/window-chrome.js'
import type { WorkspaceOptions } from './ui/window-chrome.js'
import type { WorkspaceMode } from './ui/window-chrome.js'
import type { StylesBarPosition } from './ui/window-chrome.js'
import type { ChromeMode } from './ui/window-chrome.js'
import {
  DEFAULT_PREFERENCES,
  nextScale,
  normalisePreferences,
  preferenceVariables,
} from './reader-preferences.js'
import type { ReaderPreferences } from './reader-preferences.js'
import { loadUiPreferences, saveUiPreferences } from './ui-preferences.js'
import type { UiPreferences } from './ui-preferences.js'
import type { AppIconChoice, AppIconId } from './app-icons.js'
import type { UpdateStatus } from './update-status.js'
import { documentStatistics } from './document-statistics.js'

/**
 * The composition root shared by every shell (ADR-0001).
 *
 * This is the only place that knows both a concrete adapter and the application.
 * `browser.ts` and, later, `tauri.ts` supply platform ports and call
 * `composeApp`; neither contains a document or editor rule, so a feature cannot
 * work in one shell and not the other.
 *
 * The wiring below is the architectural claim of EDITOR-1: an editor keystroke
 * becomes a serialised document, which becomes a named DocumentTransaction
 * carrying the revision it was built against, which the session accepts or
 * refuses. The editor never reaches a file, and the UI never reaches the
 * document.
 */

export interface AppPorts {
  readonly file: FilePort
  readonly assets?: AssetReferencePort
  readonly links?: DocumentLinkPort
  readonly clipboard?: ClipboardPort
  readonly diagrams: DiagramRenderer
  readonly diagramFix?: DiagramFixPort
  /**
   * Supplies the top-level block offsets that let a save preserve untouched
   * blocks. Absent means every save re-serializes the whole document, which is
   * what happened before FIDELITY-1 and remains the honest fallback.
   */
  readonly blockBoundaries?: BlockBoundaryPort
  /** Absent in hosts that cannot keep images beside the note. */
  readonly images?: ImageStorePort
  /** Native notes store. Absent in the browser shell; bootstrap then uses localStorage. */
  readonly threads?: ThreadStore
  readonly identity?: NoteIdentity
}

export interface AppComposition {
  readonly element: HTMLElement
  readonly session: DocumentSession
  readonly editor: MilkdownEditor
  /** The editor-owned port that decodes, applies, and rebases opaque steps. */
  readonly steps: StepDocumentPort
  /**
   * §4 of the chip-chrome spec: the diagram verb surface, delegating to the
   * editor. Every verb answers `false` (or `null` for `kind()`) before the
   * editor mounts, the same honest-before-ready shape `run`/`commandState`
   * already keep.
   */
  readonly diagram: DiagramController
  /**
   * Notes surface for the rail, capture, and Playwright harness.
   *
   * Desktop injects `TauriThreadStore`. The browser harness keeps threads in
   * localStorage so a reload can prove the same promise.
   */
  readonly notes: {
    setThreadsForTest(threads: readonly Thread[]): void
    selectTextForTest(quote: string): boolean
    /** Optional NOTES-8 hook. Called after the editor receives the threads. */
    onThreadsForTest?: (threads: readonly Thread[]) => void
    /** Rewords the first occurrence of `from` so NOTES-9 can prove re-derivation. */
    replaceTextForTest(from: string, to: string): void
    /** Fresh anchors from each live decoration (NOTES-9). */
    currentAnchorsForTest(): Record<string, Anchor>
    /** Re-lists threads from the store (another device wrote them) and repaints. */
    reload(): Promise<void>
  }
  /**
   * The app-level agent conversation and its live run (ADR-0012, APP-32).
   *
   * The composition owns this rather than an entrypoint because both shells
   * need the identical surface, and because the write path has to stay behind
   * the one document authority in either.
   */
  readonly agent: {
    /** Opens or closes the panel. The only thing that may open it is a person. */
    toggle(): void
    isPanelOpen(): boolean
    /** Sends a composer message in the given mode. */
    send(mode: ComposerMode, markdown: string): void
    pause(): void
    resume(): void
    stop(): void
    isRunning(): boolean
    /** Whether the reader has opted into following the agent. */
    isFollowing(): boolean
    /** Opens or closes the Activity timeline. */
    toggleActivity(): void
    isActivityOpen(): boolean
    /**
     * Replaces the provider for a test.
     *
     * A test double in the same spirit as `notes.setThreadsForTest`: the six
     * exit behaviours are about the fence, the target resolver and the
     * surfaces, and a live model cannot be scripted into being ambiguous on
     * demand. The real provider path is covered by the adapter's own tests.
     */
    setProviderForTest(provider: AgentProviderPort | undefined): void
    /** Agent changes counted against each note this session. */
    editsForTest(): Readonly<Record<string, number>>
    /** Shows the wedge banner without starving anything (BUG-13 spec). */
    triggerWedgeBannerForTest(): void
  }
  /** Tears down the editor and presentation observers before remounting. */
  destroy(): Promise<void>
  /** Flushes any pending debounced save. `false` leaves the current document in place. */
  save(): Promise<boolean>
  /**
   * Brings the session up to date with the document on screen.
   *
   * The editor hands changes over on a debounce, so for a moment after the last
   * keystroke `session.snapshot()` still describes the previous document.
   * `save` already closes that gap for itself; this exists for the shell code
   * that *reads* the session to make a decision — is this draft untouched, what
   * do I put on the clipboard — because deciding on a stale snapshot throws away
   * whatever was typed last.
   */
  flushPendingChanges(): void
  /** Shows a truthful platform or file-reference limitation in the shell. */
  setStatus(state: SaveState, message: string): void
  /**
   * Runs any command in the shared registry.
   *
   * The macOS menubar is built from that registry and dispatches here, which is
   * what makes the menubar a complete command surface without owning a second
   * copy of the editing rules (application/commands.ts).
   */
  run(command: DocumentCommandId): void
  /** Runs a native context-menu export against the pre-AppKit selection. */
  runNativeContextCommand(command: DocumentCommandId): void
  /** Replaces one note row's subtitle in place, without reordering the list. */
  applyNoteSummary(handle: string, summary: string): void
  /** Adds an extracted note preview without reordering the visible list. */
  applyNotePreview(handle: string, preview: string): void
  /** Whether the optional styles bar is showing, for the View menu checkmark. */
  stylesBarVisible(): boolean
  /**
   * Reports an update check to the library footer.
   *
   * The check itself belongs to the platform entrypoint — only it knows whether
   * there is a bundle to update — so the composition root just forwards.
   */
  setUpdateStatus(status: UpdateStatus): void
  /** Current availability and checkmark state for any shared command surface. */
  commandState(command: DocumentCommandId): { readonly enabled: boolean; readonly checked: boolean }
  /** Reconciles shell catalog state while preserving the mounted editor and its selection. */
  reconcileWorkspace(workspace: WorkspaceOptions): void
}

export interface ComposeOptions {
  readonly ports: AppPorts
  readonly filePath: string
  /** Where reader preferences are read from and written to. Defaults to localStorage. */
  readonly preferenceStorage?: Pick<Storage, 'getItem' | 'setItem'>
  /** Native whole-webview magnification; separate from document text size. */
  readonly pageZoom?: {
    readonly current: () => number
    readonly set: (zoom: number) => void
    readonly preview: (zoom: number) => void
    readonly remember: (zoom: number) => void
  }
  /** Debounce for save-on-pause. Zero disables the timer so tests drive save directly. */
  readonly autosaveMs?: number
  /** Honest confirmation for platforms that save a downloaded replacement. */
  readonly saveSuccessMessage?: string
  /**
   * Persists an otherwise in-memory new document after an explicit Save. A
   * cancelled destination picker returns false, so callers never throw the
   * draft away while switching notes or closing the window.
   */
  readonly onSaveDraft?: (markdown: string) => Promise<boolean>
  /**
   * Renames the current durable document. The platform owns the filesystem
   * operation; the shared composition only flushes the current transaction
   * before asking it to do so.
   */
  readonly onRenameDocument?: (name: string) => Promise<boolean>
  /**
   * Whether the optional styles bar starts visible when nothing is stored yet.
   * The native shell passes `false`: its menubar already carries every command,
   * so the bar would open as pure duplication.
   */
  readonly stylesBarDefault?: boolean
  /** Platform hook for opening a real file; absent when the platform cannot. */
  readonly onOpenFile?: () => void
  /** Platform hook for opening the active Markdown folder; absent when the platform cannot. */
  readonly onOpenFolder?: () => void
  /**
   * Copies a large virtualised table through the host clipboard. The native
   * shell supplies NSPasteboard rather than making WKWebView marshal a large
   * payload on its UI thread.
   */
  readonly copyDeferredTable?: (markdown: string) => Promise<boolean>
  /**
   * `Copy image`'s shell-level clipboard write (figure-viewer-everywhere
   * spec §1 ruling 4) — the packaged app's native pasteboard, following the
   * same deferred-table-copy precedent above. Absent falls back to the web
   * `ClipboardItem` best-effort path.
   */
  readonly copyImage?: (png: Uint8Array) => Promise<boolean>
  /**
   * `Save image`'s native save dialog. Absent falls back to a canvas→blob
   * browser download.
   */
  readonly saveImage?: (bytes: Uint8Array, format: 'png' | 'svg', suggestedName: string) => Promise<boolean>
  /** Shown on the disabled open control when onOpenFile is absent. */
  readonly openFileUnavailableReason?: string
  /**
   * Platform hook for handing the rendered document to the operating system's
   * print service. Both shells have one — the browser's own `window.print()`
   * and, on macOS, the native print panel — so this is wiring, not a
   * capability the shells differ on. What both then print is decided entirely
   * by `styles/print.css`, never here.
   */
  readonly onPrint?: () => void
  /** Acts on an offered update. Absent where there is no bundle to replace. */
  readonly onUpdate?: () => void
  /** Shared navigation supplied by the platform composition root. */
  readonly workspace?: WorkspaceOptions
  /** Which platform owns the application chrome around the shared workspace. */
  readonly chromeMode?: ChromeMode
  /** Native application icon capability; omitted by browser composition. */
  readonly appIcon?: AppIconId
  readonly appIconChoices?: readonly AppIconChoice[]
  readonly onAppIconChange?: (icon: AppIconId) => Promise<void>
  /** Supplies caret context before macOS opens WebKit's native right-click menu. */
  readonly onNativeContextMenu?: (
    shape: { readonly inTable: boolean; readonly inCode: boolean },
  ) => void
  /**
   * Passed straight through to `MilkdownEditor.mount` — see its own doc for
   * what "selection change" covers. The native shell is the one caller today:
   * the Format → Diagram submenu needs to repaint on this, not only on its
   * own commands running (final review Finding 1).
   */
  readonly onSelectionChange?: () => void
  /**
   * The configured document agent, read fresh per run (APP-32).
   *
   * A function, not a value: credentials are entered in Settings while the app
   * is running, and a provider captured at composition time would stay
   * unconfigured for the rest of the session. Returning undefined is the honest
   * "no agent here", which the panel states rather than hides.
   */
  readonly agentProvider?: () => AgentProviderPort | undefined
  /** Opens the platform's Settings surface from the panel's own prompt. */
  readonly onOpenSettings?: () => void
  /**
   * Relaunches the app, for the wedge banner's Restart (BUG-13). Absent falls
   * back to reloading the page, which is what the browser shell can do.
   */
  readonly onRelaunch?: () => void
  /**
   * Agent-edit counts per note, owned by the entrypoint so they survive the
   * remount that every note open performs. Absent gets a per-mount tally, which
   * is only correct for a shell that does not remount.
   */
  readonly agentEdits?: AgentEditTally
  /**
   * The id the note list uses for the open note, when it is not the handle.
   *
   * Row identity belongs to the shell. The native shell keys rows by the
   * canonical path, which is also the document handle, so it passes nothing. The
   * browser shell keys its demo rows by a fixture id while the port answers
   * `fixture:<name>` — counting against the handle there files every agent edit
   * under a key no row has, and the marker never appears.
   */
  readonly noteRowId?: () => string
}

const STYLES_BAR_KEY = 'simplemark.styles-bar-visible'
const STYLES_BAR_POSITION_KEY = 'simplemark.styles-bar-position'
const WORKSPACE_MODE_KEY = 'simplemark.workspace-mode'

/**
 * §4 of the chip-chrome spec: the Format → Diagram submenu ids, and the two
 * refinements past "a diagram block is selected" that `commandState` applies
 * — float needs `svg` or a `generated` diagram (refused on `math` and the
 * paste-exhaust `text` kind alike), zoom needs a `generated` diagram.
 */
const DIAGRAM_COMMAND_IDS: ReadonlySet<DocumentCommandId> = new Set([
  'diagramEditSource',
  'diagramOpenFigure',
  'diagramFloatLeft',
  'diagramFloatRight',
  'diagramFloatInline',
  'diagramDelete',
  'diagramZoomIn',
  'diagramZoomOut',
  'diagramZoomReset',
])
const DIAGRAM_FLOAT_COMMAND_IDS: ReadonlySet<DocumentCommandId> = new Set([
  'diagramFloatLeft',
  'diagramFloatRight',
  'diagramFloatInline',
])
const DIAGRAM_ZOOM_COMMAND_IDS: ReadonlySet<DocumentCommandId> = new Set([
  'diagramZoomIn',
  'diagramZoomOut',
  'diagramZoomReset',
])

export async function composeApp(options: ComposeOptions): Promise<AppComposition> {
  const { ports } = options
  const stepAdapter = await createStepDocumentPort()
  const session = await DocumentSession.open(ports.file, ports.blockBoundaries, stepAdapter.port)

  // Reader preferences are app state, never document content (D6). They are
  // applied to the document root so one multiplier and one palette drive the
  // whole page rather than any selection.
  const storage = options.preferenceStorage ?? readPreferenceStorage()
  const stylesBarKey = `${STYLES_BAR_KEY}.${options.chromeMode ?? 'web'}`
  const stylesBarPositionKey = `${STYLES_BAR_POSITION_KEY}.${options.chromeMode ?? 'web'}`
  let preferences = loadPreferences(storage)
  let uiPreferences: UiPreferences = loadUiPreferences(storage)
  let workspaceMode = singlePaneWorkspaceMode(options.workspace) ?? loadWorkspaceMode(storage)
  // A phone has no View menu to reach the styles bar from, so iOS always
  // starts with it visible when nothing is stored yet; the persisted
  // preference still wins once the reader has toggled it themselves.
  const stylesBarDefault = options.chromeMode === 'ios' ? true : (options.stylesBarDefault ?? true)
  let stylesBarVisible = loadStylesBarVisible(storage, stylesBarKey, stylesBarDefault)
  let stylesBarPosition = loadStylesBarPosition(storage, stylesBarPositionKey)
  applyPreferences(preferences)

  let editor: MilkdownEditor | undefined
  let paintNotes = (): void => {}
  let nativeContextSelection: ReturnType<MilkdownEditor['contextSelection']> | undefined
  let nativeNoteRange: ReturnType<MilkdownEditor['selectionRange']> = undefined
  let captureNote = async (): Promise<void> => {}
  let chrome: WindowChrome
  /**
   * Routes a registry id to whoever executes it (application/commands.ts).
   *
   * This is the single dispatch both shells share: the web toolbar, the styles
   * bar, and the macOS menubar all arrive here, so a command can never mean two
   * different things in two shells. Adding a surface is wiring; adding a
   * command is a registry entry plus one case.
  */
  function runCommand(id: DocumentCommandId): void {
    if (!commandState(id).enabled) return
    if (COMMANDS[id].target === 'editor') {
      // Async and interactive, so it cannot be a plain forwarded command.
      if (id === 'convertToDiagram') {
        // A refusal carries the reason the block did not convert — an empty
        // block, unrecognised source, or a renderer that failed. Dropping it
        // left the command looking broken rather than declined (§4.4 rule 3).
        void editor?.convertBlockToDiagram().then(
          (result) => {
            if (!result.ok) chrome.setStatus('error', `Not converted — ${result.reason}`)
          },
          // The method guards its render gate, but building or dispatching the
          // transaction can still throw — and in an async method that arrives
          // here as a rejection. Saying so is the whole point of the command.
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            chrome.setStatus('error', `Not converted — ${message}`)
          },
        )
        return
      }
      // §4 of the chip-chrome spec: these route to the diagram controller —
      // the one behavior surface the chips and the app API also call —
      // rather than the editor's own EditorCommandName switch.
      switch (id) {
        case 'diagramEditSource':
          editor?.diagram.editSource()
          return
        case 'diagramOpenFigure':
          editor?.diagram.openFigure()
          return
        case 'diagramFloatLeft':
          editor?.diagram.setFloat('left')
          return
        case 'diagramFloatRight':
          editor?.diagram.setFloat('right')
          return
        case 'diagramFloatInline':
          editor?.diagram.setFloat(null)
          return
        case 'diagramDelete':
          editor?.diagram.delete()
          return
        case 'diagramZoomIn':
          editor?.diagram.zoomIn()
          return
        case 'diagramZoomOut':
          editor?.diagram.zoomOut()
          return
        case 'diagramZoomReset':
          editor?.diagram.zoomReset()
          return
      }
      editor?.runCommand(id as Parameters<MilkdownEditor['runCommand']>[0])
      return
    }

    switch (id) {
      case 'openFile':
        options.onOpenFile?.()
        return
      case 'openFolder':
        options.onOpenFolder?.()
        return
      case 'newNote':
        options.workspace?.onCreateNote?.()
        return
      case 'save':
        void save(true)
        return
      case 'saveAs':
        void options.workspace?.onSaveNoteAs?.(options.workspace?.activeNoteId ?? '')
        return
      case 'print':
        options.onPrint?.()
        return
      case 'moveToTrash':
        void options.workspace?.onTrashNote?.(options.workspace?.activeNoteId ?? '')
        return
      case 'insertAsset':
        void insertAsset()
        return
      case 'copyAsMarkdown':
      case 'copyAsPlainText':
      case 'copyAsRichText':
      case 'copyAsHtml':
      case 'copyCode':
      case 'copyTableAsMarkdown':
      case 'copyTableAsHtml':
      case 'copyTableAsCsv':
        void copySelection(id)
        return
      case 'addNote':
        void captureNote()
        return
      case 'pasteAsPlainText':
        void pasteAsPlainText()
        return
      case 'find':
        findBar.open()
        return
      case 'toggleStatistics':
        chrome.toggleInfoTab('statistics')
        return
      case 'contents':
        chrome.toggleInfoTab('contents')
        return
      case 'toggleWordCount':
        chrome.toggleWordCount()
        return
      case 'toggleStylesBar':
        chrome.toggleStylesBar()
        return
      case 'toggleHistoryNavigation':
        chrome.toggleHistoryNavigation()
        return
      case 'showAllPanes':
        chrome.setWorkspaceMode('all')
        return
      case 'showNotesAndEditor':
        chrome.setWorkspaceMode('notes')
        return
      case 'showEditorOnly':
        chrome.setWorkspaceMode('editor')
        return
      case 'togglePinned':
        chrome.togglePinned(options.workspace?.activeNoteId ?? '')
        return
      case 'historyBack':
        options.workspace?.onHistoryBack?.()
        return
      case 'historyForward':
        options.workspace?.onHistoryForward?.()
        return
      case 'previousNote':
        chrome.stepNote(-1)
        return
      case 'nextNote':
        chrome.stepNote(1)
        return
      case 'previewSmall':
        chrome.setPreviewDensity('small')
        return
      case 'previewMedium':
        chrome.setPreviewDensity('medium')
        return
      case 'previewLarge':
        chrome.setPreviewDensity('large')
        return
      case 'hideAttachments':
        return
      case 'sortByModified':
        chrome.setNotesSort('modified')
        return
      case 'sortByCreated':
        chrome.setNotesSort('created')
        return
      case 'sortByTitle':
        chrome.setNotesSort('title')
        return
      case 'toggleNewestOnTop':
        chrome.toggleNewestOnTop()
        return
      case 'sortFoldersByTitle':
        chrome.setFoldersSort('title')
        return
      case 'sortFoldersByCount':
        chrome.setFoldersSort('count')
        return
      case 'toggleFoldersAtoZ':
        chrome.toggleFoldersAtoZ()
        return
      case 'zoomIn':
        setPreferences({ ...preferences, scale: nextScale(preferences.scale, 'up') })
        return
      case 'zoomOut':
        setPreferences({ ...preferences, scale: nextScale(preferences.scale, 'down') })
        return
      case 'actualSize':
        setPreferences({ ...preferences, scale: 1 })
        options.pageZoom?.set(1)
        return
      case 'toggleFirstLineIndent':
        setPreferences({
          ...preferences,
          indent: preferences.indent === 'first-line' ? 'none' : 'first-line',
        })
        return
    }

    const readerChange = READER_COMMANDS[id]
    if (readerChange !== undefined) setPreferences({ ...preferences, ...readerChange })
  }

  /**
   * The View menu's typography commands, as the preference each one sets.
   *
   * A table rather than twenty switch cases: every entry is the same shape, so
   * a lookup states the rule once and cannot drift into twenty near-copies.
   */
  const READER_COMMANDS: Partial<Record<DocumentCommandId, Partial<ReaderPreferences>>> = {
    themeWhite: { theme: 'white' },
    themeTan: { theme: 'tan' },
    themeNight: { theme: 'night' },
    fontIowan: { family: 'serif' },
    fontGeorgia: { family: 'literata' },
    fontSystem: { family: 'sans' },
    fontMono: { family: 'mono' },
    widthNarrow: { width: 'narrow' },
    widthNormal: { width: 'normal' },
    widthWide: { width: 'wide' },
    leadingTight: { leading: 'tight' },
    leadingNormal: { leading: 'normal' },
    leadingOpen: { leading: 'open' },
    spacingCompact: { spacing: 'compact' },
    spacingNormal: { spacing: 'normal' },
    spacingAiry: { spacing: 'airy' },
  }

  /** Applies, persists, and repaints — the one path preference changes take. */
  function setPreferences(next: ReaderPreferences): void {
    preferences = next
    applyPreferences(next)
    savePreferences(storage, next)
    chrome.setPreferences(next)
  }

  function commandState(id: DocumentCommandId): { enabled: boolean; checked: boolean } {
    const modeFor = (command: DocumentCommandId): WorkspaceMode | undefined => {
      if (command === 'showAllPanes') return 'all'
      if (command === 'showNotesAndEditor') return 'notes'
      if (command === 'showEditorOnly') return 'editor'
      return undefined
    }
    const requestedMode = modeFor(id)
    if (requestedMode !== undefined) {
      return {
        enabled: options.workspace !== undefined,
        checked: options.workspace !== undefined && chrome.workspaceMode() === requestedMode,
      }
    }
    if (id === 'openFolder') return { enabled: options.onOpenFolder !== undefined, checked: false }
    if (id === 'openFile') return { enabled: options.onOpenFile !== undefined, checked: false }
    if (id === 'print') return { enabled: options.onPrint !== undefined, checked: false }
    if (id === 'insertAsset') return { enabled: ports.assets !== undefined, checked: false }
    if (id === 'newNote') return { enabled: options.workspace?.onCreateNote !== undefined, checked: false }
    if (id === 'togglePinned') {
      const active = options.workspace?.notes.find((note) => note.id === options.workspace?.activeNoteId)
      return {
        enabled: options.workspace?.onTogglePinned !== undefined && active !== undefined,
        checked: active === undefined ? false : chrome.isPinned(active.id),
      }
    }
    if (id === 'saveAs') {
      const active = options.workspace?.notes.find((note) => note.id === options.workspace?.activeNoteId)
      return { enabled: options.workspace?.onSaveNoteAs !== undefined && active !== undefined, checked: false }
    }
    if (id === 'moveToTrash') {
      const active = options.workspace?.notes.find((note) => note.id === options.workspace?.activeNoteId)
      return { enabled: options.workspace?.onTrashNote !== undefined && active !== undefined, checked: false }
    }
    // A greyed-out Back is the honest answer when there is nowhere behind you,
    // and the menubar is where most people will discover these exist at all.
    if (id === 'historyBack') {
      return { enabled: options.workspace?.canHistoryBack?.() === true, checked: false }
    }
    if (id === 'historyForward') {
      return { enabled: options.workspace?.canHistoryForward?.() === true, checked: false }
    }
    if (id === 'previousNote' || id === 'nextNote') {
      // Two notes is the smallest list with a previous and a next in it.
      const notes = options.workspace?.notes.length ?? 0
      return { enabled: options.workspace?.onSelectNote !== undefined && notes > 1, checked: false }
    }
    if (id === 'toggleStylesBar') return { enabled: true, checked: chrome.stylesBarVisible() }
    if (id === 'toggleWordCount') return { enabled: true, checked: chrome.wordCountVisible() }
    if (id === 'toggleStatistics') return { enabled: true, checked: chrome.infoTab() === 'statistics' }
    if (id === 'contents') return { enabled: true, checked: chrome.infoTab() === 'contents' }
    if (id === 'toggleHistoryNavigation') {
      return { enabled: true, checked: chrome.historyNavigationVisible() }
    }

    // §4 of the chip-chrome spec: enabled only while a diagram block is
    // selected, refined by which verbs that diagram's kind supports — float
    // is unavailable on `math`, zoom needs a `generated` diagram.
    if (DIAGRAM_COMMAND_IDS.has(id)) {
      const kind = editor?.diagram.kind() ?? null
      if (kind === null) return { enabled: false, checked: false }
      // Final review Finding 2: float (and, by the identical rule,
      // `MilkdownEditor#diagram.setWidth`) only ever acts on svg or a
      // zoomable generated diagram. `kind === 'math'` alone used to be the
      // whole check, back when 'math' was the only kind besides those two —
      // now that a paste-exhaust text card (json, ansi, …) is its own 'text'
      // kind rather than falling through to 'generated', it needs the same
      // refusal math already got.
      if (DIAGRAM_FLOAT_COMMAND_IDS.has(id) && kind !== 'svg' && kind !== 'generated') {
        return { enabled: false, checked: false }
      }
      if (DIAGRAM_ZOOM_COMMAND_IDS.has(id) && kind !== 'generated') return { enabled: false, checked: false }
      return { enabled: true, checked: false }
    }

    // Reader typography: always available, since the document is always there.
    // Each entry is a thunk rather than a value — building the whole table
    // eagerly would read note-list state on the way to answering about `bold`,
    // and the chrome is not necessarily built when the first question arrives.
    const readerChecks: Partial<Record<DocumentCommandId, () => boolean>> = {
      themeWhite: () => preferences.theme === 'white',
      themeTan: () => preferences.theme === 'tan',
      themeNight: () => preferences.theme === 'night',
      fontIowan: () => preferences.family === 'serif',
      fontGeorgia: () => preferences.family === 'literata',
      fontSystem: () => preferences.family === 'sans',
      fontMono: () => preferences.family === 'mono',
      widthNarrow: () => preferences.width === 'narrow',
      widthNormal: () => preferences.width === 'normal',
      widthWide: () => preferences.width === 'wide',
      leadingTight: () => preferences.leading === 'tight',
      leadingNormal: () => preferences.leading === 'normal',
      leadingOpen: () => preferences.leading === 'open',
      spacingCompact: () => preferences.spacing === 'compact',
      spacingNormal: () => preferences.spacing === 'normal',
      spacingAiry: () => preferences.spacing === 'airy',
      toggleFirstLineIndent: () => preferences.indent === 'first-line',
    }
    const readerCheck = readerChecks[id]
    if (readerCheck !== undefined) return { enabled: true, checked: readerCheck() }

    // Zoom stops where the curated steps stop, so the menu says when a further
    // step is not on offer instead of appearing to do nothing.
    if (id === 'zoomIn') {
      return { enabled: nextScale(preferences.scale, 'up') !== preferences.scale, checked: false }
    }
    if (id === 'zoomOut') {
      return { enabled: nextScale(preferences.scale, 'down') !== preferences.scale, checked: false }
    }
    if (id === 'actualSize') {
      return {
        enabled: preferences.scale !== 1 || (options.pageZoom?.current() ?? 1) !== 1,
        checked: false,
      }
    }

    // Note-list view state needs a note list. Without a catalog these describe
    // nothing, so they are visibly unavailable rather than quietly inert.
    const noteListChecks: Partial<Record<DocumentCommandId, () => boolean>> = {
      previewSmall: () => chrome.previewDensity() === 'small',
      previewMedium: () => chrome.previewDensity() === 'medium',
      previewLarge: () => chrome.previewDensity() === 'large',
      sortByModified: () => chrome.notesSort() === 'modified',
      sortByCreated: () => chrome.notesSort() === 'created',
      sortByTitle: () => chrome.notesSort() === 'title',
      toggleNewestOnTop: () => chrome.newestOnTop(),
    }
    const noteListCheck = noteListChecks[id]
    if (noteListCheck !== undefined) {
      // Sorting by a date the catalog never reported would silently do nothing,
      // so the order that cannot be produced is the one that goes grey.
      const notes = options.workspace?.notes
      const stamped = (of: 'createdAt' | 'updatedAt'): boolean =>
        notes !== undefined && notes.every((note) => note[of] !== undefined)
      const available =
        id === 'sortByCreated'
          ? stamped('createdAt')
          : id === 'sortByModified' || id === 'toggleNewestOnTop'
            ? stamped('updatedAt')
            : notes !== undefined
      return { enabled: available, checked: noteListCheck() }
    }
    if (id === 'hideAttachments') {
      // SimpleMark links files rather than embedding them, so there is nothing
      // to hide. Named and unavailable, matching Bear's own disabled row.
      return { enabled: false, checked: false }
    }
    if (id === 'sortFoldersByTitle') return { enabled: false, checked: chrome.foldersSort() === 'title' }
    if (id === 'sortFoldersByCount') return { enabled: false, checked: chrome.foldersSort() === 'count' }
    if (id === 'toggleFoldersAtoZ') return { enabled: false, checked: chrome.foldersAtoZ() }

    return { enabled: true, checked: false }
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const autosaveMs = options.autosaveMs ?? 900
  const save = async (force = false): Promise<boolean> => {
    clearTimeout(saveTimer)
    // The editor hands changes over on a debounce, so the session can be a
    // couple of hundred milliseconds behind the document on screen. Saving what
    // the session happens to hold would drop the last thing typed and still say
    // "Saved" — worst of all on the save that runs while closing a note.
    editor?.flushPendingChanges()

    if (options.onSaveDraft !== undefined) {
      try {
        const saved = await options.onSaveDraft(session.snapshot().markdown)
        if (!saved) chrome.setStatus('dirty', 'Not saved')
        return saved
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        chrome.setStatus('error', `Not saved — ${message}`)
        return false
      }
    }

    const result = await session.save(force)
    if (result.ok) {
      chrome.setStatus('saved', options.saveSuccessMessage)
      return true
    }
    chrome.setStatus('error', `Not saved — ${result.reason}`)
    return false
  }

  const renameDocument = async (name: string): Promise<boolean> => {
    editor?.flushPendingChanges()
    const result = await session.save()
    if (!result.ok) {
      chrome.setStatus('error', `Not renamed — ${result.reason}`)
      return false
    }
    try {
      return await options.onRenameDocument?.(name) ?? false
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      chrome.setStatus('error', `Not renamed — ${message}`)
      return false
    }
  }

  chrome = createWindowChrome({
    chromeMode: options.chromeMode ?? 'web',
    // Only a person opens the conversation (ADR-0012). A shell with no agent
    // capability gets no control, rather than a control that does nothing.
    ...(options.agentProvider === undefined ? {} : {
      // One side slot, one occupant. Both panels pin to the same corner at the
      // same width, so two open at once put one of them on top of the other's
      // close button — a box with no visible way out.
      onToggleAgent: () => toggleAgentPanel(),
      onToggleActivity: () => toggleActivityPanel(),
    }),
    fileName: session.name,
    filePath: options.filePath,
    onOpenFile: options.onOpenFile,
    openFileUnavailableReason: options.openFileUnavailableReason,
    workspace: options.workspace,
    initialWorkspaceMode: workspaceMode,
    onWorkspaceModeChange: (mode) => {
      workspaceMode = mode
      saveWorkspaceMode(storage, mode)
    },
    uiPreferences,
    onUiPreferencesChange: (next) => {
      uiPreferences = next
      saveUiPreferences(storage, next)
    },
    ...(options.appIcon === undefined
      || options.appIconChoices === undefined
      || options.onAppIconChange === undefined
      ? {}
      : {
          appIcon: options.appIcon,
          appIconChoices: options.appIconChoices,
          onAppIconChange: options.onAppIconChange,
        }),
    onSave: () => void save(true),
    ...(options.onRenameDocument === undefined ? {} : { onRenameDocument: renameDocument }),
    onInsertAsset: ports.assets === undefined
      ? undefined
      : () => void insertAsset(),
    stylesBarVisible,
    onStylesBarVisibleChange: (visible) => {
      stylesBarVisible = visible
      saveStylesBarVisible(storage, stylesBarKey, visible)
    },
    stylesBarPosition,
    onStylesBarPositionChange: (position) => {
      stylesBarPosition = position
      saveStylesBarPosition(storage, stylesBarPositionKey, position)
    },
    preferences,
    onPreferences: (next) => {
      preferences = next
      applyPreferences(next)
      savePreferences(storage, next)
    },
    // Measured from the session rather than the editor: the session is the one
    // that knows what the document currently is.
    getStatistics: () => documentStatistics(session.snapshot().markdown),
    onUpdate: options.onUpdate,
    onClipboardExport: ports.clipboard === undefined
      ? undefined
      : (command) => runCommand(command as DocumentCommandId),
    onAddNote: () => {
      void captureNote()
    },
    // The same pure predicates the exports use, so the menu can never offer an
    // item that the command would then refuse.
    getSelectionShape: () => {
      const markdown = editor?.selectionMarkdown() ?? ''
      return {
        inTable: markdownTableToCsv(markdown) !== null,
        inCode: codeFenceContent(markdown) !== null,
        hasSelection: editor?.selectionRange() !== undefined,
      }
    },
    // Cheap enough to run on every selection change (every keystroke, since
    // typing moves the selection) — unlike `getSelectionShape`, which
    // serializes the selection to Markdown and is reserved for menus.
    hasSelection: () => editor?.selectionRange() !== undefined,
    // Wired for the macOS chrome even when the platform IPC callback is
    // absent — the `?chrome=macos` browser override mounts the real listener
    // path, and a capture that silently does not run there is a path no test
    // can see (BUG-11 shipped through exactly that blindness).
    ...(options.onNativeContextMenu === undefined && options.chromeMode !== 'macos'
      ? {}
      : {
          onNativeSelection: (target: Node | null) => {
            nativeContextSelection = editor?.contextSelection(target)
            nativeNoteRange = editor?.selectionRange()
          },
          onNativeContextMenu: (
            shape: { readonly inTable: boolean; readonly inCode: boolean },
            _target: Node | null,
          ) => {
            // Shape only. This also captured the selection, which put a
            // block's markdown+HTML serialization on every block the pointer
            // crossed (BUG-11); the right-click gesture itself captures via
            // `onNativeSelection`, before AppKit opens the menu.
            options.onNativeContextMenu?.(shape)
          },
        }),
    onContinueWriting: () => editor?.continueAfterLastBlock(),
    // The temporary contents popover (EDITOR-3) reads the outline fresh on
    // every open and navigates through the editor — the chrome itself never
    // holds document state.
    getOutline: () => editor?.outline() ?? [],
    onNavigate: (pos) => editor?.navigateToHeading(pos),
    onCommand: (command: EditorCommand) => runCommand(command),
  })

  editor = await MilkdownEditor.mount({
    mount: chrome.editorHost,
    initialMarkdown: session.snapshot().markdown,
    renderer: ports.diagrams,
    ...(ports.clipboard === undefined ? {} : { clipboard: ports.clipboard }),
    ...(ports.diagramFix === undefined ? {} : { diagramFix: ports.diagramFix }),
    // Always wired, not just when a caller (Tauri's native-menu repaint)
    // supplies one: the styles bar's Add Note button needs this same signal
    // on every platform, browser tests included. This fires from the
    // ProseMirror plugin `update` in milkdown-editor.ts, after `view.state`
    // already has the new selection — including one that arrived through the
    // DOM (a touch handle drag), which is why it replaces reading the
    // browser's own `selectionchange` event in window-chrome.ts.
    onSelectionChange: () => {
      chrome.stylesBarSelectionChanged()
      options.onSelectionChange?.()
    },
    ...(options.copyImage === undefined ? {} : { copyImage: options.copyImage }),
    ...(options.saveImage === undefined ? {} : { saveImage: options.saveImage }),
    onCopyDeferredTable: async (source) => {
      try {
        if (options.copyDeferredTable !== undefined) return await options.copyDeferredTable(source)
        return await (ports.clipboard?.write({ 'text/plain': source }) ?? Promise.resolve(false))
      } catch {
        return false
      }
    },
    ...(ports.links === undefined ? {} : {
      onOpenLink: async (href: string) => {
          try {
            await ports.links!.open(session.documentHandle(), href)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            chrome.setStatus('error', `Could not open link — ${message}`)
          }
        },
    }),
    // The document handle is bound at call time, not at construction: the open
    // note changes under a long-lived port, and a handle captured once would
    // resolve every later capture against whichever note was open at startup.
    ...(ports.images === undefined ? {} : {
      images: {
        store: (url: string) => ports.images!.store(session.documentHandle(), url),
        read: (href: string) => ports.images!.read(session.documentHandle(), href),
      },
    }),
    onMarkdownChanged: (markdown, steps) => {
      const before = session.snapshot()
      const result = session.acceptEditorSteps({
        actorId: 'human',
        name: 'Edit',
        baseVersion: before.revision,
        steps,
        markdown,
      })

      if (!result.ok) {
        // The editor raced the session. Say so rather than pretending the edit
        // landed; the live-agent deliverable is what makes this recoverable.
        chrome.setStatus('error', 'Edit refused — document moved underneath the editor')
        return
      }

      chrome.setStatus('dirty')
      chrome.refreshStatistics()
      paintNotes()
      if (autosaveMs > 0 && options.onSaveDraft === undefined) {
        // Debounced save on pause, never per keystroke (DESIGN.md §8).
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => void save(), autosaveMs)
      }
    },
  })

  // First paint of Add Note against whatever the editor mounted with — a
  // reopened note can already carry a selection, and `onSelectionChange`
  // only fires on a later change, not on mount.
  chrome.stylesBarSelectionChanged()

  chrome.refreshStatistics()
  if (uiPreferences.infoTab !== null) chrome.openInfoTab(uiPreferences.infoTab)

  // In-document find (EDITOR-7): a temporary overlay in the editor section,
  // never a titlebar control. Cmd/Ctrl+F opens it wherever focus is inside the
  // app; the browser's own page-find is deliberately overridden because the
  // page IS the document.
  const findBar = createFindBar({
    onQuery: (query) => editor?.setFindQuery(query) ?? { count: 0, active: -1 },
    onStep: (direction) => editor?.findStep(direction) ?? { count: 0, active: -1 },
  })
  chrome.editorHost.parentElement?.append(findBar.element)
  chrome.element.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      findBar.open()
    }
  })

  /**
   * The one implementation of each side-panel toggle.
   *
   * There were two — the titlebar's and the composition's own surface — and the
   * mutual-exclusion rule was added to only one of them, so the same action
   * behaved differently depending on which path reached it. A rule that lives in
   * one of two copies is a rule that is already broken.
   */
  const toggleAgentPanel = (): void => {
    if (!agentPanel.isOpen()) {
      activityTimeline.close()
      // The document-information panel shares the corner too, and it was left
      // out of this rule — which is how Statistics ended up sitting on top of
      // another panel, burying its close control.
      chrome.closeInfoTab()
    }
    agentPanel.toggle()
    chrome.setAgentOpen(agentPanel.isOpen())
  }
  const toggleActivityPanel = (): void => {
    if (!activityTimeline.isOpen()) {
      agentPanel.close()
      chrome.closeInfoTab()
    }
    activityTimeline.toggle()
    chrome.setActivityOpen(activityTimeline.isOpen())
  }

  /**
   * Escape closes the open side surface.
   *
   * A close button is a target you have to find and hit; Escape is the way out
   * of a panel that people already try first. Registered on the chrome rather
   * than the document so it cannot fight the editor's own key handling, and it
   * closes one surface per press, nearest-first.
   */
  const onSidePanelEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    if (activityTimeline.isOpen()) {
      activityTimeline.close()
      event.stopPropagation()
      return
    }
    if (agentPanel.isOpen()) {
      agentPanel.close()
      event.stopPropagation()
    }
    // Deliberately not the notes rail. Escape closes surfaces a person opened;
    // the rail appears on its own because something is unresolved, and hiding it
    // by a keystroke aimed at something else is how a reader loses their notes
    // without knowing they did. Its own × is the way to dismiss it.
  }

  // ---- the wedge detector (BUG-13) ----
  // The renderer can starve behind an external accessibility client's queries
  // for as long as the app lives, with nothing on screen saying so. The page
  // can observe its own starvation — rAF frames arriving seconds apart on an
  // idle, visible document — and must say so out loud, with the recovery
  // attached. A wedge only a diagnostician can see is a hidden failure.
  const wedgeDetector = createWedgeDetector()
  let wedgeBanner: HTMLElement | undefined
  let wedgeDismissedAt = 0
  const showWedgeBanner = (): void => {
    if (wedgeBanner !== undefined) return
    if (Date.now() - wedgeDismissedAt < 300_000) return
    const banner = document.createElement('div')
    banner.className = 'sm-wedge-banner'
    banner.setAttribute('role', 'alert')
    const text = document.createElement('span')
    text.textContent =
      'Something outside SimpleMark is overloading this document — the window may be freezing. Restarting clears it.'
    const restart = document.createElement('button')
    restart.type = 'button'
    restart.dataset['action'] = 'wedge-restart'
    restart.textContent = 'Restart SimpleMark'
    restart.addEventListener('click', () => {
      if (options.onRelaunch !== undefined) options.onRelaunch()
      else window.location.reload()
    })
    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.dataset['action'] = 'wedge-dismiss'
    dismiss.setAttribute('aria-label', 'Dismiss')
    dismiss.textContent = '×'
    dismiss.addEventListener('click', () => {
      wedgeDismissedAt = Date.now()
      wedgeDetector.reset()
      banner.remove()
      wedgeBanner = undefined
    })
    banner.append(text, restart, dismiss)
    chrome.element.prepend(banner)
    wedgeBanner = banner
  }
  let wedgeRaf = 0
  const wedgeFrame = (now: number): void => {
    if (wedgeDetector.observeFrame(now, !document.hidden)) showWedgeBanner()
    wedgeRaf = requestAnimationFrame(wedgeFrame)
  }
  wedgeRaf = requestAnimationFrame(wedgeFrame)
  const onWedgeInput = (): void => wedgeDetector.observeInput(performance.now())
  chrome.element.addEventListener('keydown', onWedgeInput, true)
  chrome.element.addEventListener('pointerdown', onWedgeInput, true)

  const noteRailHost = document.createElement('div')
  noteRailHost.className = 'sm-note-rail-host'
  const noteStackHost = document.createElement('div')
  noteStackHost.className = 'sm-note-stack-host'
  const documentSurface = chrome.editorHost.closest('.document-surface')
  documentSurface?.append(noteRailHost, noteStackHost)

  // ---- the agent in the document (APP-32) ----
  // The status line sits on the document surface, and the panel beside it, so a
  // reader with the panel closed still sees a run — which is the whole reason
  // ADR-0012 keeps the two surfaces separate rather than folding the status
  // into the conversation.
  let agentProvider = options.agentProvider
  // Owned by the entrypoint, because a mount does not live long enough: opening
  // a note rebuilds this whole composition, and the marker's whole job is to
  // report an edit to a note the reader is not looking at.
  const agentEdits = options.agentEdits ?? createAgentEditTally()
  const conversation = new AgentConversation()

  const agentStatus = createAgentStatusLine({
    pause: () => agentController.pause(),
    resume: () => agentController.resume(),
    stop: () => agentController.stop(),
    follow: (range) => editor?.reveal(range.from),
  })
  documentSurface?.prepend(agentStatus.host)

  const agentPanel = createAgentPanel({
    onClosed: () => chrome.setAgentOpen(false),
    conversation,
    renderMarkdown: (markdown) => stepAdapter.renderMarkdown(markdown),
    onSend: (mode, markdown) => agentController.send(mode, markdown),
    onAnswerQuestion: (occurrence) => agentController.answerQuestion(occurrence),
    isConfigured: () => agentProvider?.() !== undefined,
    onOpenSettings: () => options.onOpenSettings?.(),
  })
  // Inside the document pane, not the window: `position: absolute` with no
  // positioned ancestor resolves against the viewport, and the panel escaped the
  // app window's own frame — overhanging its right edge and running past its
  // rounded bottom. `.document-surface` is the positioned ancestor that also
  // scopes it to the surface it belongs beside.
  documentSurface?.append(agentPanel.host)
  chrome.element.addEventListener('keydown', onSidePanelEscape)

  /**
   * Where each accepted agent change landed, by transaction id.
   *
   * The session sequences opaque steps and cannot say where one applied; the
   * run knows, because the authority scoped it. Recorded here so the timeline
   * can offer Jump to on the rows it can actually jump to.
   */
  const agentChangePositions = new Map<string, number>()

  const activityTimeline = createActivityTimeline({
    onClosed: () => chrome.setActivityOpen(false),
    history: () => session.history(),
    humanActor: 'human',
    positionOf: (id) => agentChangePositions.get(id),
    jumpTo: (id) => {
      const position = agentChangePositions.get(id)
      if (position !== undefined) editor?.reveal(position)
    },
    revert: (id) => {
      const result = session.revert(id)
      if (!result.ok) {
        chrome.setStatus('error', `Could not revert — ${result.reason}`)
        return false
      }
      // The view is updated by the accepted-change mirror below, not from here.
      // Replacing the whole document instead lost unrelated blocks: the session
      // had reverted correctly and the replacement was what damaged it.
      chrome.setStatus('dirty')
      chrome.refreshStatistics()
      paintNotes()
      activityTimeline.repaint()
      return true
    },
  })
  documentSurface?.append(activityTimeline.host)

  /**
   * Mirrors a reverted transaction into the visible view.
   *
   * The same path an agent edit takes, deliberately: one accepted-change stream,
   * one way of getting a change the editor did not make onto the screen
   * (ADR-0006). Reverting by re-rendering the whole document from the snapshot
   * looked equivalent and was not — it dropped blocks the revert had correctly
   * left alone, because a whole-document replace is not the change that was
   * accepted.
   */
  const stopRevertMirror = session.onAccepted((change) => {
    if (change.actorId !== 'activity' || change.steps === undefined) return
    editor?.applyRemoteSteps(change.steps, 'activity')
  })

  const agentController = createAgentController({
    session,
    editor: {
      applyRemoteSteps: (steps, actorId) => editor?.applyRemoteSteps(steps, actorId) ?? false,
      selectionRange: () => editor?.selectionRange(),
      reveal: (range) => editor?.reveal(range.from),
      documentText: () => editor?.noteDocumentText() ?? session.snapshot().markdown,
      documentRangeAt: (offset, length) => editor?.documentRangeAt(offset, length),
      showScope: (range) => editor?.showAgentScope(range),
    },
    panel: agentPanel,
    status: agentStatus,
    conversation,
    provider: () => agentProvider?.(),
    noteHandle: () => options.noteRowId?.() ?? session.documentHandle(),
    onAcceptedAt: (transactionId, from) => {
      agentChangePositions.set(transactionId, from)
      activityTimeline.repaint()
    },
    onAgentEdit: (handle) => {
      // Two writes, both needed. The tally is the durable one the next render
      // reads from; patching the row is only so the marker appears now, without
      // a repaint that would re-run the sort and reorder the list.
      const changes = agentEdits.record(handle)
      if (changes > 0) chrome.applyAgentEdits(handle, changes)
    },
  })

  let waitingReattachId: string | undefined
  /** The thread whose passage the agent is working on, for the rail's own line. */
  let agentBusyThreadId: string | undefined
  /**
   * Whether the reader has hidden the notes rail.
   *
   * Reset whenever the note set changes, so hiding is a dismissal of what is on
   * screen now rather than a preference that silently swallows the next note.
   */
  let noteRailHidden = false

  const closeNoteStack = (): void => {
    noteStackHost.replaceChildren()
  }

  // A host with no identity port has no front matter to consult: the handle
  // is the document's identity, on read and on ensure alike, so the key the
  // composer saves under is the key a reload lists.
  const identity: NoteIdentity =
    ports.identity ??
    {
      readId: async (handle) => handle,
      ensureId: async (handle) => ({ id: handle }),
    }
  const persist: ThreadStore = ports.threads ?? new LocalThreadStore(storage)
  const store: ThreadStore = {
    list: (noteKey) => persist.list(noteKey),
    save: async (thread) => {
      await persist.save(thread)
      noteThreads = [...noteThreads.filter((candidate) => candidate.id !== thread.id), thread]
    },
    remove: async (noteKey, threadId) => {
      await persist.remove(noteKey, threadId)
      noteThreads = noteThreads.filter((thread) => thread.id !== threadId)
    },
  }
  // Without a front-matter id the key is derived from the handle the same way
  // the composer's `degradedKey` derives it. The raw handle is a path, and the
  // native store refuses a key with a separator in it — a refusal that once
  // took the whole composition down on every open of an id-less note.
  const noteKeyForOpenDocument = async (): Promise<string> => {
    const handle = session.documentHandle()
    return (await identity.readId(handle)) ?? noteKeyForPath(handle)
  }
  // Notes are a layer over the document, so a store that cannot answer costs
  // exactly the notes: the document still opens, and the shell says why.
  let noteThreads: readonly Thread[] = []
  let notesLoadError: string | undefined
  try {
    noteThreads = await persist.list(await noteKeyForOpenDocument())
  } catch (error) {
    notesLoadError = error instanceof Error ? error.message : String(error)
  }

  const persistDerivedAnchors = async (): Promise<void> => {
    if (editor === undefined) return
    const derived = editor.currentNoteAnchors()
    const persisted = await persist.list(await noteKeyForOpenDocument())
    const persistedById = new Map(persisted.map((thread) => [thread.id, thread]))
    for (const thread of noteThreads) {
      if (thread.state !== 'open') continue
      const next = derived[thread.id]
      if (next === undefined) continue
      const previous = persistedById.get(thread.id)
      if (previous !== undefined && anchorsEqual(previous.anchor, next)) continue
      await persist.save({ ...thread, anchor: next })
    }
  }

  const applyWaitingReattach = (): void => {
    if (waitingReattachId === undefined || editor === undefined) return
    const anchor = editor.anchorFromSelection()
    if (anchor === undefined) return
    const thread = noteThreads.find((candidate) => candidate.id === waitingReattachId)
    if (thread === undefined) return
    waitingReattachId = undefined
    void store.save({ ...thread, anchor }).then(() => paintNotes())
  }

  /** Note ids and turn counts the rail last painted, to notice a real change. */
  let paintedNoteSignature = ''

  paintNotes = (): void => {
    if (editor === undefined) return
    // Hiding dismisses what is on screen now. A note arriving, resolving, or
    // gaining a turn is new information, so it brings the rail back rather than
    // being swallowed by an earlier dismissal.
    const signature = noteThreads
      .filter((thread) => thread.state === 'open')
      .map((thread) => `${thread.id}:${thread.replies?.length ?? 0}`)
      .sort()
      .join('|')
    if (signature !== paintedNoteSignature) {
      paintedNoteSignature = signature
      noteRailHidden = false
    }
    const derived = editor.currentNoteAnchors()
    noteThreads = noteThreads.map((thread) => {
      if (thread.state !== 'open') return thread
      const next = derived[thread.id]
      return next === undefined ? thread : { ...thread, anchor: next }
    })
    const text = editor.noteDocumentText()
    editor.setNoteThreads(noteThreads)
    if (noteRailHidden) {
      // Hiding hides the rail, and nothing else. Returning before this point
      // skipped `setNoteThreads` as well, so a dismissal also stopped painting
      // the passage tints — and then scrolling to a note showed nothing at all.
      // The tints are in the document; they are not the rail's to take away.
      noteRailHost.replaceChildren()
      return
    }
    renderNoteRail(noteRailHost, noteThreads, {
      resolve: (id) => {
        waitingReattachId = undefined
        const thread = noteThreads.find((candidate) => candidate.id === id)
        if (thread === undefined) return
        void store.save(resolveThread(thread)).then(() => paintNotes())
      },
      reopen: (id) => {
        waitingReattachId = undefined
        const thread = noteThreads.find((candidate) => candidate.id === id)
        if (thread === undefined) return
        void store.save({ ...thread, state: 'open' }).then(() => paintNotes())
      },
      editBody: (id, body) => {
        const thread = noteThreads.find((candidate) => candidate.id === id)
        if (thread === undefined) return
        void store.save({ ...thread, body }).then(() => paintNotes())
      },
      detach: (id) => {
        waitingReattachId = undefined
        const thread = noteThreads.find((candidate) => candidate.id === id)
        if (thread === undefined) return
        void store.save(detachThread(thread)).then(() => paintNotes())
      },
      remove: (id) => {
        if (waitingReattachId === id) waitingReattachId = undefined
        const thread = noteThreads.find((candidate) => candidate.id === id)
        if (thread === undefined) return
        void store.remove(thread.noteKey, id).then(() => paintNotes())
      },
      reattach: (id) => {
        waitingReattachId = id
        paintNotes()
      },
      // `.catch` rather than bare `void`: an unhandled rejection here is a
      // button that does nothing and says nothing.
      askAgent: (id) => {
        askAgentForThread(id).catch((error: unknown) => {
          chrome.setStatus('error', `Ask agent failed — ${String(error)}`)
        })
      },
      sendTurn: (id, mode, body) => {
        sendThreadTurn(id, mode, body).catch((error: unknown) => {
          chrome.setStatus('error', `Could not send — ${String(error)}`)
        })
      },
    }, text, waitingReattachId, {
      renderMarkdown: (markdown) => stepAdapter.renderMarkdown(markdown),
      ...(agentBusyThreadId === undefined ? {} : { busyThreadId: agentBusyThreadId }),
      onHide: () => {
        noteRailHidden = true
        noteRailHost.replaceChildren()
      },
    })
  }

  /**
   * Ask the agent to act on one note's passage (AGENT-9).
   *
   * The note body is the instruction and the anchor is the scope, which is the
   * wireframe's invocation: you select the passage, then ask. The anchor is
   * matched against the editor's own text and mapped to document positions
   * there, so the scope is the passage as it reads *now* rather than where it
   * was when the note was written.
   */
  async function askAgentForThread(id: string): Promise<void> {
    const thread = noteThreads.find((candidate) => candidate.id === id)
    if (thread === undefined) return
    // Every refusal below says so in the thread. Pressing Ask agent and getting
    // silence is the worst outcome available: there is no way to tell a refusal
    // from a hang, and nothing on screen to act on.
    if (thread.anchor === undefined) {
      await recordThreadReply(id, 'agent', 'This note is not on a passage, so there is nothing to act on.')
      return
    }
    const instruction = thread.body.trim()
    if (instruction === '') {
      await recordThreadReply(id, 'agent', 'This note is empty. Write what you want changed, then ask again.')
      return
    }

    const text = editor?.noteDocumentText() ?? session.snapshot().markdown
    const offset = matchAnchor(thread.anchor, text)
    if (offset === undefined) {
      // An orphan has no passage to scope to, and guessing one is exactly what
      // the anchor rules forbid.
      await recordThreadReply(id, 'agent', 'This note is no longer on a passage, so there is nothing to scope to.')
      return
    }
    const range = editor?.documentRangeAt(offset, thread.anchor.quote.length)
    if (range === undefined) {
      await recordThreadReply(
        id,
        'agent',
        'The passage this note is on could not be located in the open document.',
      )
      return
    }

    agentBusyThreadId = thread.id
    paintNotes()
    try {
      const answer = await agentController.runForPassage(instruction, range)
      await recordThreadReply(id, 'agent', answer)
    } catch (error) {
      // An unguarded rejection here is invisible: the busy line clears and
      // nothing explains why, which is the failure mode this whole branch was
      // opened to remove.
      const message = error instanceof Error ? error.message : String(error)
      await recordThreadReply(id, 'agent', `Could not run — ${message}`)
    } finally {
      agentBusyThreadId = undefined
      paintNotes()
    }
  }

  /** A turn typed into the passage conversation. `redirect` also fences. */
  async function sendThreadTurn(
    id: string,
    mode: 'note' | 'redirect',
    body: string,
  ): Promise<void> {
    await recordThreadReply(id, 'local', body, mode)
    if (mode === 'note') return
    const thread = noteThreads.find((candidate) => candidate.id === id)
    if (thread === undefined) return
    const text = editor?.noteDocumentText() ?? session.snapshot().markdown
    const offset = thread.anchor === undefined ? undefined : matchAnchor(thread.anchor, text)
    const range = offset === undefined || thread.anchor === undefined
      ? undefined
      : editor?.documentRangeAt(offset, thread.anchor.quote.length)
    agentBusyThreadId = id
    paintNotes()
    try {
      const answer = await agentController.redirectForPassage(body, range)
      await recordThreadReply(id, 'agent', answer)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await recordThreadReply(id, 'agent', `Could not run — ${message}`)
    } finally {
      agentBusyThreadId = undefined
      paintNotes()
    }
  }

  async function recordThreadReply(
    id: string,
    author: string,
    body: string,
    mode?: 'note' | 'redirect',
  ): Promise<void> {
    const thread = noteThreads.find((candidate) => candidate.id === id)
    if (thread === undefined) return
    const next = appendReply(thread, {
      id: `${id}-${(thread.replies?.length ?? 0) + 1}`,
      author,
      createdAt: new Date().toISOString(),
      body,
      ...(mode === undefined ? {} : { mode }),
    })
    try {
      await store.save(next)
    } catch {
      // A sidecar that cannot be written costs the transcript, not the edit
      // that already landed. Keep the turn in memory so the rail still shows it.
      noteThreads = [...noteThreads.filter((candidate) => candidate.id !== id), next]
    }
    paintNotes()
  }
  const notes: AppComposition['notes'] = {
    setThreadsForTest: (threads) => {
      waitingReattachId = undefined
      closeNoteStack()
      noteThreads = threads
      paintNotes()
      const hook = notes.onThreadsForTest
      if (typeof hook === 'function') hook(threads)
    },
    selectTextForTest: (quote) => {
      const ok = editor?.selectQuote(quote) ?? false
      if (ok) applyWaitingReattach()
      return ok
    },
    replaceTextForTest: (from, to) => {
      editor?.replaceTextForTest(from, to)
    },
    currentAnchorsForTest: () => editor?.currentNoteAnchors() ?? {},
    reload: async () => {
      try {
        noteThreads = await persist.list(await noteKeyForOpenDocument())
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        chrome.setStatus('error', `Notes for this document could not be read — ${message}`)
        return
      }
      closeNoteStack()
      paintNotes()
    },
  }
  paintNotes()
  if (notesLoadError !== undefined) {
    chrome.setStatus('error', `Notes for this document could not be read — ${notesLoadError}`)
  }

  const noteCapture =
    editor === undefined
      ? { destroy: () => {}, capture: async () => {} }
      : editor.installNoteCapture({
          store,
          identity,
          handle: () => session.documentHandle(),
          degradedKey: noteKeyForPath,
          onSaved: () => paintNotes(),
          onNeedSelection: () => chrome.setStatus('error', NEED_SELECTION),
          onSaveFailed: (message) => chrome.setStatus('error', `Could not save the note — ${message}`),
          onIdentityWritten: (markdown) => {
            session.adoptDiskWrite(markdown)
            editor.adoptFrontMatter(markdown)
          },
        })
  captureNote = noteCapture.capture

  const onNotesEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    if (waitingReattachId !== undefined) {
      event.preventDefault()
      waitingReattachId = undefined
      paintNotes()
    }
    closeNoteStack()
  }
  const onEditorSelectionSettled = (): void => {
    applyWaitingReattach()
  }
  const onDocumentClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('.sm-note-stack') !== null) return
    const tint = target.closest('.sm-note-anchor')
    if (tint === null) {
      closeNoteStack()
      return
    }
    const ids = (tint.getAttribute('data-threads') ?? '').split(/\s+/).filter((id) => id !== '')
    const stacked = ids.flatMap((id) => noteThreads.filter((thread) => thread.id === id))
    renderNoteStack(noteStackHost, stacked, tint.getBoundingClientRect())
  }
  chrome.editorHost.addEventListener('mouseup', onEditorSelectionSettled)
  chrome.editorHost.addEventListener('keyup', onEditorSelectionSettled)
  chrome.element.ownerDocument.addEventListener('click', onDocumentClick)
  chrome.element.ownerDocument.addEventListener('keydown', onNotesEscape)

  /**
   * Moving between notes on ⌘⌥ plus an arrow.
   *
   * The same double surface `find` uses, and for the same reason: the browser
   * shell has no menubar, so a DOM listener is the only way the shortcut exists
   * there at all. It does not double-fire in the native app — AppKit's native
   * bridge claims the chord before the webview's responder chain sees it, so
   * exactly one of the two paths runs on each platform. That matters more here
   * than it does for `find`, which is idempotent; going back twice on one
   * keypress would not be.
   */
  const NOTE_NAVIGATION: Readonly<Record<string, DocumentCommandId>> = {
    ArrowLeft: 'historyBack',
    ArrowRight: 'historyForward',
    ArrowUp: 'previousNote',
    ArrowDown: 'nextNote',
  }
  chrome.element.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey) return
    const command = NOTE_NAVIGATION[event.key]
    if (command === undefined) return
    // Only claim the keystroke once the command is actually available, so a
    // dead end falls through to whatever the platform would otherwise do
    // rather than being silently swallowed.
    if (!commandState(command).enabled) return
    event.preventDefault()
    runCommand(command)
  })

  /**
   * Copy As, in every flavour (EDITOR-10).
   *
   * The selection is converted by the shared `domain` rules and only then
   * handed to a platform clipboard, so a browser and the native shell produce
   * identical bytes. Nothing here writes to the document: copy never mutates
   * the file.
   *
   * A refused clipboard is reported. Browsers can decline a write for reasons
   * the document cannot control, and a success message for something that did
   * not happen is exactly the silent-wrong-state this product refuses.
   */
  async function copySelection(
    id: DocumentCommandId,
    snapshot?: { readonly markdown: string; readonly html: string },
  ): Promise<void> {
    const port = ports.clipboard
    if (port === undefined || editor === undefined) return
    const markdown = snapshot?.markdown ?? editor.selectionMarkdown()

    let payload: { 'text/plain': string; 'text/html'?: string } | null = null
    let describe = 'Copied'

    switch (id) {
      case 'copyAsMarkdown':
        payload = { 'text/plain': markdown }
        describe = 'Copied as Markdown'
        break
      case 'copyAsPlainText':
        payload = { 'text/plain': markdownToPlainText(markdown) }
        describe = 'Copied as plain text'
        break
      case 'copyAsRichText':
        payload = {
          'text/plain': markdownToPlainText(markdown),
          'text/html': snapshot?.html ?? editor.selectionHtml(),
        }
        describe = 'Copied as rich text'
        break
      case 'copyAsHtml':
        // The markup itself is the payload here, so it travels as text.
        payload = { 'text/plain': snapshot?.html ?? editor.selectionHtml() }
        describe = 'Copied as HTML'
        break
      case 'copyCode': {
        const code = codeFenceContent(markdown)
        if (code === null) {
          chrome.setStatus('error', 'Copy Code needs a code block — put the caret inside one')
          return
        }
        payload = { 'text/plain': code }
        describe = 'Copied code'
        break
      }
      case 'copyTableAsMarkdown':
      case 'copyTableAsHtml':
      case 'copyTableAsCsv': {
        const table =
          id === 'copyTableAsCsv'
            ? markdownTableToCsv(markdown)
            : id === 'copyTableAsHtml'
              ? markdownTableToHtml(markdown)
              : markdownTableToCsv(markdown) === null
                ? null
                : markdown
        if (table === null) {
          chrome.setStatus('error', 'Copy Table needs a table — put the caret inside one')
          return
        }
        payload = { 'text/plain': table }
        describe = `Copied table as ${id === 'copyTableAsCsv' ? 'CSV' : id === 'copyTableAsHtml' ? 'HTML' : 'Markdown'}`
        break
      }
      default:
        return
    }

    const ok = await port.write(payload)
    chrome.setStatus(ok ? 'saved' : 'error', ok ? describe : 'Clipboard refused the copy')
  }

  /** Paste that deliberately drops any rich flavour the source offered. */
  async function pasteAsPlainText(): Promise<void> {
    const port = ports.clipboard
    if (port === undefined || editor === undefined) return
    const text = await port.readText()
    if (text === null) {
      chrome.setStatus('error', 'Clipboard unavailable — paste needs permission')
      return
    }
    editor.insertPlainText(text)
  }

  async function insertAsset(): Promise<void> {
    try {
      const reference = await ports.assets?.chooseReference()
      if (reference === null || reference === undefined) return
      editor?.insertAsset(reference)
      chrome.setStatus('dirty', reference.notice ?? 'Portable reference added')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not choose a file'
      chrome.setStatus('error', `File not linked — ${message}`)
    }
  }

  return {
    element: chrome.element,
    run: runCommand,
    diagram: {
      kind: () => editor?.diagram.kind() ?? null,
      setWidth: (px: number | null) => editor?.diagram.setWidth(px) ?? false,
      setFloat: (side: 'left' | 'right' | null) => editor?.diagram.setFloat(side) ?? false,
      delete: () => editor?.diagram.delete() ?? false,
      editSource: () => editor?.diagram.editSource() ?? false,
      zoomIn: () => editor?.diagram.zoomIn() ?? false,
      zoomOut: () => editor?.diagram.zoomOut() ?? false,
      zoomReset: () => editor?.diagram.zoomReset() ?? false,
      openFigure: () => editor?.diagram.openFigure() ?? false,
      copySource: () => editor?.diagram.copySource() ?? Promise.resolve(false),
      copyImage: () => editor?.diagram.copyImage() ?? Promise.resolve(false),
      saveImage: (format) => editor?.diagram.saveImage(format) ?? Promise.resolve(false),
      printFigure: () => editor?.diagram.printFigure() ?? false,
    },
    applyNoteSummary: (handle, summary) => chrome.applyNoteSummary(handle, summary),
    applyNotePreview: (handle, preview) => chrome.applyNotePreview(handle, preview),
    runNativeContextCommand: (command) => {
      if (command === 'addNote') {
        if (nativeNoteRange !== undefined) editor?.restoreSelection(nativeNoteRange)
        void captureNote()
        return
      }
      void copySelection(command, nativeContextSelection)
    },
    stylesBarVisible: () => chrome.stylesBarVisible(),
    setUpdateStatus: (status) => chrome.setUpdateStatus(status),
    commandState,
    reconcileWorkspace: (workspace) => chrome.reconcileWorkspace(workspace),
    session,
    editor,
    steps: stepAdapter.port,
    notes,
    agent: {
      toggle: () => toggleAgentPanel(),
      isPanelOpen: () => agentPanel.isOpen(),
      send: (mode: ComposerMode, markdown: string) => agentController.send(mode, markdown),
      pause: () => agentController.pause(),
      resume: () => agentController.resume(),
      stop: () => agentController.stop(),
      isRunning: () => agentController.isRunning(),
      isFollowing: () => agentStatus.isFollowing(),
      toggleActivity: () => toggleActivityPanel(),
      isActivityOpen: () => activityTimeline.isOpen(),
      setProviderForTest: (provider) => {
        agentProvider = provider === undefined ? undefined : () => provider
        agentPanel.repaint()
        paintNotes()
      },
      editsForTest: () => Object.fromEntries(agentEdits.all()),
      /** Shows the wedge banner without starving anything (BUG-13 spec). */
      triggerWedgeBannerForTest: () => showWedgeBanner(),
    },
    async destroy() {
      clearTimeout(saveTimer)
      cancelAnimationFrame(wedgeRaf)
      chrome.element.removeEventListener('keydown', onWedgeInput, true)
      chrome.element.removeEventListener('pointerdown', onWedgeInput, true)
      chrome.element.removeEventListener('keydown', onSidePanelEscape)
      stopRevertMirror()
      agentController.dispose()
      await persistDerivedAnchors()
      noteCapture.destroy()
      chrome.element.ownerDocument.removeEventListener('keydown', onNotesEscape)
      chrome.editorHost.removeEventListener('mouseup', onEditorSelectionSettled)
      chrome.editorHost.removeEventListener('keyup', onEditorSelectionSettled)
      chrome.element.ownerDocument.removeEventListener('click', onDocumentClick)
      chrome.dispose()
      await editor.destroy()
      await stepAdapter.destroy()
    },
    save,
    flushPendingChanges: () => editor?.flushPendingChanges(),
    setStatus: (state, message) => chrome.setStatus(state, message),
  }
}

/** A shell preference, never part of the Markdown document. */
function loadStylesBarVisible(
  storage: Pick<Storage, 'getItem'>,
  key: string,
  fallback: boolean,
): boolean {
  try {
    const saved = storage.getItem(key)
    return saved === null ? fallback : saved === 'true'
  } catch {
    return fallback
  }
}

function saveStylesBarVisible(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  visible: boolean,
): void {
  try {
    storage.setItem(key, String(visible))
  } catch {
    // The app remains usable in private or restricted storage contexts.
  }
}

function loadStylesBarPosition(
  storage: Pick<Storage, 'getItem'>,
  key: string,
): StylesBarPosition | undefined {
  try {
    const saved = storage.getItem(key)
    if (saved === null || saved === '') return undefined
    const value = JSON.parse(saved) as Partial<StylesBarPosition>
    if (
      typeof value.x !== 'number' || !Number.isFinite(value.x) || value.x < 0 || value.x > 1 ||
      typeof value.y !== 'number' || !Number.isFinite(value.y) || value.y < 0 || value.y > 1
    ) return undefined
    return { x: value.x, y: value.y }
  } catch {
    return undefined
  }
}

function saveStylesBarPosition(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  position: StylesBarPosition | undefined,
): void {
  try {
    storage.setItem(key, position === undefined ? '' : JSON.stringify(position))
  } catch {
    // Moving optional chrome must never interfere with editing.
  }
}

const PREFERENCES_KEY = 'simplemark.reader-preferences'

/**
 * The width below which the note list and the document cannot share a row.
 *
 * Must equal the `max-width: 620px` breakpoint in `app.css`, where
 * `.document-surface` is hidden outright.
 */
const SINGLE_PANE_WIDTH = 620

/**
 * Which pane a single-pane viewport is showing — navigation, not a preference.
 *
 * Below the breakpoint the list and the document are two screens rather than a
 * split view that got narrow, so "which one am I on" follows from whether a note
 * is open: reading one means you are on it, and having none means you are in the
 * list. Deciding it here rather than in the chrome is what makes it survive —
 * opening a note tears the composition down and builds a new one, so a mode
 * written onto the old DOM is gone moments later.
 *
 * Returns undefined on a viewport that can show both, where the mode really is
 * a remembered preference.
 */
function singlePaneWorkspaceMode(workspace: WorkspaceOptions | undefined): WorkspaceMode | undefined {
  const singlePane = globalThis.matchMedia?.(`(max-width: ${SINGLE_PANE_WIDTH}px)`).matches === true
  if (!singlePane || workspace === undefined) return undefined
  return workspace.activeNoteId === '' ? 'all' : 'editor'
}

function loadWorkspaceMode(storage: Pick<Storage, 'getItem'>): WorkspaceMode {
  try {
    const stored = storage.getItem(WORKSPACE_MODE_KEY)
    return stored === 'all' || stored === 'notes' || stored === 'editor' ? stored : 'all'
  } catch {
    return 'all'
  }
}

function saveWorkspaceMode(
  storage: Pick<Storage, 'setItem'>,
  mode: WorkspaceMode,
): void {
  try {
    storage.setItem(WORKSPACE_MODE_KEY, mode)
  } catch {
    // Losing optional shell state must never interfere with editing.
  }
}

function readPreferenceStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  // Private-browsing and sandboxed contexts throw on access rather than
  // returning null, so a missing store must not take the editor down with it.
  try {
    return window.localStorage
  } catch {
    return { getItem: () => null, setItem: () => {} }
  }
}

function loadPreferences(storage: Pick<Storage, 'getItem'>): ReaderPreferences {
  try {
    const raw = storage.getItem(PREFERENCES_KEY)
    return raw === null ? DEFAULT_PREFERENCES : normalisePreferences(JSON.parse(raw))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function savePreferences(
  storage: Pick<Storage, 'setItem'>,
  preferences: ReaderPreferences,
): void {
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // A preference that cannot be persisted is not worth failing an edit over.
  }
}

function applyPreferences(preferences: ReaderPreferences): void {
  const root = document.documentElement
  root.dataset['readerTheme'] = preferences.theme
  for (const [name, value] of Object.entries(preferenceVariables(preferences))) {
    root.style.setProperty(name, value)
  }
}

function anchorsEqual(left: Anchor | undefined, right: Anchor): boolean {
  return (
    left !== undefined &&
    left.quote === right.quote &&
    left.prefix === right.prefix &&
    left.suffix === right.suffix &&
    left.blockIndex === right.blockIndex
  )
}
