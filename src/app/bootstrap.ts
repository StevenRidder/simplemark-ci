import type { AssetReferencePort, DiagramRenderer, FilePort } from '../application/index.js'
import { DocumentSession } from '../application/index.js'
import { MilkdownEditor } from '../adapters/editor/milkdown-editor.js'
import { createWindowChrome } from './ui/window-chrome.js'
import { createFindBar } from './ui/find-bar.js'
import type { EditorCommand } from './ui/window-chrome.js'
import type { WindowChrome } from './ui/window-chrome.js'
import type { SaveState } from './ui/window-chrome.js'
import { DEFAULT_PREFERENCES, normalisePreferences, preferenceVariables } from './reader-preferences.js'
import type { ReaderPreferences } from './reader-preferences.js'

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
  readonly diagrams: DiagramRenderer
}

export interface AppComposition {
  readonly element: HTMLElement
  readonly session: DocumentSession
  readonly editor: MilkdownEditor
  /** Flushes any pending debounced save. */
  save(): Promise<void>
  /** Shows a truthful platform or file-reference limitation in the shell. */
  setStatus(state: SaveState, message: string): void
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
  /** Platform hook for opening a real file; absent when the platform cannot. */
  readonly onOpenFile?: () => void
  /** Shown on the disabled open control when onOpenFile is absent. */
  readonly openFileUnavailableReason?: string
}

const STYLES_BAR_KEY = 'simplemark.styles-bar-visible'

export async function composeApp(options: ComposeOptions): Promise<AppComposition> {
  const { ports } = options
  const session = await DocumentSession.open(ports.file)

  // Reader preferences are app state, never document content (D6). They are
  // applied to the document root so one multiplier and one palette drive the
  // whole page rather than any selection.
  const storage = options.preferenceStorage ?? readPreferenceStorage()
  let preferences = loadPreferences(storage)
  let stylesBarVisible = loadStylesBarVisible(storage)
  applyPreferences(preferences)

  let editor: MilkdownEditor | undefined
  let chrome: WindowChrome
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
    fileName: session.name,
    filePath: options.filePath,
    onOpenFile: options.onOpenFile,
    openFileUnavailableReason: options.openFileUnavailableReason,
    onSave: () => void save(),
    onInsertAsset: ports.assets === undefined
      ? undefined
      : () => void insertAsset(),
    stylesBarVisible,
    onStylesBarVisibleChange: (visible) => {
      stylesBarVisible = visible
      saveStylesBarVisible(storage, visible)
    },
    preferences,
    onPreferences: (next) => {
      preferences = next
      applyPreferences(next)
      savePreferences(storage, next)
    },
    onContinueWriting: () => editor?.continueAfterLastBlock(),
    // The temporary contents popover (EDITOR-3) reads the outline fresh on
    // every open and navigates through the editor — the chrome itself never
    // holds document state.
    getOutline: () => editor?.outline() ?? [],
    onNavigate: (pos) => editor?.navigateToHeading(pos),
    onCommand: (command: EditorCommand) => {
      if (command === 'convertToDiagram') {
        void editor?.convertBlockToDiagram()
        return
      }
      editor?.runCommand(command)
    },
  })

  editor = await MilkdownEditor.mount({
    mount: chrome.editorHost,
    initialMarkdown: session.snapshot().markdown,
    renderer: ports.diagrams,
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
    session,
    editor,
    save,
    setStatus: (state, message) => chrome.setStatus(state, message),
  }
}

/** A shell preference, never part of the Markdown document. */
function loadStylesBarVisible(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    const saved = storage.getItem(STYLES_BAR_KEY)
    return saved === null ? true : saved === 'true'
  } catch {
    return true
  }
}

function saveStylesBarVisible(storage: Pick<Storage, 'setItem'>, visible: boolean): void {
  try {
    storage.setItem(STYLES_BAR_KEY, String(visible))
  } catch {
    // The app remains usable in private or restricted storage contexts.
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
