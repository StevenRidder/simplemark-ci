import type { AssetReferencePort, DiagramRenderer, DocumentLinkPort, FilePort } from '../application/index.js'
import { DocumentSession } from '../application/index.js'
import { MilkdownEditor } from '../adapters/editor/milkdown-editor.js'
import { createWindowChrome } from './ui/window-chrome.js'
import { createFindBar } from './ui/find-bar.js'
import type { EditorCommand } from './ui/window-chrome.js'
import { COMMANDS } from '../application/index.js'
import type { DocumentCommandId } from '../application/index.js'
import type { WindowChrome } from './ui/window-chrome.js'
import type { SaveState } from './ui/window-chrome.js'
import type { WorkspaceOptions } from './ui/window-chrome.js'
import type { WorkspaceMode } from './ui/window-chrome.js'
import type { StylesBarPosition } from './ui/window-chrome.js'
import {
  DEFAULT_PREFERENCES,
  nextScale,
  normalisePreferences,
  preferenceVariables,
} from './reader-preferences.js'
import type { ReaderPreferences } from './reader-preferences.js'
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
  readonly diagrams: DiagramRenderer
}

export interface AppComposition {
  readonly element: HTMLElement
  readonly session: DocumentSession
  readonly editor: MilkdownEditor
  /** Tears down the editor and presentation observers before remounting. */
  destroy(): Promise<void>
  /** Flushes any pending debounced save. */
  save(): Promise<void>
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
  /** Whether the optional styles bar is showing, for the View menu checkmark. */
  stylesBarVisible(): boolean
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
  /** Debounce for save-on-pause. Zero disables the timer so tests drive save directly. */
  readonly autosaveMs?: number
  /** Honest confirmation for platforms that save a downloaded replacement. */
  readonly saveSuccessMessage?: string
  /**
   * Whether the optional styles bar starts visible when nothing is stored yet.
   * The native shell passes `false`: its menubar already carries every command,
   * so the bar would open as pure duplication.
   */
  readonly stylesBarDefault?: boolean
  /** Platform hook for opening a real file; absent when the platform cannot. */
  readonly onOpenFile?: () => void
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
  /** Shared navigation supplied by the platform composition root. */
  readonly workspace?: WorkspaceOptions
  /** Which platform owns the application chrome around the shared workspace. */
  readonly chromeMode?: 'web' | 'macos'
}

const STYLES_BAR_KEY = 'simplemark.styles-bar-visible'
const STYLES_BAR_POSITION_KEY = 'simplemark.styles-bar-position'

export async function composeApp(options: ComposeOptions): Promise<AppComposition> {
  const { ports } = options
  const session = await DocumentSession.open(ports.file)

  // Reader preferences are app state, never document content (D6). They are
  // applied to the document root so one multiplier and one palette drive the
  // whole page rather than any selection.
  const storage = options.preferenceStorage ?? readPreferenceStorage()
  const stylesBarKey = `${STYLES_BAR_KEY}.${options.chromeMode ?? 'web'}`
  const stylesBarPositionKey = `${STYLES_BAR_POSITION_KEY}.${options.chromeMode ?? 'web'}`
  let preferences = loadPreferences(storage)
  let stylesBarVisible = loadStylesBarVisible(storage, stylesBarKey, options.stylesBarDefault ?? true)
  let stylesBarPosition = loadStylesBarPosition(storage, stylesBarPositionKey)
  applyPreferences(preferences)

  let editor: MilkdownEditor | undefined
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
        void editor?.convertBlockToDiagram()
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
        return
      case 'newNote':
        options.workspace?.onCreateNote?.()
        return
      case 'save':
        void save()
        return
      case 'print':
        options.onPrint?.()
        return
      case 'insertAsset':
        void insertAsset()
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
      case 'toggleBacklinks':
        chrome.toggleInfoTab('backlinks')
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
    if (id === 'openFolder') return { enabled: false, checked: false }
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
    if (id === 'toggleStylesBar') return { enabled: true, checked: chrome.stylesBarVisible() }
    if (id === 'toggleWordCount') return { enabled: true, checked: chrome.wordCountVisible() }
    if (id === 'toggleStatistics') return { enabled: true, checked: chrome.infoTab() === 'statistics' }
    if (id === 'contents') return { enabled: true, checked: chrome.infoTab() === 'contents' }
    if (id === 'toggleBacklinks') return { enabled: true, checked: chrome.infoTab() === 'backlinks' }
    if (id === 'toggleHistoryNavigation') {
      return { enabled: true, checked: chrome.historyNavigationVisible() }
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
    if (id === 'actualSize') return { enabled: preferences.scale !== 1, checked: false }

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
  const save = async (): Promise<void> => {
    clearTimeout(saveTimer)
    const result = await session.save()
    if (result.ok) {
      chrome.setStatus('saved', options.saveSuccessMessage)
      return
    }
    chrome.setStatus('error', `Not saved — ${result.reason}`)
  }

  chrome = createWindowChrome({
    chromeMode: options.chromeMode ?? 'web',
    fileName: session.name,
    filePath: options.filePath,
    onOpenFile: options.onOpenFile,
    openFileUnavailableReason: options.openFileUnavailableReason,
    workspace: options.workspace,
    onSave: () => void save(),
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
    onMarkdownChanged: (markdown) => {
      const before = session.snapshot()
      const result = session.apply({
        actorId: 'human',
        name: 'Edit',
        expectedRevision: before.revision,
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
      if (autosaveMs > 0) {
        // Debounced save on pause, never per keystroke (DESIGN.md §8).
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => void save(), autosaveMs)
      }
    },
  })

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
    stylesBarVisible: () => chrome.stylesBarVisible(),
    commandState,
    reconcileWorkspace: (workspace) => chrome.reconcileWorkspace(workspace),
    session,
    editor,
    async destroy() {
      clearTimeout(saveTimer)
      chrome.dispose()
      await editor.destroy()
    },
    save,
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
